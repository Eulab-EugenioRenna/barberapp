import { Prisma } from "@prisma/client";

const stopped = new Set(["cancelled", "no_show"]);

/**
 * Prenotazioni storiche senza riga nel conto: invece di bloccare l'agenda, la riga
 * mancante si crea al volo. Ordine di preferenza, senza mai cambiare importi registrati:
 * 1. collegamento già presente ma segnato come anomalo → si toglie solo l'anomalia;
 * 2. conto storico della prenotazione con una riga dello stesso servizio libera → si collega;
 * 3. conto storico della prenotazione (stesso cliente e sede) → riga a zero, il totale resta;
 * 4. nessun conto utilizzabile → conto aperto nuovo al prezzo della prenotazione
 *    (annullato subito se la prenotazione era annullata o non presentata).
 * Il chiamante tiene il lock operativo. Restituisce true se ha scritto qualcosa.
 */
export async function linkLegacyBooking(
  tx: Prisma.TransactionClient,
  tenantId: string,
  appointmentId: string,
  /** Operational scope of the caller: out-of-scope bookings are left untouched. */
  scopeWhere: Prisma.AppointmentWhereInput = {},
): Promise<boolean> {
  const booking = await tx.appointment.findFirst({
    where: { AND: [{ id: appointmentId, tenantId }, scopeWhere] },
    select: {
      id: true,
      locationId: true,
      sectorId: true,
      customerId: true,
      serviceId: true,
      status: true,
      startsAt: true,
      estimatedPrice: true,
      finalPrice: true,
      orderItemId: true,
      orderIssue: true,
      createdById: true,
      service: { select: { name: true } },
    },
  });
  if (!booking) return false;
  if (booking.orderItemId) {
    if (!booking.orderIssue) return false;
    await tx.appointment.update({
      where: { id: booking.id },
      data: { orderIssue: null },
    });
    return true;
  }
  const link = (orderItemId: string) =>
    tx.appointment.update({
      where: { id: booking.id },
      data: { orderItemId, orderIssue: null },
    });
  const sale = await tx.sale.findFirst({
    where: {
      tenantId,
      appointmentId: booking.id,
      customerId: booking.customerId,
      locationId: booking.locationId,
      orderStatus: { notIn: ["cancelled", "superseded"] },
    },
    orderBy: { soldAt: "asc" },
    select: {
      id: true,
      items: {
        select: {
          id: true,
          serviceId: true,
          sectorId: true,
          quantity: true,
          position: true,
          booking: { select: { id: true } },
        },
      },
    },
  });
  if (sale) {
    const free = sale.items.find(
      (row) =>
        !row.booking &&
        row.serviceId === booking.serviceId &&
        row.sectorId === booking.sectorId &&
        row.quantity === 1,
    );
    if (free) {
      await link(free.id);
      return true;
    }
    const zero = new Prisma.Decimal(0);
    const item = await tx.saleItem.create({
      data: {
        saleId: sale.id,
        sectorId: booking.sectorId,
        serviceId: booking.serviceId,
        label: booking.service.name,
        quantity: 1,
        unitPrice: zero,
        discount: zero,
        taxTotal: zero,
        lineTotal: zero,
        priceOverrideReason:
          "Riga di collegamento della prenotazione storica: l'importo è già nel conto",
        position: Math.max(-1, ...sale.items.map((row) => row.position)) + 1,
      },
      select: { id: true },
    });
    await link(item.id);
    return true;
  }
  const price = booking.finalPrice ?? booking.estimatedPrice ?? new Prisma.Decimal(0);
  const referenced = await tx.sale.count({
    where: { tenantId, appointmentId: booking.id },
  });
  const created = await tx.sale.create({
    data: {
      tenantId,
      locationId: booking.locationId,
      customerId: booking.customerId,
      appointmentId: referenced ? null : booking.id,
      subtotal: price,
      discountTotal: 0,
      taxTotal: 0,
      total: price,
      paymentStatus: "unpaid",
      soldAt: booking.startsAt,
      createdById: booking.createdById,
      orderStatus: "open",
      orderOrigin: "legacy_appointment",
    },
    select: { id: true },
  });
  const item = await tx.saleItem.create({
    data: {
      saleId: created.id,
      sectorId: booking.sectorId,
      serviceId: booking.serviceId,
      label: booking.service.name,
      quantity: 1,
      unitPrice: price,
      discount: 0,
      taxTotal: 0,
      lineTotal: price,
    },
    select: { id: true },
  });
  await link(item.id);
  if (stopped.has(booking.status))
    await tx.sale.update({
      where: { id: created.id },
      data: { orderStatus: "cancelled", revision: { increment: 1 } },
    });
  return true;
}
