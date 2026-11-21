import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  AutomationChannel,
  AutomationDelegationInput,
  AutomationGrant,
  ConnectServer,
  DelegatedMessageStatus,
  DelegatedMessageWithdrawal,
  WhatsAppPayload,
} from "@eulab/connect/server";
import { Prisma, type NotificationAutomationGrant } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { connectApplication } from "../../common/connect-application";
import { connectHttpError } from "../../common/connect-http";
import {
  canUseLocalFunction,
  type FunctionKey,
} from "../../common/function-catalog";
import {
  loadConnectConfig,
  openConnect,
  sealConnect,
} from "../../common/connect-runtime";
import {
  requireTenantId,
  requireUser,
  resolveRequestSession,
} from "../../common/request-session";
import { resolveOperationalScope } from "../locations/operational-scope";
import { NotificationAutomationCommandStore } from "./notification-automation-command-store.service";

const loadSdk = new Function(
  "return import('@eulab/connect/server')",
) as () => Promise<typeof import("@eulab/connect/server")>;
const purpose = "appointments.automation";
export const CUSTOMER_COMMAND_PURPOSE = "appointments.customer_commands";
const functions = (channel: AutomationChannel, customerCommands = false) =>
  customerCommands
    ? ["appointments.update.all", "notifications.manage"]
    : channel === "whatsapp"
      ? ["whatsapp.manage", "whatsapp.send"]
      : ["notifications.manage"];
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const statusCode = (error: unknown) =>
  error && typeof error === "object" && "status" in error
    ? error.status
    : undefined;
function providerError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  const status = statusCode(error);
  if (status === 400)
    throw new BadRequestException("Dati della delega non validi");
  if (status === 401)
    throw new UnauthorizedException("Ripeti l’accesso Connect");
  if (status === 403)
    throw new ForbiddenException(
      "Delega non autorizzata dai permessi o dalla licenza corrente",
    );
  if (status === 409)
    throw new ConflictException(
      "La richiesta precedente ha dati diversi. Recupera lo stesso comando.",
    );
  if (status === 404) throw new NotFoundException("Delega non disponibile");
  throw new ServiceUnavailableException(
    "Connect non disponibile. Recupera la stessa richiesta senza creare una nuova autorizzazione.",
  );
}

/** Persistent commands and encrypted secrets belong to ALORA; Connect owns grant authorization/outbox. */
@Injectable()
export class NotificationAutomationGrantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: NotificationAutomationCommandStore,
  ) {}

  async withWhatsAppOperator<T>(
    auth: string | undefined,
    operation: (
      client: ConnectServer,
      token: string,
      actor: {
        tenantId: string;
        userId: string;
        subject: string;
        installationId: string;
        appId: string;
        appOrigin: string;
      },
    ) => Promise<T>,
  ): Promise<T> {
    const ctx = await this.author(auth, "whatsapp");
    try {
      const app = await connectApplication(this.prisma);
      return await app.services(
        openConnect(ctx.linked.sdkSessionCipher!),
        (client, token) =>
          operation(client, token, {
            tenantId: ctx.tenantId,
            userId: ctx.user.id,
            subject: ctx.subject,
            installationId: ctx.binding.installationId,
            appId: ctx.binding.appId,
            appOrigin: new URL(ctx.binding.returnUrl).origin,
          }),
      );
    } catch (error) {
      return providerError(error);
    }
  }

  private async author(
    auth: string | undefined,
    channel?: AutomationChannel,
    customerCommands = false,
  ) {
    const session = await resolveRequestSession(this.prisma, auth),
      user = requireUser(session),
      tenantId = requireTenantId(session);
    const required: FunctionKey[] = [
      "notifications.manage",
      ...(customerCommands ? ["appointments.update.all" as const] : []),
      ...(channel === "whatsapp"
        ? ([
            "whatsapp.read",
            "whatsapp.manage",
            "whatsapp.send",
          ] as FunctionKey[])
        : []),
    ];
    if (
      user.technicalAccess ||
      user.role === "platform_admin" ||
      !required.every((key) => canUseLocalFunction(user, key))
    )
      throw new ForbiddenException(
        "Permessi espliciti per le automazioni richiesti",
      );
    const scope = await resolveOperationalScope(this.prisma, session);
    if (
      scope.allowedSectorIds.length !==
      (await this.prisma.sector.count({ where: { tenantId } }))
    )
      throw new ForbiddenException(
        "Le automazioni sono condivise dall’attività: occorre accesso a tutti i settori",
      );
    const linked = session.connectSessionId
      ? await this.prisma.connectSession.findFirst({
          where: {
            id: session.connectSessionId,
            userId: user.id,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { sdkSessionCipher: true, installationId: true },
        })
      : null;
    if (!linked?.sdkSessionCipher)
      throw new UnauthorizedException("Accedi tramite Connect");
    const binding = await loadConnectConfig(this.prisma, tenantId);
    if (!binding || binding.installationId !== linked.installationId)
      throw new ForbiddenException("Collegamento dell’attività da verificare");
    const identity = await this.prisma.user.findFirst({
      where: { id: user.id, tenantId, isActive: true },
      select: { connectSubject: true, connectInstallationId: true },
    });
    if (
      !identity?.connectSubject ||
      identity.connectInstallationId !== binding.installationId
    )
      throw new ForbiddenException("Identità Connect locale da verificare");
    return {
      user,
      tenantId,
      linked,
      binding,
      subject: identity.connectSubject,
    };
  }
  private view(row: NotificationAutomationGrant) {
    const request = row.request as unknown as AutomationDelegationInput;
    return {
      id: row.id,
      channel: row.channel,
      useCase:
        request.purpose === CUSTOMER_COMMAND_PURPOSE
          ? "customer_commands"
          : "notifications",
      status: row.status,
      archiveId: request.archiveId || null,
      sessionId: row.sessionId,
      expiresAt: request.expiresAt,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  async list(auth?: string) {
    const ctx = await this.author(auth);
    const rows = await this.prisma.notificationAutomationGrant.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    return rows.map((row) => this.view(row));
  }
  async prepare(auth: string | undefined, body: Record<string, unknown>) {
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (key) =>
          ![
            "idempotencyKey",
            "channel",
            "archiveId",
            "validDays",
            "useCase",
          ].includes(key),
      ) ||
      typeof body["idempotencyKey"] !== "string" ||
      !uuid.test(body["idempotencyKey"]) ||
      !["whatsapp", "email", "application_notification"].includes(
        String(body["channel"]),
      ) ||
      !Number.isInteger(body["validDays"]) ||
      Number(body["validDays"]) < 1 ||
      Number(body["validDays"]) > 365
    )
      throw new BadRequestException("Richiesta di autorizzazione non valida");
    const channel = body["channel"] as AutomationChannel;
    const customerCommands = body["useCase"] === "customer_commands";
    if (
      (body["useCase"] !== undefined &&
        !["notifications", "customer_commands"].includes(
          String(body["useCase"]),
        )) ||
      (customerCommands && channel !== "application_notification")
    )
      throw new BadRequestException("Finalità della delega non valida");
    if (
      channel === "whatsapp"
        ? typeof body["archiveId"] !== "string" || !uuid.test(body["archiveId"])
        : body["archiveId"] !== undefined
    )
      throw new BadRequestException("Archivio della delega non valido");
    const ctx = await this.author(auth, channel, customerCommands),
      key =
        "alora-grant-" +
        hash([ctx.tenantId, ctx.user.id, body["idempotencyKey"]]);
    const fingerprint = hash([
      channel,
      body["archiveId"] || null,
      body["validDays"],
      ...(customerCommands ? ["customer_commands"] : []),
    ]);
    let row = await this.prisma.notificationAutomationGrant.findUnique({
      where: {
        tenantId_requestKey: { tenantId: ctx.tenantId, requestKey: key },
      },
    });
    if (!row) {
      let sessionId: string | null = null;
      if (channel === "whatsapp") {
        try {
          const app = await connectApplication(this.prisma);
          const sessions = await app.services(
            openConnect(ctx.linked.sdkSessionCipher!),
            (client, token) => client.whatsapp(token).sessions(),
          );
          sessionId =
            sessions.find(
              (s) =>
                s.archive_id === body["archiveId"] &&
                s.state === "connected" &&
                s.runner_online &&
                !s.closed_at,
            )?.id || null;
        } catch (e) {
          if (e instanceof HttpException) throw e;
          return connectHttpError(e);
        }
        if (!sessionId)
          throw new ConflictException(
            "Collega il numero e attendi che il servizio sia disponibile",
          );
      }
      const request: AutomationDelegationInput = {
        purpose: customerCommands ? CUSTOMER_COMMAND_PURPOSE : purpose,
        channel,
        functions: functions(channel, customerCommands),
        ...(channel === "whatsapp"
          ? { archiveId: String(body["archiveId"]) }
          : {}),
        expiresAt: new Date(
          Date.now() + Number(body["validDays"]) * 86400000,
        ).toISOString(),
      };
      try {
        row = await this.prisma.notificationAutomationGrant.create({
          data: {
            tenantId: ctx.tenantId,
            actorUserId: ctx.user.id,
            actorSubject: ctx.subject,
            appId: ctx.binding.appId,
            installationId: ctx.binding.installationId,
            channel,
            requestKey: key,
            requestHash: fingerprint,
            request: request as unknown as Prisma.InputJsonValue,
            sessionId,
          },
        });
      } catch (e) {
        if (
          !(
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === "P2002"
          )
        )
          throw e;
        row = await this.prisma.notificationAutomationGrant.findUniqueOrThrow({
          where: {
            tenantId_requestKey: { tenantId: ctx.tenantId, requestKey: key },
          },
        });
      }
    }
    if (row.requestHash !== fingerprint)
      throw new ConflictException("La richiesta precedente ha dati diversi");
    return this.recoverWithAuthor(ctx, row);
  }
  async recover(auth: string | undefined, id: string) {
    const row = await this.prisma.notificationAutomationGrant.findUnique({
      where: { id },
    });
    const ctx = await this.author(
      auth,
      row?.channel as AutomationChannel | undefined,
    );
    if (!row || row.tenantId !== ctx.tenantId)
      throw new NotFoundException("Richiesta non disponibile");
    return this.recoverWithAuthor(ctx, row);
  }
  private async recoverWithAuthor(
    ctx: Awaited<ReturnType<NotificationAutomationGrantsService["author"]>>,
    row: NotificationAutomationGrant,
  ) {
    if (
      row.actorUserId !== ctx.user.id ||
      row.actorSubject !== ctx.subject ||
      row.appId !== ctx.binding.appId ||
      row.installationId !== ctx.binding.installationId
    )
      throw new ForbiddenException(
        "La richiesta appartiene a un altro autore o collegamento",
      );
    if (["revoked", "revocation_pending"].includes(row.status))
      return this.view(row);
    try {
      const app = await connectApplication(this.prisma);
      const result = await app.services(
        openConnect(ctx.linked.sdkSessionCipher!),
        async (client, token) => {
          const api = client.automations(token);
          if (row.grantId && row.credentialCipher)
            return {
              delegation: await api.get(row.grantId),
              credential: openConnect(row.credentialCipher),
            };
          try {
            return await api.recover(row.requestKey);
          } catch (e) {
            if (statusCode(e) !== 404) throw e;
            return api.create(
              row.request as unknown as AutomationDelegationInput,
              row.requestKey,
            );
          }
        },
      );
      this.checkGrant(row, result);
      if (result.delegation.revokedAt !== null) {
        return this.view(
          await this.prisma.notificationAutomationGrant.update({
            where: { id: row.id },
            data: { status: "revoked" },
          }),
        );
      }
      await this.persistCredential(row, result);
      return this.view(
        await this.prisma.notificationAutomationGrant.findUniqueOrThrow({
          where: { id: row.id },
        }),
      );
    } catch (e) {
      return providerError(e);
    }
  }
  private async persistCredential(
    row: NotificationAutomationGrant,
    result: AutomationGrant,
    revoking = false,
  ) {
    this.checkGrant(row, result);
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        NotificationAutomationGrant[]
      >`SELECT * FROM "NotificationAutomationGrant" WHERE id=${row.id} FOR UPDATE`;
      if (!locked) throw new NotFoundException("Delega non disponibile");
      if (
        locked.status === "revoked" ||
        (!revoking && locked.status === "revocation_pending")
      )
        return locked;
      if (locked.credentialCipher) {
        if (
          locked.grantId !== result.delegation.id ||
          openConnect(locked.credentialCipher) !== result.credential
        )
          throw new BadGatewayException("Credenziale di recupero non coerente");
        return locked;
      }
      return tx.notificationAutomationGrant.update({
        where: { id: row.id },
        data: {
          grantId: result.delegation.id,
          credentialCipher: sealConnect(result.credential),
          status: revoking ? locked.status : "ready",
        },
      });
    });
  }
  private checkGrant(
    row: NotificationAutomationGrant,
    result: AutomationGrant,
  ) {
    const expected = row.request as unknown as AutomationDelegationInput,
      grant = result?.delegation;
    if (
      !grant ||
      typeof result.credential !== "string" ||
      !result.credential ||
      result.credential.length > 8192 ||
      !uuid.test(grant.id) ||
      grant.actor !== row.actorSubject ||
      grant.appId !== row.appId ||
      grant.installationId !== row.installationId ||
      grant.purpose !== expected.purpose ||
      grant.channel !== row.channel ||
      grant.archiveId !== (expected.archiveId || null) ||
      Date.parse(grant.expiresAt) !== Date.parse(expected.expiresAt) ||
      !Array.isArray(grant.functions) ||
      JSON.stringify([...grant.functions].sort()) !==
        JSON.stringify([...expected.functions].sort()) ||
      (grant.revokedAt !== null &&
        !Number.isFinite(Date.parse(grant.revokedAt)))
    )
      throw new BadGatewayException(
        "Risposta della delega non coerente con la richiesta",
      );
  }
  private async worker(row: NotificationAutomationGrant) {
    const binding = await loadConnectConfig(this.prisma, row.tenantId);
    if (
      !binding ||
      binding.appId !== row.appId ||
      binding.installationId !== row.installationId ||
      !row.grantId ||
      !row.credentialCipher
    )
      throw new ForbiddenException(
        "Collegamento o credenziale della delega non disponibile",
      );
    const sdk = await loadSdk();
    return {
      api: new sdk.ConnectServer({
        apiUrl: binding.apiUrl,
        installationId: binding.installationId,
        secret: binding.secret,
        requestTimeoutMs: 10000,
      }).automations(),
      credential: openConnect(row.credentialCipher),
    };
  }
  async verifyForWorker(id: string) {
    const row = await this.prisma.notificationAutomationGrant.findUnique({
      where: { id },
    });
    if (!row || row.status !== "ready")
      return { allowed: false, reason: "local_authorization_unavailable" };
    const [user, tenant] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: row.actorUserId, tenantId: row.tenantId, isActive: true },
      }),
      this.prisma.tenant.findUnique({
        where: { id: row.tenantId },
        select: { isActive: true, isSuspended: true },
      }),
    ]);
    const scope = row.request as unknown as AutomationDelegationInput;
    const needed = [
      "notifications.manage",
      ...scope.functions,
    ] as FunctionKey[];
    if (
      !tenant?.isActive ||
      tenant.isSuspended ||
      !user ||
      user.connectSubject !== row.actorSubject ||
      user.connectInstallationId !== row.installationId ||
      user.role === "platform_admin" ||
      (user.role !== "owner" &&
        !needed.every((key) => canUseLocalFunction(user, key)))
    )
      return { allowed: false, reason: "local_permissions_revoked" };
    if (
      user.role !== "owner" &&
      (await this.prisma.sector.count({
        where: {
          tenantId: row.tenantId,
          access: { none: { userId: user.id } },
        },
      }))
    )
      return { allowed: false, reason: "local_membership_revoked" };
    try {
      const { api, credential } = await this.worker(row);
      const result = await api.verify(
        row.grantId!,
        {
          purpose: scope.purpose,
          channel: row.channel as AutomationChannel,
          functions: scope.functions,
        },
        credential,
      );
      return {
        allowed: result?.allowed === true,
        reason:
          result?.allowed === true ? "allowed" : "central_authorization_denied",
      };
    } catch {
      return { allowed: false, reason: "central_authorization_unavailable" };
    }
  }
  private messageKey(row: NotificationAutomationGrant, commandId: string) {
    if (!uuid.test(commandId))
      throw new BadRequestException("Identità del comando non valida");
    return "alora-message-" + hash([row.tenantId, commandId]);
  }
  private messageView(
    row: NotificationAutomationGrant,
    value: DelegatedMessageStatus,
  ): DelegatedMessageStatus {
    if (
      !value ||
      !uuid.test(value.id) ||
      value.sessionId !== row.sessionId ||
      ![
        "queued",
        "sending",
        "sent",
        "failed",
        "uncertain",
        "cancelled",
      ].includes(value.state) ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      (value.providerId !== null &&
        (typeof value.providerId !== "string" ||
          value.providerId.length > 512)) ||
      (value.error !== null && typeof value.error !== "string")
    )
      throw new BadGatewayException(
        "Ricevuta Connect non coerente con l’invio",
      );
    return {
      id: value.id,
      sessionId: value.sessionId,
      state: value.state,
      providerId: value.providerId,
      error: value.error === null ? null : "Esito da verificare in Connect",
      createdAt: value.createdAt,
    };
  }
  async messageState(
    id: string,
    commandId: string,
  ): Promise<DelegatedMessageStatus> {
    const row = await this.prisma.notificationAutomationGrant.findUniqueOrThrow(
      { where: { id } },
    );
    const { api, credential } = await this.worker(row);
    const message = this.messageView(
      row,
      await api.message(
        row.grantId!,
        credential,
        this.messageKey(row, commandId),
      ),
    );
    const command = await this.commands.find(row.tenantId, commandId);
    return command?.grantId === row.id
      ? this.commands.acknowledge(command, message)
      : message;
  }
  async sendForWorker(
    id: string,
    commandId: string,
    payload: WhatsAppPayload,
  ): Promise<DelegatedMessageStatus> {
    const row = await this.prisma.notificationAutomationGrant.findUniqueOrThrow(
      { where: { id } },
    );
    this.messageKey(row, commandId);
    const existing = await this.commands.find(row.tenantId, commandId);
    if (
      row.channel !== "whatsapp" ||
      !row.sessionId ||
      (!existing?.sendStartedAt &&
        !existing?.withdrawRequestedAt &&
        !(await this.verifyForWorker(id)).allowed)
    )
      throw new ForbiddenException("Delega per l’invio non disponibile");
    const command = await this.commands.reserve(
      row,
      commandId,
      purpose,
      payload,
    );
    const attempt = await this.commands.beginSend(command);
    if (attempt.row.withdrawRequestedAt)
      return (
        await this.withdrawForWorker(
          id,
          commandId,
          this.commands.payload(command),
        )
      ).message;
    const { api, credential } = await this.worker(row);
    const message = this.messageView(
      row,
      attempt.firstAttempt
        ? await api.send(
            row.grantId!,
            credential,
            {
              purpose,
              sessionId: row.sessionId,
              payload: this.commands.payload(command),
            },
            this.messageKey(row, commandId),
          )
        : await api.message(
            row.grantId!,
            credential,
            this.messageKey(row, commandId),
          ),
    );
    return this.commands.acknowledge(command, message);
  }
  /** Ownership operation: revoke/expiry stops sends, never recovery or withdrawal of an original command. */
  async withdrawForWorker(
    id: string,
    commandId: string,
    originalPayload: WhatsAppPayload,
  ): Promise<DelegatedMessageWithdrawal> {
    const row = await this.prisma.notificationAutomationGrant.findUniqueOrThrow(
      {
        where: { id },
      },
    );
    if (row.channel !== "whatsapp" || !row.sessionId)
      throw new ForbiddenException(
        "Delega WhatsApp del comando non disponibile",
      );
    this.messageKey(row, commandId);
    const command = await this.commands.reserve(
      row,
      commandId,
      purpose,
      originalPayload,
    );
    await this.commands.requestWithdrawal(command);
    const { api, credential } = await this.worker(row);
    let result: DelegatedMessageWithdrawal;
    try {
      result = await api.withdraw(
        row.grantId!,
        credential,
        {
          purpose,
          sessionId: row.sessionId,
          payload: this.commands.payload(command),
        },
        this.messageKey(row, commandId),
      );
    } catch (error) {
      await this.commands.defer(command);
      throw error;
    }
    const message = this.messageView(row, result?.message);
    const valid =
      (result.outcome === "withdrawn" && message.state === "cancelled") ||
      (result.outcome === "already_terminal" &&
        ["cancelled", "failed"].includes(message.state)) ||
      (result.outcome === "effect_started" &&
        ["sending", "sent", "uncertain"].includes(message.state));
    if (!valid) {
      await this.commands.defer(command);
      throw new BadGatewayException(
        "Esito del ritiro Connect non coerente: verifica richiesta",
      );
    }
    const saved = await this.commands.acknowledge(
      command,
      message,
      result.outcome,
    );
    if (result.outcome === "withdrawn" && saved.state === "cancelled")
      return {
        outcome: "withdrawn",
        message: { ...saved, state: "cancelled" },
      };
    if (
      result.outcome === "already_terminal" &&
      (saved.state === "cancelled" || saved.state === "failed")
    )
      return {
        outcome: "already_terminal",
        message: { ...saved, state: saved.state },
      };
    if (
      result.outcome === "effect_started" &&
      (saved.state === "sending" ||
        saved.state === "sent" ||
        saved.state === "uncertain")
    )
      return {
        outcome: "effect_started",
        message: { ...saved, state: saved.state },
      };
    throw new BadGatewayException(
      "Esito del ritiro Connect non coerente: verifica richiesta",
    );
  }
  async revoke(auth: string | undefined, id: string) {
    const row = await this.prisma.notificationAutomationGrant.findUnique({
      where: { id },
    });
    const ctx = await this.author(
      auth,
      row?.channel as AutomationChannel | undefined,
    );
    if (!row || row.tenantId !== ctx.tenantId)
      throw new NotFoundException("Delega non disponibile");
    if (
      row.installationId !== ctx.binding.installationId ||
      row.appId !== ctx.binding.appId
    )
      throw new ForbiddenException("Il collegamento dell’attività è cambiato");
    if (row.status === "revoked") return this.view(row);
    await this.prisma.notificationAutomationGrant.update({
      where: { id },
      data: { status: "revocation_pending" },
    });
    try {
      // Recovery also handles a lost create response; never manufacture another grant to revoke it.
      const app = await connectApplication(this.prisma);
      const confirmed = await app.services(
        openConnect(ctx.linked.sdkSessionCipher!),
        async (client, token) => {
          const api = client.automations(token);
          let grantId = row.grantId;
          let local = row;
          if (!grantId) {
            if (
              row.actorUserId !== ctx.user.id ||
              row.actorSubject !== ctx.subject
            )
              return false;
            try {
              const recovered = await api.recover(row.requestKey);
              this.checkGrant(row, recovered);
              if (recovered.delegation.revokedAt !== null) return true;
              local = await this.persistCredential(row, recovered, true);
              grantId = recovered.delegation.id;
            } catch (e) {
              if (statusCode(e) !== 404) throw e;
              return false;
            }
          }
          if (local.credentialCipher) {
            const worker = await this.worker(local);
            await worker.api.revoke(grantId, worker.credential);
          } else await api.revoke(grantId);
          return true;
        },
      );
      if (!confirmed)
        return this.view(
          await this.prisma.notificationAutomationGrant.findUniqueOrThrow({
            where: { id },
          }),
        );
      return this.view(
        await this.prisma.notificationAutomationGrant.update({
          where: { id },
          data: { status: "revoked" },
        }),
      );
    } catch (e) {
      return providerError(e);
    }
  }
}
