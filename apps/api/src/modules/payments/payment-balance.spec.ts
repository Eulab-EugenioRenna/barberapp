import { paymentBalance } from "./payment-balance";
const receipt = (id: string, amount: string) => ({
  id,
  amount,
  kind: "receipt",
});
const refund = (id: string, amount: string, refundOfId: string) => ({
  id,
  amount,
  refundOfId,
  kind: "refund",
});
describe("operational payment balance", () => {
  it("zero receipts and a zero opening do not mean refunded", () => {
    expect(paymentBalance("100", "ledger", []).status).toBe("unpaid");
    expect(
      paymentBalance("100", "ledger", [
        { id: "zero", kind: "opening", amount: "0" },
      ]).status,
    ).toBe("unpaid");
  });
  it("does not infer historical cash or residual from a sale status", () => {
    expect(paymentBalance("100", "legacy_unknown", [])).toMatchObject({
      netReceived: null,
      remaining: null,
      status: null,
    });
    expect(() =>
      paymentBalance("100", "legacy_unknown", [receipt("a", "20")]),
    ).toThrow();
  });
  it("keeps deposits separate from fulfillment and settles exact decimal splits", () => {
    expect(
      paymentBalance("100.10", "ledger", [receipt("a", "20.10")]),
    ).toMatchObject({ status: "partial", remaining: "80.00" });
    expect(
      paymentBalance("100.10", "ledger", [
        receipt("a", "20.10"),
        receipt("b", "30.00"),
        receipt("c", "50.00"),
      ]),
    ).toMatchObject({ status: "paid", remaining: "0.00", receipts: "100.10" });
  });
  it("rejects overpayments and caps refunds per original, not just per account", () => {
    expect(() =>
      paymentBalance("30", "ledger", [receipt("a", "30.01")]),
    ).toThrow("fuori totale");
    expect(() =>
      paymentBalance("100", "ledger", [
        receipt("a", "10"),
        receipt("b", "50"),
        refund("r", "11", "a"),
      ]),
    ).toThrow("oltre incasso originale");
    expect(() =>
      paymentBalance("100", "ledger", [
        receipt("a", "10"),
        refund("r", "1", "unknown"),
      ]),
    ).toThrow();
  });
  it("sums all refunds including a mixed command and forbids refund-of-refund", () => {
    expect(() =>
      paymentBalance("100", "ledger", [
        receipt("a", "10"),
        refund("r1", "6", "a"),
        refund("r2", "5", "a"),
      ]),
    ).toThrow();
    expect(() =>
      paymentBalance("100", "ledger", [
        receipt("a", "10"),
        refund("r1", "6", "a"),
        refund("r2", "1", "r1"),
      ]),
    ).toThrow();
    expect(
      paymentBalance("100", "ledger", [
        receipt("a", "10"),
        refund("r1", "6", "a"),
        refund("r2", "4", "a"),
      ]),
    ).toMatchObject({
      status: "refunded",
      netReceived: "0.00",
      remaining: "100.00",
    });
  });
  it("accounts for an explicit historical opening without treating it as today's receipt", () => {
    const opening = { id: "o", kind: "opening", amount: "25.20" };
    expect(
      paymentBalance("40", "ledger", [opening, receipt("a", "14.80")]),
    ).toMatchObject({
      opening: "25.20",
      receipts: "14.80",
      netReceived: "40.00",
      status: "paid",
    });
    expect(
      paymentBalance("40", "ledger", [opening, refund("r", "5.20", "o")]),
    ).toMatchObject({ netReceived: "20.00", remaining: "20.00" });
    expect(() =>
      paymentBalance("40", "ledger", [opening, { ...opening, id: "o2" }]),
    ).toThrow();
  });
  it("rejects price reduction under received net, permits it after explicit refund", () => {
    expect(() =>
      paymentBalance("70", "ledger", [receipt("a", "100")]),
    ).toThrow();
    expect(
      paymentBalance("70", "ledger", [
        receipt("a", "100"),
        refund("r", "30", "a"),
      ]),
    ).toMatchObject({ status: "paid", netReceived: "70.00" });
  });
});
