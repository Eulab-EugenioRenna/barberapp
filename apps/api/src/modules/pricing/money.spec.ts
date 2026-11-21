import {
  allocateDiscount,
  applyOrderDiscount,
  priceLine,
  sumPricedLines,
} from "./money";

describe("exact line pricing", () => {
  it("separates net and gross input while reconciling every cent", () => {
    const gross = priceLine({
      unitPrice: "12.00",
      quantity: 3,
      priceMode: "gross",
      vatRate: "22",
    });
    expect(gross).toMatchObject({
      lineSubtotal: "29.51",
      lineTotal: "29.51",
      taxTotal: "6.49",
      grossTotal: "36.00",
    });
    const net = priceLine({
      unitPrice: "10.00",
      quantity: 3,
      priceMode: "net",
      vatRate: "4",
    });
    expect(net).toMatchObject({
      lineTotal: "30.00",
      taxTotal: "1.20",
      grossTotal: "31.20",
    });
  });
  it("rounds half up once per line and keeps fractional physical quantities exact", () => {
    expect(
      priceLine({
        unitPrice: "0.05",
        quantity: "0.1",
        priceMode: "net",
        vatRate: 0,
      }),
    ).toMatchObject({ lineTotal: "0.01", grossTotal: "0.01" });
    expect(priceLine({ unitPrice: "1.005" })).toMatchObject({
      unitPrice: "1.01",
      lineTotal: "1.01",
    });
    expect(priceLine({ unitPrice: "0.10", quantity: 3 })).toMatchObject({
      lineTotal: "0.30",
    });
  });
  it("preserves explicit legacy tax without inferring an undocumented rate", () => {
    expect(
      priceLine({ unitPrice: "19.37", legacyTaxTotal: "1.13" }),
    ).toMatchObject({
      vatRate: null,
      lineTotal: "19.37",
      taxTotal: "1.13",
      grossTotal: "20.50",
    });
    expect(() => priceLine({ unitPrice: 10, priceMode: "gross" })).toThrow(
      "aliquota",
    );
  });
  it.each([-1, "NaN", "Infinity", "1e100", "", null])(
    "rejects invalid prices %s",
    (value) => {
      expect(() => priceLine({ unitPrice: value })).toThrow();
    },
  );
  it("rejects zero quantities, excessive rates and discounts above the row", () => {
    expect(() => priceLine({ unitPrice: 10, quantity: 0 })).toThrow("Quantità");
    expect(() =>
      priceLine({ unitPrice: 10, priceMode: "net", vatRate: 101 }),
    ).toThrow("Aliquota");
    expect(() => priceLine({ unitPrice: 10, discount: "10.01" })).toThrow(
      "sconto supera",
    );
  });
});

describe("order discount allocation", () => {
  it("distributes residual cents deterministically, without floating point", () => {
    expect(allocateDiscount(["1.00", "1.00", "1.00"], "0.01")).toEqual([
      "0.01",
      "0.00",
      "0.00",
    ]);
    expect(allocateDiscount(["0.10", "0.20"], "0.10")).toEqual([
      "0.03",
      "0.07",
    ]);
    expect(allocateDiscount(["0.00", "0.00"], 0)).toEqual(["0.00", "0.00"]);
  });
  it("reconciles net, tax, gross and discount across independent rates", () => {
    const lines = applyOrderDiscount(
      [
        priceLine({ unitPrice: 12.2, priceMode: "gross", vatRate: 22 }),
        priceLine({ unitPrice: 10.4, priceMode: "gross", vatRate: 4 }),
      ],
      "1.01",
    );
    expect(lines.map((line) => line.grossTotal)).toEqual(["11.65", "9.94"]);
    expect(sumPricedLines(lines)).toEqual({
      subtotal: "20.00",
      discountTotal: "0.89",
      taxTotal: "2.48",
      total: "21.59",
    });
  });
  it("does not derive a tax rate from legacy tax or discount more than the account", () => {
    expect(() =>
      applyOrderDiscount([priceLine({ unitPrice: 10, legacyTaxTotal: 2 })], 1),
    ).toThrow("IVA storica");
    expect(() => allocateDiscount(["0.10"], "0.11")).toThrow("supera il conto");
  });
});
