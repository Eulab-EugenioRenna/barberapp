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
  media: { mimetype: string | null; filename: string | null } | null;
  senderName: string | null;
}
export interface WhatsAppOutboxView {
  id: string; sessionId: string; state: string; createdAt: string; hasError: boolean;
  /** Readable outcome when the message did not go out as expected. */
  problem: string | null;
  /** From ALORA's own record of the send; null for sends made elsewhere. */
  recipientName: string | null; preview: string | null; kind: string | null;
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
export interface WhatsAppBroadcastResult { sent: number; failed: number; skipped: number }
export interface WhatsAppAudienceView {
  /** Active customers. */
  customers: number;
  /** Active customers with a usable phone number. */
  withPhone: number;
  /** With phone and marketing consent: who «Invia a tutti» reaches. */
  eligible: number;
}
export interface WhatsAppAcknowledgement { id: string; state: string }
