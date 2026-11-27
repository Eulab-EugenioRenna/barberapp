import { applyBookingCancellation } from "./booking-cancellation";
import { beginAppointmentEvents } from "../notifications/appointment-events";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { sumPricedLines } from "../pricing/money";
import { paymentBalance } from "../payments/payment-balance";
import { PrismaService } from "../../prisma/prisma.service";
import {
  lockOperationalTenant,
  setOperationalActor,
} from "../../common/operational-lock";
import type {
  BookingRevisionDto,
} from "../../common/booking-mutation.dto";
import { publicBookingResult } from "../../common/public-booking-result";
import { saleFilter, sectorFilter } from "../locations/operational-scope";
import { linkLegacyBooking } from "./legacy-booking-link";
import { changeAccountCustomer } from "./account-customer";
import { normalizeOrderItems, type OrderItemInput } from "../sales/sales.logic";
import { BookingResourcesService } from "./booking-resources.service";
import {
  OrderCommandService,
  type CommandContext,
} from "./order-command.service";
import { OperationalOrderService } from "./operational-order.service";
import { resolveBookingTimes } from "./booking-times";
import type { LegacyWriteDto } from "../../common/legacy-write.dto";
import { parseZonedDateTime } from "../../common/zoned-time";

const include = {
  customer: { select: { id: true, firstName: true, lastName: true } },
  items: {
    orderBy: { id: "asc" as const },
    include: {
      booking: {
        include: {
          service: true,
          collaborator: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      },
    },
  },
} as const;
type Account = Prisma.SaleGetPayload<{ include: typeof include }>;
const stopped = new Set(["cancelled", "no_show", "completed"]);
export const DEFAULT_CANCELLATION_REASON = "Annullato dall'agenda";

/** All schedule rows of one existing operational account share this transaction and revision. */
@Injectable()
export class BookingMutationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: OrderCommandService,
    private readonly resources: BookingResourcesService,
    private readonly orders: OperationalOrderService,
  ) {}

  private internal(context: CommandContext) {
    if (
      context.source !== "internal" ||
      !context.actorId ||
      context.scope?.tenantId !== context.tenantId
    )
      throw new BadRequestException("Contesto della modifica non valido");
  }
  private scopeWhere(context: CommandContext): Prisma.AppointmentWhereInput {
    return context.scope ? sectorFilter(context.scope) : {};
  }
  /** Historical bookings without an account row get one on the fly (never a block). */
  private async ensureLinked(context: CommandContext, appointmentId: string) {
    const row = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId: context.tenantId },
      select: { orderItemId: true, orderIssue: true },
    });
    if (!row || (row.orderItemId && !row.orderIssue)) return;
    await this.prisma.$transaction(
      async (tx) => {
        await lockOperationalTenant(tx, context.tenantId);
        await setOperationalActor(tx, context.actorId);
        await linkLegacyBooking(
          tx,
          context.tenantId,
          appointmentId,
          this.scopeWhere(context),
        );
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      },
      { timeout: 15000 },
    );
  }
  private async account(
    tx: Prisma.TransactionClient,
    context: CommandContext,
    appointmentId: string,
  ) {
    const anchor = await tx.appointment.findFirst({
      where: { id: appointmentId, tenantId: context.tenantId },
      select: {
        orderItemId: true,
        orderItem: { select: { saleId: true } },
      },
    });
    if (!anchor) throw new NotFoundException("Prenotazione non accessibile");
    if (!anchor.orderItem)
      throw new NotFoundException("Prenotazione non accessibile");
    const account = await tx.sale.findFirst({
      where: {
        id: anchor.orderItem.saleId,
        tenantId: context.tenantId,
        ...saleFilter(context.scope!),
      },
      include,
    });
    if (!account)
      throw new NotFoundException(
        "Serve accesso a tutti i settori della prenotazione",
      );
    if (!account.customerId || !account.customer)
      throw new ConflictException("Il conto non ha un cliente: assegnalo dalla cassa");
    return account;
  }
  private view(account: Account) {
    return {
      orderId: account.id,
      revision: account.revision,
      orderStatus: account.orderStatus,
      customerId: account.customerId,
      customer: account.customer,
      appointments: account.items
        .flatMap((row) =>
          row.booking
            ? [
                {
                  ...publicBookingResult(row.booking, account.customer!),
                  orderItemId: row.id,
                  estimatedPrice: row.lineTotal.plus(row.taxTotal).toFixed(2),
                },
              ]
            : [],
        )
        .sort(
          (a, b) =>
            a.startsAt.getTime() - b.startsAt.getTime() ||
            a.id.localeCompare(b.id),
        ),
    };
  }
  async read(context: CommandContext, appointmentId: string) {
    this.internal(context);
    await this.ensureLinked(context, appointmentId);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return this.view(await this.account(tx, context, appointmentId));
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  private normalize(body: BookingRevisionDto) {
    if (
      (body.revision !== null &&
        (!Number.isInteger(body.revision) || body.revision < 0)) ||
      !Array.isArray(body.lines) ||
      body.lines.length < 1 ||
      body.lines.length > 20
    )
      throw new BadRequestException(
        "Indica revisione e da uno a venti servizi",
      );
    const text = (value: unknown, max = 100) => {
      if (value === undefined || value === null || value === "") return null;
      if (typeof value !== "string" || value.length > max)
        throw new BadRequestException("Campo della modifica non valido");
      return value.trim() || null;
    };
    return {
      revision: body.revision,
      startsAt: text(body.startsAt, 64),
      lines: body.lines.map((row) => {
        const serviceId = text(row.serviceId);
        if (!serviceId) throw new BadRequestException("Indica ogni servizio");
        const finalPrice =
          row.finalPrice == null ? null : String(row.finalPrice);
        if (finalPrice !== null && !/^\d{1,8}(\.\d{1,2})?$/.test(finalPrice))
          throw new BadRequestException("Prezzo concordato non valido");
        return {
          serviceId,
          appointmentId: text(row.appointmentId),
          orderItemId: text(row.orderItemId),
          startsAt: text(row.startsAt, 64),
          collaboratorId: text(row.collaboratorId),
          roomId: text(row.roomId),
          finalPrice:
            finalPrice === null
              ? null
              : new Prisma.Decimal(finalPrice).toFixed(2),
          priceOverrideReason: text(row.priceOverrideReason, 500),
        };
      }),
    };
  }
  private async plan(
    tx: Prisma.TransactionClient,
    context: CommandContext,
    account: Account,
    input: ReturnType<BookingMutationService["normalize"]>,
    lineOnly = false,
  ) {
    // Moving, reassigning or re-timing is last-write-wins on any account state:
    // only price or row changes need the revision and an open account (economics).
    const tenant = await tx.tenant.findFirst({
      where: { id: context.tenantId, isActive: true, isSuspended: false },
      select: { timezone: true },
    });
    if (!tenant) throw new NotFoundException("Attività non disponibile");
    const booked = account.items.flatMap((row) =>
      row.booking ? [row.booking] : [],
    );
    const seen = new Set<string>();
    const targets = input.lines.map((row) => {
      const old = row.appointmentId
        ? booked.find((old) => old.id === row.appointmentId)
        : undefined;
      if (row.appointmentId && !old)
        throw new ConflictException(
          "Il servizio non è modificabile in questa prenotazione",
        );
      const itemId = old?.orderItemId || row.orderItemId || randomUUID();
      if (seen.has(itemId))
        throw new BadRequestException(
          "Ogni servizio va indicato una sola volta",
        );
      seen.add(itemId);
      if (old && row.orderItemId && row.orderItemId !== old.orderItemId)
        throw new BadRequestException(
          "La riga stabile non corrisponde al servizio",
        );
      const existing = account.items.find((item) => item.id === itemId);
      if (
        row.orderItemId &&
        !old &&
        (!existing ||
          existing.booking ||
          existing.serviceId !== row.serviceId ||
          existing.quantity !== 1)
      )
        throw new BadRequestException(
          "La riga da pianificare non è disponibile",
        );
      return { old, existing, itemId };
    });
    if (
      !lineOnly &&
      booked.some(
        (old) =>
          !stopped.has(old.status) &&
          !input.lines.some((row) => row.appointmentId === old.id),
      )
    )
      throw new ConflictException(
        "Includi tutti i servizi attivi; l'annullamento è un'azione separata",
      );
    const requests = await resolveBookingTimes(
      tx,
      context.tenantId,
      tenant.timezone || "Europe/Rome",
      input.lines.map((row, index) => ({
        ...row,
        durationMilliseconds:
          targets[index].old?.serviceId === row.serviceId
            ? targets[index].old!.endsAt.getTime() -
              targets[index].old!.startsAt.getTime()
            : undefined,
        startsAt:
          row.startsAt ||
          (!input.startsAt
            ? targets[index].old?.startsAt.toISOString()
            : undefined),
      })),
      input.startsAt,
    );
    const rows = await this.resources.plan(
      tx,
      context.tenantId,
      tenant.timezone || "Europe/Rome",
      requests,
      {
        scope: context.scope,
        excludeAppointmentIds: targets.flatMap((row) =>
          row.old ? [row.old.id] : [],
        ),
        // An account never changes location: services resolve their activity there.
        target: { locationId: account.locationId },
      },
    );
    for (const [index, row] of rows.entries()) {
      if (row.service.sector.locationId !== account.locationId)
        throw new BadRequestException(
          "La sede storica del conto non cambia con la pianificazione",
        );
      const old = targets[index].old;
      if (
        old?.serviceId === row.serviceId &&
        old.sectorId !== row.service.sectorId
      )
        throw new ConflictException(
          "Il servizio è stato spostato di settore: scegli esplicitamente un servizio abilitato nella sede originale",
        );
    }
    return { rows, targets };
  }
  private async economics(
    tx: Prisma.TransactionClient,
    account: Account,
    input: ReturnType<BookingMutationService["normalize"]>,
    plan: Awaited<ReturnType<BookingMutationService["plan"]>>,
  ) {
    const { rows, targets } = plan;
    // Re-sending the price already on the row is not a price change.
    const priced = input.lines.map((request, i) => {
      const existing = targets[i].existing;
      return (
        request.finalPrice !== null &&
        !(
          existing &&
          existing.serviceId === request.serviceId &&
          new Prisma.Decimal(request.finalPrice).eq(
            existing.lineTotal.plus(existing.taxTotal),
          )
        )
      );
    });
    const economic = targets.some(
      (target, i) =>
        !target.existing ||
        target.existing.serviceId !== input.lines[i].serviceId ||
        priced[i],
    );
    const itemInputs: OrderItemInput[] = account.items.map((row) => ({
      ...row,
      kind: row.serviceId ? "service" : "product",
      collaboratorId: row.collaboratorId || undefined,
    }));
    for (const [index, request] of input.lines.entries()) {
      const target = targets[index],
        service = rows[index].service;
      if (
        target.existing &&
        target.existing.serviceId !== request.serviceId &&
        (target.existing.stockState === "posted" ||
          (await tx.stockMovement.count({
            where: { saleItemId: target.itemId },
          })))
      )
        throw new ConflictException(
          "Il servizio ha consumi già registrati: conserva la riga e gestisci il reso esplicitamente",
        );
      if (
        !target.existing ||
        target.existing.serviceId !== request.serviceId ||
        priced[index]
      ) {
        const same = target.existing?.serviceId === request.serviceId;
        const changed: OrderItemInput = {
          ...(target.existing || {}),
          id: target.itemId,
          kind: "service",
          productId: undefined,
          serviceId: service.id,
          sectorId: service.sectorId,
          label: service.name,
          quantity: 1,
          collaboratorId: same
            ? target.existing?.collaboratorId || undefined
            : undefined,
          unitPrice: request.finalPrice ?? service.basePrice.toFixed(2),
          priceMode:
            request.finalPrice !== null && service.priceMode !== "legacy"
              ? "gross"
              : service.priceMode,
          vatRate: service.vatRate,
          discount: 0,
          taxTotal: 0,
          priceOverrideReason: request.priceOverrideReason || undefined,
        };
        const position = itemInputs.findIndex(
          (row) => row["id"] === target.itemId,
        );
        if (position < 0) itemInputs.push(changed);
        else itemInputs[position] = changed;
      }
    }

    if (!economic) return { economic, itemInputs, normalized: null };
    let normalized;
    try {
      normalized = normalizeOrderItems({
        items: itemInputs,
        products: [],
        services: rows.map((row) => row.service),
        existing: account.items,
        orderDiscount: account.orderDiscount,
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Prezzi non validi",
      );
    }

    return { economic, itemInputs, normalized };
  }
  async preview(
    context: CommandContext,
    appointmentId: string,
    body: BookingRevisionDto,
    includeEconomics = false,
  ) {
    this.internal(context);
    const input = this.normalize(body);
    await this.ensureLinked(context, appointmentId);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const account = await this.account(tx, context, appointmentId),
          plan = await this.plan(tx, context, account, input);
        const { rows, targets } = plan;
        const economic = await this.economics(tx, account, input, plan);
        const totals = economic.normalized
          ? sumPricedLines(economic.normalized)
          : {
              subtotal: account.subtotal.toFixed(2),
              discountTotal: account.discountTotal.toFixed(2),
              taxTotal: account.taxTotal.toFixed(2),
              total: account.total.toFixed(2),
            };
        const entries = await tx.paymentEntry.findMany({
          where: { tenantId: context.tenantId, saleId: account.id },
        });
        let balance;
        try {
          balance = paymentBalance(totals.total, account.paymentBasis, entries);
        } catch (error) {
          throw new ConflictException(
            error instanceof Error ? error.message : "Incassi non coerenti",
          );
        }
        return {
          economics: includeEconomics
            ? {
                ...totals,
                previousTotal: account.total.toFixed(2),
                difference: new Prisma.Decimal(totals.total)
                  .minus(account.total)
                  .toFixed(2),
                payment: balance,
              }
            : undefined,
          orderId: account.id,
          revision: account.revision,
          lines: rows.map((row, index) => ({
            appointmentId: targets[index].old?.id || null,
            orderItemId: targets[index].existing?.id || null,
            serviceId: row.serviceId,
            name: row.service.name,
            startsAt: row.startsAt.toISOString(),
            endsAt: row.endsAt.toISOString(),
            collaboratorId: row.collaboratorId,
            roomId: row.roomId,
          })),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
      },
    );
  }
  private async applyRevision(
    tx: Prisma.TransactionClient,
    context: CommandContext,
    account: Account,
    input: ReturnType<BookingMutationService["normalize"]>,
    options: { lineOnly?: boolean; baseRevision?: number } = {},
  ) {
    const { rows, targets } = await this.plan(
      tx,
      context,
      account,
      input,
      options.lineOnly,
    );
    const { economic, itemInputs, normalized } = await this.economics(
      tx,
      account,
      input,
      { rows, targets },
    );
    if (economic) {
      this.orders.assertRevision(
        { revision: options.baseRevision ?? account.revision },
        input.revision,
      );
      if (account.orderStatus !== "open")
        throw new ConflictException(
          "Prezzo e servizi si cambiano su un conto ancora da incassare: per un conto chiuso usa la cassa",
        );
    }
    await tx.$executeRaw`SET CONSTRAINTS alora_appointment_resources DEFERRED`;
    if (normalized) {
      for (const [index, row] of normalized.entries()) {
        const id = String(itemInputs[index]["id"]),
          old = account.items.find((item) => item.id === id);
        const serviceChanged = !!old && old.serviceId !== row.serviceId;
        if (old)
          await tx.saleItem.update({
            where: { id },
            data: {
              ...row,
              collaboratorId: row.collaboratorId ?? null,
              ...(serviceChanged
                ? { inventoryRequirements: Prisma.DbNull }
                : {}),
              sectorId: String(itemInputs[index]["sectorId"]),
            },
          });
        else
          await tx.saleItem.create({
            data: {
              ...row,
              id,
              saleId: account.id,
              sectorId: String(itemInputs[index]["sectorId"]),
              stockState: "pending",
              // New services go after the lines arranged at the till.
              position: account.items.length + index,
            },
          });
      }
    }
    const changedIds: string[] = [];
    for (const [index, row] of rows.entries()) {
      const target = targets[index],
        request = input.lines[index];
      const scheduling = {
        serviceId: row.serviceId,
        sectorId: row.service.sectorId,
        locationId: account.locationId,
        collaboratorId: row.collaboratorId,
        roomId: row.roomId,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        updatedById: context.actorId,
      };
      if (target.old) {
        await tx.appointment.update({
          where: { id: target.old.id },
          data: {
            ...scheduling,
            ...(request.finalPrice !== null
              ? { finalPrice: request.finalPrice }
              : target.old.serviceId !== row.serviceId
                ? { finalPrice: null }
                : {}),
          },
        });
        changedIds.push(target.old.id);
      } else {
        const pricedItem = await tx.saleItem.findUniqueOrThrow({
          where: { id: target.itemId },
          select: { lineTotal: true, taxTotal: true },
        });
        const created = await tx.appointment.create({
          data: {
            ...scheduling,
            tenantId: context.tenantId,
            customerId: account.customerId!,
            orderItemId: target.itemId,
            createdById: context.actorId,
            source: "internal",
            status: "confirmed",
            finalPrice: request.finalPrice,
            estimatedPrice: pricedItem.lineTotal.plus(pricedItem.taxTotal),
          },
        });
        changedIds.push(created.id);
      }
    }
    if (economic) {
      await this.orders.recalculate(tx, account.id, account.paymentBasis);
      const items = await tx.saleItem.findMany({
        where: { saleId: account.id },
      });
      for (const row of items)
        await tx.appointment.updateMany({
          where: { tenantId: context.tenantId, orderItemId: row.id },
          data: { estimatedPrice: row.lineTotal.plus(row.taxTotal) },
        });
    } else
      await tx.sale.update({
        where: { id: account.id },
        data: { revision: { increment: 1 } },
      });
    const fresh = await tx.sale.findUniqueOrThrow({
      where: { id: account.id },
      include,
    });
    const result = JSON.parse(
      JSON.stringify(this.view(fresh)),
    ) as Prisma.InputJsonObject;
    return { result, appointmentIds: changedIds };
  }
  async revise(
    context: CommandContext,
    appointmentId: string,
    body: BookingRevisionDto,
  ) {
    this.internal(context);
    const input = this.normalize(body);
    const command = this.commands.command(
      context,
      "update_booking",
      body.idempotencyKey,
      { appointmentId, ...input },
    );
    return this.prisma.$transaction(
      async (tx) => {
        await lockOperationalTenant(tx, context.tenantId);
        await setOperationalActor(tx, context.actorId);
        const replay = await this.commands.replay(tx, command);
        if (replay)
          return {
            result: replay.result,
            replayed: true,
            appointmentIds: [] as string[],
          };
        await linkLegacyBooking(
          tx,
          context.tenantId,
          appointmentId,
          this.scopeWhere(context),
        );
        const account = await this.account(tx, context, appointmentId);
        const recordEvents = await beginAppointmentEvents(tx, context, {
          orderItem: { saleId: account.id },
        });
        const { result, appointmentIds } = await this.applyRevision(
          tx,
          context,
          account,
          input,
        );
        const operation = await this.commands.save(
          tx,
          command,
          account.id,
          result,
        );
        await recordEvents({ orderItem: { saleId: account.id } }, operation.id);
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        return { result, replayed: false, appointmentIds };
      },
      { timeout: 15000 },
    );
  }
  /** Posted stock belongs to an executed service: its status stays until the stock is returned. */
  private async consumed(
    tx: Prisma.TransactionClient,
    item: { id: string; stockState: string },
  ) {
    return (
      item.stockState === "posted" ||
      (await tx.stockMovement.count({ where: { saleItemId: item.id } })) > 0
    );
  }
  /** A cancelled account goes back to work when one of its bookings is corrected. */
  private async reopen(tx: Prisma.TransactionClient, account: Account) {
    if (account.orderStatus !== "cancelled") return false;
    await tx.sale.update({
      where: { id: account.id },
      data: {
        orderStatus:
          account.paymentStatus === "unpaid" && !account.paymentMethod
            ? "open"
            : "confirmed",
        revision: { increment: 1 },
      },
    });
    return true;
  }
  /** After a correction of a cancelled account, it closes again if nothing is left to do. */
  private async recloseIfIdle(tx: Prisma.TransactionClient, saleId: string) {
    const items = await tx.saleItem.findMany({
      where: { saleId },
      select: { booking: { select: { status: true } } },
    });
    if (
      items.length &&
      items.every(
        (row) =>
          row.booking && ["cancelled", "no_show"].includes(row.booking.status),
      )
    )
      await tx.sale.update({
        where: { id: saleId },
        data: { orderStatus: "cancelled", revision: { increment: 1 } },
      });
  }
  private async statusHistory(
    tx: Prisma.TransactionClient,
    context: CommandContext,
    appointmentId: string,
    from: string,
    to: string,
  ) {
    await tx.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorUserId: context.actorId,
        action: "appointment.status_changed",
        entityType: "appointment",
        entityId: appointmentId,
        before: { status: from },
        after: { status: to },
      },
    });
  }
  /** Cancels inside the caller's transaction. Money, payments and stock are never changed here. */
  private async cancelInTransaction(
    tx: Prisma.TransactionClient,
    context: CommandContext,
    account: Account,
    appointmentId: string,
    reason: string,
    mode: "all" | "line",
  ) {
    if (account.orderStatus === "superseded")
      throw new ConflictException("Il conto storico è stato sostituito");
    const bookings = account.items.flatMap((row) =>
      row.booking ? [{ ...row.booking, item: row }] : [],
    );
    const targets =
      mode === "all"
        ? bookings.filter((row) => !stopped.has(row.status))
        : bookings.filter(
            (row) => row.id === appointmentId && row.status !== "cancelled",
          );
    for (const row of targets)
      if (row.status === "completed" && (await this.consumed(tx, row.item)))
        throw new ConflictException(
          "Il servizio ha consumi di magazzino registrati: resta «eseguito» finché non gestisci il reso dal magazzino",
        );
    const ids = new Set(targets.map((row) => row.id));
    const allStopped =
      mode === "all" ||
      account.items.every(
        (row) =>
          row.booking &&
          (ids.has(row.booking.id) ||
            ["cancelled", "no_show"].includes(row.booking.status)),
      );
    if (targets.length || (allStopped && account.orderStatus !== "cancelled"))
      await applyBookingCancellation(tx, {
        orderId: account.id,
        appointmentIds: targets.map((row) => row.id),
        allStopped,
        actorId: context.actorId,
        cancelledByType: "staff",
        cancelledById: context.actorId,
        reason,
        policyResult: "operator_recorded",
      });
    for (const row of targets)
      await this.statusHistory(tx, context, row.id, row.status, "cancelled");
    return targets.map((row) => row.id);
  }
  /**
   * Single-booking adapter used by the agenda (drag, form, status buttons).
   * Last write wins for time, professional, status, notes and customer; the
   * revision is checked only when price or account rows change. Double booking
   * stays impossible: the database resource check runs before commit.
   */
  async reviseLine(
    context: CommandContext,
    appointmentId: string,
    body: LegacyWriteDto,
  ) {
    this.internal(context);
    const allowed = new Set([
      "idempotencyKey",
      "revision",
      "serviceId",
      "startsAt",
      "collaboratorId",
      "roomId",
      "finalPrice",
      "priceOverrideReason",
      "status",
      "reason",
      "customerId",
      "customerNotes",
      "internalNotes",
      "locationId",
      "sectorId",
    ]);
    if (
      Object.keys(body).some(
        (key) => body[key] !== undefined && !allowed.has(key),
      ) ||
      (body.revision != null &&
        (!Number.isInteger(body.revision) || Number(body.revision) < 0))
    )
      throw new BadRequestException("Campi della prenotazione non validi");
    if (body.finalPrice === null)
      throw new BadRequestException(
        "Indica un prezzo esplicito; zero significa prestazione gratuita",
      );
    const idempotencyKey =
      typeof body.idempotencyKey === "string" && body.idempotencyKey
        ? body.idempotencyKey
        : `agenda:${randomUUID()}`;
    const command = this.commands.command(
      context,
      "update_booking",
      idempotencyKey,
      { adapter: "single_line", appointmentId, input: body },
    );
    const reason =
      (typeof body.reason === "string" && body.reason.trim().slice(0, 2000)) ||
      DEFAULT_CANCELLATION_REASON;
    return this.prisma.$transaction(
      async (tx) => {
        await lockOperationalTenant(tx, context.tenantId);
        await setOperationalActor(tx, context.actorId);
        const replay = await this.commands.replay(tx, command);
        if (replay)
          return {
            result: replay.result,
            replayed: true,
            appointmentIds: [] as string[],
            assignmentChanged: false,
            customerId: null as string | null,
            previousCustomerId: null as string | null,
            previousCollaboratorId: null as string | null,
          };
        await linkLegacyBooking(
          tx,
          context.tenantId,
          appointmentId,
          this.scopeWhere(context),
        );
        let account = await this.account(tx, context, appointmentId);
        const baseRevision = account.revision;
        const recordEvents = await beginAppointmentEvents(tx, context, {
          orderItem: { saleId: account.id },
        });
        const line = account.items.find(
          (row) => row.booking?.id === appointmentId,
        );
        const old = line?.booking;
        if (!line || !old)
          throw new NotFoundException("Appuntamento non accessibile");
        if (body.locationId && body.locationId !== account.locationId)
          throw new BadRequestException(
            "La sede del conto non cambia dall'agenda",
          );
        // Intermediate states (status first, then time) are not conflicts: the
        // final state is checked once, before commit.
        await tx.$executeRaw`SET CONSTRAINTS alora_appointment_resources DEFERRED`;
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: context.tenantId },
          select: { timezone: true },
        });
        const start =
          body.startsAt === undefined
            ? old.startsAt
            : parseZonedDateTime(
                String(body.startsAt),
                tenant.timezone || "Europe/Rome",
              );
        if (!start) throw new BadRequestException("Orario non valido");
        const serviceId =
          body.serviceId === undefined ? old.serviceId : body.serviceId;
        const collaboratorId =
          body.collaboratorId === undefined
            ? old.collaboratorId
            : body.collaboratorId || null;
        const roomId =
          body.roomId === undefined
            ? serviceId === old.serviceId
              ? old.roomId
              : null
            : body.roomId || null;
        const calendarChange =
          serviceId !== old.serviceId ||
          start.getTime() !== old.startsAt.getTime() ||
          collaboratorId !== old.collaboratorId ||
          roomId !== old.roomId;
        const priceChange =
          body.finalPrice !== undefined &&
          !new Prisma.Decimal(String(body.finalPrice)).eq(
            line.lineTotal.plus(line.taxTotal),
          );
        const status =
          body.status && body.status !== old.status ? body.status : null;
        const cancelling = status === "cancelled";
        const customerId =
          body.customerId && body.customerId !== account.customerId
            ? body.customerId
            : null;
        const notes =
          body.customerNotes !== undefined || body.internalNotes !== undefined;
        if (
          status &&
          old.status === "completed" &&
          (await this.consumed(tx, line))
        )
          throw new ConflictException(
            "Il servizio ha consumi di magazzino registrati: resta «eseguito» finché non gestisci il reso dal magazzino",
          );
        const wasCancelled = account.orderStatus === "cancelled";
        if (status || calendarChange || priceChange || customerId || notes)
          await this.reopen(tx, account);
        if (status && !cancelling) {
          await tx.appointment.update({
            where: { id: appointmentId },
            data: { status, updatedById: context.actorId },
          });
          await this.statusHistory(
            tx,
            context,
            appointmentId,
            old.status,
            status,
          );
        }
        let previousCustomerId: string | null = null;
        if (customerId)
          previousCustomerId = (
            await changeAccountCustomer(tx, {
              tenantId: context.tenantId,
              saleId: account.id,
              customerId,
            })
          ).previousCustomerId;
        if (cancelling) {
          // The service row (money) stays; only the time and people follow the form.
          if (calendarChange)
            await tx.appointment.update({
              where: { id: appointmentId },
              data: {
                startsAt: start,
                endsAt: new Date(
                  start.getTime() +
                    (old.endsAt.getTime() - old.startsAt.getTime()),
                ),
                collaboratorId,
                roomId,
                updatedById: context.actorId,
              },
            });
        } else if (calendarChange || priceChange) {
          account = await this.account(tx, context, appointmentId);
          const input = this.normalize({
            idempotencyKey,
            revision: body.revision ?? null,
            lines: [
              {
                appointmentId,
                serviceId,
                startsAt: start.toISOString(),
                collaboratorId: collaboratorId || undefined,
                roomId: roomId || undefined,
                finalPrice:
                  body.finalPrice === undefined
                    ? undefined
                    : String(body.finalPrice),
                priceOverrideReason: body.priceOverrideReason,
              },
            ],
          } as unknown as BookingRevisionDto);
          await this.applyRevision(tx, context, account, input, {
            lineOnly: true,
            baseRevision,
          });
        }
        if (notes)
          await tx.appointment.update({
            where: { id: appointmentId },
            data: {
              ...(body.customerNotes !== undefined
                ? { customerNotes: body.customerNotes }
                : {}),
              ...(body.internalNotes !== undefined
                ? { internalNotes: body.internalNotes }
                : {}),
              updatedById: context.actorId,
            },
          });
        if (cancelling)
          await this.cancelInTransaction(
            tx,
            context,
            await this.account(tx, context, appointmentId),
            appointmentId,
            reason,
            "line",
          );
        await tx.sale.update({
          where: { id: account.id },
          data: { revision: { increment: 1 } },
        });
        if (wasCancelled && !cancelling)
          await this.recloseIfIdle(tx, account.id);
        const fresh = await this.account(tx, context, appointmentId);
        const current = fresh.items.find(
          (row) => row.booking?.id === appointmentId,
        )!;
        const result = JSON.parse(
          JSON.stringify({
            ...publicBookingResult(current.booking!, fresh.customer!),
            customerId: fresh.customerId,
            orderItemId: current.id,
            orderId: fresh.id,
            orderRevision: fresh.revision,
            orderStatus: fresh.orderStatus,
            estimatedPrice: current.lineTotal.plus(current.taxTotal).toFixed(2),
            finalPrice: current.booking!.finalPrice,
            customerNotes: current.booking!.customerNotes,
            internalNotes: current.booking!.internalNotes,
          }),
        ) as Prisma.InputJsonObject;
        const operation = await this.commands.save(
          tx,
          command,
          fresh.id,
          result,
        );
        await recordEvents({ orderItem: { saleId: fresh.id } }, operation.id);
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        return {
          result,
          replayed: false,
          appointmentIds: [appointmentId],
          customerId: fresh.customerId,
          previousCustomerId,
          previousCollaboratorId: old.collaboratorId,
          assignmentChanged:
            old.collaboratorId !== current.booking!.collaboratorId,
        };
      },
      { timeout: 15000 },
    );
  }
  /** Reason and revision are optional: the agenda never has to justify a cancellation. */
  async cancel(
    context: CommandContext,
    appointmentId: string,
    body: {
      idempotencyKey?: string;
      revision?: number | null;
      reason?: string | null;
    },
    mode: "all" | "line" = "all",
  ) {
    this.internal(context);
    const reason =
      (typeof body.reason === "string" && body.reason.trim().slice(0, 2000)) ||
      DEFAULT_CANCELLATION_REASON;
    const command = this.commands.command(
      context,
      "cancel_booking",
      body.idempotencyKey || `agenda-cancel:${randomUUID()}`,
      { appointmentId, revision: body.revision ?? null, reason, mode },
    );
    return this.prisma.$transaction(
      async (tx) => {
        await lockOperationalTenant(tx, context.tenantId);
        await setOperationalActor(tx, context.actorId);
        const replay = await this.commands.replay(tx, command);
        if (replay)
          return {
            result: replay.result,
            replayed: true,
            appointmentIds: [] as string[],
          };
        await linkLegacyBooking(
          tx,
          context.tenantId,
          appointmentId,
          this.scopeWhere(context),
        );
        const account = await this.account(tx, context, appointmentId);
        const recordEvents = await beginAppointmentEvents(tx, context, {
          orderItem: { saleId: account.id },
        });
        const cancelled = await this.cancelInTransaction(
          tx,
          context,
          account,
          appointmentId,
          reason,
          mode,
        );
        const fresh = await tx.sale.findUniqueOrThrow({
          where: { id: account.id },
          include,
        });
        const result = JSON.parse(
          JSON.stringify({
            ...this.view(fresh),
            cancelledAppointmentIds: cancelled,
            refund: "not_requested",
            stockReturn: "not_requested",
          }),
        ) as Prisma.InputJsonObject;
        const operation = await this.commands.save(
          tx,
          command,
          account.id,
          result,
        );
        await recordEvents({ orderItem: { saleId: account.id } }, operation.id);
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        return { result, replayed: false, appointmentIds: cancelled };
      },
      { timeout: 15000 },
    );
  }
}
