import { buildMetrics } from "./financial-report.service";

const base = {
  sold: { gross: "120.00", linesGross: "120.00", unattributedGross: "0.00", accounts: 3 },
  cash: { receipts: "100.00", refunds: "10.00", net: "90.00" },
  accounts: { total: "120.00", opening: "0.00", receipts: "100.00", refunds: "10.00", netReceived: "90.00", remaining: "30.00", knownCount: 3, unknownCount: 0, unknownTotal: "0.00" },
  counts: { serviceLines: 4, productLines: 2, customers: 2 },
  appointments: { total: 5, completed: 3, cancelled: 1, noShow: 0 },
  byService: [{ id: "s1", label: "Taglio", revenue: "80.00", quantity: 3 }],
  byProduct: [{ id: "p1", label: "Cera", revenue: "40.00", quantity: 2 }],
  byBrand: [{ id: null as unknown as string, label: "Senza brand", revenue: "40.00", quantity: 2 }],
};

describe("buildMetrics", () => {
  it("shows sold, cash, open balance, average and appointments for everything", () => {
    const cards = buildMetrics("all", "EUR", base);
    expect(cards.map((c) => c.label)).toEqual(["Venduto", "Incassato", "Da incassare", "Spesa media per conto", "Appuntamenti"]);
    expect(cards[0].trend).toBe("3 conti · 4 servizi · 2 prodotti");
    expect(cards[1]).toMatchObject({ value: "EUR 90.00", trend: "Incassi EUR 100.00 · rimborsi EUR 10.00" });
    expect(cards[3]).toMatchObject({ value: "EUR 40.00", trend: "3 conti · 2 clienti" });
    expect(cards[4]).toMatchObject({ value: "5", trend: "3 completati · 1 annullati · 0 non presentati" });
  });

  it("services: no cash cards, best service", () => {
    const cards = buildMetrics("services", "EUR", { ...base, cash: null, accounts: null });
    expect(cards.map((c) => c.label)).toEqual(["Venduto in servizi", "Spesa media per conto", "Appuntamenti", "Servizio più venduto"]);
    expect(cards[3]).toMatchObject({ value: "Taglio", trend: "3 volte · EUR 80.00" });
  });

  it("products: brand card only when products have a brand", () => {
    expect(buildMetrics("products", "EUR", base).map((c) => c.label)).toEqual(["Venduto in prodotti", "Prezzo medio per pezzo", "Prodotto più venduto"]);
    const branded = buildMetrics("products", "EUR", { ...base, byBrand: [{ id: "b1", label: "Davines", revenue: "40.00", quantity: 2 }] });
    expect(branded[3]).toMatchObject({ label: "Brand più venduto", value: "Davines", trend: "2 pezzi · EUR 40.00" });
  });
});
