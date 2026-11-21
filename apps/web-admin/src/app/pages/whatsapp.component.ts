import { Component, OnDestroy, OnInit, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import type {
  WhatsAppArchiveView, WhatsAppConnection, WhatsAppConversationView, WhatsAppMessageView, WhatsAppOutboxView,
} from "@barber/shared/whatsapp";
import { SessionStore } from "../core/session.store";
import { WhatsAppApiService } from "../core/whatsapp-api.service";
import { NotificationTemplateEditorComponent } from "../shared/notification-template-editor.component";
import { AppointmentAutomationPolicyComponent } from "../shared/appointment-automation-policy.component";
import { AppointmentAutomationMonitorComponent } from "../shared/appointment-automation-monitor.component";
import { AppointmentAutomationAccessComponent } from "../shared/appointment-automation-access.component";
@Component({
  standalone: true, imports: [CommonModule, FormsModule, RouterLink, NotificationTemplateEditorComponent, AppointmentAutomationPolicyComponent, AppointmentAutomationAccessComponent, AppointmentAutomationMonitorComponent],
  templateUrl: "./whatsapp.component.html", styleUrl: "./whatsapp.component.css",
})
export class WhatsAppComponent implements OnInit, OnDestroy {
  readonly session = inject(SessionStore);
  readonly api = inject(WhatsAppApiService);
  connections: WhatsAppConnection[] = [];
  archives: WhatsAppArchiveView[] = [];
  conversations: WhatsAppConversationView[] = [];
  messages: WhatsAppMessageView[] = [];
  outbox: WhatsAppOutboxView[] = [];
  archiveId = ""; chatId = ""; qr: string | null = null;
  to = ""; message = ""; recipientAuthorized = false;
  feedback = ""; connectionFeedback = ""; sendFeedback = ""; updatedAt: Date | null = null;
  loading = true; refreshing = false; busy = false; sending = false; loadingMessages = false;
  fresh = false; hasOlder = false; disconnectId = "";
  private destroyed = false;
  private timer?: ReturnType<typeof setInterval>;
  private selection = 0;
  private loadingSelection = -1;
  get canManage() { return this.session.can("whatsapp.manage"); }
  get canSend() { return this.session.can("whatsapp.send"); }
  get active() { return this.connections.find(c => !c.closedAt); }
  get connected() { return this.connections.find(c => !c.closedAt && c.state === "connected" && c.runnerOnline); }
  get pending() { return this.api.pending(); }
  get pendingPayload() {
    const state = this.pending;
    if (state.kind !== "pending") return null;
    return { to: String(state.command.body["to"] || ""), text: String(state.command.body["text"] || "") };
  }
  get draftLocked() { return this.sending || this.pending.kind !== "empty"; }
  async ngOnInit() {
    await this.refresh();
    if (!this.destroyed) this.timer = setInterval(() => { if (!document.hidden) void this.refresh(); }, 8000);
  }
  ngOnDestroy() { this.destroyed = true; this.selection++; clearInterval(this.timer); this.qr = null; }
  private error(error: any): string { return error?.error?.message || error?.message || "WhatsApp non disponibile. Aggiorna lo stato."; }
  async refresh() {
    if (this.refreshing || this.destroyed) return;
    this.refreshing = true;
    try {
      const [connections, archives, outbox] = await Promise.all([this.api.sessions(), this.api.archives(), this.api.outbox()]);
      if (this.destroyed) return;
      this.connections = connections; this.archives = archives; this.outbox = outbox;
      this.fresh = true; this.feedback = ""; this.updatedAt = new Date();
      if (!archives.some(a => a.id === this.archiveId)) {
        this.archiveId = archives[0]?.id || ""; this.chatId = ""; this.messages = []; this.selection++;
      }
      await this.loadConversations();
      if (this.active?.state === "pairing" && this.canManage) {
        const result = await this.api.qr(this.active.id);
        if (!this.destroyed) this.qr = result.qr;
      } else this.qr = null;
    } catch (error) {
      this.fresh = false; this.qr = null;
      this.feedback = this.error(error);
      // Do not retain a conversation on screen after a permission or session denial.
      if ([401, 403].includes((error as any)?.status)) {
        this.connections = []; this.archives = []; this.messages = []; this.conversations = []; this.outbox = [];
      }
    } finally { this.loading = false; this.refreshing = false; }
  }
  async loadConversations() {
    const archiveId = this.archiveId, version = this.selection;
    if (!archiveId) { this.conversations = []; return; }
    const result = await this.api.conversations(archiveId);
    if (this.destroyed || version !== this.selection || archiveId !== this.archiveId) return;
    this.conversations = result;
    if (this.chatId) await this.loadMessages();
  }
  async selectArchive() {
    this.selection++; this.chatId = ""; this.messages = []; this.conversations = []; this.hasOlder = false;
    try { await this.loadConversations(); } catch (error) { this.feedback = this.error(error); }
  }
  async selectChat(chat: WhatsAppConversationView) {
    this.selection++; this.chatId = chat.chatId; this.messages = []; this.hasOlder = false;
    if (!this.draftLocked) this.to = chat.chatId;
    try { await this.loadMessages(); } catch (error) { this.feedback = this.error(error); }
  }
  async loadMessages(older = false) {
    if (!this.archiveId || !this.chatId || this.loadingSelection === this.selection) return;
    const version = this.selection, archiveId = this.archiveId, chatId = this.chatId;
    this.loadingMessages = true;
    this.loadingSelection = version;
    try {
      const result = await this.api.messages(archiveId, chatId, older ? this.messages[0]?.id : undefined);
      if (this.destroyed || version !== this.selection) return;
      if (older || !this.messages.length) this.hasOlder = result.length === 50;
      this.messages = [...new Map([...this.messages, ...result].map(m => [m.id, m])).values()]
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
    } finally {
      if (this.loadingSelection === version) { this.loadingMessages = false; this.loadingSelection = -1; }
    }
  }
  async olderMessages() {
    try { await this.loadMessages(true); }
    catch (error) { this.feedback = this.error(error); this.fresh = false; }
  }
  async connectionAction(action: "connect" | "reconnect" | "disconnect", id = "") {
    if (this.busy || !this.fresh) return;
    this.busy = true; this.qr = null; this.disconnectId = ""; this.connectionFeedback = "";
    try {
      if (action === "connect") await this.api.connect(); else await this.api.action(id, action);
      this.connectionFeedback = "Richiesta registrata. Attendi l’aggiornamento dello stato.";
    } catch (error) { this.connectionFeedback = this.error(error); }
    finally { this.busy = false; this.fresh = false; }
    await this.refresh();
  }
  async send(retry = false) {
    if (this.sending || !this.canSend || (!retry && (!this.connected || !this.recipientAuthorized || !this.message.trim()))) return;
    this.sending = true; this.sendFeedback = "";
    try {
      const ack = retry ? await this.api.retry() : await this.api.send(this.connected!.id, { to: this.to, text: this.message, recipientAuthorized: true });
      this.sendFeedback = `Richiesta registrata: ${this.stateLabel(ack.state)}. Controlla gli invii recenti.`;
      this.message = ""; this.recipientAuthorized = false;
      await this.refresh();
    } catch (error) { this.sendFeedback = this.error(error); }
    finally { this.sending = false; }
  }
  stateLabel(state: string) {
    const labels: Record<string, string> = {
      queued: "In coda", pairing: "Da collegare", connected: "Connesso", failed: "Interrotto",
      disconnecting: "Disconnessione in corso", disconnected: "Disconnesso", sending: "Invio in corso",
      sent: "Inviato al canale", uncertain: "Esito da verificare", cancelled: "Annullato", completed: "Completato",
    };
    return labels[state] || "Stato da verificare";
  }
  chatName() { return this.conversations.find(c => c.chatId === this.chatId)?.name || this.chatId; }
  trackId(_index: number, item: { id: string }) { return item.id; }
  trackChat(_index: number, item: WhatsAppConversationView) { return item.chatId; }
}
