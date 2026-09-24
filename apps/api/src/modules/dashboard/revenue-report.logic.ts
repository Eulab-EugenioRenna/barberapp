export type RevenuePeriod = "day" | "week" | "month" | "year" | "all";

export function getRevenueRange(
  period: RevenuePeriod,
  referenceInput?: string,
  timezone = "Europe/Rome",
): { start?: Date; end?: Date; label: string } {
  if (period === "all") return { label: "Tutto" };

  const reference = referenceDateParts(referenceInput, timezone);
  const calendar = new Date(
    Date.UTC(reference.year, reference.month - 1, reference.day),
  );
  let startCalendar = new Date(calendar);
  let endCalendar = new Date(calendar);
  let label = "Giorno";

  if (period === "week") {
    const mondayOffset = (calendar.getUTCDay() + 6) % 7;
    startCalendar.setUTCDate(startCalendar.getUTCDate() - mondayOffset);
    endCalendar = new Date(startCalendar);
    endCalendar.setUTCDate(endCalendar.getUTCDate() + 7);
    label = "Settimana";
  } else if (period === "month") {
    startCalendar = new Date(Date.UTC(reference.year, reference.month - 1, 1));
    endCalendar = new Date(Date.UTC(reference.year, reference.month, 1));
    label = "Mese";
  } else if (period === "year") {
    startCalendar = new Date(Date.UTC(reference.year, 0, 1));
    endCalendar = new Date(Date.UTC(reference.year + 1, 0, 1));
    label = "Anno";
  } else {
    endCalendar.setUTCDate(endCalendar.getUTCDate() + 1);
  }

  const start = localMidnightToUtc(startCalendar, timezone);
  const nextPeriodStart = localMidnightToUtc(endCalendar, timezone);
  return { start, end: new Date(nextPeriodStart.getTime() - 1), label };
}

function referenceDateParts(
  referenceInput: string | undefined,
  timezone: string,
): { year: number; month: number; day: number } {
  if (referenceInput) {
    const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(referenceInput);
    if (!match) throw new Error("Data non valida");
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3] ?? 1),
    };
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function localMidnightToUtc(calendarDate: Date, timezone: string): Date {
  const intended = Date.UTC(
    calendarDate.getUTCFullYear(),
    calendarDate.getUTCMonth(),
    calendarDate.getUTCDate(),
  );
  let candidate = intended;

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    const represented = Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
      value("second"),
    );
    candidate += intended - represented;
  }

  return new Date(candidate);
}

export function calculateRevenueKpis(input: {
  salesValues: number[];
  appointmentValues: number[];
  productRevenue: number;
  appointmentCount: number;
}) {
  const salesRevenue = input.salesValues.reduce((sum, value) => sum + value, 0);
  const appointmentRevenue = input.appointmentValues.reduce(
    (sum, value) => sum + value,
    0,
  );
  const totalRevenue = salesRevenue + appointmentRevenue;
  const revenueEvents =
    input.salesValues.length + input.appointmentValues.length;
  // Products are a subset of sales revenue; everything else (service sale
  // rows plus standalone completed appointments) is service revenue.
  const productRevenue = input.productRevenue;
  const serviceRevenue = totalRevenue - productRevenue;

  return {
    salesRevenue,
    appointmentRevenue,
    totalRevenue,
    averageTicket: revenueEvents ? totalRevenue / revenueEvents : 0,
    serviceRevenue,
    productRevenue,
    appointmentCount: input.appointmentCount,
    revenueEvents,
  };
}
