import type {
  AppointmentAutomationSettings,
  AppointmentReminderPlan,
} from "../../common/appointment-automation-policy";
import { intersectBusinessHours } from "../locations/operational-hours";

/** Minutes are elapsed time. Opening windows are tenant-local wall clock time.
 * Moving backwards through actual instants handles both occurrences in a DST fold.
 */
export function planAppointmentReminders(input: {
  settings: AppointmentAutomationSettings;
  startsAt: Date;
  now: Date;
  timezone: string;
  calendars: Array<{ weeklyHours: unknown; closures: unknown }>;
  holidays: string[];
}): AppointmentReminderPlan {
  const { settings, startsAt, now, timezone } = input;
  const minute = 60000;
  const expires =
    startsAt.getTime() -
    (settings.requestResponse ? settings.responseDeadlineMinutes : 0) * minute;
  const result: AppointmentReminderPlan = {
    timezone,
    responseExpiresAt: settings.requestResponse
      ? new Date(expires).toISOString()
      : null,
    reminders: [],
    omitted: [],
  };
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const holidays = new Set(input.holidays);
  const windows = new Map<string, ReturnType<typeof intersectBusinessHours>>();
  const policyWindow = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    isWorkingDay: true,
    startTime: settings.deliveryStart,
    endTime: settings.deliveryEnd,
  }));
  const previousOpening = (nominal: number) => {
    const limit = Math.max(now.getTime(), nominal - 31 * 86400000);
    for (
      let cursor = Math.floor(nominal / minute) * minute;
      cursor > limit;
      cursor -= minute
    ) {
      const p = Object.fromEntries(
        formatter
          .formatToParts(new Date(cursor))
          .map((part) => [part.type, part.value]),
      );
      const date = `${p["year"]}-${p["month"]}-${p["day"]}`;
      if (!windows.has(date))
        windows.set(
          date,
          holidays.has(date)
            ? null
            : intersectBusinessHours(date, [
                ...input.calendars,
                { weeklyHours: policyWindow, closures: [] },
              ]),
        );
      const window = windows.get(date),
        localMinute = Number(p["hour"]) * 60 + Number(p["minute"]);
      if (
        window &&
        localMinute >= window.startMinutes &&
        localMinute < window.endMinutes
      )
        return cursor;
    }
    return null;
  };
  let previous: number | null = null;
  for (let index = 0; index < settings.maxReminders; index++) {
    const nominal =
      startsAt.getTime() -
      settings.leadMinutes * minute +
      index * settings.repeatIntervalMinutes * minute;
    if (nominal >= expires) {
      result.omitted.push({
        sequence: index + 1,
        reason: "outside_response_window",
      });
      continue;
    }
    const due = previousOpening(nominal);
    if (due === null) {
      result.omitted.push({ sequence: index + 1, reason: "no_future_opening" });
      // Do not start a repeat sequence whose first message was already missed.
      if (index === 0) break;
      continue;
    }
    if (
      previous !== null &&
      due - previous < settings.repeatIntervalMinutes * minute
    ) {
      result.omitted.push({ sequence: index + 1, reason: "repeat_too_close" });
      continue;
    }
    result.reminders.push({
      sequence: index + 1,
      nominalAt: new Date(nominal).toISOString(),
      dueAt: new Date(due).toISOString(),
      shifted: due !== nominal,
    });
    previous = due;
  }
  return result;
}
