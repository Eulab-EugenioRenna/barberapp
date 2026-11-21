import { validateAutomationSettings } from "./appointment-automation-policy.service";
import {
  appointmentPhone,
  whatsappParty,
  bookingContactAuthorization,
} from "./appointment-automation-state";
import {
  automationNextOpening,
  automationWindowEnd,
  automationTexts,
  DEFAULT_AUTOMATION_TEXTS,
  renderAutomationText,
} from "./appointment-automation-messages";
import { customerCancellationAllowed } from "../orders/booking-cancellation";

describe("Appointment customer contract", () => {
  it("requires an explicit international prefix and normalizes only unambiguous WhatsApp parties", () => {
    expect(appointmentPhone("+39 (333) 123-4567")).toBe("393331234567");
    expect(appointmentPhone("0039 333 1234567")).toBe("393331234567");
    expect(appointmentPhone("3331234567")).toBeNull();
    expect(appointmentPhone("+123456")).toBeNull();
    expect(whatsappParty("393331234567:12@s.whatsapp.net")).toBe(
      "393331234567",
    );
    expect(whatsappParty("393331234567@g.us")).toBeNull();
    expect(whatsappParty("123456789@lid")).toBeNull();
  });
  it("keeps a consent identity for the same customer and phone but requires a new identity after a phone change", () => {
    const customer = { id: "customer", phone: "+393331234567" };
    const first = bookingContactAuthorization(
      customer,
      true,
      "author",
      "internal",
      null,
    )!;
    expect(
      bookingContactAuthorization(
        { ...customer, phone: "+39 333 1234567" },
        true,
        "author",
        "internal",
        JSON.parse(JSON.stringify(first)),
      ),
    ).toEqual(first);
    expect(
      bookingContactAuthorization(
        { ...customer, phone: "+393331234568" },
        true,
        "author",
        "internal",
        JSON.parse(JSON.stringify(first)),
      )?.authorizationId,
    ).not.toBe(first.authorizationId);
    expect(
      bookingContactAuthorization(customer, false, "author", "internal", null),
    ).toBeNull();
    expect(() =>
      bookingContactAuthorization(
        { ...customer, phone: "3331234567" },
        true,
        "author",
        "internal",
        null,
      ),
    ).toThrow();
  });
  it("uses the same 24 elapsed hours cutoff at the exact boundary and across DST", () => {
    const starts = new Date("2027-03-28T10:00:00Z");
    expect(
      customerCancellationAllowed(starts, new Date("2027-03-27T10:00:00Z")),
    ).toBe(true);
    expect(
      customerCancellationAllowed(starts, new Date("2027-03-27T10:00:00.001Z")),
    ).toBe(false);
    expect(
      customerCancellationAllowed(starts, new Date("2027-03-28T11:00:00Z")),
    ).toBe(false);
  });
  it("allows operational placeholders and rejects contact data, unknown paths and oversized templates", () => {
    expect(automationTexts(null)).toEqual(DEFAULT_AUTOMATION_TEXTS);
    expect(() =>
      automationTexts({
        ...DEFAULT_AUTOMATION_TEXTS,
        initial: "{{customer.phone}}",
      }),
    ).toThrow();
    expect(() =>
      automationTexts({
        ...DEFAULT_AUTOMATION_TEXTS,
        initial: "{{__proto__.value}}",
      }),
    ).toThrow();
    expect(() =>
      automationTexts({
        ...DEFAULT_AUTOMATION_TEXTS,
        initial: "a".repeat(3501),
      }),
    ).toThrow();
  });
  it("renders sample and production-shaped fields in the activity timezone with plain text values", () => {
    const sample = {
      customer: { firstName: "<Giulia>", lastName: "Esempio" },
      service: { name: "Taglio" },
      appointment: {
        startsAt: new Date("2030-06-18T09:00Z"),
        endsAt: new Date("2030-06-18T10:00Z"),
        status: "confirmed",
      },
      collaborator: null,
      tenant: { name: "Salone" },
    };
    const text = renderAutomationText(
      "{{customer.firstName}} {{appointment.startsAt}} {{tenant.name}}",
      sample,
      "Europe/Rome",
    );
    expect(text).toContain("<Giulia>");
    expect(text).toContain("11:00");
    expect(text).toContain("Salone");
    expect(text).not.toContain("{{");
  });
});

describe("Initial and delivery opening windows", () => {
  const settings = {
    initialConfirmation: true,
    requestResponse: true,
    leadMinutes: 1440,
    maxReminders: 1,
    repeatIntervalMinutes: 120,
    responseDeadlineMinutes: 30,
    deliveryStart: "00:00",
    deliveryEnd: "23:59",
    noResponseAction: "keep_booking" as const,
  };
  const calendar = (startTime: string, endTime: string) => ({
    weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      isWorkingDay: true,
      startTime,
      endTime,
    })),
    closures: [],
  });
  it("intersects calendars, respects holidays and returns no opening before the deadline", () => {
    const plan = {
      order: { tenant: { timezone: "Europe/Rome" } },
      appointments: [
        {
          location: calendar("09:00", "19:00"),
          sector: calendar("10:00", "18:00"),
        },
      ],
    };
    expect(
      automationNextOpening(
        plan,
        settings,
        new Date("2026-11-10T19:00Z"),
        new Date("2026-11-13T10:00Z"),
        ["2026-11-11"],
      )?.toISOString(),
    ).toBe("2026-11-12T09:00:00.000Z");
    expect(
      automationNextOpening(
        plan,
        settings,
        new Date("2026-11-10T19:00Z"),
        new Date("2026-11-11T08:00Z"),
        [],
      ),
    ).toBeNull();
    expect(
      automationWindowEnd(
        plan,
        settings,
        new Date("2026-11-12T09:00Z"),
        new Date("2026-11-12T11:30Z"),
        [],
      ).toISOString(),
    ).toBe("2026-11-12T11:30:00.000Z");
  });
  it("treats both DST-fold openings as actual instants and stops at the first real close", () => {
    const plan = {
      order: { tenant: { timezone: "Europe/Rome" } },
      appointments: [
        {
          location: calendar("02:15", "02:45"),
          sector: calendar("02:00", "03:00"),
        },
      ],
    };
    expect(
      automationNextOpening(
        plan,
        settings,
        new Date("2026-10-25T00:50Z"),
        new Date("2026-10-25T03:00Z"),
        [],
      )?.toISOString(),
    ).toBe("2026-10-25T01:15:00.000Z");
    expect(
      automationWindowEnd(
        plan,
        settings,
        new Date("2026-10-25T00:15Z"),
        new Date("2026-10-25T03:00Z"),
        [],
      ).toISOString(),
    ).toBe("2026-10-25T00:45:00.000Z");
  });
});

describe("Appointment notification event choices", () => {
  const settings = {
    initialConfirmation: true,
    requestResponse: true,
    leadMinutes: 1440,
    maxReminders: 2,
    repeatIntervalMinutes: 120,
    responseDeadlineMinutes: 30,
    deliveryStart: "09:00",
    deliveryEnd: "19:00",
    noResponseAction: "keep_booking",
  };
  it("keeps new terminal event notices disabled for old policies and retains reschedule behavior", () => {
    expect(
      validateAutomationSettings({ ...settings, maxReminders: 0 }).maxReminders,
    ).toBe(0);
    expect(validateAutomationSettings(settings).eventNotices).toEqual({
      confirmation: false,
      cancellation: false,
      rescheduling: true,
    });
    expect(
      validateAutomationSettings({
        ...settings,
        eventNotices: {
          confirmation: true,
          cancellation: true,
          rescheduling: false,
        },
      }).eventNotices,
    ).toEqual({ confirmation: true, cancellation: true, rescheduling: false });
  });
  it("rejects incomplete or untyped event choices instead of inferring permission", () => {
    expect(() =>
      validateAutomationSettings({
        ...settings,
        eventNotices: { confirmation: true },
      }),
    ).toThrow();
    expect(() =>
      validateAutomationSettings({
        ...settings,
        eventNotices: {
          confirmation: true,
          cancellation: "yes",
          rescheduling: true,
        },
      }),
    ).toThrow();
    expect(() =>
      validateAutomationSettings({
        ...settings,
        eventNotices: {
          confirmation: true,
          cancellation: true,
          rescheduling: true,
          all: true,
        },
      }),
    ).toThrow();
  });
  it("keeps event templates operational and fills compatible old text settings", () => {
    const texts = automationTexts({
      initial: "Ciao {{customer.firstName}}",
      reminder: "Promemoria {{service.name}}",
    });
    expect(texts.confirmed).toContain("è confermato");
    expect(texts.cancelled).toContain("annullato");
    expect(texts.rescheduled).toContain("riprogrammato");
    expect(() =>
      automationTexts({ ...texts, cancelled: "{{customer.phone}}" }),
    ).toThrow();
  });
});
