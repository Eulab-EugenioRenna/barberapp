import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
type CalendarClient = Pick<
  Prisma.TransactionClient,
  "sector" | "tenantHoliday"
>;
import { zonedDateKey, zonedDateParts } from "../../common/zoned-time";
export interface BusinessHours {
  weekday: number;
  isWorkingDay: boolean;
  startTime?: string;
  endTime?: string;
}
export function validateHours(value: unknown): BusinessHours[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 7)
    throw new BadRequestException("Orari non validi");
  const seen = new Set<number>();
  return value.map((entry: unknown) => {
    const row = entry as BusinessHours;
    if (
      !row ||
      !Number.isInteger(row.weekday) ||
      row.weekday < 0 ||
      row.weekday > 6 ||
      seen.has(row.weekday) ||
      typeof row.isWorkingDay !== "boolean"
    )
      throw new BadRequestException("Giorni degli orari non validi");
    seen.add(row.weekday);
    if (
      row.isWorkingDay &&
      (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startTime || "") ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.endTime || "") ||
        row.startTime! >= row.endTime!)
    )
      throw new BadRequestException("Intervallo degli orari non valido");
    return {
      weekday: row.weekday,
      isWorkingDay: row.isWorkingDay,
      ...(row.isWorkingDay
        ? { startTime: row.startTime, endTime: row.endTime }
        : {}),
    };
  });
}
export function validateClosures(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 730 ||
    value.some(
      (date) =>
        typeof date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date + "T00:00:00Z")) ||
        new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date,
    )
  )
    throw new BadRequestException("Date di chiusura non valide");
  return [...new Set(value as string[])].sort();
}
const minutes = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
export function intersectBusinessHours(
  date: string,
  settings: Array<{ weeklyHours: unknown; closures: unknown }>,
) {
  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  let startMinutes = 0,
    endMinutes = 1440;
  for (const [index, setting] of settings.entries()) {
    if (Array.isArray(setting.closures) && setting.closures.includes(date))
      return null;
    if (index > 0 && setting.weeklyHours == null) continue;
    // The inherited legacy business day is 09:00–19:00.
    const row = Array.isArray(setting.weeklyHours)
      ? (setting.weeklyHours as BusinessHours[]).find(
          (day) => day.weekday === weekday,
        )
      : { isWorkingDay: true, startTime: "09:00", endTime: "19:00" };
    if (!row?.isWorkingDay || !row.startTime || !row.endTime) return null;
    startMinutes = Math.max(startMinutes, minutes(row.startTime));
    endMinutes = Math.min(endMinutes, minutes(row.endTime));
  }
  return startMinutes < endMinutes ? { startMinutes, endMinutes } : null;
}
export async function sectorWorkingWindow(
  prisma: CalendarClient,
  sectorId: string,
  date: string,
  publicOnly = false,
) {
  const sector = await prisma.sector.findFirst({
    where: {
      id: sectorId,
      isActive: true,
      location: { isActive: true, ...(publicOnly ? { isPublic: true } : {}) },
      ...(publicOnly ? { isPublic: true } : {}),
    },
    include: { location: true },
  });
  if (!sector) return null;
  const holiday = await prisma.tenantHoliday.count({
    where: {
      tenantId: sector.tenantId,
      date: new Date(date + "T00:00:00.000Z"),
    },
  });
  return holiday
    ? null
    : intersectBusinessHours(date, [sector.location, sector]);
}
export async function requireSectorWorkingWindow(
  prisma: CalendarClient,
  sectorId: string,
  startsAt: Date,
  endsAt: Date,
  timezone: string,
) {
  const date = zonedDateKey(startsAt, timezone),
    start = zonedDateParts(startsAt, timezone),
    end = zonedDateParts(endsAt, timezone);
  const window = await sectorWorkingWindow(prisma, sectorId, date);
  if (
    !window ||
    zonedDateKey(endsAt, timezone) !== date ||
    start.hour * 60 + start.minute < window.startMinutes ||
    end.hour * 60 + end.minute > window.endMinutes
  )
    throw new BadRequestException(
      "Orario fuori apertura della sede o del settore",
    );
}
