import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  saleFilter,
  type OperationalScope,
} from "../locations/operational-scope";
export type CommandContext = {
  tenantId: string;
  actorId: string | null;
  source: "public" | "internal" | "customer";
  customerId?: string;
  scope?: OperationalScope;
};
export interface OrderCommand {
  kind:
    | "create_booking"
    | "create_sale"
    | "update_booking"
    | "update_sale"
    | "cancel_booking"
    | "cancel_sale"
    | "confirm_booking"
    | "request_booking_change"
    | "authorize_booking_contact";
  idempotencyKey: string;
  fingerprint: string;
  context: CommandContext;
}
@Injectable()
export class OrderCommandService {
  command(
    context: CommandContext,
    kind: OrderCommand["kind"],
    key: unknown,
    normalizedInput: unknown,
  ): OrderCommand {
    if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(key))
      throw new BadRequestException(
        "Indica una chiave valida per recuperare l'esito dell'operazione",
      );
    if (
      (context.source === "internal" &&
        (!context.actorId || context.scope?.tenantId !== context.tenantId)) ||
      (context.source === "public" &&
        (context.actorId || kind !== "create_booking")) ||
      (context.source === "customer" &&
        (context.actorId ||
          !context.customerId ||
          ![
            "confirm_booking",
            "request_booking_change",
            "cancel_booking",
          ].includes(kind)))
    )
      throw new BadRequestException("Contesto del comando non valido");
    return {
      context,
      kind,
      idempotencyKey: key,
      fingerprint: createHash("sha256")
        .update(
          JSON.stringify(
            {
              tenantId: context.tenantId,
              actorId: context.actorId,
              source: context.source,
              kind,
              input: normalizedInput,
            },
            (_key, value) =>
              value && typeof value === "object" && !Array.isArray(value)
                ? Object.fromEntries(
                    Object.keys(value)
                      .sort()
                      .map((key) => [key, value[key]]),
                  )
                : value,
          ),
        )
        .digest("hex"),
    };
  }
  /** Caller acquires the shared tenant lock before lookup and all domain writes. */
  async replay(tx: Prisma.TransactionClient, command: OrderCommand) {
    const old = await tx.orderOperation.findUnique({
      where: {
        tenantId_idempotencyKey: {
          tenantId: command.context.tenantId,
          idempotencyKey: command.idempotencyKey,
        },
      },
    });
    if (!old) return null;
    if (old.fingerprint !== command.fingerprint || old.kind !== command.kind)
      throw new ConflictException("Chiave già usata per un'altra operazione");
    const { context } = command;
    const sale = await tx.sale.findFirst({
      where: {
        id: old.saleId,
        tenantId: context.tenantId,
        ...(context.source === "internal"
          ? saleFilter(context.scope!)
          : context.source === "customer"
            ? { customerId: context.customerId }
            : {
                location: { isActive: true, isPublic: true },
              }),
      },
    });
    if (!sale)
      throw new NotFoundException(
        "Operazione non accessibile nell'ambito corrente",
      );
    if (context.source === "public") {
      const hidden = await tx.appointment.count({
        where: {
          tenantId: context.tenantId,
          orderItem: { saleId: sale.id },
          OR: [
            { collaborator: { isPublic: false } },
            { room: { isPublic: false } },
            { service: { isPublic: false } },
            { service: { isActive: false } },
            { service: { isBookableOnline: false } },
            { sector: { isPublic: false } },
            { sector: { isActive: false } },
          ],
        },
      });
      if (hidden)
        throw new NotFoundException(
          "Operazione non accessibile nell'ambito corrente",
        );
    }
    return { result: old.result, sale };
  }
  async save(
    tx: Prisma.TransactionClient,
    command: OrderCommand,
    saleId: string,
    result: Prisma.InputJsonValue,
  ) {
    return tx.orderOperation.create({
      data: {
        tenantId: command.context.tenantId,
        saleId,
        actorUserId: command.context.actorId,
        idempotencyKey: command.idempotencyKey,
        fingerprint: command.fingerprint,
        kind: command.kind,
        source: command.context.source,
        result,
      },
    });
  }
}
