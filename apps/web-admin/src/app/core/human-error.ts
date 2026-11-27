/**
 * One wording for every failure shown to the user.
 *
 * - no connection / timeout (status 0) → «Connessione assente o lenta: riprova»
 * - 5xx → «Errore del server, riprova tra poco»
 * - 400 with class-validator output (English, often an array) → «Dati non validi: <campo>»
 * - a readable server message (Italian, written for the user) is kept
 * - Angular's "Http failure response for …" and JS runtime errors never reach the screen
 */
export const OFFLINE_MESSAGE = "Connessione assente o lenta: riprova";
export const SERVER_MESSAGE = "Errore del server, riprova tra poco";
export const INVALID_MESSAGE = "Dati non validi";

/** Field names that appear in validation messages, in the words of the screens. */
const FIELD_LABELS: Record<string, string> = {
  email: "email",
  phone: "telefono",
  firstName: "nome",
  lastName: "cognome",
  name: "nome",
  password: "password",
  price: "prezzo",
  basePrice: "prezzo",
  cost: "costo",
  vatRate: "aliquota IVA",
  durationMinutes: "durata",
  startsAt: "orario",
  date: "data",
  notes: "note",
  barcode: "codice a barre",
  quantity: "quantità",
  amount: "importo",
  customerId: "cliente",
  serviceId: "servizio",
  collaboratorId: "collaboratore",
  productId: "prodotto",
  locationId: "sede",
  sectorId: "settore",
  publicDomain: "dominio",
  slug: "indirizzo",
  text: "testo",
  to: "destinatario",
};

// class-validator / Nest built-ins: "phone must be a string", "property x should not exist", …
const ENGLISH_VALIDATION =
  /^(property\s+)?([\w.[\]]+)\s+(must|should|is not|has failed|has wrong)\b|^(each value in|Validation failed|Unexpected token|Bad Request)/i;

export function humanError(error: unknown, fallback: string): string {
  const err = error as any;
  if (err === null || err === undefined) return fallback;
  if (typeof err === "string") return readable(err) ?? fallback;

  const status = typeof err.status === "number" ? err.status : undefined;
  if (status === 0) return OFFLINE_MESSAGE;
  if (status !== undefined && status >= 500) return SERVER_MESSAGE;

  const body = err.error;
  const raw = body && typeof body === "object" ? body.message : body;

  if (Array.isArray(raw)) return invalid(raw);
  if (typeof raw === "string") {
    if (status === 400 && ENGLISH_VALIDATION.test(raw)) return invalid([raw]);
    const text = readable(raw);
    if (text) return text;
  }

  if (status === 401) return "Sessione scaduta: accedi di nuovo";
  if (status === 403) return "Operazione non consentita per il tuo profilo";
  if (status === 429) return "Troppe richieste: attendi qualche secondo e riprova";
  if (status !== undefined) return fallback;

  // A plain Error raised on purpose by the app (already in Italian) is kept;
  // runtime failures (TypeError, …) are not something the user can act on.
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return OFFLINE_MESSAGE;
    if (err.name !== "Error") return fallback;
    return readable(err.message) ?? fallback;
  }
  if (typeof err.message === "string") return readable(err.message) ?? fallback;
  return fallback;
}

/** Only short, human-written text: no HTML pages, no Angular/HTTP internals. */
function readable(text: string): string | null {
  const value = text.trim();
  if (!value || value.length > 300) return null;
  if (/^Http failure|^<|^Internal server error$|^Unknown Error$|^Cannot |is not a function|undefined|^\[object /i.test(value))
    return null;
  if (ENGLISH_VALIDATION.test(value)) return INVALID_MESSAGE;
  return value;
}

function invalid(messages: unknown[]): string {
  const first = messages.find((item): item is string => typeof item === "string") ?? "";
  // An Italian message from a DTO is already specific: keep it.
  if (first && !ENGLISH_VALIDATION.test(first) && readable(first)) return first;
  const field = ENGLISH_VALIDATION.exec(first)?.[2]?.split(".").pop()?.replace(/\[\d+\]/g, "");
  if (!field) return INVALID_MESSAGE;
  return `${INVALID_MESSAGE}: controlla il campo «${FIELD_LABELS[field] ?? field}»`;
}
