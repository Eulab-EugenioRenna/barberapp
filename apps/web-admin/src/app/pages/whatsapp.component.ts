import { Component, OnDestroy, OnInit, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import type {
  WhatsAppArchiveView, WhatsAppConnection, WhatsAppConversationView, WhatsAppMessageView, WhatsAppOutboxView,
  WhatsAppImageInput,
} from "@barber/shared/whatsapp";
import { prepareWhatsAppImage } from "../shared/whatsapp-image";
import { SessionStore } from "../core/session.store";
import { WhatsAppApiService } from "../core/whatsapp-api.service";
import { UiPageComponent, UiSelectComponent, UiTabsComponent, type UiOption, type UiTab } from "@alora/ui";
import { AdminPageHeaderComponent } from "../shell/admin-page-header.component";
import { CustomerDirectoryService } from "../core/customer-directory.service";
import { CustomerSelectComponent } from "../shared/customer-select.component";
@Component({
  standalone: true, imports: [CommonModule, FormsModule, CustomerSelectComponent, UiPageComponent, UiTabsComponent, UiSelectComponent, AdminPageHeaderComponent],
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
  private readonly customerDirectory = inject(CustomerDirectoryService);
  get customers() { return this.customerDirectory.customers(); }
  customerId = "";
  get customerName() {
    const c = this.customerDirectory.find(this.customerId);
    return c ? `${c.firstName} ${c.lastName}`.trim() : "";
  }
  chooseCustomer(id: string) { this.customerId = id; this.to = ""; }
  clearRecipient() { this.customerId = ""; this.to = ""; }
  get hasRecipient() { return !!this.customerId || !!this.to.trim(); }
  /** Reply in the open conversation: always goes to that chat. */
  reply = ""; replyImage: WhatsAppImageInput | null = null; replyFeedback = "";
  /** Photo of «Nuovo messaggio». */
  image: WhatsAppImageInput | null = null;
  /** Attachments shown in the thread, by message id (object URLs of files saved in ALORA). */
  media = new Map<string, { state: "loading" | "queued" | "error" } | { state: "ready"; url: string; type: string }>();
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
    const to = String(state.command.body["to"] || "");
    const chat = this.conversations.find(c => c.chatId === to);
    return {
      to: customer ? `${customer.firstName} ${customer.lastName}` : customerId ? "Cliente" : chat ? this.chatLabel(chat) : to,
      text: String(state.command.body["text"] || "") || (state.command.body["image"] ? "Foto" : ""),
    };
  }
  get draftLocked() { return this.sending || this.pending.kind !== "empty"; }
  async ngOnInit() {
    if (this.canSend) void this.customerDirectory.load();
    await this.refresh();
    if (!this.destroyed) this.timer = setInterval(() => { if (!document.hidden) void this.refresh(); }, 8000);
  }
  ngOnDestroy() { this.destroyed = true; this.selection++; clearInterval(this.timer); this.stopQr(); this.qr = null; this.clearMedia(); }
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
    if (chat.chatId !== this.chatId) { this.reply = ""; this.replyImage = null; this.replyFeedback = ""; this.clearMedia(); }
    this.selection++; this.chatId = chat.chatId; this.messages = []; this.hasOlder = false;
    try { await this.loadMessages(); } catch (error) { this.feedback = this.error(error); }
  }
  closeChat() { this.chatId = ""; this.clearMedia(); }
  private clearMedia() {
    for (const item of this.media.values()) if (item.state === "ready") URL.revokeObjectURL(item.url);
    this.media = new Map();
  }
  /** Photos, voice notes and files of the open chat are copied into ALORA and shown here. */
  private async loadMedia() {
    const archiveId = this.archiveId, version = this.selection;
    const todo = this.messages.filter(m => m.media && (!this.media.has(m.id) || this.media.get(m.id)!.state === "queued"));
    for (let index = 0; index < todo.length; index += 3) {
      await Promise.all(todo.slice(index, index + 3).map(async item => {
        this.media.set(item.id, { state: "loading" });
        try {
          const blob = await this.api.media(archiveId, item.id);
          if (this.destroyed || version !== this.selection) return;
          this.media.set(item.id, blob
            ? { state: "ready", url: URL.createObjectURL(blob), type: blob.type || item.media?.mimetype || "" }
            : { state: "queued" });
        } catch {
          if (version === this.selection) this.media.set(item.id, { state: "error" });
        }
      }));
      if (this.destroyed || version !== this.selection) return;
    }
  }
  mediaOf(id: string) { return this.media.get(id); }
  mediaKind(item: WhatsAppMessageView): "image" | "audio" | "video" | "file" {
    const type = (this.media.get(item.id) as { type?: string } | undefined)?.type || item.media?.mimetype || "";
    if (["image", "sticker"].includes(item.kind) || type.startsWith("image/")) return "image";
    if (["ptt", "audio"].includes(item.kind) || type.startsWith("audio/")) return "audio";
    if (item.kind === "video" || type.startsWith("video/")) return "video";
    return "file";
  }
  retryMedia(id: string) { this.media.delete(id); void this.loadMedia(); }
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
      void this.loadMedia();
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
        : action === "remove" ? "Collegamento eliminato. Lo storico dei messaggi resta conservato."
        : "Richiesta registrata. Attendi l’aggiornamento dello stato.";
    } catch (error) { this.connectionFeedback = this.error(error); }
    finally { this.busy = false; this.fresh = false; }
    await this.refresh();
  }
  async pickImage(event: Event, target: "reply" | "compose") {
    const input = event.target as HTMLInputElement, file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const image = await prepareWhatsAppImage(file);
      if (target === "reply") { this.replyImage = image; this.replyFeedback = ""; }
      else { this.image = image; this.sendFeedback = ""; }
    } catch (error) {
      if (target === "reply") this.replyFeedback = this.error(error); else this.sendFeedback = this.error(error);
    }
  }
  async send(retry = false) {
    const content = !!this.message.trim() || !!this.image;
    if (this.sending || !this.canSend || (!retry && (!this.connected || !this.recipientAuthorized || !content))) return;
    this.sending = true; this.sendFeedback = "";
    try {
      const ack = retry ? await this.api.retry() : await this.api.send(this.connected!.id, {
        ...(this.customerId ? { customerId: this.customerId } : { to: this.to }),
        text: this.message, ...(this.image ? { image: this.image } : {}), recipientAuthorized: true,
      });
      this.sendFeedback = `${this.stateLabel(ack.state)}. L’esito è in «Invii».`;
      this.message = ""; this.image = null; this.recipientAuthorized = false;
      await this.refresh();
    } catch (error) { this.sendFeedback = this.error(error); }
    finally { this.sending = false; }
  }
  /** The person wrote in this chat: replying there is expected, no extra confirmation. */
  async sendReply() {
    const chatId = this.chatId;
    if (this.sending || !this.canSend || !this.connected || !chatId || (!this.reply.trim() && !this.replyImage)) return;
    this.sending = true; this.replyFeedback = "";
    try {
      await this.api.send(this.connected.id, {
        to: chatId, text: this.reply, ...(this.replyImage ? { image: this.replyImage } : {}), recipientAuthorized: true,
      });
      this.reply = ""; this.replyImage = null;
      this.replyFeedback = "Messaggio affidato a WhatsApp. Compare nella conversazione appena il telefono lo conferma.";
      await this.refresh();
    } catch (error) { this.replyFeedback = this.error(error); }
    finally { this.sending = false; }
  }
  stateLabel(state: string) {
    const labels: Record<string, string> = {
      queued: "In coda", pairing: "Da collegare", connected: "Connesso", failed: "Interrotto",
      disconnecting: "Disconnessione in corso", disconnected: "Disconnesso", sending: "Invio in corso",
      sent: "Inviato", uncertain: "Non confermato", cancelled: "Annullato", completed: "Completato",
    };
    return labels[state] || "Stato da verificare";
  }
  /** Name first; a phone only when WhatsApp gives one; never the internal «@lid» id. */
  chatLabel(chat: WhatsAppConversationView) { return chat.name || chat.phone || (chat.isGroup ? "Gruppo WhatsApp" : "Contatto senza nome"); }
  get currentChat() { return this.conversations.find(c => c.chatId === this.chatId); }
  chatName() { const chat = this.currentChat; return chat ? this.chatLabel(chat) : "Conversazione"; }
  trackId(_index: number, item: { id: string }) { return item.id; }
  trackChat(_index: number, item: WhatsAppConversationView) { return item.chatId; }
}
