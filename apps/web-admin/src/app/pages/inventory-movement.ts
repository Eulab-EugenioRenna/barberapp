/** Default reason per movement type: the reason field is optional. */
export const KIND_REASON: Record<string, string> = {
  opening: "Inventario iniziale",
  receipt: "Carico",
  issue: "Scarico",
  adjust: "Rettifica",
  transfer: "Trasferimento",
  return: "Reso",
};

/** The server wants at least 3 characters: an empty or short note gets the type. */
export function movementReason(reason: string, kind: string): string {
  const note = (reason || "").trim();
  if (note.length >= 3) return note;
  const label = KIND_REASON[kind] || "Movimento";
  return note ? `${label} · ${note}` : label;
}
