import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, type NotificationAutomationWebhook } from "@prisma/client";
import type {
  ConnectWebhookEvent,
  WebhookRegistration,
  WhatsAppMessageEventPayload,
} from "@eulab/connect/server";
import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { PrismaService } from "../../prisma/prisma.service";
import {
  loadConnectConfig,
  openConnect,
  sealConnect,
} from "../../common/connect-runtime";
import { NotificationAutomationGrantsService } from "./notification-automation-grants.service";

const sdk = new Function(
  "return import('@eulab/connect/server')",
) as () => Promise<typeof import("@eulab/connect/server")>;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v);
const instant = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
  Number.isFinite(Date.parse(v));
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const statusCode = (e: unknown) =>
  e && typeof e === "object" && "status" in e ? e.status : undefined;
function publicOrigin(fallback: string) {
  try {
    const url = new URL(
      process.env["ALORA_CONNECT_WEBHOOK_ORIGIN"] || fallback,
    );
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
      url.hostname === "localhost" ||
      !url.hostname.includes(".")
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new ServiceUnavailableException(
      "Ricezione pubblica delle risposte non configurata. Occorre un indirizzo HTTPS dell’applicazione.",
    );
  }
}

@Injectable()
export class NotificationAutomationWebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: NotificationAutomationGrantsService,
  ) {}
  private view(row: NotificationAutomationWebhook) {
    return {
      id: row.id,
      url: row.url,
      status: row.status,
      lastReceivedAt: row.lastReceivedAt?.toISOString() || null,
    };
  }
  async get(auth?: string) {
    return this.grants.withWhatsAppOperator(
      auth,
      async (_client, _token, actor) => {
        const row = await this.prisma.notificationAutomationWebhook.findUnique({
          where: { tenantId: actor.tenantId },
        });
        return row
          ? this.view(row)
          : {
              id: null,
              url: null,
              status: "not_registered",
              lastReceivedAt: null,
            };
      },
    );
  }
  async prepare(auth: string | undefined, body: Record<string, unknown>) {
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "idempotencyKey") ||
      !uuid(body["idempotencyKey"])
    )
      throw new BadRequestException("Richiesta di ricezione non valida");
    return this.grants.withWhatsAppOperator(
      auth,
      async (client, token, actor) => {
        const origin = publicOrigin(actor.appOrigin);
        let row = await this.prisma.notificationAutomationWebhook.findUnique({
          where: { tenantId: actor.tenantId },
        });
        if (!row) {
          const id = randomUUID(),
            requestKey =
              "alora-hook-" +
              createHash("sha256")
                .update(
                  JSON.stringify([
                    actor.tenantId,
                    actor.userId,
                    body["idempotencyKey"],
                  ]),
                )
                .digest("hex");
          try {
            row = await this.prisma.notificationAutomationWebhook.create({
              data: {
                id,
                tenantId: actor.tenantId,
                actorUserId: actor.userId,
                actorSubject: actor.subject,
                installationId: actor.installationId,
                appId: actor.appId,
                requestKey,
                url: `${origin}/api/notifications/automation-webhooks/${id}/events`,
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
            row =
              await this.prisma.notificationAutomationWebhook.findUniqueOrThrow(
                { where: { tenantId: actor.tenantId } },
              );
          }
        }
        if (
          row.installationId !== actor.installationId ||
          row.appId !== actor.appId ||
          new URL(row.url).origin !== origin
        )
          throw new ConflictException(
            "Il collegamento o l’indirizzo pubblico sono cambiati: verifica la ricezione prima di creare un nuovo endpoint",
          );
        if (row.status === "disabled") return this.view(row);
        if (row.secretCipher && row.actorUserId !== actor.userId)
          return this.view(row);
        if (
          row.actorUserId !== actor.userId ||
          row.actorSubject !== actor.subject
        )
          throw new ForbiddenException(
            "La configurazione è in preparazione da un altro autore",
          );
        const api = client.automations(token);
        let registered: WebhookRegistration;
        try {
          registered = await api.webhooks.recover(row.requestKey);
        } catch (e) {
          if (statusCode(e) !== 404) throw e;
          registered = await api.webhooks.create(row.url, row.requestKey);
        }
        if (
          !uuid(registered?.id) ||
          registered.url !== row.url ||
          typeof registered.enabled !== "boolean" ||
          !text(registered.secret, 8192)
        )
          throw new BadGatewayException(
            "Risposta della configurazione di ricezione non valida",
          );
        const saved = await this.prisma.$transaction(async (tx) => {
          const [locked] = await tx.$queryRaw<
            NotificationAutomationWebhook[]
          >`SELECT * FROM "NotificationAutomationWebhook" WHERE id=${row.id} FOR UPDATE`;
          if (locked.status === "disabled") return locked;
          if (locked.secretCipher) {
            if (
              locked.endpointId !== registered.id ||
              openConnect(locked.secretCipher) !== registered.secret
            )
              throw new BadGatewayException(
                "Credenziale di ricezione non coerente",
              );
            if (!registered.enabled)
              return tx.notificationAutomationWebhook.update({
                where: { id: row.id },
                data: { status: "disabled" },
              });
            return locked;
          }
          return tx.notificationAutomationWebhook.update({
            where: { id: row.id },
            data: {
              endpointId: registered.id,
              secretCipher: sealConnect(registered.secret),
              status: registered.enabled ? "ready" : "disabled",
            },
          });
        });
        return this.view(saved);
      },
    );
  }
  async receive(id: string, raw: unknown, headers: Record<string, unknown>) {
    if (headers["origin"] || headers["sec-fetch-site"])
      throw new ForbiddenException("Ingresso riservato a Connect");
    if (!Buffer.isBuffer(raw) || !raw.length)
      throw new BadRequestException("Corpo originale del webhook richiesto");
    const row = await this.prisma.notificationAutomationWebhook.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException("Ricezione non disponibile");
    if (!row.secretCipher)
      throw new ServiceUnavailableException("Ricezione ancora in preparazione");
    const body = raw.toString("utf8"),
      timestamp = headers["x-eulab-timestamp"],
      signature = headers["x-eulab-signature"];
    if (
      !Buffer.from(body, "utf8").equals(raw) ||
      typeof timestamp !== "string" ||
      typeof signature !== "string" ||
      !(await sdk()).verifyWebhook(
        openConnect(row.secretCipher),
        body,
        timestamp,
        signature,
      )
    )
      throw new UnauthorizedException("Firma del webhook non valida");
    let event: ConnectWebhookEvent;
    try {
      event = JSON.parse(body);
    } catch {
      throw new BadRequestException("Evento firmato non valido");
    }
    if (
      !event ||
      !uuid(event.id) ||
      event.id !== headers["x-eulab-event-id"] ||
      !uuid(event.installationId) ||
      event.installationId !== row.installationId ||
      !uuid(event.sessionId) ||
      !text(event.kind, 120) ||
      !instant(event.createdAt)
    )
      throw new BadRequestException("Identità dell’evento non valida");
    const eventId = event.id.toLowerCase();
    const binding = await loadConnectConfig(this.prisma, row.tenantId);
    if (
      !binding ||
      binding.installationId !== row.installationId ||
      binding.appId !== row.appId
    )
      throw new ForbiddenException(
        "Installazione della ricezione non più valida",
      );
    let reason =
      row.status !== "ready"
        ? "webhook_disabled"
        : event.kind !== "message.interactive_response"
          ? "unsupported_event"
          : null;
    const payload = event.payload as WhatsAppMessageEventPayload | null;
    const now = Date.now(),
      future = now + 300000;
    if (
      !reason &&
      (!payload ||
        !uuid(payload.messageId) ||
        !uuid(payload.sessionId) ||
        payload.sessionId !== event.sessionId ||
        !uuid(payload.messageSessionId) ||
        !uuid(payload.archiveId) ||
        !text(payload.providerId, 256) ||
        !text(payload.chatId, 128) ||
        !text(payload.senderId, 128) ||
        !text(payload.recipientId, 128) ||
        payload.direction !== "in" ||
        payload.fromMe !== false ||
        payload.source !== "whatsapp_provider" ||
        payload.addressingVerified !== true ||
        payload.timestampSource !== "provider" ||
        !instant(payload.occurredAt) ||
        !instant(payload.observedAt) ||
        Date.parse(payload.occurredAt) > future ||
        Date.parse(payload.observedAt) > future ||
        !text(payload.body?.selectedButtonId, 512))
    )
      reason = "interactive_origin_unverified";
    // No media, free text or customer profile is retained. A later worker must correlate the action token.
    const minimal =
      !reason && payload
        ? {
            messageId: payload.messageId,
            providerId: payload.providerId,
            sessionId: payload.sessionId,
            messageSessionId: payload.messageSessionId,
            archiveId: payload.archiveId,
            chatId: payload.chatId,
            senderId: payload.senderId,
            recipientId: payload.recipientId,
            occurredAt: payload.occurredAt,
            observedAt: payload.observedAt,
            selectedButtonId: payload.body.selectedButtonId,
          }
        : null;
    const bodyHash = createHash("sha256").update(raw).digest("hex");
    try {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.notificationAutomationWebhookEvent.findUnique(
          {
            where: {
              installationId_eventId: {
                installationId: row.installationId,
                eventId,
              },
            },
          },
        );
        if (existing) {
          if (
            existing.bodyHash !== bodyHash ||
            existing.registrationId !== row.id
          )
            throw new ConflictException(
              "Identità dell’evento già usata con contenuto diverso",
            );
          return;
        }
        await tx.notificationAutomationWebhookEvent.create({
          data: {
            tenantId: row.tenantId,
            registrationId: row.id,
            installationId: row.installationId,
            eventId,
            kind: event.kind,
            sessionId: event.sessionId,
            bodyHash,
            occurredAt: new Date(event.createdAt),
            status: reason ? "ignored" : "received",
            reason,
            payloadCipher: minimal
              ? sealConnect(JSON.stringify(minimal))
              : null,
            processedAt: reason ? new Date() : null,
          },
        });
        await tx.notificationAutomationWebhook.update({
          where: { id: row.id },
          data: { lastReceivedAt: new Date() },
        });
      });
    } catch (e) {
      if (e instanceof ConflictException) throw e;
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        const existing =
          await this.prisma.notificationAutomationWebhookEvent.findUnique({
            where: {
              installationId_eventId: {
                installationId: row.installationId,
                eventId,
              },
            },
          });
        if (
          existing?.bodyHash === bodyHash &&
          existing.registrationId === row.id
        )
          return { accepted: true };
        throw new ConflictException(
          "Identità dell’evento già usata con contenuto diverso",
        );
      }
      throw new ServiceUnavailableException(
        "Ricezione temporaneamente non disponibile: nessuna azione applicata",
      );
    }
    return { accepted: true };
  }
}
