// Utilità barcode condivise: normalizzazione e validazione EAN-8/13/UPC-A.
// Nessuna dipendenza da framework; usabile da API e UI (es. tastiera-wedge).

export interface BarcodeValidation {
  ok: boolean;
  normalized: string;
  format?: "EAN-8" | "EAN-13" | "UPC-A" | "internal";
  reason?: string;
}

// Caratteri ammessi nel codice a barre: solo cifre e spazi tra i segmenti.
const ALLOWED = /^[0-9 ]+$/;

// EAN-13 e UPC-A/EAN-8 usano pesi opposti sulle posizioni (da sinistra).
function ean13Check(digits: number[]): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    // posizione i+1: dispari ×1, pari ×3
    sum += (i % 2 === 0 ? digits[i] : digits[i] * 3);
  }
  return (10 - (sum % 10)) % 10;
}

function upcAOrEan8Check(digits: number[]): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    // posizione i+1: dispari ×3, pari ×1
    sum += (i % 2 === 0 ? digits[i] * 3 : digits[i]);
  }
  return (10 - (sum % 10)) % 10;
}

function isValidEan13(value: string): boolean {
  if (value.length !== 13 || !/^\d{13}$/.test(value)) return false;
  const digits = value.split("").map(Number);
  return digits[12] === ean13Check(digits.slice(0, 12));
}

function isValidEan8(value: string): boolean {
  if (value.length !== 8 || !/^\d{8}$/.test(value)) return false;
  const digits = value.split("").map(Number);
  return digits[7] === upcAOrEan8Check(digits.slice(0, 7));
}

function isValidUpcA(value: string): boolean {
  if (value.length !== 12 || !/^\d{12}$/.test(value)) return false;
  const digits = value.split("").map(Number);
  return digits[11] === upcAOrEan8Check(digits.slice(0, 11));
}

/**
 * Normalizza un barcode letto da tastiera-wedge o digitato a mano:
 * - trim
 * - rimuove spazi
 * - accetta solo cifre (altrimenti codice interno non rifiutato, ma non validato come EAN/UPC)
 * Restituisce il valore normalizzato (vuoto se input vuoto/null).
 */
export function normalizeBarcode(value: unknown): string {
  if (value === undefined || value === null) return "";
  const cleaned = String(value).trim().replace(/\s+/g, "");
  if (!ALLOWED.test(cleaned)) return cleaned; // codice interno: mai rifiutato
  return cleaned;
}

/**
 * Valida un barcode normalizzato. Codici interni (non EAN/UPC) passano con
 * format "internal"; codici EAN-8/13/UPC-A passano con il formato riconosciuto.
 */
export function validateBarcode(value: string): BarcodeValidation {
  if (!value) return { ok: false, normalized: "", reason: "Barcode mancante" };
  const normalized = normalizeBarcode(value);
  if (!normalized) return { ok: false, normalized: "", reason: "Barcode mancante" };

  if (!ALLOWED.test(normalized)) {
    // Codice interno non numerico: accettato senza validazione EAN/UPC.
    return { ok: true, normalized, format: "internal" };
  }

  if (normalized.length === 13 && isValidEan13(normalized)) {
    return { ok: true, normalized, format: "EAN-13" };
  }
  if (normalized.length === 13) {
    return { ok: false, normalized, reason: "Cifra di controllo EAN-13 non valida" };
  }
  if (normalized.length === 8 && isValidEan8(normalized)) {
    return { ok: true, normalized, format: "EAN-8" };
  }
  if (normalized.length === 8) {
    return { ok: false, normalized, reason: "Cifra di controllo EAN-8 non valida" };
  }
  if (normalized.length === 12 && isValidUpcA(normalized)) {
    return { ok: true, normalized, format: "UPC-A" };
  }
  if (normalized.length === 12) {
    return { ok: false, normalized, reason: "Cifra di controllo UPC-A non valida" };
  }

  // Lunghezze diverse da EAN/UPC: codice interno, accettato ma non validato.
  if (/^\d+$/.test(normalized)) {
    return { ok: true, normalized, format: "internal" };
  }

  return { ok: false, normalized, reason: "Formato barcode non valido" };
}

export function barcodeMatches(left: unknown, right: unknown): boolean {
  return (
    normalizeBarcode(left) === normalizeBarcode(right) &&
    normalizeBarcode(left) !== ""
  );
}
