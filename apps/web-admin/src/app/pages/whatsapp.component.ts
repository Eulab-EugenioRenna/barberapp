import { Component, OnDestroy, OnInit, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import type {
  WhatsAppArchiveView, WhatsAppConnection, WhatsAppConversationView, WhatsAppMessageView, WhatsAppOutboxView,
} from "@barber/shared/whatsapp";
import { SessionStore } from "../core/session.store";
import { WhatsAppApiService } from "../core/whatsapp-api.service";
import { UiPageComponent, UiSelectComponent, UiTabsComponent, type UiOption, type UiTab } from "@alora/ui";
import { AdminPageHeaderComponent } from "../shell/admin-page-header.component";
@Component({
  standalone: true, imports: [CommonModule, FormsModule, UiPageComponent, UiTabsComponent, UiSelectComponent, AdminPageHeaderComponent],
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
  /** Recipient: a customer of the salon, or the conversation chosen in «Conversazioni» (`to`). */
  customers: Array<{ id: string; firstName: string; lastName: string; hasPhone: boolean }> = [];
  customerId = ""; customerQuery = "";
  get customerName() {
    const c = this.customers.find(item => item.id === this.customerId);
    return c ? `${c.firstName} ${c.lastName}`.trim() : "";
  }
  get customerMatches() {
    const terms = this.customerQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return this.customers
      .filter(c => c.hasPhone && terms.every(t => `${c.firstName} ${c.lastName}`.toLowerCase().includes(t)))
      .slice(0, 8);
  }
  chooseCustomer(id: string) { this.customerId = id; this.customerQuery = ""; this.to = ""; }
  clearRecipient() { this.customerId = ""; this.to = ""; }
  get hasRecipient() { return !!this.customerId || !!this.to.trim(); }
  feedback = ""; connectionFeedback = ""; sendFeedback = ""; updatedAt: Date | null = null;
  loading = true; refreshing = false; busy = false; sending = false; loadingMessages = false;
  fresh = false; hasOlder = false; disconnectId = ""; removeId = "";
  section: "connection" | "chats" | "compose" | "outbox" = "connection";
  readonly tabs: UiTab[] = [
    { key: "connection", label: "Collegamento" },
    { key: "chats", label: "Conversazioni" },
    { key: "compose", label: "Nuovo messaggio" },
    { key: "outbox", label: "Invii" },
  ];
  private qrTimer?: ReturnType<typeof setInterval>;
  private archiveOptionsCache: { source: WhatsAppArchiveView[]; value: UiOption[] } | null = null;
  get archiveOptions(): UiOption[] {
    if (this.archiveOptionsCache?.source !== this.archives)
      this.archiveOptionsCache = { source: this.archives, value: this.archives.map(a => ({ value: a.id, label: a.number })) };
    return this.archiveOptionsCache.value;
  }
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
    const customerId = String(state.command.body["customerId"] || "");
    const customer = this.customers.find(c => c.id === customerId);
    return { to: customer ? `${customer.firstName} ${customer.lastName}` : customerId ? "Cliente" : String(state.command.body["to"] || ""), text: String(state.command.body["text"] || "") };
  }
  get draftLocked() { return this.sending || this.pending.kind !== "empty"; }
  async ngOnInit() {
    if (this.canSend) void this.api.customers().then(list => { this.customers = list; }).catch(() => { this.customers = []; });
    await this.refresh();
    if (!this.destroyed) this.timer = setInterval(() => { if (!document.hidden) void this.refresh(); }, 8000);
  }
  ngOnDestroy() { this.destroyed = true; this.selection++; clearInterval(this.timer); this.stopQr(); this.qr = null; }
  /** While pairing, the QR rotates: refresh it often, stop as soon as it is linked. */
  private syncQrPolling() {
    const pairing = this.active?.state === "pairing" && this.canManage;
    if (pairing && !this.qrTimer) this.qrTimer = setInterval(() => { if (!document.hidden) void this.refreshQr(); }, 3000);
    if (!pairing) this.stopQr();
  }
  private stopQr() { if (this.qrTimer) clearInterval(this.qrTimer); this.qrTimer = undefined; }
  private async refreshQr() {
    const active = this.active;
    if (!active || active.state !== "pairing") return this.stopQr();
    try {
      const result = await this.api.qr(active.id);
      if (this.destroyed) return;
      this.qr = result.qr;
      // Linked on the phone: reload the whole state once.
      if (result.state !== "pairing") { this.stopQr(); await this.refresh(); }
    } catch { /* the 8s refresh reports errors */ }
  }
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
      this.syncQrPolling();
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
    if (!this.draftLocked) { this.to = chat.chatId; this.customerId = ""; }
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
  async connectionAction(action: "connect" | "reconnect" | "disconnect" | "remove", id = "") {
    if (this.busy || !this.fresh) return;
    this.busy = true; this.qr = null; this.disconnectId = ""; this.removeId = ""; this.connectionFeedback = "";
    try {
      if (action === "connect") await this.api.connect();
      else if (action === "remove") await this.api.remove(id);
      else await this.api.action(id, action);
      this.connectionFeedback = action === "connect"
        ? "Collegamento creato. Inquadra il QR con il telefono."
        : action === "remove" ? "Collegamento eliminato. Lo storico dei messaggi resta in Connect."
        : "Richiesta registrata. Attendi l’aggiornamento dello stato.";
    } catch (error) { this.connectionFeedback = this.error(error); }
    finally { this.busy = false; this.fresh = false; }
    await this.refresh();
  }
  async send(retry = false) {
    if (this.sending || !this.canSend || (!retry && (!this.connected || !this.recipientAuthorized || !this.message.trim()))) return;
    this.sending = true; this.sendFeedback = "";
    try {
      const ack = retry ? await this.api.retry() : await this.api.send(this.connected!.id, { ...(this.customerId ? { customerId: this.customerId } : { to: this.to }), text: this.message, recipientAuthorized: true });
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
