import { buildCustomerTimeline } from "./customers.controller";

describe("buildCustomerTimeline", () => {
  it("groups appointments and sales that happen on the same day", () => {
    const timeline = buildCustomerTimeline(
      [
        {
          id: "appt-1",
          startsAt: "2026-03-10T09:00:00.000Z",
        },
      ],
      [
        {
          id: "sale-1",
          soldAt: "2026-03-10T09:30:00.000Z",
          total: "40.00",
          paymentStatus: "paid",
        },
      ],
    );

    expect(timeline).toHaveLength(1);
    expect(timeline[0].date).toBe("2026-03-10");
    expect(timeline[0].appointments).toHaveLength(1);
    expect(timeline[0].sales).toHaveLength(1);
    expect(timeline[0].salesTotal).toBe(40);
  });

  it("sorts days descending and sums only paid/partial sales", () => {
    const timeline = buildCustomerTimeline(
      [],
      [
        {
          id: "sale-old",
          soldAt: "2026-01-01T10:00:00.000Z",
          total: "10.00",
          paymentStatus: "unpaid",
        },
        {
          id: "sale-new",
          soldAt: "2026-02-01T10:00:00.000Z",
          total: "25.00",
          paymentStatus: "partial",
        },
      ],
    );

    expect(timeline.map((entry) => entry.date)).toEqual([
      "2026-02-01",
      "2026-01-01",
    ]);
    expect(timeline[0].salesTotal).toBe(25);
    expect(timeline[1].salesTotal).toBe(0);
  });
});