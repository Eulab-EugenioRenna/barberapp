import { buildAccountRows } from "./cash-accounts";

const now = new Date("2026-11-22T15:00:00.000Z");
const customer = { firstName: "Anna", lastName: "Rossi" };

describe("Cassa: one list, three labels", () => {
  it("merges accounts to close, open and registered, without duplicates", () => {
    const appointment = { id: "a1", startsAt: "2026-11-22T10:00:00.000Z", customer, service: { name: "Taglio" } };
    const bookedOpen = {
      id: "s1",
      soldAt: "2026-11-22T10:00:00.000Z",
      total: "25",
      customer,
      items: [{ service: { name: "Taglio" }, booking: { id: "a1" } }],
    };
    const counterOpen = { id: "s2", orderOrigin: "cashier", soldAt: "2026-11-22T14:00:00.000Z", total: "8", customer, items: [{ product: { name: "Cera" } }] };
    const laterToday = {
      id: "s3",
      soldAt: "2026-11-22T17:00:00.000Z",
      total: "30",
      customer,
      appointmentId: "a3",
      appointment: { id: "a3", startsAt: "2026-11-22T17:00:00.000Z" },
      items: [{ service: { name: "Colore" }, booking: { id: "a3" } }],
    };
    const registered = [
      { id: "s4", soldAt: "2026-11-21T09:00:00.000Z", total: "10", items: [] },
      { id: "s5", soldAt: "2026-11-22T09:00:00.000Z", total: "12", items: [] },
    ];
    const rows = buildAccountRows([appointment], [bookedOpen, counterOpen, laterToday], registered, now);
    expect(rows.map((row) => [row.key, row.kind])).toEqual([
      ["a:a1", "toClose"],
      ["s:s2", "open"],
      ["s:s3", "open"],
      ["s:s5", "registered"],
      ["s:s4", "registered"],
    ]);
    // The account to close carries its booked sale and total.
    expect(rows[0].sale?.id).toBe("s1");
    expect(rows[0].total).toBe(25);
  });

  it("marks a started booked account as to close even beyond the live queue", () => {
    const started = {
      id: "s6",
      soldAt: "2026-11-22T11:00:00.000Z",
      total: "20",
      appointment: { id: "a6" },
      items: [{ service: { name: "Barba" }, booking: { id: "a6" } }],
    };
    expect(buildAccountRows([], [started], [], now)[0].kind).toBe("toClose");
  });
});
