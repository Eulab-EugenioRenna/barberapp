/** Safe consumer projections. Provider credentials and raw payloads never cross the BFF. */
export interface WhatsAppConnection {
  id: string; number: string | null; state: string; archiveId: string | null;
  runnerOnline: boolean; createdAt: string; closedAt: string | null;
  syncStatus: string; syncCount: number;
}
export interface WhatsAppArchiveView { id: string; number: string }
export interface WhatsAppConversationView {
  chatId: string; messages: number; lastMessageAt: string; preview: string | null;
  name: string | null; direction: string; kind: string;
  /** Phone number in international form when the chat id carries one (not for «@lid» chats). */
  phone: string | null;
  isGroup: boolean;
}
export interface WhatsAppMessageView {
  id: string; chatId: string; direction: string; kind: string; occurredAt: string;
  text: string | null; selectedButtonId: string | null;
  /** Attachment (image, voice note, audio, video, document): fetched through ALORA. */
  media: { mimetype: string | null; filename: string | null;
    /** Low-resolution preview sent by WhatsApp (data URL), shown until the full file arrives. */
    thumbnail: string | null } | null;
  senderName: string | null;
}
export interface WhatsAppOutboxView {
  id: string; sessionId: string; state: string; createdAt: string; hasError: boolean;
  /** Readable outcome when the message did not go out as expected. */
  problem: string | null;
  /** From ALORA's own record of the send; null for sends made elsewhere. */
  recipientName: string | null; preview: string | null; kind: string | null;
  /** Number written to, from ALORA's record. */
  recipient: string | null;
  /** The «Messaggio a tutti» this message belongs to, if any. */
  broadcastId: string | null;
}
/** Image attached to a message: data URL (JPEG, PNG or WebP), caption is the text. */
export interface WhatsAppImageInput { data: string; filename: string }
/** Exactly one recipient: a customer of the tenant (preferred) or a number. */
export interface WhatsAppSendInput {
  to?: string; customerId?: string; text?: string; idempotencyKey: string; recipientAuthorized: true;
  image?: WhatsAppImageInput;
}
/** Sends the same text to every active customer with a phone and marketing consent. */
export interface WhatsAppBroadcastInput {
  text?: string; idempotencyKey: string; recipientAuthorized: true;
  image?: WhatsAppImageInput;
}
/** «Messaggio a tutti», sent in the background a step at a time. */
/** One moment in the life of a «Messaggio a tutti». */
export interface WhatsAppBroadcastEventView {
  kind: "queued" | "step" | "waiting" | "busy" | "paused" | "resumed" | "cancelled" | "done" | "retried";
  sent: number; failed: number; pending: number; note: string | null; at: string;
}
export interface WhatsAppBroadcastRecipientView {
  name: string | null; recipient: string; state: "pending" | "sent" | "failed" | "skipped";
  attempts: number; error: string | null; outboxId: string | null; sentAt: string | null;
}
/** Detail card: the queue, its steps and every recipient. */
export interface WhatsAppBroadcastDetail extends WhatsAppBroadcastView {
  events: WhatsAppBroadcastEventView[];
  recipients: WhatsAppBroadcastRecipientView[];
}
export interface WhatsAppBroadcastView {
  id: string;
  /** running: in progress · paused: waits for «Riprendi» · done · cancelled */
  status: "running" | "paused" | "done" | "cancelled";
  /** Recipients queued (skipped excluded). */
  total: number;
  sent: number;
  failed: number;
  /** Duplicates, unreadable numbers, or already reached with the same text. */
  skipped: number;
  pending: number;
  error: string | null;
  /** Start of the text («Foto» for a photo alone), to tell queues apart. */
  preview: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** Closed text queue: «Completa e riprova i rimanenti» is possible. */
  retryable: boolean;
}
export interface WhatsAppAudienceView {
  /** Active customers. */
  customers: number;
  /** Active customers with a usable phone number. */
  withPhone: number;
  /** Distinct numbers «Invia a tutti» reaches (consent is handled outside ALORA). */
  eligible: number;
  /** Saved without prefix, read as Italian (+39 added). */
  prefixAdded: number;
  /** Italian landlines: sent, but often not on WhatsApp. */
  landline: number;
  /** Phones that are not a number ALORA can read: excluded. */
  invalid: number;
  /** Up to ten customers whose phone must be corrected. */
  invalidCustomers: Array<{ id: string; name: string; phone: string }>;
}
export interface WhatsAppAcknowledgement { id: string; state: string }
