import { wholeQuantity } from "./quick-order-quantity";

describe("wholeQuantity", () => {
  it("keeps whole quantities", () => {
    expect(wholeQuantity(3)).toBe(3);
    expect(wholeQuantity("2")).toBe(2);
  });
  it("turns empty, zero, negative or invalid input into 1", () => {
    for (const value of ["", null, undefined, 0, -2, "abc"]) expect(wholeQuantity(value)).toBe(1);
  });
  it("drops decimals the server would reject", () => {
    expect(wholeQuantity("2.7")).toBe(2);
    expect(wholeQuantity(1.5)).toBe(1);
  });
});
