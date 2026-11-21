import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { lockOperationalTenant } from "../../common/operational-lock";
import {
  OrderCommandService,
  type CommandContext,
} from "../orders/order-command.service";
import { OperationalOrderService } from "../orders/operational-order.service";
import { saleFilter } from "../locations/operational-scope";
import {
  appointmentPhone,
  automationHash,
  bookingContactAuthorization,
  invalidateAutomationAccounts,
  type BookingContactAuthorization,
} from "./appointment-automation-state";
import { beginAppointmentEvents } from "./appointment-events";

@Injectable()
export class AppointmentContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: OrderCommandService,
    private readonly orders: OperationalOrderService,
  ) {}
  private async account(
    tx: Prisma.TransactionClient,
    context: CommandContext,
    appointmentId: string,
  ) {
    if (context.source !== "internal" || !context.actorId || !context.scope)
      throw new BadRequestException("Contesto del recapito non valido");
    const account = await tx.sale.findFirst({
      where: {
        AND: [
          {
            tenantId: context.tenantId,
            items: { some: { booking: { id: appointmentId } } },
          },
          saleFilter(context.scope),
        ],
      },
      include: {
        customer: { select: { id: true, phone: true } },
        items: { select: { booking: { select: { id: true } } } },
      },
    });
    if (!account?.customer)
      throw new NotFoundException("Conto non accessibile nei settori correnti");
    return { ...account, customer: account.customer };
  }
  private view(account: {
    revision: number;
    automationContact: Prisma.JsonValue | null;
    customer: { id: string; phone: string | null };
  }) {
    const phone = appointmentPhone(account.customer.phone),
      contact =
        account.automationContact as unknown as BookingContactAuthorization | null;
    const authorized =
      !!phone &&
      contact?.customerId === account.customer.id &&
      contact.phoneHash === automationHash(phone);
    return {
      revision: account.revision,
      authorized,
      phoneMasked: phone
        ? "+" + phone.slice(0, 2) + " •••• " + phone.slice(-4)
        : null,
      authorizedAt: authorized ? contact?.authorizedAt : null,
    };
  }
  async get(context: CommandContext, appointmentId: string) {
    return this.prisma.$transaction(async (tx) =>
      this.view(await this.account(tx, context, appointmentId)),
    );
  }
  async save(
    context: CommandContext,
    appointmentId: string,
    body: Record<string, unknown>,
  ) {
    if (
      !body ||
      Object.keys(body).some(
        (k) => !["revision", "idempotencyKey", "authorized"].includes(k),
      ) ||
      typeof body["authorized"] !== "boolean" ||
      !Number.isInteger(body["revision"]) ||
      Number(body["revision"]) < 0
    )
      throw new BadRequestException("Autorizzazione al recapito non valida");
    const command = this.commands.command(
      context,
      "authorize_booking_contact",
      body["idempotencyKey"],
      {
        appointmentId,
        revision: body["revision"],
        authorized: body["authorized"],
      },
    );
    const authorized = body["authorized"] === true;
    return this.prisma.$transaction(async (tx) => {
      await lockOperationalTenant(tx, context.tenantId);
      const replay = await this.commands.replay(tx, command);
      if (replay) return replay.result;
      const account = await this.account(tx, context, appointmentId);
      this.orders.assertRevision(account, Number(body["revision"]));
      const next = bookingContactAuthorization(
        account.customer,
        authorized,
        context.actorId,
        "internal",
        account.automationContact,
      );
      if (JSON.stringify(account.automationContact) !== JSON.stringify(next)) {
        const record = await beginAppointmentEvents(
          tx,
          { ...context, source: "internal" },
          { orderItem: { saleId: account.id } },
        );
        await tx.sale.update({
          where: { id: account.id },
          data: {
            automationContact: next
              ? (next as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            revision: { increment: 1 },
          },
        });
        await invalidateAutomationAccounts(tx, context.tenantId, [account.id]);
        if (next)
          await record(
            { orderItem: { saleId: account.id } },
            command.idempotencyKey,
            "appointment.contact_authorized",
          );
      }
      const fresh = await this.account(tx, context, appointmentId),
        result = this.view(fresh);
      await this.commands.save(
        tx,
        command,
        account.id,
        result as unknown as Prisma.InputJsonValue,
      );
      return result;
    });
  }
}
