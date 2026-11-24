import { Injectable, inject, signal } from "@angular/core";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import {
  beginPendingCommand, clearPendingCommand, readPendingCommand, type PendingCommand,
} from "@barber/shared/utils";
import type {
  WhatsAppAcknowledgement, WhatsAppArchiveView, WhatsAppConnection, WhatsAppConversationView,
  WhatsAppMessageView, WhatsAppOutboxView, WhatsAppSendInput,
  WhatsAppAudienceView, WhatsAppBroadcastInput, WhatsAppBroadcastResult,
} from "@barber/shared/whatsapp";
import { ADMIN_API_URL } from "./api-config";
import { SessionStore } from "./session.store";
@Injectable({ providedIn: "root" })
export class WhatsAppApiService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  private readonly version = signal(0);
  private readonly root = `${ADMIN_API_URL}/whatsapp`;
  private key() {
    const user = this.session.currentUser();
    if (!user?.id || !user.tenantId) throw new Error("Sessione non disponibile");
    return `alora.whatsapp.send:${user.tenantId}:${user.id}`;
  }
  pending() {
    this.version();
    try { return readPendingCommand(sessionStorage, this.key()); }
    catch { return { kind: "unreadable" } as const; }
  }
  sessions() { return firstValueFrom(this.http.get<WhatsAppConnection[]>(this.root + "/sessions")); }
  archives() { return firstValueFrom(this.http.get<WhatsAppArchiveView[]>(this.root + "/archives")); }
  outbox() { return firstValueFrom(this.http.get<WhatsAppOutboxView[]>(this.root + "/outbox")); }
  connect() { return firstValueFrom(this.http.post<WhatsAppAcknowledgement>(this.root + "/sessions", {})); }
  action(id: string, action: "reconnect" | "disconnect") {
    return firstValueFrom(this.http.post<WhatsAppAcknowledgement>(`${this.root}/sessions/${encodeURIComponent(id)}/${action}`, {}));
  }
  remove(id: string) { return firstValueFrom(this.http.delete<WhatsAppAcknowledgement>(`${this.root}/sessions/${encodeURIComponent(id)}`)); }
  qr(id: string) { return firstValueFrom(this.http.get<{ state: string; qr: string | null }>(`${this.root}/sessions/${encodeURIComponent(id)}/qr`)); }
  conversations(id: string) { return firstValueFrom(this.http.get<WhatsAppConversationView[]>(`${this.root}/archives/${encodeURIComponent(id)}/conversations`)); }
  messages(id: string, chat: string, before?: string) {
    return firstValueFrom(this.http.get<WhatsAppMessageView[]>(`${this.root}/archives/${encodeURIComponent(id)}/messages`, { params: { chat, ...(before ? { before } : {}) } }));
  }
  /** Attachment of a message, copied into ALORA. null while it is still being recovered. */
  async media(archiveId: string, messageId: string): Promise<Blob | null> {
    const response = await firstValueFrom(this.http.get(
      `${this.root}/archives/${encodeURIComponent(archiveId)}/messages/${encodeURIComponent(messageId)}/media`,
      { observe: "response", responseType: "blob" }));
    return response.status === 204 || !response.body?.size ? null : response.body;
  }
  /** Customers of the tenant for the recipient picker (no phone numbers, only whether one exists). */
  customers() {
    return firstValueFrom(this.http.get<Array<{ id: string; firstName: string; lastName: string; hasPhone: boolean }>>(`${ADMIN_API_URL}/customers/options`));
  }
  audience() { return firstValueFrom(this.http.get<WhatsAppAudienceView>(this.root + "/audience")); }
  /** Same key for a repeated request: customers already reached are not messaged again. */
  broadcast(sessionId: string, input: WhatsAppBroadcastInput) {
    return firstValueFrom(this.http.post<WhatsAppBroadcastResult>(`${this.root}/sessions/${encodeURIComponent(sessionId)}/broadcast`, input));
  }
  async send(sessionId: string, input: Omit<WhatsAppSendInput, "idempotencyKey">) {
    const key = this.key();
    let command: PendingCommand;
    try { command = beginPendingCommand(sessionStorage, key, { sessionId, ...input }); }
    catch (error) {
      if (error instanceof DOMException) throw new Error("La foto è troppo grande per essere inviata da questo browser. Scegline una più leggera.");
      throw error;
    }
    this.version.update(v => v + 1);
    return this.sendCommand(key, command);
  }
  retry() {
    const state = this.pending();
    if (state.kind !== "pending") throw new Error("Richiesta precedente non leggibile: controlla sul telefono se il messaggio è partito");
    return this.sendCommand(this.key(), state.command);
  }
  private async sendCommand(key: string, command: PendingCommand) {
    const { sessionId, ...input } = command.body;
    if (typeof sessionId !== "string" || !sessionId) throw new Error("Connessione della richiesta precedente non leggibile");
    try {
      const result = await firstValueFrom(this.http.post<WhatsAppAcknowledgement>(`${this.root}/sessions/${encodeURIComponent(sessionId)}/messages`, input));
      clearPendingCommand(sessionStorage, key, command.body.idempotencyKey);
      this.version.update(v => v + 1);
      return result;
    } catch (error) {
      // No new key after a timeout, permission change, disconnection or provider conflict.
      if (error instanceof HttpErrorResponse && error.status === 400) {
        clearPendingCommand(sessionStorage, key, command.body.idempotencyKey);
        this.version.update(v => v + 1);
        throw error;
      }
      throw new Error("L’invio è da verificare. Recupera la stessa richiesta e controlla lo stato; non creare un nuovo messaggio.");
    }
  }
}
