import { customerWhatsAppNumber } from "./whatsapp.service";

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
});
