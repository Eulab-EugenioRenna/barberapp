import {
  normalizeBarcode,
  validateBarcode,
  barcodeMatches,
} from "@barber/shared/utils";

// Cifre di controllo calcolate secondo GS1: EAN-13 (pos dispari ×1, pari ×3),
// EAN-8 e UPC-A (pos dispari ×3, pari ×1).
function ean13Check(prefix: string): number {
  const digits = prefix.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    sum += i % 2 === 0 ? digits[i] : digits[i] * 3;
  }
  return (10 - (sum % 10)) % 10;
}

function upcCheck(prefix: string): number {
  const digits = prefix.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    sum += i % 2 === 0 ? digits[i] * 3 : digits[i];
  }
  return (10 - (sum % 10)) % 10;
}

const ean13 = "400638133393" + ean13Check("400638133393"); // 13 cifre
const ean8 = "4006381" + upcCheck("4006381"); // 8 cifre
const upcA = "01234567890" + upcCheck("01234567890"); // 12 cifre

describe("normalizeBarcode", () => {
  it("trims e rimuove spazi interni", () => {
    expect(normalizeBarcode("  8 0 512345678 0  ")).toBe("805123456780");
  });
  it("restituisce vuoto per input vuoto/null", () => {
    expect(normalizeBarcode("")).toBe("");
    expect(normalizeBarcode(null)).toBe("");
    expect(normalizeBarcode(undefined)).toBe("");
  });
  it("accetta codici interni non numerici senza rifiutarli", () => {
    expect(normalizeBarcode("INT-001 ABC")).toBe("INT-001ABC");
  });
});

describe("validateBarcode", () => {
  it("accetta EAN-13 valido", () => {
    expect(validateBarcode(ean13)).toMatchObject({
      ok: true,
      normalized: ean13,
      format: "EAN-13",
    });
  });
  it("accetta EAN-8 valido", () => {
    expect(validateBarcode(ean8)).toMatchObject({
      ok: true,
      normalized: ean8,
      format: "EAN-8",
    });
  });
  it("accetta UPC-A valido", () => {
    expect(validateBarcode(upcA)).toMatchObject({
      ok: true,
      normalized: upcA,
      format: "UPC-A",
    });
  });
  it("rifiuta EAN-13 con cifra di controllo errata", () => {
    const bad = ean13.slice(0, -1) + String((Number(ean13[12]) + 1) % 10);
    expect(validateBarcode(bad)).toMatchObject({
      ok: false,
      reason: "Cifra di controllo EAN-13 non valida",
    });
  });
  it("accetta codice interno numerico senza validare EAN", () => {
    expect(validateBarcode("123456")).toMatchObject({
      ok: true,
      normalized: "123456",
      format: "internal",
    });
  });
  it("normalizza prima di validare", () => {
    expect(validateBarcode(`  ${ean13.split("").join(" ")}  `)).toMatchObject({
      ok: true,
      normalized: ean13,
      format: "EAN-13",
    });
  });
  it("rifiuta input vuoto", () => {
    expect(validateBarcode("")).toMatchObject({
      ok: false,
      normalized: "",
      reason: "Barcode mancante",
    });
  });
});

describe("barcodeMatches", () => {
  it("confronta codici normalizzati", () => {
    expect(barcodeMatches(` ${ean13} `, ean13)).toBe(true);
    expect(barcodeMatches(ean13, ean8)).toBe(false);
    expect(barcodeMatches("", "")).toBe(false);
  });
});
