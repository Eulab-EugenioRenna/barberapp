import {
  localBookingTime,
  parseLocalBookingTime,
  bookingInstant,
} from "./booking-local-time";
describe("booking civil-time input", () => {
  it("retains the exact held instant when the displayed civil value is unchanged", () => {
    expect(
      bookingInstant(
        "2026-10-25T02:30",
        "2026-10-25T01:30:00.000Z",
        "2026-10-25T02:30",
      ),
    ).toBe("2026-10-25T01:30:00.000Z");
    expect(bookingInstant("invalid")).toBeNull();
  });
  it("round-trips a stored instant without dropping non-grid seconds or milliseconds", () => {
    const instant = new Date(2039, 2, 4, 12, 15, 32, 125);
    expect(localBookingTime(instant)).toBe("2039-03-04T12:15:32.125");
    expect(parseLocalBookingTime(localBookingTime(instant))?.getTime()).toBe(
      instant.getTime(),
    );
  });
  it("rejects normalized calendar overflows and zoned strings in a civil-time control", () => {
    expect(parseLocalBookingTime("2039-02-30T12:00")).toBeNull();
    expect(parseLocalBookingTime("2039-03-04T25:00")).toBeNull();
    expect(parseLocalBookingTime("2039-03-04T12:00Z")).toBeNull();
  });
  it("keeps minute-only values and canonicalizes fractional precision without changing the instant", () => {
    expect(localBookingTime(new Date(2039, 2, 4, 12, 15))).toBe(
      "2039-03-04T12:15",
    );
    expect(localBookingTime(new Date(2039, 2, 4, 12, 15, 0, 100))).toBe(
      "2039-03-04T12:15:00.1",
    );
  });
});
