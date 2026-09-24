/**
 * Timezone helpers for tenant-scoped business dates.
 *
 * Business times (appointments, working hours, availability slots) belong to
 * the tenant timezone, while the process runs in UTC inside containers. These
 * helpers convert between a tenant-local wall clock and the UTC instant stored
 * in the database.
 */

export type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function zonedDateParts(value: Date, timezone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const numberPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: numberPart("year"),
    month: numberPart("month"),
    day: numberPart("day"),
    hour: numberPart("hour"),
    minute: numberPart("minute"),
    second: numberPart("second"),
  };
}

export function zonedDateKey(value: Date, timezone: string): string {
  const parts = zonedDateParts(value, timezone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/**
 * Converts a tenant-local wall clock (e.g. 2026-09-25 09:00 in Europe/Rome)
 * into the corresponding UTC instant. The algorithm iterates a couple of times
 * to account for DST offsets.
 */
export function zonedTimeToUtc(
  parts: {
    year: number;
    month: number;
    day: number;
    hour?: number;
    minute?: number;
    second?: number;
  },
  timezone: string,
): Date {
  const intended = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
    0,
  );
  let candidate = intended;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const represented = zonedDateParts(new Date(candidate), timezone);
    const representedUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
    );
    candidate += intended - representedUtc;
  }

  return new Date(candidate);
}

/**
 * Parses a date/datetime coming from a client.
 *
 * - If the value carries an explicit UTC designator or offset, it is used
 *   as-is (absolute instant).
 * - Otherwise the value is interpreted as tenant-local wall clock.
 */
export function parseZonedDateTime(
  value: string,
  timezone: string,
): Date | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const absolute = new Date(trimmed);
    return Number.isNaN(absolute.getTime()) ? null : absolute;
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(
      trimmed,
    );
  if (!match) {
    const fallback = new Date(trimmed);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  return zonedTimeToUtc(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4] ?? 0),
      minute: Number(match[5] ?? 0),
      second: Number(match[6] ?? 0),
    },
    timezone,
  );
}

/** Resolves the tenant calendar day (YYYY-MM-DD) from a date or datetime. */
export function resolveZonedDateKey(
  value: string | Date | undefined,
  timezone: string,
): string {
  if (value === undefined || value === "") {
    return zonedDateKey(new Date(), timezone);
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }

  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    return "";
  }

  return zonedDateKey(instant, timezone);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
