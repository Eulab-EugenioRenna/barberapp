import {
  parseZonedDateTime,
  resolveZonedDateKey,
  zonedDateKey,
  zonedTimeToUtc,
} from "./zoned-time";

describe("zoned-time", () => {
  it("converts a tenant wall clock to UTC across DST", () => {
    // Europe/Rome is UTC+2 in summer and UTC+1 in winter.
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 9, day: 25, hour: 9 },
        "Europe/Rome",
      ).toISOString(),
    ).toBe("2026-09-25T07:00:00.000Z");
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 1, day: 15, hour: 9 },
        "Europe/Rome",
      ).toISOString(),
    ).toBe("2026-01-15T08:00:00.000Z");
  });

  it("parses naive datetimes as tenant local and keeps absolute instants", () => {
    expect(
      parseZonedDateTime("2026-09-25T09:00", "Europe/Rome")?.toISOString(),
    ).toBe("2026-09-25T07:00:00.000Z");
    expect(
      parseZonedDateTime(
        "2026-09-25T09:00:00.000Z",
        "Europe/Rome",
      )?.toISOString(),
    ).toBe("2026-09-25T09:00:00.000Z");
    expect(parseZonedDateTime("not-a-date", "Europe/Rome")).toBeNull();
  });

  it("resolves the tenant calendar day from a UTC instant", () => {
    expect(
      zonedDateKey(new Date("2026-09-24T22:30:00.000Z"), "Europe/Rome"),
    ).toBe("2026-09-25");
    expect(resolveZonedDateKey("2026-09-25", "Europe/Rome")).toBe("2026-09-25");
    expect(
      resolveZonedDateKey("2026-09-24T22:30:00.000Z", "Europe/Rome"),
    ).toBe("2026-09-25");
  });
});
