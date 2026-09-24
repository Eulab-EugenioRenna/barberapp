import { buildDayListingEvent } from "../../../web-admin/src/app/appointments/calendar-date";
import { toLocalDateKey } from "../../../../libs/shared/utils/src";

describe("toLocalDateKey", () => {
  it("preserves the local calendar day instead of serializing it as UTC", () => {
    const localMidnight = new Date(2026, 8, 24, 0, 0, 0);

    expect(localMidnight.toISOString().slice(0, 10)).toBe("2026-09-23");
    expect(toLocalDateKey(localMidnight)).toBe("2026-09-24");
  });

  it("uses the browser-local day for an ISO appointment timestamp", () => {
    const instant = new Date(2026, 8, 24, 0, 30, 0);

    expect(toLocalDateKey(instant.toISOString())).toBe("2026-09-24");
  });

  it("returns an empty key for invalid input", () => {
    expect(toLocalDateKey("not-a-date")).toBe("");
  });

  it("emits the selected local day from the +N More flow", () => {
    expect(buildDayListingEvent(new Date(2026, 8, 24), "month")).toEqual({
      date: "2026-09-24",
      sourceView: "month",
    });
  });
});
