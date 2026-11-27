/**
 * The agenda editor in plain functions: one booking, one or more services in
 * sequence, a status and notes. The server decides; these only shape requests
 * and the inline warnings.
 */
import { localBookingTime, parseLocalBookingTime } from "./booking-local-time";

export const DEFAULT_CANCEL_REASON = "Annullato dall'agenda";
export const REMOVED_LINE_REASON = "Servizio tolto dalla prenotazione";
export const BUSY_WARNING =
  "Il professionista ha già un appuntamento in quell'orario";
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Statuses that end a service: no longer on the calendar as «to do». */
export const STOPPED_STATUSES = ["cancelled", "no_show", "completed"];

export type EditorRow = {
  /** Local key for the template; existing rows use their id. */
  key: string;
  appointmentId?: string;
  orderItemId?: string;
  serviceId: string;
  collaboratorId: string;
  /** YYYY-MM-DD, browser local. */
  date: string;
  /** HH:MM, browser local. */
  time: string;
  /** Starts when the previous service ends (moves with it). */
  follow: boolean;
  /** Current status of an existing row; "" for a new one. */
  status: string;
  /** What the server holds, to send only real changes. */
  held?: {
    serviceId: string;
    collaboratorId: string;
    startsAt: string;
    local: string;
    durationMinutes: number;
  };
};

export type BusyRow = {
  id?: string;
  collaboratorId?: string | null;
  startsAt: string;
  endsAt: string;
  status?: string;
};

export function splitLocal(value: string | Date): { date: string; time: string } {
  const local = localBookingTime(value);
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

export function addMinutes(
  date: string,
  time: string,
  minutes: number,
): { date: string; time: string } {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return splitLocal(new Date(y, m - 1, d, h, min + minutes));
}

/** Instant of the row; an untouched row keeps the stored one (clock folds). */
export function rowInstant(row: EditorRow): string | null {
  if (!row.date || !TIME_PATTERN.test(row.time)) return null;
  const local = `${row.date}T${row.time}`;
  if (row.held && row.held.local.slice(0, 16) === local) return row.held.startsAt;
  return parseLocalBookingTime(local)?.toISOString() ?? null;
}

export function rowDuration(
  row: EditorRow,
  catalogMinutes: (serviceId: string) => number | undefined,
): number {
  if (row.held && row.held.serviceId === row.serviceId)
    return row.held.durationMinutes;
  return catalogMinutes(row.serviceId) || 30;
}

/** Services marked «in sequenza» start when the previous one ends. */
export function applySequence(
  rows: EditorRow[],
  catalogMinutes: (serviceId: string) => number | undefined,
): EditorRow[] {
  const out: EditorRow[] = [];
  for (const [index, row] of rows.entries()) {
    const previous = out[index - 1];
    if (index > 0 && row.follow && previous && TIME_PATTERN.test(previous.time)) {
      const next = addMinutes(
        previous.date,
        previous.time,
        rowDuration(previous, catalogMinutes),
      );
      out.push({ ...row, ...next });
    } else out.push({ ...row });
  }
  return out;
}

/** An existing row that starts right where the previous one ends follows it. */
export function followsPrevious(previous: BusyRow | undefined, row: BusyRow): boolean {
  return !!previous && Date.parse(previous.endsAt) === Date.parse(row.startsAt);
}

export function lineChanged(row: EditorRow): boolean {
  if (!row.appointmentId || !row.held) return true;
  return (
    row.serviceId !== row.held.serviceId ||
    (row.collaboratorId || "") !== (row.held.collaboratorId || "") ||
    rowInstant(row) !== row.held.startsAt
  );
}

/** Same professional, overlapping time: the server will refuse it. */
export function overlapsBusy(
  row: EditorRow,
  minutes: number,
  busy: BusyRow[],
): boolean {
  const start = rowInstant(row);
  if (!row.collaboratorId || !start) return false;
  const from = Date.parse(start),
    to = from + minutes * 60000;
  return busy.some(
    (other) =>
      other.collaboratorId === row.collaboratorId &&
      other.id !== row.appointmentId &&
      !["cancelled", "no_show"].includes(other.status || "") &&
      Date.parse(other.startsAt) < to &&
      Date.parse(other.endsAt) > from,
  );
}

export type SaveOp =
  | { kind: "patch"; appointmentId: string; body: Record<string, unknown> }
  | { kind: "revise"; appointmentId: string; body: Record<string, unknown> };

export type EditInput = {
  /** The appointment opened: it carries the notes shown in the editor. */
  anchorId: string;
  rows: EditorRow[];
  /** Existing rows taken out of the booking. */
  removed: EditorRow[];
  status: string;
  statusTouched: boolean;
  reason: string;
  customerId: string;
  originalCustomerId: string;
  notes: string;
  originalNotes: string;
  revision: number | null;
};

function lineFields(row: EditorRow): Record<string, unknown> {
  return {
    serviceId: row.serviceId,
    startsAt: rowInstant(row),
    collaboratorId: row.collaboratorId || null,
  };
}

/**
 * Requests for an existing booking, in order. One service: one PATCH (status,
 * time, people, notes, customer together). Added services or several moved
 * together: one revision of the whole booking, so they never clash in between.
 */
export function planEdit(input: EditInput): SaveOp[] {
  const ops: SaveOp[] = [];
  for (const row of input.removed)
    if (row.appointmentId && !STOPPED_STATUSES.includes(row.status))
      ops.push({
        kind: "patch",
        appointmentId: row.appointmentId,
        body: { status: "cancelled", reason: REMOVED_LINE_REASON },
      });
  const existing = input.rows.filter((row) => !!row.appointmentId);
  const movedTogether =
    existing.filter(
      (row) => lineChanged(row) && !STOPPED_STATUSES.includes(row.status),
    ).length >= 2;
  const revise = input.rows.some((row) => !row.appointmentId) || movedTogether;
  if (revise) {
    const lines = input.rows
      .filter((row) => !row.appointmentId || !STOPPED_STATUSES.includes(row.status))
      .map((row) => ({
        ...(row.appointmentId ? { appointmentId: row.appointmentId } : {}),
        ...(row.orderItemId ? { orderItemId: row.orderItemId } : {}),
        serviceId: row.serviceId,
        startsAt: rowInstant(row),
        ...(row.collaboratorId ? { collaboratorId: row.collaboratorId } : {}),
      }));
    const anchor =
      existing.find((row) => !STOPPED_STATUSES.includes(row.status)) ||
      existing[0];
    if (anchor?.appointmentId)
      ops.push({
        kind: "revise",
        appointmentId: anchor.appointmentId,
        body: { revision: input.revision ?? 0, lines },
      });
  }
  const reason = input.reason.trim() || DEFAULT_CANCEL_REASON;
  const notesRow =
    existing.find((row) => row.appointmentId === input.anchorId) || existing[0];
  for (const row of existing) {
    const body: Record<string, unknown> = {};
    const inRevision = revise && !STOPPED_STATUSES.includes(row.status);
    if (!inRevision && lineChanged(row)) Object.assign(body, lineFields(row));
    if (input.statusTouched && input.status && input.status !== row.status) {
      body["status"] = input.status;
      if (input.status === "cancelled") body["reason"] = reason;
    }
    if (row === notesRow) {
      if (input.customerId && input.customerId !== input.originalCustomerId)
        body["customerId"] = input.customerId;
      if (input.notes !== input.originalNotes) body["customerNotes"] = input.notes;
    }
    if (Object.keys(body).length)
      ops.push({ kind: "patch", appointmentId: row.appointmentId!, body });
  }
  return ops;
}

/** A new booking: every service with its own time, the first one leads. */
export function buildCreate(input: {
  customerId: string;
  rows: EditorRow[];
  status: string;
  notes: string;
  locationId: string;
  whatsAppConsent: boolean;
}): Record<string, unknown> {
  const lines = input.rows.map((row) => ({
    serviceId: row.serviceId,
    startsAt: rowInstant(row),
    ...(row.collaboratorId ? { collaboratorId: row.collaboratorId } : {}),
  }));
  return {
    customerId: input.customerId,
    appointmentWhatsAppConsent: input.whatsAppConsent === true,
    status: input.status,
    customerNotes: input.notes,
    ...(input.locationId ? { locationId: input.locationId } : {}),
    startsAt: lines[0]?.startsAt,
    lines,
  };
}

/** What still keeps «Salva» from doing its job, in the barber's words. */
export function missingForSave(input: {
  customerId: string;
  rows: EditorRow[];
}): string {
  if (!input.customerId) return "Scegli il cliente";
  if (!input.rows.length) return "Tocca almeno un servizio";
  if (input.rows.some((row) => !row.date)) return "Scegli il giorno";
  if (input.rows.some((row) => !TIME_PATTERN.test(row.time)))
    return "Scegli o scrivi l'ora";
  if (input.rows.some((row) => !rowInstant(row)))
    return "Quell'ora non esiste in questo giorno (cambio dell'ora legale)";
  return "";
}
