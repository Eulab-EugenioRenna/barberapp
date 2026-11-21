/** Native datetime-local controls express browser-local civil time; preserve all stored precision. */
export function localBookingTime(value: string | Date): string {
  const date = new Date(value),
    pad = (number: number) => String(number).padStart(2, "0");
  const fraction = date.getMilliseconds()
    ? "." + String(date.getMilliseconds()).padStart(3, "0").replace(/0+$/, "")
    : "";
  const seconds =
    date.getSeconds() || fraction
      ? ":" + pad(date.getSeconds()) + fraction
      : "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}${seconds}`;
}
/** Reject invalid civil dates and spring-forward gaps instead of silently normalizing the chosen time. */
export function parseLocalBookingTime(value: string): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
      value,
    );
  if (!match) return null;
  const date = new Date(value);
  const expected = [
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0),
    Number((match[7] || "").padEnd(3, "0")),
  ];
  const actual = [
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  ];
  return Number.isFinite(date.getTime()) &&
    expected.every((number, index) => number === actual[index])
    ? date
    : null;
}

/** An unchanged civil label may identify either instant of the autumn clock fold. */
export function bookingInstant(
  value: string,
  heldInstant?: string,
  heldLocal?: string,
): string | null {
  if (heldInstant && heldLocal === value) return heldInstant;
  return parseLocalBookingTime(value)?.toISOString() ?? null;
}
