/**
 * Bookings the agenda loads: the calendar period on screen (day, Monday-based
 * week or month), extended to a filtered list day, widened by a week each side.
 */
export function agendaWindow(
  view: "day" | "week" | "month",
  date: Date,
  filterDate = "",
): { from: Date; to: Date } {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  if (view === "week") from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
  if (view === "month") from.setDate(1);
  const to = new Date(from);
  if (view === "day") to.setDate(to.getDate() + 1);
  else if (view === "week") to.setDate(to.getDate() + 7);
  else to.setMonth(to.getMonth() + 1);
  if (filterDate) {
    const day = new Date(filterDate + "T00:00:00");
    if (Number.isFinite(day.getTime())) {
      if (day < from) from.setTime(day.getTime());
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      if (next > to) to.setTime(next.getTime());
    }
  }
  from.setDate(from.getDate() - 7);
  to.setDate(to.getDate() + 7);
  return { from, to };
}

/** True when the loaded range already covers the wanted one. */
export function windowCovers(
  loaded: { from: number; to: number } | null,
  wanted: { from: Date; to: Date },
): boolean {
  return (
    !!loaded &&
    loaded.from <= wanted.from.getTime() &&
    loaded.to >= wanted.to.getTime()
  );
}
