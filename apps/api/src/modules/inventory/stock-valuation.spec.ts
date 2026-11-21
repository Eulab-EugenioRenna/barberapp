import { quoteReceipt, valueStockChange } from "./stock-valuation";

const empty = { initialized: false, quantity: "0.000", value: "0.000000" };
describe("stock valuation and purchase tax", () => {
  it("requires an explicit opening instead of treating unknown historical stock as zero", () => {
    expect(() =>
      valueStockChange(empty, {
        direction: "in",
        quantity: 1,
        incomingValue: 10,
      }),
    ).toThrow("giacenza iniziale");
    expect(
      valueStockChange(empty, {
        direction: "in",
        quantity: 0,
        incomingValue: 0,
        opening: true,
      }),
    ).toMatchObject({
      initialized: true,
      quantity: "0.000",
      value: "0.000000",
    });
  });
  it("keeps purchase VAT independent of a later sale rate", () => {
    expect(
      quoteReceipt({
        quantity: 10,
        unitCost: "12.20",
        costMode: "gross",
        purchaseVatRate: 22,
      }),
    ).toMatchObject({
      netValue: "100.000000",
      purchaseTax: "22.00",
      grossValue: "122.00",
      unitNetCost: "10.000000",
    });
    expect(
      quoteReceipt({
        quantity: 10,
        unitCost: "10.00",
        costMode: "net",
        purchaseVatRate: 4,
      }),
    ).toMatchObject({
      netValue: "100.000000",
      purchaseTax: "4.00",
      grossValue: "104.00",
    });
  });
  it("supports precise fractional units and unit costs with line monetary rounding", () => {
    expect(
      quoteReceipt({
        quantity: "0.125",
        unitCost: "0.123456",
        costMode: "net",
        purchaseVatRate: 0,
      }),
    ).toMatchObject({
      quantity: "0.125",
      netValue: "0.020000",
      unitNetCost: "0.160000",
    });
  });
  it("uses the moving weighted average and freezes the cost of each issue", () => {
    const opening = valueStockChange(empty, {
      direction: "in",
      quantity: 10,
      incomingValue: 100,
      opening: true,
    });
    const receipt = valueStockChange(opening, {
      direction: "in",
      quantity: 10,
      incomingValue: 200,
    });
    expect(receipt).toMatchObject({
      quantity: "20.000",
      value: "300.000000",
      averageCost: "15.000000",
    });
    const sale = valueStockChange(receipt, { direction: "out", quantity: 3 });
    expect(sale).toMatchObject({
      quantity: "17.000",
      value: "255.000000",
      valueDelta: "-45.000000",
    });
    const returned = valueStockChange(sale, {
      direction: "in",
      quantity: 1,
      incomingValue: 15,
    });
    expect(returned).toMatchObject({
      quantity: "18.000",
      value: "270.000000",
      averageCost: "15.000000",
    });
  });
  it("clears every valuation remainder on the final issue", () => {
    const opening = valueStockChange(empty, {
      direction: "in",
      quantity: 3,
      incomingValue: 1,
      opening: true,
    });
    const first = valueStockChange(opening, { direction: "out", quantity: 1 });
    expect(first.valueDelta).toBe("-0.333333");
    const last = valueStockChange(first, { direction: "out", quantity: 2 });
    expect(last).toMatchObject({
      quantity: "0.000",
      value: "0.000000",
      valueDelta: "-0.666667",
    });
  });
  it("transfers the exact source value and updates the destination weighted cost", () => {
    const source = valueStockChange(
      { initialized: true, quantity: "3", value: "1" },
      { direction: "out", quantity: 1 },
    );
    const target = valueStockChange(
      { initialized: true, quantity: "1", value: "2" },
      {
        direction: "in",
        quantity: 1,
        incomingValue: source.valueDelta.slice(1),
      },
    );
    expect(source.value).toBe("0.666667");
    expect(target).toMatchObject({
      quantity: "2.000",
      value: "2.333333",
      averageCost: "1.166667",
    });
  });
  it("rejects negative stock, repeated opening, invalid rates and zero movement quantities", () => {
    const stock = { initialized: true, quantity: "1", value: "10" };
    expect(() =>
      valueStockChange(stock, { direction: "out", quantity: "1.001" }),
    ).toThrow("insufficiente");
    expect(() =>
      valueStockChange(stock, {
        direction: "in",
        quantity: 1,
        incomingValue: 10,
        opening: true,
      }),
    ).toThrow("già registrata");
    expect(() =>
      valueStockChange(stock, { direction: "out", quantity: 0 }),
    ).toThrow("non valida");
    expect(() =>
      quoteReceipt({
        quantity: 1,
        unitCost: 1,
        costMode: "net",
        purchaseVatRate: 101,
      }),
    ).toThrow("Aliquota");
  });
});
