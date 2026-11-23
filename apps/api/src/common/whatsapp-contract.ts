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
}
export interface WhatsAppMessageView {
  id: string; chatId: string; direction: string; kind: string; occurredAt: string;
  text: string | null; selectedButtonId: string | null;
}
export interface WhatsAppOutboxView {
  id: string; sessionId: string; state: string; createdAt: string; hasError: boolean;
}
/** Exactly one recipient: a customer of the tenant (preferred) or a number. */
export interface WhatsAppSendInput {
  to?: string; customerId?: string; text: string; idempotencyKey: string; recipientAuthorized: true;
}
/** Sends the same text to every active customer with a phone and marketing consent. */
export interface WhatsAppBroadcastInput {
  text: string; idempotencyKey: string; recipientAuthorized: true;
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
