import { toLocalDateKey } from "@barber/shared/utils";

export function buildDayListingEvent(
  date: Date,
  sourceView: "week" | "month",
): { date: string; sourceView: "week" | "month" } {
  return {
    date: toLocalDateKey(date),
    sourceView,
  };
}
