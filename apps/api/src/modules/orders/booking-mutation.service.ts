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
  BookingCancellationDto,
} from "../../common/booking-mutation.dto";
import { publicBookingResult } from "../../common/public-booking-result";
import { saleFilter } from "../locations/operational-scope";
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
  private async account(
    tx: Prisma.TransactionClient,
    context: CommandContext,
    appointmentId: string,
  ) {
    const anchor = await tx.appointment.findFirst({
      where: { id: appointmentId, tenantId: context.tenantId },
      select: {
        orderItemId: true,
        orderIssue: true,
        orderItem: { select: { saleId: true } },
      },
    });
    if (!anchor) throw new NotFoundException("Prenotazione non accessibile");
    if (!anchor.orderItem || anchor.orderIssue)
      throw new ConflictException(
        "Riconcilia prima il collegamento storico del conto",
      );
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
    if (
      !account.customerId ||
      !account.customer ||
      account.items.some((row) => row.booking?.orderIssue)
    )
      throw new ConflictException(
        "Riconcilia prima i collegamenti storici del conto",
      );
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
    this.orders.assertRevision(account, input.revision);
    if (account.orderStatus !== "open")
      throw new ConflictException(
        "La pianificazione si modifica su un conto aperto",
      );
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
      if (row.appointmentId && (!old || stopped.has(old.status)))
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
    const economic = targets.some(
      (target, i) =>
        !target.existing ||
        target.existing.serviceId !== input.lines[i].serviceId ||
        input.lines[i].finalPrice !== null,
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
        request.finalPrice !== null
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
    lineOnly = false,
  ) {
    const { rows, targets } = await this.plan(
      tx,
      context,
      account,
      input,
      lineOnly,
    );
    const { economic, itemInputs, normalized } = await this.economics(
      tx,
      account,
      input,
      { rows, targets },
    );
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
  /** Legacy single-line adapter: other reservations remain fixed in the planner's calendar. */
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
      !Number.isInteger(body.revision) ||
      Number(body.revision) < 0
    )
      throw new BadRequestException(
        "Indica revisione e campi della prenotazione validi",
      );
    if (body.finalPrice === null)
      throw new BadRequestException(
        "Indica un prezzo esplicito; zero significa prestazione gratuita",
      );
    const command = this.commands.command(
      context,
      "update_booking",
      body.idempotencyKey,
      { adapter: "single_line", appointmentId, input: body },
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
            assignmentChanged: false,
            customerId: null,
            previousCollaboratorId: null,
          };
        const account = await this.account(tx, context, appointmentId);
        const recordEvents = await beginAppointmentEvents(tx, context, {
          orderItem: { saleId: account.id },
        });
        this.orders.assertRevision(account, body.revision);
        const old = account.items.find(
          (row) => row.booking?.id === appointmentId,
        )?.booking;
        if (!old) throw new NotFoundException("Appuntamento non accessibile");
        if (
          (body.customerId && body.customerId !== account.customerId) ||
          (body.locationId && body.locationId !== account.locationId) ||
          (body.sectorId && body.sectorId !== old.sectorId)
        )
          throw new BadRequestException(
            "Cliente e sede del conto non cambiano con lo spostamento",
          );
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
        if (
          (calendarChange || body.finalPrice !== undefined) &&
          stopped.has(old.status)
        )
          throw new ConflictException(
            "Le prestazioni eseguite o annullate conservano la pianificazione storica",
          );
        if (body.status === "cancelled")
          throw new BadRequestException("Usa l'annullamento con motivazione");
        if (
          stopped.has(old.status) &&
          body.status &&
          body.status !== old.status
        )
          throw new ConflictException(
            "Lo stato storico non si riapre dalla modifica",
          );
        if (calendarChange || body.finalPrice !== undefined) {
          const input = this.normalize({
            idempotencyKey: body.idempotencyKey!,
            revision: body.revision!,
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
          });
          await this.applyRevision(tx, context, account, input, true);
        } else
          await tx.sale.update({
            where: { id: account.id },
            data: { revision: { increment: 1 } },
          });
        await tx.appointment.update({
          where: { id: appointmentId },
          data: {
            ...(body.status ? { status: body.status } : {}),
            ...(body.customerNotes !== undefined
              ? { customerNotes: body.customerNotes }
              : {}),
            ...(body.internalNotes !== undefined
              ? { internalNotes: body.internalNotes }
              : {}),
            updatedById: context.actorId,
          },
        });
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
          previousCollaboratorId: old.collaboratorId,
          assignmentChanged:
            old.collaboratorId !== current.booking!.collaboratorId,
        };
      },
      { timeout: 15000 },
    );
  }
  async cancel(
    context: CommandContext,
    appointmentId: string,
    body: Omit<BookingCancellationDto, "revision"> & {
      revision: number | null;
    },
    mode: "all" | "line" = "all",
  ) {
    this.internal(context);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (
      reason.length < 3 ||
      reason.length > 2000 ||
      (body.revision !== null &&
        (!Number.isInteger(body.revision) || body.revision < 0))
    )
      throw new BadRequestException(
        "Indica revisione e motivo dell'annullamento",
      );
    const command = this.commands.command(
      context,
      "cancel_booking",
      body.idempotencyKey,
      { appointmentId, revision: body.revision, reason, mode },
    );
    return this.prisma.$transaction(async (tx) => {
      await lockOperationalTenant(tx, context.tenantId);
      await setOperationalActor(tx, context.actorId);
      const replay = await this.commands.replay(tx, command);
      if (replay)
        return {
          result: replay.result,
          replayed: true,
          appointmentIds: [] as string[],
        };
      const account = await this.account(tx, context, appointmentId);
      const recordEvents = await beginAppointmentEvents(tx, context, {
        orderItem: { saleId: account.id },
      });
      if (body.revision !== null)
        this.orders.assertRevision(account, body.revision);
      if (account.orderStatus === "superseded")
        throw new ConflictException("Il conto storico è stato sostituito");
      const active = account.items.flatMap((row) =>
        row.booking && !stopped.has(row.booking.status) ? [row.booking] : [],
      );
      if (!active.length && account.orderStatus !== "cancelled")
        throw new ConflictException(
          "Non ci sono servizi prenotati da annullare; le prestazioni eseguite e i rimborsi si gestiscono separatamente",
        );
      const targets =
        mode === "all"
          ? active
          : active.filter((row) => row.id === appointmentId);
      if (
        mode === "line" &&
        account.items.find((row) => row.booking?.id === appointmentId)?.booking
          ?.status === "completed"
      )
        throw new ConflictException(
          "La prestazione eseguita si conserva; il rimborso è un'azione separata",
        );
      const allStopped =
        mode === "all" ||
        (active.length === targets.length &&
          account.items.every(
            (row) => row.booking && row.booking.status !== "completed",
          ));
      if (targets.length || (allStopped && account.orderStatus !== "cancelled"))
        await applyBookingCancellation(tx,{orderId:account.id,appointmentIds:targets.map(row=>row.id),allStopped,actorId:context.actorId,cancelledByType:"staff",cancelledById:context.actorId,reason,policyResult:"operator_recorded"});
      const fresh = await tx.sale.findUniqueOrThrow({
        where: { id: account.id },
        include,
      });
      const result = JSON.parse(
        JSON.stringify({
          ...this.view(fresh),
          cancelledAppointmentIds: targets.map((row) => row.id),
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
      return {
        result,
        replayed: false,
        appointmentIds: targets.map((row) => row.id),
      };
    });
  }
}
