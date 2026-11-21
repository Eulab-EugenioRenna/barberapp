import { randomUUID } from "node:crypto";
import { paymentBalance } from "../payments/payment-balance";
import {
  priceLine as calculateLine,
  type PriceMode,
  sumPricedLines as calculateTotals,
} from "../pricing/money";
import {
  lockOperationalTenant,
  setOperationalActor,
} from "../../common/operational-lock";
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

function priceLine(input: Parameters<typeof calculateLine>[0]) {
  try {
    return calculateLine(input);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : "Prezzo non valido",
    );
  }
}
function sumPricedLines(input: Parameters<typeof calculateTotals>[0]) {
  try {
    return calculateTotals(input);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : "Totale non valido",
    );
  }
}
const bookingInclude = {
  customer: true,
  service: true,
  collaborator: true,
} as const;
export type OrderTransaction = Prisma.TransactionClient;
export type BookableOrderAppointment = {
  id: string;
  tenantId: string;
  locationId: string;
  sectorId: string;
  customerId: string;
  serviceId: string;
  estimatedPrice: Prisma.Decimal | null;
  finalPrice: Prisma.Decimal | null;
  startsAt: Date;
  createdById: string | null;
  service: { name: string; priceMode?: string; vatRate?: unknown };
};

/** Owns the atomic boundary shared by the agenda and legacy cashier adapters. */
@Injectable()
export class OperationalOrderService {
  constructor(private readonly prisma: PrismaService) {}

  async lock(tx: OrderTransaction, tenantId: string): Promise<void> {
    // Same lock as resource allocation: keep lock order consistent in all adapters.
    await lockOperationalTenant(tx, tenantId);
  }

  async createBooking(
    data: Prisma.AppointmentUncheckedCreateInput,
    options: { priceOverrideReason?: unknown } = {},
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, data.tenantId);
      await setOperationalActor(
        tx,
        typeof data.createdById === "string" ? data.createdById : null,
        data.createdById ? "application" : "public_booking",
      );
      const appointment = await tx.appointment.create({
        data,
        include: bookingInclude,
      });
      const order = await this.attachOpenOrder(tx, appointment, options);
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      return {
        ...appointment,
        estimatedPrice: order.total,
        orderItemId: order.items[0].id,
      };
    });
  }

  async attachOpenOrder(
    tx: OrderTransaction,
    input: BookableOrderAppointment | BookableOrderAppointment[],
    options: {
      priceOverrideReason?: unknown;
      priceOverrideReasons?: unknown[];
    } = {},
  ) {
    const appointments = Array.isArray(input) ? input : [input];
    const first = appointments[0];
    if (
      !first ||
      appointments.some(
        (row) =>
          row.tenantId !== first.tenantId ||
          row.locationId !== first.locationId ||
          row.customerId !== first.customerId,
      )
    )
      throw new BadRequestException(
        "Cliente, azienda e sede devono coincidere per tutti i servizi",
      );
    const lines = appointments.map((appointment, index) => {
      const amount =
        appointment.finalPrice ??
        appointment.estimatedPrice ??
        new Prisma.Decimal(0);
      if (!amount.isFinite() || amount.isNegative())
        throw new BadRequestException("Importo non valido");
      const mode = (appointment.service.priceMode ?? "legacy") as PriceMode;
      const line = priceLine({
        unitPrice: amount,
        quantity: 1,
        priceMode:
          appointment.finalPrice !== null && mode !== "legacy" ? "gross" : mode,
        vatRate: appointment.service.vatRate,
      });
      const quote = priceLine({
        unitPrice: appointment.estimatedPrice ?? 0,
        priceMode: mode,
        vatRate: appointment.service.vatRate,
      });
      const rawReason =
        options.priceOverrideReasons?.[index] ?? options.priceOverrideReason;
      const reason =
        typeof rawReason === "string" ? rawReason.trim() : undefined;
      if (
        mode !== "legacy" &&
        appointment.finalPrice !== null &&
        !new Prisma.Decimal(line.grossTotal).equals(quote.grossTotal) &&
        (!reason || reason.length < 3)
      )
        throw new BadRequestException(
          "Indica il motivo della modifica del prezzo",
        );
      return { line, reason, id: randomUUID() };
    });
    const totals = sumPricedLines(lines.map((row) => row.line));
    const order = await tx.sale.create({
      data: {
        tenantId: first.tenantId,
        locationId: first.locationId,
        customerId: first.customerId,
        appointmentId: first.id,
        orderStatus: "open",
        orderOrigin: "booking",
        paymentStatus: "unpaid",
        paymentBasis: "ledger",
        ...totals,
        soldAt: new Date(
          Math.min(...appointments.map((row) => row.startsAt.getTime())),
        ),
        createdById: first.createdById,
        items: {
          create: lines.map(({ id, line, reason }, index) => ({
            id,
            sectorId: appointments[index].sectorId,
            serviceId: appointments[index].serviceId,
            label: appointments[index].service.name,
            quantity: 1,
            unitPrice: line.unitPrice,
            lineTotal: line.lineTotal,
            taxTotal: line.taxTotal,
            priceMode: line.priceMode,
            vatRate: line.vatRate,
            lineSubtotal: line.lineSubtotal,
            discountNet: line.discountNet,
            priceOverrideReason: reason,
            stockState: "pending",
          })),
        },
      },
      include: { items: true },
    });
    for (const [index, appointment] of appointments.entries())
      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          orderItemId: lines[index].id,
          estimatedPrice: lines[index].line.grossTotal,
        },
      });
    // Nested-create return ordering is not a database contract.
    return {
      ...order,
      items: lines.map(
        (row) => order.items.find((item) => item.id === row.id)!,
      ),
    };
  }

  async recalculate(tx: OrderTransaction, id: string, paymentBasis?: string) {
    const items = await tx.saleItem.findMany({ where: { saleId: id } });
    const totals = sumPricedLines(
      items.map((item) => ({
        lineSubtotal: (
          item.lineSubtotal ?? item.unitPrice.times(item.quantity)
        ).toFixed(2),
        discountNet: (item.discountNet ?? item.discount).toFixed(2),
        lineTotal: item.lineTotal.toFixed(2),
        taxTotal: item.taxTotal.toFixed(2),
      })),
    );
    let paymentStatus: "paid" | "unpaid" | "partial" | "refunded" | undefined;
    if (paymentBasis === "ledger") {
      const entries = await tx.paymentEntry.findMany({ where: { saleId: id } });
      try {
        paymentStatus = paymentBalance(totals.total, "ledger", entries)
          .status as typeof paymentStatus;
      } catch (error) {
        throw new ConflictException(
          error instanceof Error ? error.message : "Incassi non coerenti",
        );
      }
    }
    await tx.sale.update({
      where: { id },
      data: {
        ...totals,
        ...(paymentStatus ? { paymentStatus } : {}),
        revision: { increment: 1 },
      },
    });
  }

  assertRevision(current: { revision: number }, expected: unknown) {
    if (!Number.isInteger(expected) || current.revision !== expected)
      throw new ConflictException(
        "Il conto è cambiato. Riaprilo prima di salvare",
      );
  }
}
