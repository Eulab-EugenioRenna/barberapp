import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { NormalizedOrderItem } from "../sales/sales.logic";
import type { OperationalScope } from "./operational-scope";
type ExistingRow = {
  id: string;
  sectorId: string;
  serviceId: string | null;
  productId: string | null;
  collaboratorId: string | null;
};
export async function attributeOrder(
  prisma: Pick<
    Prisma.TransactionClient,
    "sector" | "service" | "appointment" | "collaboratorSector"
  >,
  scope: OperationalScope,
  items: NormalizedOrderItem[],
  input: Array<Record<string, unknown>>,
  options: {
    locationId?: unknown;
    existing?: { locationId: string; items: ExistingRow[] };
    appointmentId?: string;
  } = {},
) {
  if (
    options.existing &&
    options.locationId &&
    options.locationId !== options.existing.locationId
  )
    throw new BadRequestException("La sede del conto non è modificabile");
  const sectors = await prisma.sector.findMany({
    where: { tenantId: scope.tenantId, id: { in: scope.sectorIds } },
    select: {
      id: true,
      locationId: true,
      isActive: true,
      location: { select: { isActive: true } },
    },
  });
  let locationId =
    options.existing?.locationId ||
    (typeof options.locationId === "string" ? options.locationId : "");
  let booked:
    | { serviceId: string; sectorId: string; collaboratorId: string | null }
    | undefined;
  if (options.appointmentId) {
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: options.appointmentId,
        tenantId: scope.tenantId,
        sectorId: { in: scope.sectorIds },
      },
      select: {
        locationId: true,
        sectorId: true,
        serviceId: true,
        collaboratorId: true,
      },
    });
    if (!appointment || (locationId && locationId !== appointment.locationId))
      throw new BadRequestException(
        "Conto e appuntamento devono appartenere alla stessa sede",
      );
    locationId = appointment.locationId;
    booked = appointment;
  }
  const services = await prisma.service.findMany({
    where: {
      tenantId: scope.tenantId,
      id: {
        in: items.flatMap((item) => (item.serviceId ? [item.serviceId] : [])),
      },
    },
    select: { id: true, sectorId: true },
  });
  if (!locationId) {
    const first = items.find((item) => item.serviceId);
    const service = services.find((service) => service.id === first?.serviceId);
    locationId =
      sectors.find((sector) => sector.id === service?.sectorId)?.locationId ||
      (scope.locationIds.length === 1 ? scope.locationIds[0] : "");
  }
  if (!locationId || !scope.locationIds.includes(locationId))
    throw new BadRequestException("Seleziona la sede del conto");
  const used = new Set<string>();
  const attributed = [];
  for (const [index, item] of items.entries()) {
    const rowInput = input[index];
    let old =
      typeof rowInput["id"] === "string"
        ? options.existing?.items.find((row) => row.id === rowInput["id"])
        : undefined;
    if (rowInput["id"] && !old)
      throw new BadRequestException("Riga del conto non valida");
    if (!rowInput["id"] && options.existing) {
      const matches = options.existing.items.filter(
        (row) =>
          !used.has(row.id) &&
          (row.serviceId || undefined) === item.serviceId &&
          (row.productId || undefined) === item.productId,
      );
      if (new Set(matches.map((row) => row.sectorId)).size > 1)
        throw new BadRequestException(
          "Mantieni gli identificativi delle righe storiche",
        );
      old = matches[0];
    }
    if (old && used.has(old.id))
      throw new BadRequestException("Riga duplicata");
    const retained =
      old &&
      (old.serviceId || undefined) === item.serviceId &&
      (old.productId || undefined) === item.productId;
    const service = services.find((service) => service.id === item.serviceId);
    const available = sectors.filter(
      (sector) => sector.locationId === locationId,
    );
    const bookedSectorId =
      booked && item.serviceId === booked.serviceId
        ? booked.sectorId
        : undefined;
    const sectorId = retained
      ? old!.sectorId
      : bookedSectorId ||
        service?.sectorId ||
        (typeof rowInput["sectorId"] === "string"
          ? rowInput["sectorId"]
          : available.length === 1
            ? available[0].id
            : "");
    const sector = available.find((sector) => sector.id === sectorId);
    if (
      !sector ||
      (!retained &&
        !bookedSectorId &&
        (!sector.isActive || !sector.location.isActive))
    )
      throw new BadRequestException(
        "Le righe devono appartenere a settori abilitati della stessa sede",
      );
    if (
      service &&
      !retained &&
      rowInput["sectorId"] &&
      rowInput["sectorId"] !== (bookedSectorId || service.sectorId)
    )
      throw new BadRequestException("Il settore del servizio non coincide");
    if (
      item.collaboratorId &&
      !(retained && old!.collaboratorId === item.collaboratorId) &&
      !(bookedSectorId && booked?.collaboratorId === item.collaboratorId) &&
      !(await prisma.collaboratorSector.count({
        where: { collaboratorId: item.collaboratorId, sectorId },
      }))
    )
      throw new BadRequestException(
        "Professionista non abilitato al settore della riga",
      );
    if (old) used.add(old.id);
    attributed.push({ ...item, ...(old ? { id: old.id } : {}), sectorId });
  }
  return { locationId, items: attributed };
}
