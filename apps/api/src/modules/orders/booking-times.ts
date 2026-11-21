import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { parseZonedDateTime } from "../../common/zoned-time";
export interface BookingTimeLine {
  serviceId: string;
  startsAt?: string | null;
  collaboratorId?: string | null;
  roomId?: string | null;
  /** Internal historical duration; never accepted from a booking DTO. */
  durationMilliseconds?: number;
}
/** Preserve every explicit start; omitted starts continue exactly after the previous service. */
export async function resolveBookingTimes(
  client: Pick<Prisma.TransactionClient, "service">,
  tenantId: string,
  timezone: string,
  lines: BookingTimeLine[],
  startsAt?: string | null,
) {
  const catalog = await client.service.findMany({
    where: {
      tenantId,
      id: { in: [...new Set(lines.map((row) => row.serviceId))] },
    },
    select: { id: true, durationMinutes: true },
  });
  let next = startsAt;
  return lines.map((row) => {
    const raw = row.startsAt || next,
      start = raw ? parseZonedDateTime(raw, timezone) : null;
    const service = catalog.find((item) => item.id === row.serviceId);
    if (
      !start ||
      !service ||
      !Number.isInteger(service.durationMinutes) ||
      service.durationMinutes < 1 ||
      service.durationMinutes > 1440
    )
      throw new BadRequestException(
        "Scegli un orario iniziale valido e servizi disponibili",
      );
    const duration =
      row.durationMilliseconds ?? service.durationMinutes * 60000;
    if (!Number.isInteger(duration) || duration < 1000 || duration > 86400000)
      throw new BadRequestException("Durata storica da riconciliare");
    const endsAt = new Date(start.getTime() + duration);
    next = endsAt.toISOString();
    return {
      serviceId: row.serviceId,
      startsAt: start,
      endsAt,
      collaboratorId: row.collaboratorId,
      roomId: row.roomId,
    };
  });
}
