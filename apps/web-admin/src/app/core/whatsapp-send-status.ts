import type { WhatsAppBroadcastRecipientView, WhatsAppBroadcastView, WhatsAppOutboxView } from "@barber/shared/whatsapp";

/** ok: arrived to WhatsApp · progress: being verified or retried · error: did not leave · warn: to check · muted: not sent on purpose. */
export type SendTone = "ok" | "progress" | "error" | "warn" | "muted";
export interface SendStatus { label: string; tone: SendTone }

/** Automatic attempts Connect makes for a message verified as not sent. */
export const SEND_ATTEMPTS = 6;
export const NO_WHATSAPP = "Il numero non ha WhatsApp.";

/** State of one message, in the same words everywhere (page, detail, notifications). */
export function sendStatus(item: Pick<WhatsAppOutboxView, "state" | "problem"> & { attempts?: number }): SendStatus {
  switch (item.state) {
    case "sent": return { label: "Inviato", tone: "ok" };
    case "queued":
      return item.attempts ? { label: `Nuovo tentativo ${item.attempts + 1} di ${SEND_ATTEMPTS}`, tone: "progress" } : { label: "In coda", tone: "progress" };
    case "sending": return { label: "In verifica", tone: "progress" };
    case "failed": return item.problem === NO_WHATSAPP ? { label: "Senza WhatsApp", tone: "muted" } : { label: "Non partito", tone: "error" };
    case "uncertain": return { label: "Da verificare", tone: "warn" };
    case "cancelled": return { label: "Annullato", tone: "muted" };
    default: return { label: "Stato da verificare", tone: "warn" };
  }
}

/** State of one recipient of a «Messaggio a tutti». */
export function recipientStatus(row: Pick<WhatsAppBroadcastRecipientView, "state" | "error">): SendStatus {
  switch (row.state) {
    case "sent": return { label: "Inviato", tone: "ok" };
    case "sending": return { label: /^Tentativo/.test(row.error ?? "") ? "Nuovo tentativo" : "In verifica", tone: "progress" };
    case "failed": return row.error === NO_WHATSAPP ? { label: "Senza WhatsApp", tone: "muted" } : { label: "Non partito", tone: "error" };
    case "uncertain": return { label: "Da verificare", tone: "warn" };
    case "skipped": return { label: row.error === "Annullato a mano" ? "Annullato" : "Saltato", tone: "muted" };
    default: return { label: "Da inviare", tone: "muted" };
  }
}

/** Shares of a queue for a segmented bar: sent, being verified, not left, to check. */
export function broadcastShares(job: WhatsAppBroadcastView) {
  const total = Math.max(job.total, 1);
  const pct = (value: number) => Math.round((Math.max(0, value) / total) * 1000) / 10;
  const sending = job.sending ?? 0, uncertain = job.uncertain ?? 0;
  return {
    sent: pct(job.sent), sending: pct(sending), failed: pct(job.failed), uncertain: pct(uncertain),
    done: Math.round(((job.sent + job.failed + uncertain) / total) * 100),
  };
}
