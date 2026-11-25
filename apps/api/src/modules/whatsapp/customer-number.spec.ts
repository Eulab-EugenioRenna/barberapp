import { checkCustomerPhone, customerWhatsAppNumber } from "./whatsapp.service";

describe("customerWhatsAppNumber", () => {
  it("reads Italian numbers saved without prefix", () => {
    expect(customerWhatsAppNumber("333 123 4567")).toBe("+393331234567");
  });
  it("keeps international prefixes", () => {
    expect(customerWhatsAppNumber("+41 79 123 45 67")).toBe("+41791234567");
    expect(customerWhatsAppNumber("0039 333-1234567")).toBe("+393331234567");
  });
  it("rejects empty or unusable values", () => {
    expect(customerWhatsAppNumber(null)).toBeNull();
    expect(customerWhatsAppNumber("  ")).toBeNull();
    expect(customerWhatsAppNumber("chiamare in negozio")).toBeNull();
  });
  it("checks numbers saved without prefix", () => {
    expect(checkCustomerPhone("333 123 4567")).toEqual({ to: "+393331234567", issue: "prefix_added" });
    // «39» written without «+» is not doubled.
    expect(checkCustomerPhone("393331234567")).toEqual({ to: "+393331234567", issue: "prefix_added" });
    expect(checkCustomerPhone("02 1234567")).toEqual({ to: "+39021234567", issue: "landline" });
    // A foreign number without prefix is not guessed as Italian.
    expect(checkCustomerPhone("791234567")).toEqual({ to: null, issue: "invalid" });
    expect(checkCustomerPhone("12345")).toEqual({ to: null, issue: "invalid" });
    expect(checkCustomerPhone("+39 333 1234567")).toEqual({ to: "+393331234567", issue: null });
    expect(checkCustomerPhone("+12")).toEqual({ to: null, issue: "invalid" });
    expect(checkCustomerPhone("")).toEqual({ to: null, issue: null });
  });
});
