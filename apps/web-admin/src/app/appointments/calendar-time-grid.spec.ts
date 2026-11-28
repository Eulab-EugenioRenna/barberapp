import {
  bookingInterval,
  closedSegments,
  clockToMinutes,
  fitPxPerMinute,
  hourMarks,
  layoutLanes,
  localDateTime,
  magnetEdges,
  minutesToClock,
  minutesToPx,
  pxToMinutes,
  snapStart,
  timeRange,
  timeRangeLabel,
  visibleDays,
} from "./calendar-time-grid";

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

describe("calendar time grid", () => {
  describe("clock helpers", () => {
    it("parses and formats HH:MM", () => {
      expect(clockToMinutes("09:30")).toBe(570);
      expect(clockToMinutes("19:00:00")).toBe(1140);
      expect(clockToMinutes("")).toBeNull();
      expect(clockToMinutes("nope")).toBeNull();
      expect(minutesToClock(570)).toBe("09:30");
      expect(minutesToClock(1440)).toBe("24:00");
      expect(timeRangeLabel({ start: 630, end: 660 })).toBe("10:30–11:00");
    });

    it("reads a booking as wall-clock minutes of its day", () => {
      // Jest runs in Europe/Rome.
      expect(
        bookingInterval("2026-11-24T09:15:00.000Z", "2026-11-24T10:00:00.000Z"),
      ).toEqual({ start: h(10, 15), end: h(11) });
      // Never shorter than 5 minutes, never past midnight.
      expect(
        bookingInterval("2026-11-24T09:15:00.000Z", "2026-11-24T09:15:00.000Z"),
      ).toEqual({ start: h(10, 15), end: h(10, 20) });
      expect(
        bookingInterval("2026-11-24T22:00:00.000Z", "2026-11-25T01:00:00.000Z"),
      ).toEqual({ start: h(23), end: h(24) });
    });

    it("writes the civil date-time the facade parses", () => {
      expect(localDateTime(new Date(2026, 10, 26), h(10, 35))).toBe(
        "2026-11-26T10:35",
      );
    });
  });

  describe("visible days", () => {
    const days = [
      { key: "mon", closed: true, count: 1 },
      { key: "tue", closed: false, count: 0 },
      { key: "sun", closed: true, count: 0 },
    ];
    it("hides closed days unless a booking was forced on them", () => {
      expect(
        visibleDays(days, (day) => day.closed, (day) => day.count).map(
          (day) => day.key,
        ),
      ).toEqual(["mon", "tue"]);
    });
  });

  describe("time range", () => {
    it("spans from the earliest opening to the latest closing", () => {
      expect(
        timeRange(
          [
            { start: h(9), end: h(19) },
            { start: h(10), end: h(13) },
          ],
          [{ start: h(9, 30), end: h(10) }],
        ),
      ).toEqual({ start: h(9), end: h(19) });
    });

    it("stretches only to show bookings outside the hours, to the hour", () => {
      expect(
        timeRange(
          [{ start: h(9), end: h(19) }],
          [
            { start: h(18, 30), end: h(19, 45) },
            { start: h(8, 40), end: h(9, 10) },
          ],
        ),
      ).toEqual({ start: h(8), end: h(20) });
    });

    it("rounds a half-hour window outwards", () => {
      expect(timeRange([{ start: h(8, 30), end: h(12, 30) }], [])).toEqual({
        start: h(8),
        end: h(13),
      });
    });

    it("falls back to 09-19 when no window is known", () => {
      expect(timeRange([], [])).toEqual({ start: h(9), end: h(19) });
      expect(timeRange([], [{ start: h(7, 10), end: h(7, 40) }])).toEqual({
        start: h(7),
        end: h(19),
      });
    });

    it("keeps at least an hour and stays inside the day", () => {
      expect(timeRange([{ start: h(23, 30), end: h(24) }], [])).toEqual({
        start: h(23),
        end: h(24),
      });
    });
  });

  describe("lane layout", () => {
    it("keeps lone bookings full width", () => {
      const layout = layoutLanes([
        { id: "a", start: h(9), end: h(9, 30) },
        { id: "b", start: h(9, 30), end: h(10) },
      ]);
      expect(layout.get("a")).toEqual({ lane: 0, lanes: 1, span: 1 });
      expect(layout.get("b")).toEqual({ lane: 0, lanes: 1, span: 1 });
    });

    it("puts overlapping bookings side by side", () => {
      const layout = layoutLanes([
        { id: "a", start: h(9), end: h(10) },
        { id: "b", start: h(9, 15), end: h(9, 45) },
        { id: "c", start: h(9, 30), end: h(10, 30) },
      ]);
      expect(layout.get("a")).toEqual({ lane: 0, lanes: 3, span: 1 });
      expect(layout.get("b")).toEqual({ lane: 1, lanes: 3, span: 1 });
      expect(layout.get("c")).toEqual({ lane: 2, lanes: 3, span: 1 });
    });

    it("reuses freed lanes and widens over free lanes", () => {
      const layout = layoutLanes([
        { id: "a", start: h(9), end: h(11) },
        { id: "b", start: h(9), end: h(9, 30) },
        { id: "c", start: h(9), end: h(9, 30) },
        { id: "d", start: h(9, 30), end: h(10) },
      ]);
      expect(layout.get("a")).toEqual({ lane: 0, lanes: 3, span: 1 });
      expect(layout.get("d")).toEqual({ lane: 1, lanes: 3, span: 2 });
    });

    it("starts a new cluster after a gap", () => {
      const layout = layoutLanes([
        { id: "a", start: h(9), end: h(10) },
        { id: "b", start: h(9), end: h(10) },
        { id: "c", start: h(11), end: h(12) },
      ]);
      expect(layout.get("c")).toEqual({ lane: 0, lanes: 1, span: 1 });
    });
  });

  describe("snapping", () => {
    const base = { min: h(9), max: h(19) };

    it("snaps to the 5-minute grid", () => {
      expect(snapStart(h(10, 32), 30, base)).toEqual({
        start: h(10, 30),
        magnet: null,
      });
      expect(snapStart(h(10, 33), 30, base).start).toBe(h(10, 35));
    });

    it("sticks the start to a nearby edge", () => {
      expect(snapStart(h(10, 37), 30, { ...base, magnets: [h(10, 45)] })).toEqual(
        { start: h(10, 45), magnet: h(10, 45) },
      );
    });

    it("sticks the end to a nearby edge", () => {
      // 30 minutes starting 11:24 end 11:54: the next booking starts at 12:00.
      expect(snapStart(h(11, 24), 30, { ...base, magnets: [h(12)] })).toEqual({
        start: h(11, 30),
        magnet: h(12),
      });
    });

    it("prefers the closest magnet and ignores far ones", () => {
      expect(
        snapStart(h(10, 2), 30, { ...base, magnets: [h(9, 55), h(10, 40)] }),
      ).toEqual({ start: h(9, 55), magnet: h(9, 55) });
      expect(
        snapStart(h(10, 21), 30, { ...base, magnets: [h(10, 30), h(11, 5)] }),
      ).toEqual({ start: h(10, 20), magnet: null });
    });

    it("stays inside the visible range", () => {
      expect(snapStart(h(8, 10), 30, base).start).toBe(h(9));
      expect(snapStart(h(18, 50), 30, base).start).toBe(h(18, 30));
    });

    it("collects magnet edges without the dragged booking", () => {
      expect(
        magnetEdges(
          [
            { id: "a", start: h(9), end: h(9, 30) },
            { id: "b", start: h(10), end: h(10, 45) },
          ],
          "a",
          { start: h(9), end: h(19) },
        ).sort((left, right) => left - right),
      ).toEqual([h(9), h(10), h(10, 45), h(19)]);
    });
  });

  describe("pixels", () => {
    it("converts minutes and pixels both ways", () => {
      expect(minutesToPx(h(10, 30), h(9), 1.2)).toBeCloseTo(108);
      expect(pxToMinutes(108, h(9), 1.2)).toBeCloseTo(h(10, 30));
    });

    it("fits the range in the space within readable bounds", () => {
      expect(fitPxPerMinute(900, 600)).toBe(1.5);
      expect(fitPxPerMinute(300, 600)).toBe(1);
      expect(fitPxPerMinute(3000, 600)).toBe(2);
      expect(fitPxPerMinute(0, 600)).toBe(1);
    });

    it("lists hour marks and closed segments", () => {
      expect(hourMarks({ start: h(9), end: h(12) })).toEqual([
        h(9),
        h(10),
        h(11),
        h(12),
      ]);
      const range = { start: h(9), end: h(19) };
      expect(closedSegments(range, { start: h(9), end: h(13) })).toEqual([
        { start: h(13), end: h(19) },
      ]);
      expect(closedSegments(range, null)).toEqual([range]);
      expect(closedSegments(range, range)).toEqual([]);
    });
  });
});
