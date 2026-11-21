import { planAppointmentReminders } from "./appointment-reminder-plan";
import { validateAutomationSettings } from "./appointment-automation-policy.service";
import type { AppointmentAutomationSettings } from "../../common/appointment-automation-policy";

const settings: AppointmentAutomationSettings = {
  initialConfirmation: true,
  requestResponse: true,
  leadMinutes: 1440,
  maxReminders: 1,
  repeatIntervalMinutes: 180,
  responseDeadlineMinutes: 30,
  deliveryStart: "09:00",
  deliveryEnd: "19:00",
  noResponseAction: "notify_staff",
};
const week = (all = false) =>
  Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    isWorkingDay: all || (weekday > 0 && weekday < 6),
    startTime: "09:00",
    endTime: "19:00",
  }));
const input = {
  settings,
  startsAt: new Date("2026-06-16T08:00:00Z"),
  now: new Date("2026-06-01T00:00:00Z"),
  timezone: "Europe/Rome",
  calendars: [{ weeklyHours: week(), closures: [] }],
  holidays: [],
};
describe("Appointment reminder timing", () => {
  it("keeps elapsed lead time and sets a separate response deadline", () => {
    expect(planAppointmentReminders(input)).toMatchObject({
      responseExpiresAt: "2026-06-16T07:30:00.000Z",
      reminders: [{ dueAt: "2026-06-15T08:00:00.000Z", shifted: false }],
    });
  });
  it("intersects location, sector, delivery window, holidays and weekend closures", () => {
    const result = planAppointmentReminders({
      ...input,
      calendars: [
        ...input.calendars,
        {
          weeklyHours: week().map((d) => ({ ...d, endTime: "17:00" })),
          closures: [],
        },
      ],
      holidays: ["2026-06-15"],
    });
    expect(result.reminders[0]).toMatchObject({
      dueAt: "2026-06-12T14:59:00.000Z",
      shifted: true,
    });
  });
  it("omits collapsed repeats rather than creating a burst at closing time", () => {
    const result = planAppointmentReminders({
      ...input,
      settings: { ...settings, maxReminders: 5 },
    });
    expect(result.reminders.map((r) => r.dueAt)).toEqual([
      "2026-06-15T08:00:00.000Z",
      "2026-06-15T11:00:00.000Z",
      "2026-06-15T14:00:00.000Z",
    ]);
    expect(result.omitted).toEqual([
      { sequence: 4, reason: "repeat_too_close" },
      { sequence: 5, reason: "repeat_too_close" },
    ]);
  });
  it("does not replay a missed first reminder or start with its later repeat", () => {
    const result = planAppointmentReminders({
      ...input,
      now: new Date("2026-06-15T08:00:01Z"),
      settings: { ...settings, maxReminders: 3 },
    });
    expect(result.reminders).toEqual([]);
    expect(result.omitted).toEqual([
      { sequence: 1, reason: "no_future_opening" },
    ]);
  });
  it("omits nominal repeats at or after the response deadline", () => {
    const result = planAppointmentReminders({
      ...input,
      settings: {
        ...settings,
        leadMinutes: 120,
        maxReminders: 3,
        repeatIntervalMinutes: 60,
      },
    });
    expect(result.omitted).toContainEqual({
      sequence: 3,
      reason: "outside_response_window",
    });
  });
  it("has no response expiry when no response is requested", () => {
    expect(
      planAppointmentReminders({
        ...input,
        settings: { ...settings, requestResponse: false },
      }).responseExpiresAt,
    ).toBeNull();
  });
  it.each([
    ["2026-03-29T08:00:00Z", "2026-03-28T08:00:00.000Z"],
    ["2026-10-25T09:00:00Z", "2026-10-24T09:00:00.000Z"],
  ])(
    "preserves 24 elapsed hours across the DST boundary at %s",
    (start, expected) => {
      const result = planAppointmentReminders({
        ...input,
        startsAt: new Date(start),
        now: new Date("2026-01-01Z"),
        calendars: [{ weeklyHours: week(true), closures: [] }],
        settings: { ...settings, deliveryStart: "00:00", deliveryEnd: "23:59" },
      });
      expect(result.reminders[0].dueAt).toBe(expected);
    },
  );
  it("keeps the second occurrence of a repeated local time when it is the nominal instant", () => {
    const hours = week(true).map((d) => ({
      ...d,
      startTime: "00:00",
      endTime: "23:59",
    }));
    const result = planAppointmentReminders({
      ...input,
      startsAt: new Date("2026-10-26T01:30:00Z"),
      now: new Date("2026-10-01Z"),
      calendars: [{ weeklyHours: hours, closures: [] }],
      settings: { ...settings, deliveryStart: "02:00", deliveryEnd: "03:00" },
    });
    expect(result.reminders[0].dueAt).toBe("2026-10-25T01:30:00.000Z");
  });
  it("bounds a search over a completely closed calendar", () => {
    const result = planAppointmentReminders({
      ...input,
      calendars: [{ weeklyHours: [], closures: [] }],
    });
    expect(result.reminders).toEqual([]);
    expect(result.omitted[0].reason).toBe("no_future_opening");
  });
});
describe("Automation settings validation", () => {
  it("does not constrain the unused response deadline when no response is requested", () => {
    expect(validateAutomationSettings({ ...settings, requestResponse: false, leadMinutes: 2 }).leadMinutes).toBe(2);
  });
  it.each([
    { ...settings, enabled: true },
    { ...settings, maxReminders: 6 },
    { ...settings, leadMinutes: "1440" },
    { ...settings, leadMinutes: 30 },
    { ...settings, deliveryEnd: "08:00" },
    { ...settings, requestResponse: "true" },
    { ...settings, noResponseAction: "cancel_booking" },
  ])("rejects invalid or unsupported policy input %#", (value) => {
    expect(() => validateAutomationSettings(value)).toThrow();
  });
});
