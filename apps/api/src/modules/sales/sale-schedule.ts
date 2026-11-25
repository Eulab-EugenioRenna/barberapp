import { BadRequestException, Injectable } from "@nestjs/common";
import { zonedDateKey, zonedDateParts } from "../../common/zoned-time";
import { CollaboratorScheduleService } from "../availability/collaborator-schedule.service";
import { PrismaService } from "../../prisma/prisma.service";

/** A till records services already performed: a small clock skew is tolerated. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/**
 * Optional "Eseguito alle" of a till account: start of the first service, the
 * others follow in order. Past dates are allowed (late registration); a future
 * time is a booking and must go through the agenda.
 */
export function parseServicesStartAt(value: unknown, now = new Date()): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000)
    throw new BadRequestException("Orario di esecuzione non valido");
  if (date.getTime() > now.getTime() + FUTURE_TOLERANCE_MS)
    throw new BadRequestException(
      "La cassa registra servizi già eseguiti: per un orario futuro usa «Prenota»",
    );
  return date;
}

export type ScheduleWarning = {
  code: "COLLABORATOR_BUSY" | "OUTSIDE_COLLABORATOR_HOURS" | "OUTSIDE_SECTOR_HOURS";
  message: string;
  lineIndex: number;
};

type ServiceLine = {
  serviceId?: string | null;
  sectorId?: string | null;
  collaboratorId?: string | null;
  durationMinutes: number;
  label: string;
  /** Already in the agenda (booked line): it keeps its own slot. */
  booked: boolean;
};

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;

/**
 * Non-blocking checks for services registered at the till: the account is
 * saved anyway ("libertà"), the operator is only told what does not add up.
 */
@Injectable()
export class SaleScheduleWarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedules: CollaboratorScheduleService,
  ) {}

  async warnings(
    tenantId: string,
    startAt: Date,
    lines: ServiceLine[],
    excludeSaleId?: string,
  ): Promise<ScheduleWarning[]> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const timezone = tenant?.timezone || "Europe/Rome";
    const names = new Map<string, string>();
    const warnings: ScheduleWarning[] = [];
    let cursor = startAt.getTime();
    for (const [lineIndex, line] of lines.entries()) {
      if (line.booked || !line.serviceId) continue;
      const start = new Date(cursor);
      const end = new Date(cursor + Math.max(0, line.durationMinutes) * 60_000);
      cursor = end.getTime();
      const date = zonedDateKey(start, timezone);
      const from = zonedDateParts(start, timezone);
      const to = zonedDateParts(end, timezone);
      const startMinutes = from.hour * 60 + from.minute;
      const endMinutes =
        zonedDateKey(end, timezone) === date ? to.hour * 60 + to.minute : 24 * 60;
      // Opening hours bind online booking only: staff may record any time.
      if (!line.collaboratorId) continue;
      if (!names.has(line.collaboratorId)) {
        const person = await this.prisma.collaborator.findFirst({
          where: { id: line.collaboratorId, tenantId },
          select: { firstName: true, lastName: true },
        });
        names.set(
          line.collaboratorId,
          `${person?.firstName ?? ""} ${person?.lastName ?? ""}`.trim() || "Il professionista",
        );
      }
      const who = names.get(line.collaboratorId)!;
      const schedule = await this.schedules.resolveWorkingWindow(
        tenantId,
        line.collaboratorId,
        new Date(from.year, from.month - 1, from.day),
      );
      if (
        !schedule.isAvailable ||
        startMinutes < schedule.startMinutes ||
        endMinutes > schedule.endMinutes
      )
        warnings.push({
          code: "OUTSIDE_COLLABORATOR_HOURS",
          lineIndex,
          message: `${line.label}: ${who} non risultava in servizio a quell'ora.`,
        });
      const overlap = await this.prisma.appointment.findFirst({
        where: {
          tenantId,
          collaboratorId: line.collaboratorId,
          status: { notIn: ["cancelled", "no_show"] },
          startsAt: { lt: end },
          endsAt: { gt: start },
          ...(excludeSaleId
            ? { NOT: { orderItem: { is: { saleId: excludeSaleId } } } }
            : {}),
        },
        select: { startsAt: true, service: { select: { name: true } } },
        orderBy: { startsAt: "asc" },
      });
      if (overlap) {
        const at = zonedDateParts(overlap.startsAt, timezone);
        warnings.push({
          code: "COLLABORATOR_BUSY",
          lineIndex,
          message: `${line.label}: ${who} ha già «${overlap.service?.name ?? "un appuntamento"}» alle ${hhmm(at.hour * 60 + at.minute)}.`,
        });
      }
    }
    return warnings;
  }
}
