export interface CommandStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface PendingCommand {
  body: Record<string, unknown> & { idempotencyKey: string };
  headers: Record<string, string>;
}
export type PendingCommandState =
  | { kind: "empty" }
  | { kind: "pending"; command: PendingCommand }
  | { kind: "unreadable" };
/** Per-form recovery state only. Sending/retrying remains an explicit domain UI action. */
export function readPendingCommand(
  storage: CommandStorage,
  key: string,
): PendingCommandState {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { kind: "empty" };
    const value = JSON.parse(raw);
    if (
      !value?.body ||
      typeof value.body.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9._:-]{8,128}$/.test(value.body.idempotencyKey) ||
      !value.headers ||
      Object.entries(value.headers).some(
        ([name, value]) =>
          !["X-Alora-Location", "X-Alora-Sector"].includes(name) ||
          typeof value !== "string",
      )
    )
      return { kind: "unreadable" };
    return { kind: "pending", command: value };
  } catch {
    return { kind: "unreadable" };
  }
}
export function beginPendingCommand(
  storage: CommandStorage,
  key: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): PendingCommand {
  if (readPendingCommand(storage, key).kind !== "empty")
    throw new Error("Un invio precedente è ancora da verificare");
  if (
    Object.keys(headers).some(
      (name) => !["X-Alora-Location", "X-Alora-Sector"].includes(name),
    )
  )
    throw new Error("Intestazioni del comando non valide");
  const command = {
    body: { ...body, idempotencyKey: crypto.randomUUID() },
    headers,
  };
  // Serialize immediately: later form edits cannot alter the attempted command.
  const saved = JSON.stringify(command);
  storage.setItem(key, saved);
  return JSON.parse(saved) as PendingCommand;
}
export function clearPendingCommand(
  storage: CommandStorage,
  key: string,
  idempotencyKey: string,
): void {
  const current = readPendingCommand(storage, key);
  if (
    current.kind === "pending" &&
    current.command.body.idempotencyKey === idempotencyKey
  )
    storage.removeItem(key);
}
