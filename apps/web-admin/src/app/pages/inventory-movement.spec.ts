import { movementReason } from "./inventory-movement";

describe("movementReason", () => {
  it("keeps a real note", () => {
    expect(movementReason("  Fattura 12  ", "receipt")).toBe("Fattura 12");
  });
  it("uses the movement type when the note is empty", () => {
    expect(movementReason("", "issue")).toBe("Scarico");
    expect(movementReason("   ", "adjust")).toBe("Rettifica");
  });
  it("completes a note shorter than the server minimum", () => {
    expect(movementReason("ok", "receipt")).toBe("Carico · ok");
  });
  it("falls back for unknown types", () => {
    expect(movementReason("", "other")).toBe("Movimento");
  });
});
