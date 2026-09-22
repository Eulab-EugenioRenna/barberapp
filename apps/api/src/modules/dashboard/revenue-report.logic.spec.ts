import { calculateRevenueKpis, getRevenueRange } from "./revenue-report.logic";

describe("getRevenueRange", () => {
  it("calcola la settimana da lunedi a domenica", () => {
    const range = getRevenueRange("week", "2026-09-22");
    expect(range.start?.toISOString()).toBe("2026-09-20T22:00:00.000Z");
    expect(range.end?.toISOString()).toBe("2026-09-27T21:59:59.999Z");
  });

  it("non applica limiti temporali al filtro tutto", () => {
    expect(getRevenueRange("all", "2026-09-22")).toEqual({ label: "Tutto" });
  });

  it("rispetta il cambio di ora legale del tenant", () => {
    const range = getRevenueRange("day", "2026-03-29", "Europe/Rome");
    expect(range.start?.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(range.end?.toISOString()).toBe("2026-03-29T21:59:59.999Z");
  });

  it("calcola il ticket medio sugli eventi che generano ricavo", () => {
    const result = calculateRevenueKpis({
      salesValues: [40, 20],
      appointmentValues: [30],
      productRevenue: 20,
      appointmentCount: 12,
    });

    expect(result.totalRevenue).toBe(90);
    expect(result.averageTicket).toBe(30);
    expect(result.revenueEvents).toBe(3);
    expect(result.productRevenue).toBe(20);
  });
});
