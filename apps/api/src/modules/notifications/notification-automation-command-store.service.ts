import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import {
  Prisma,
  type NotificationAutomationCommand,
  type NotificationAutomationGrant,
} from "@prisma/client";
import type {
  DelegatedMessageStatus,
  DelegatedMessageWithdrawal,
  WhatsAppPayload,
} from "@eulab/connect/server";
import { createHash } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { openConnect, sealConnect } from "../../common/connect-runtime";

const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((key) => [key, v[key]]),
        )
      : v,
  );

/** Frozen original command, never a second provider queue. Reconciliation reuses the Connect key. */
@Injectable()
export class NotificationAutomationCommandStore {
  constructor(private readonly prisma: PrismaService) {}
  async reserve(
    grant: NotificationAutomationGrant,
    commandId: string,
    purpose: string,
    payload: WhatsAppPayload,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    let body: string;
    try {
      body = canonical(payload);
      if (!body || body.length > 1024 * 1024) throw new Error();
    } catch {
      throw new BadRequestException("Comando di automazione non valido");
    }
    const inputHash = createHash("sha256")
      .update(canonical([grant.id, purpose, grant.sessionId, JSON.parse(body)]))
      .digest("hex");
    let row = await client.notificationAutomationCommand.findUnique({
      where: { tenantId_commandId: { tenantId: grant.tenantId, commandId } },
    });
    if (!row) {
      try {
        row = await client.notificationAutomationCommand.create({
          data: {
            tenantId: grant.tenantId,
            commandId,
            grantId: grant.id,
            inputHash,
            payloadCipher: sealConnect(body),
          },
        });
      } catch (error) {
        if (
          !(
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          )
        )
          throw error;
        row = await client.notificationAutomationCommand.findUniqueOrThrow({
          where: {
            tenantId_commandId: { tenantId: grant.tenantId, commandId },
          },
        });
      }
    }
    if (row.grantId !== grant.id || row.inputHash !== inputHash)
      throw new ConflictException(
        "Il comando originale ha un’altra delega o contenuto. Recupera la stessa richiesta.",
      );
    return row;
  }
  payload(row: NotificationAutomationCommand): WhatsAppPayload {
    return JSON.parse(openConnect(row.payloadCipher));
  }
  async find(tenantId: string, commandId: string) {
    return this.prisma.notificationAutomationCommand.findUnique({
      where: { tenantId_commandId: { tenantId, commandId } },
    });
  }
  async beginSend(row: NotificationAutomationCommand) {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        NotificationAutomationCommand[]
      >`SELECT * FROM "NotificationAutomationCommand" WHERE "tenantId"=${row.tenantId} AND "commandId"=${row.commandId} FOR UPDATE`;
      if (locked.withdrawRequestedAt || locked.sendStartedAt)
        return { row: locked, firstAttempt: false };
      return {
        row: await tx.notificationAutomationCommand.update({
          where: {
            tenantId_commandId: {
              tenantId: row.tenantId,
              commandId: row.commandId,
            },
          },
          data: { sendStartedAt: new Date() },
        }),
        firstAttempt: true,
      };
    });
  }
  async requestWithdrawal(row: NotificationAutomationCommand) {
    await this.prisma.notificationAutomationCommand.updateMany({
      where: {
        tenantId: row.tenantId,
        commandId: row.commandId,
        withdrawRequestedAt: null,
      },
      data: { withdrawRequestedAt: new Date(), nextAttemptAt: new Date() },
    });
  }
  async acknowledge(
    row: NotificationAutomationCommand,
    message: DelegatedMessageStatus,
    withdrawal?: DelegatedMessageWithdrawal["outcome"],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        NotificationAutomationCommand[]
      >`SELECT * FROM "NotificationAutomationCommand" WHERE "tenantId"=${row.tenantId} AND "commandId"=${row.commandId} FOR UPDATE`;
      if (locked.receiptId && locked.receiptId !== message.id)
        throw new BadGatewayException(
          "La ricevuta Connect ha cambiato identità",
        );
      const old =
        locked.lastReceipt as unknown as DelegatedMessageStatus | null;
      // A late queued/sending acknowledgement must not erase a later terminal receipt.
      const keep =
        old &&
        (["sent", "failed", "cancelled"].includes(old.state) ||
          (old.state === "uncertain" &&
            ["queued", "sending"].includes(message.state)) ||
          (old.state === "sending" && message.state === "queued"));
      const current = keep ? old : message;
      if (withdrawal && current.state !== message.state)
        throw new BadGatewayException(
          "Ritiro discordante con la ricevuta già osservata: verifica richiesta",
        );
      await tx.notificationAutomationCommand.update({
        where: {
          tenantId_commandId: {
            tenantId: row.tenantId,
            commandId: row.commandId,
          },
        },
        data: {
          receiptId: current.id,
          lastReceipt: current as unknown as Prisma.InputJsonValue,
          ...(withdrawal && !locked.withdrawResolvedAt
            ? { withdrawOutcome: withdrawal, withdrawResolvedAt: new Date() }
            : {}),
        },
      });
      return current;
    });
  }
  async pendingWithdrawals() {
    return this.prisma.notificationAutomationCommand.findMany({
      where: {
        withdrawRequestedAt: { not: null },
        withdrawResolvedAt: null,
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: [{ nextAttemptAt: "asc" }, { commandId: "asc" }],
      take: 20,
    });
  }
  async defer(row: NotificationAutomationCommand) {
    await this.prisma.notificationAutomationCommand.updateMany({
      where: {
        tenantId: row.tenantId,
        commandId: row.commandId,
        withdrawResolvedAt: null,
      },
      data: { nextAttemptAt: new Date(Date.now() + 30000) },
    });
  }
}
