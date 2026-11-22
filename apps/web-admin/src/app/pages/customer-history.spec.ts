import { buildHistoryRows, filterHistoryRows, summarizeHistory } from "./customer-history";

const now = new Date("2026-11-22T12:00:00Z");
const history = {
  salesTotal: 80,
  appointments: [
    {
      id: "a1",
      startsAt: "2026-11-01T09:00:00Z",
      status: "completed",
      orderItemId: "i1",
      service: { name: "Taglio" },
      collaborator: { firstName: "Anna", lastName: "Neri" },
    },
    {
      id: "a2",
      startsAt: "2026-12-01T09:00:00Z",
      status: "confirmed",
      service: { name: "Colore" },
      collaborator: { firstName: "Luca", lastName: "" },
    },
    { id: "a3", startsAt: "2025-01-10T09:00:00Z", status: "no_show", service: { name: "Piega" } },
  ],
  sales: [
    {
      id: "s1",
      soldAt: "2026-11-01T10:00:00Z",
      total: 80,
      paymentStatus: "paid",
      paymentMethod: "card",
      items: [
        { id: "i1", quantity: 1, lineTotal: 50, service: { name: "Taglio" } },
        { id: "i2", quantity: 2, lineTotal: 30, product: { name: "Shampoo" } },
      ],
    },
  ],
};

describe("customer history", () => {
  it("lists appointments and accounts newest first and marks settled visits", () => {
    const rows = buildHistoryRows(history, now);
    expect(rows.map((row) => row.id)).toEqual(["a:a2", "s:s1", "a:a1", "a:a3"]);
    expect(rows.find((row) => row.id === "a:a1")?.settled).toBe(true);
    expect(rows.find((row) => row.id === "a:a2")?.future).toBe(true);
    expect(rows.find((row) => row.id === "s:s1")?.title).toBe("Taglio · Shampoo");
  });

  it("filters by kind, period and text, keeping upcoming appointments in every period", () => {
    const rows = buildHistoryRows(history, now);
    const ids = (kind: any, period: any, query = "") =>
      filterHistoryRows(rows, { kind, period, query }, now).map((row) => row.id);
    expect(ids("sale", "all")).toEqual(["s:s1"]);
    expect(ids("all", "30d")).toEqual(["a:a2", "s:s1", "a:a1"]);
    expect(ids("all", "all", "shampoo")).toEqual(["s:s1"]);
    expect(ids("appointment", "all", "anna taglio")).toEqual(["a:a1"]);
  });

  it("summarizes spending, visits and the next appointment", () => {
    expect(summarizeHistory(history, now)).toEqual({
      spent: 80,
      visits: 1,
      lastVisit: "2026-11-01T09:00:00Z",
      nextAppointment: "2026-12-01T09:00:00Z",
      noShows: 1,
    });
  });
});
