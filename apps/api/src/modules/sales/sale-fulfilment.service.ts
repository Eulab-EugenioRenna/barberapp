import { BadRequestException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export type PreviousServiceRow = {
  id: string;
  serviceId: string | null;
  collaboratorId: string | null;
};
/** Declares execution only at checkout. Scheduling assignments never supply an actual performer. */
@Injectable()
export class SaleFulfilmentService {
  async confirm(
    tx: Prisma.TransactionClient,
    saleId: string,
    actorId: string,
    previous: {
      orderStatus: string;
      items: PreviousServiceRow[];
      rowOrder?: string[];
      /** "Eseguito alle" chosen at the till: start of the first new service. */
      servicesStartAt?: Date;
    },
  ) {
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: {
        items: {
          orderBy: { id: "asc" },
          include: { service: true, booking: true },
        },
      },
    });
    if (sale.orderStatus !== "confirmed") return;
    const services = sale.items
      .filter((row) => row.serviceId)
      .sort(
        (a, b) =>
          (previous.rowOrder?.indexOf(a.id) ?? 0) -
          (previous.rowOrder?.indexOf(b.id) ?? 0),
      );
    const newExecutions = services.filter(
      (row) =>
        !row.booking &&
        (previous.orderStatus !== "confirmed" ||
          !previous.items.some(
            (old) => old.id === row.id && old.serviceId === row.serviceId,
          )),
    );
    if (newExecutions.length && !sale.customerId)
      throw new BadRequestException(
        "Seleziona un cliente per registrare i servizi eseguiti",
      );
    for (const row of services) {
      const old = previous.items.find(
        (old) => old.id === row.id && old.serviceId === row.serviceId,
      );
      const stopped =
        row.booking && ["cancelled", "no_show"].includes(row.booking.status);
      if (stopped) {
        if (
          previous.orderStatus !== "confirmed" &&
          row.lineTotal.plus(row.taxTotal).greaterThan(0) &&
          !row.nonPerformanceChargeReason?.trim()
        )
          throw new BadRequestException(
            "Per il servizio non eseguito azzera esplicitamente l'importo oppure dichiara il motivo della quota trattenuta",
          );
        continue;
      }
      const firstExecution =
        (!!row.booking &&
          previous.orderStatus !== "confirmed" &&
          row.booking.status !== "completed") ||
        newExecutions.some((item) => item.id === row.id);
      if (
        (firstExecution || !!old?.collaboratorId) &&
        row.service?.requiresCollaborator &&
        !row.collaboratorId
      )
        throw new BadRequestException(
          "Indica l'esecutore effettivo per ogni prestazione eseguita che lo richiede",
        );
      if (firstExecution && row.quantity !== 1)
        throw new BadRequestException(
          "Registra ogni prestazione come riga separata",
        );
    }
    const durations = new Map(
      services.map((row) => [row.id, row.service?.durationMinutes || 0]),
    );
    // Default: the new services end now (or at the sale time for a new sale).
    let cursor = previous.servicesStartAt
      ? new Date(previous.servicesStartAt.getTime())
      : new Date(
          (previous.orderStatus === "new" ? sale.soldAt.getTime() : Date.now()) -
            newExecutions.reduce(
              (sum, row) => sum + (durations.get(row.id) || 0) * 60000,
              0,
            ),
        );
    let primary = sale.appointmentId;
    for (const row of services) {
      if (row.booking) {
        if (["cancelled", "no_show"].includes(row.booking.status)) continue;
        // A historic confirmed account may have an unresolved planning status.
        // An unrelated counter edit cannot declare its execution retroactively.
        if (
          previous.orderStatus === "confirmed" &&
          row.booking.status !== "completed"
        )
          continue;
        await tx.appointment.update({
          where: { id: row.booking.id },
          data: {
            status: "completed",
            finalPrice: row.lineTotal.plus(row.taxTotal),
            updatedById: actorId,
          },
        });
      } else if (newExecutions.some((item) => item.id === row.id)) {
        const duration = durations.get(row.id) || 0;
        if (!Number.isInteger(duration) || duration < 1 || duration > 1440)
          throw new BadRequestException("Durata del servizio non valida");
        const end = new Date(cursor.getTime() + duration * 60000);
        const created = await tx.appointment.create({
          data: {
            tenantId: sale.tenantId,
            locationId: sale.locationId,
            sectorId: row.sectorId,
            customerId: sale.customerId!,
            serviceId: row.serviceId!,
            collaboratorId: row.collaboratorId,
            startsAt: cursor,
            endsAt: end,
            status: "completed",
            source: "internal",
            estimatedPrice: row.lineTotal.plus(row.taxTotal),
            finalPrice: row.lineTotal.plus(row.taxTotal),
            orderItemId: row.id,
            internalNotes: "Prestazione dichiarata dalla cassa",
            createdById: actorId,
            updatedById: actorId,
          },
          select: { id: true },
        });
        primary ||= created.id;
        cursor = end;
      }
    }
    if (primary !== sale.appointmentId)
      await tx.sale.update({
        where: { id: sale.id },
        data: { appointmentId: primary },
      });
  }
}
