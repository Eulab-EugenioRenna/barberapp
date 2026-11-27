import { agendaWindow, windowCovers } from "./agenda-window";

const local = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

describe("agenda loading window", () => {
  it("loads the visible Monday-based week plus a week on each side", () => {
    // Thursday 26 November 2026.
    const range = agendaWindow("week", new Date(2026, 10, 26, 15, 30));
    expect(local(range.from)).toBe("2026-11-16");
    expect(local(range.to)).toBe("2026-12-07");
  });
  it("covers the whole month grid and a filtered day outside it", () => {
    const month = agendaWindow("month", new Date(2026, 1, 10));
    expect(local(month.from)).toBe("2026-01-25");
    expect(local(month.to)).toBe("2026-03-08");
    const filtered = agendaWindow("day", new Date(2026, 1, 10), "2026-04-02");
    expect(local(filtered.from)).toBe("2026-02-03");
    expect(local(filtered.to)).toBe("2026-04-10");
  });
  it("reloads only when the calendar leaves the loaded range", () => {
    const loaded = agendaWindow("week", new Date(2026, 10, 26));
    const range = { from: loaded.from.getTime(), to: loaded.to.getTime() };
    expect(windowCovers(range, agendaWindow("day", new Date(2026, 10, 27)))).toBe(
      true,
    );
    expect(windowCovers(range, agendaWindow("week", new Date(2026, 11, 3)))).toBe(
      false,
    );
    expect(windowCovers(null, loaded)).toBe(false);
  });
});
