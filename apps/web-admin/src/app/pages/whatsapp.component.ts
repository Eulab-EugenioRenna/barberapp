import { AfterViewChecked, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import type {
  WhatsAppArchiveView, WhatsAppConnection, WhatsAppConversationView, WhatsAppMessageView, WhatsAppOutboxView,
  WhatsAppImageInput, WhatsAppBroadcastView, WhatsAppBroadcastDetail, WhatsAppBroadcastEventView, WhatsAppBroadcastRecipientView,
} from "@barber/shared/whatsapp";
import { prepareWhatsAppImage } from "../shared/whatsapp-image";
import { SessionStore } from "../core/session.store";
import { WhatsAppApiService } from "../core/whatsapp-api.service";
import { NotificationsFeedService } from "../core/notifications-feed.service";
import { humanError } from "../core/human-error";
import { UiPageComponent, UiSelectComponent, UiTabsComponent, type UiOption, type UiTab } from "@alora/ui";
import { AdminPageHeaderComponent } from "../shell/admin-page-header.component";
import { CustomerDirectoryService } from "../core/customer-directory.service";
import { CustomerSelectComponent } from "../shared/customer-select.component";
import { ActivatedRoute, Router } from "@angular/router";
import { broadcastShares, recipientStatus, sendStatus, SEND_ATTEMPTS, type SendStatus } from "../core/whatsapp-send-status";
@Component({
  standalone: true, imports: [CommonModule, FormsModule, CustomerSelectComponent, UiPageComponent, UiTabsComponent, UiSelectComponent, AdminPageHeaderComponent],
  templateUrl: "./whatsapp.component.html", styleUrl: "./whatsapp.component.css",
})
export class WhatsAppComponent implements OnInit, OnDestroy, AfterViewChecked {
  /** Conversations use all the height left in the window. */
  @ViewChild("workspace") workspace?: ElementRef<HTMLElement>;
  private workspaceHeight = 0;
  @ViewChild("messagesBox") messagesBox?: ElementRef<HTMLElement>;
  @ViewChild("replyBox") replyBox?: ElementRef<HTMLTextAreaElement>;
  private scrollToEnd = false;
  /** Pictures load after the text: until then the view keeps following the end. */
  private stickUntil = 0;
  ngAfterViewChecked() {
    this.fitWorkspace();
    const box = this.messagesBox?.nativeElement;
    if (this.scrollToEnd && box) { this.scrollToEnd = false; this.stickUntil = Date.now() + 3000; box.scrollTop = box.scrollHeight; }
  }
  mediaLoaded() {
    const box = this.messagesBox?.nativeElement;
    if (box && Date.now() < this.stickUntil) box.scrollTop = box.scrollHeight;
  }
  /** The reply box grows with its lines, up to about eight. */
  growReply(box: HTMLTextAreaElement) {
    const list = this.messagesBox?.nativeElement;
    const atEnd = !!list && list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 200)}px`;
    // A taller box must not hide the last message being answered.
    if (list && atEnd) list.scrollTop = list.scrollHeight;
  }
  /** Enter sends, Shift+Enter starts a new line (as in WhatsApp Web). */
  replyEnter(event: Event) {
    const key = event as KeyboardEvent;
    // On phones Enter keeps starting a new line: the «Invia» button sends.
    if (key.shiftKey || key.isComposing || window.matchMedia("(pointer: coarse)").matches) return;
    key.preventDefault();
    if (!this.sending && this.connected && this.pending.kind === "empty" && (this.reply.trim() || this.replyImage)) void this.sendReply();
  }
  @HostListener("window:resize") fitWorkspace() {
    const el = this.workspace?.nativeElement;
    if (!el || window.innerWidth < 768) { if (el) el.style.height = ""; return; }
    const height = Math.max(420, Math.floor(window.innerHeight - (el.getBoundingClientRect().top + window.scrollY) - 16));
    if (height !== this.workspaceHeight || !el.style.height) { this.workspaceHeight = height; el.style.height = `${height}px`; }
  }

  readonly session = inject(SessionStore);
  readonly api = inject(WhatsAppApiService);
  connections: WhatsAppConnection[] = [];
  archives: WhatsAppArchiveView[] = [];
  conversations: WhatsAppConversationView[] = [];
  messages: WhatsAppMessageView[] = [];
  /** Sends come from the feed shared with the notifications bell: one request for both. */
  private readonly feed = inject(NotificationsFeedService);
  get outbox(): WhatsAppOutboxView[] { return this.feed.singles(); }
  set outbox(value: WhatsAppOutboxView[]) { this.feed.singles.set(value); }
  /** «Messaggio a tutti» of this account: one row each in «Invii». */
  get broadcasts(): WhatsAppBroadcastView[] { return this.feed.recent(); }
  set broadcasts(value: WhatsAppBroadcastView[]) { this.feed.recent.set(value); }
  /** Detail card open in «Invii»: a whole queue or one message. */
  detail: { kind: "broadcast"; job: WhatsAppBroadcastDetail } | { kind: "single"; item: WhatsAppOutboxView } | null = null;
  detailLoading = false; detailFeedback = "";
  private detailTimer?: ReturnType<typeof setTimeout>;
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
  fresh = false; hasOlder = false; disconnectId = "";
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
  private timer?: ReturnType<typeof setTimeout>;
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
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  async ngOnInit() {
    if (this.canSend) void this.customerDirectory.load();
    await this.refresh();
    // Opened from the notifications: straight to that send.
    this.route.queryParamMap.subscribe((params) => {
      const invio = params.get("invio"), messaggio = params.get("messaggio");
      if (!invio && !messaggio) return;
      this.section = "outbox";
      if (invio) void this.openBroadcast({ id: invio } as WhatsAppBroadcastView);
      else { const item = this.outbox.find((o) => o.id === messaggio); if (item) this.openSingle(item); }
      void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    });
    this.schedulePoll();
  }
  /** Tab change: fresh data for that tab only, then its own pace. */
  selectSection(section: "connection" | "chats" | "compose" | "outbox") {
    if (this.section === section) return;
    this.section = section;
    void this.pollSection().catch((error) => { this.feedback = this.error(error); });
    this.schedulePoll();
  }
  /** Conversations every 8 s, «Invii» every 15 s (shared feed), the link state every 20 s. */
  private schedulePoll() {
    if (this.timer) clearTimeout(this.timer);
    if (this.destroyed) return;
    const delay = this.section === "chats" ? 8_000 : this.section === "outbox" ? 15_000 : 20_000;
    this.timer = setTimeout(async () => {
      if (!document.hidden && !this.refreshing) {
        try { await this.pollSection(); this.feedback = ""; } catch (error) { this.feedback = this.error(error); }
      }
      this.schedulePoll();
    }, delay);
  }
  private async pollSection() {
    if (this.destroyed) return;
    if (this.section === "chats") {
      await this.loadConversations();
      this.followDraft();
    } else if (this.section === "outbox") {
      await this.feed.refresh(5_000);
    } else {
      const connections = await this.api.sessions();
      if (this.destroyed) return;
      this.connections = connections; this.updatedAt = new Date();
      this.syncQrPolling();
    }
  }
  ngOnDestroy() {
    this.destroyed = true; this.selection++; clearTimeout(this.timer); this.stopQr(); this.qr = null; this.clearMedia();
    if (this.detailTimer) clearTimeout(this.detailTimer);
    if (this.draftTimer) clearTimeout(this.draftTimer);
  }

  /** «Invii» filter: everything, queues, single messages, or only what needs a look. */
  sendFilter: "all" | "broadcast" | "single" | "attention" = "all";
  readonly sendFilters = [
    { key: "all", label: "Tutti" }, { key: "broadcast", label: "Messaggi a tutti" },
    { key: "single", label: "Singoli" }, { key: "attention", label: "Da controllare" },
  ] as const;
  readonly sendStatus = sendStatus;
  readonly recipientStatus = recipientStatus;
  readonly shares = broadcastShares;
  readonly attempts = SEND_ATTEMPTS;
  /** «Invii»: each «Messaggio a tutti» is one row, single messages one row each, newest first. */
  get allSendRows(): Array<{ key: string; at: string; job?: WhatsAppBroadcastView; item?: WhatsAppOutboxView }> {
    const known = new Set(this.broadcasts.map((job) => job.id));
    return [
      ...this.broadcasts.map((job) => ({ key: "b:" + job.id, at: job.createdAt, job })),
      ...this.outbox
        .filter((item) => !item.broadcastId || !known.has(item.broadcastId))
        .map((item) => ({ key: "m:" + item.id, at: item.createdAt, item })),
    ].sort((a, b) => b.at.localeCompare(a.at));
  }
  private needsLook(row: { job?: WhatsAppBroadcastView; item?: WhatsAppOutboxView }) {
    if (row.job) return row.job.status === "paused" || row.job.failed > 0 || (row.job.uncertain ?? 0) > 0;
    const tone = row.item ? sendStatus(row.item).tone : "ok";
    return tone === "error" || tone === "warn";
  }
  get sendRows() {
    const rows = this.allSendRows;
    const filtered = this.sendFilter === "broadcast" ? rows.filter((r) => r.job)
      : this.sendFilter === "single" ? rows.filter((r) => r.item)
        : this.sendFilter === "attention" ? rows.filter((r) => this.needsLook(r)) : rows;
    return filtered.slice(0, 80);
  }
  filterCount(key: string) {
    const rows = this.allSendRows;
    return key === "broadcast" ? rows.filter((r) => r.job).length : key === "single" ? rows.filter((r) => r.item).length
      : key === "attention" ? rows.filter((r) => this.needsLook(r)).length : rows.length;
  }
  /** Today at a glance: in progress, arrived, being verified, to check. */
  get sendSummary() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const today = (at: string | null | undefined) => !!at && Date.parse(at) >= start.getTime();
    const singles = this.outbox.filter((o) => !o.broadcastId && today(o.createdAt));
    const jobs = this.broadcasts.filter((j) => today(j.createdAt) || j.status === "running" || j.status === "paused");
    const tone = (t: string) => singles.filter((o) => sendStatus(o).tone === t).length;
    return {
      running: this.broadcasts.filter((j) => j.status === "running" || j.status === "paused").length,
      sent: tone("ok") + jobs.reduce((n, j) => n + j.sent, 0),
      verifying: tone("progress") + jobs.reduce((n, j) => n + (j.sending ?? 0), 0),
      attention: tone("error") + tone("warn") + jobs.reduce((n, j) => n + j.failed + (j.uncertain ?? 0), 0),
    };
  }
  /** Recipients of the open queue: filter by outcome and search by name or number. */
  recipientFilter: "all" | "sent" | "progress" | "error" | "warn" | "pending" | "muted" = "all";
  recipientQuery = "";
  readonly recipientFilters = [
    { key: "all", label: "Tutti" }, { key: "sent", label: "Inviati" }, { key: "progress", label: "In verifica" },
    { key: "error", label: "Non partiti" }, { key: "warn", label: "Da verificare" }, { key: "pending", label: "Da inviare" },
    { key: "muted", label: "Saltati e annullati" },
  ] as const;
  private recipientGroup(row: WhatsAppBroadcastRecipientView) {
    if (row.state === "pending") return "pending";
    const tone = recipientStatus(row).tone;
    return tone === "ok" ? "sent" : tone;
  }
  recipientTotal(rows: WhatsAppBroadcastRecipientView[], key: string) {
    return key === "all" ? rows.length : rows.filter((r) => this.recipientGroup(r) === key).length;
  }
  visibleRecipients(rows: WhatsAppBroadcastRecipientView[]) {
    const query = this.recipientQuery.trim().toLowerCase();
    return rows.filter((r) => (this.recipientFilter === "all" || this.recipientGroup(r) === this.recipientFilter)
      && (!query || (r.name ?? "").toLowerCase().includes(query) || r.recipient.includes(query.replace(/\s/g, ""))));
  }
  trackRecipient(_index: number, row: WhatsAppBroadcastRecipientView) { return row.id; }
  canRetryRecipient(row: WhatsAppBroadcastRecipientView) {
    return this.canSend && ((row.state === "failed" && row.error !== "Il numero non ha WhatsApp.") || row.state === "uncertain"
      || (row.state === "skipped" && row.error === "Annullato a mano"));
  }
  canCancelRecipient(row: WhatsAppBroadcastRecipientView) {
    return this.canSend && (row.state === "pending" || (row.state === "sending" && /^Tentativo/.test(row.error ?? "")));
  }
  /** Recipient waiting for «Conferma»: it may already have arrived. */
  confirmRecipient = "";
  recipientBusy = "";
  async recipientAction(row: WhatsAppBroadcastRecipientView, action: "retry" | "cancel") {
    if (this.detail?.kind !== "broadcast") return;
    if (action === "retry" && row.state === "uncertain" && this.confirmRecipient !== row.id) { this.confirmRecipient = row.id; return; }
    const id = this.detail.job.id;
    this.recipientBusy = row.id; this.detailFeedback = "";
    try {
      if (action === "retry") await this.api.retryRecipient(id, row.id, row.state === "uncertain");
      else await this.api.cancelRecipient(id, row.id);
      this.confirmRecipient = "";
      const full = await this.api.broadcastDetail(id);
      this.detail = { kind: "broadcast", job: full };
      this.broadcasts = this.broadcasts.map((job) => (job.id === full.id ? full : job));
      this.scheduleDetail();
    } catch (error) {
      this.detailFeedback = this.error(error);
    } finally { this.recipientBusy = ""; }
  }
  statusOf(item: WhatsAppOutboxView): SendStatus { return sendStatus(item); }
  trackKey(_index: number, row: { key: string }) { return row.key; }
  broadcastStatus(status: string) {
    return ({ running: "In esecuzione", paused: "In pausa", done: "Completato", cancelled: "Annullato" } as Record<string, string>)[status] ?? status;
  }
  broadcastPercent(job: WhatsAppBroadcastView) { return broadcastShares(job).done; }
  broadcastTone(job: WhatsAppBroadcastView) {
    if (job.status === "running") return "progress";
    if (job.status === "paused") return "warn";
    if (job.status === "cancelled") return "muted";
    return job.failed ? "error" : job.uncertain ? "warn" : "ok";
  }
  eventLabel(event: WhatsAppBroadcastEventView) {
    switch (event.kind) {
      case "queued": return `Messo in coda: ${event.pending} destinatari`;
      case "step": return event.note === "Esiti verificati dopo i tentativi automatici"
        ? `Esiti verificati dopo i tentativi automatici: ${event.sent} inviati${event.failed ? `, ${event.failed} non partiti` : ""}`
        : `Gruppo concluso: ${event.sent} inviati e verificati${event.failed ? `, ${event.failed} non partiti` : ""}${event.note ? `, ${event.note}` : ""} · ${event.pending} da inviare`;
      case "waiting": return `${event.pending} numeri aspettano il messaggio precedente`;
      case "busy": return "WhatsApp occupato: nuovo tentativo dopo un minuto";
      case "paused": return "In pausa";
      case "resumed": return "Ripreso";
      case "cancelled": return `Annullato (${event.sent} già inviati)`;
      case "done": return `Completato: ${event.sent} inviati${event.failed ? `, ${event.failed} non riusciti` : ""}`;
      case "retried": return event.note?.endsWith(": nuovo invio") ? `Riprova: ${event.note}` : `Completa e riprova: ${event.note || `${event.pending} da inviare`}`;
    }
  }
  /** Delivery state reported by WhatsApp for one message of a queue, when still listed. */
  deliveryOf(outboxId: string | null) {
    const item = outboxId ? this.outbox.find((row) => row.id === outboxId) : undefined;
    return item ? this.stateLabel(item.state) : "";
  }
  /** What happened to one recipient and, when it did not arrive, why. */
  recipientOutcome(row: WhatsAppBroadcastRecipientView): { label: string; tone: string; reason: string | null } {
    const status = recipientStatus(row);
    const reason = row.state === "sent" || row.error === "In invio" || row.error === "In verifica su WhatsApp" ? null
      : row.state === "pending" && row.error ? `Ultimo tentativo: ${row.error}` : row.error;
    return { ...status, reason };
  }
  recipientCounts(rows: WhatsAppBroadcastRecipientView[]) {
    return { queued: rows.filter((r) => r.state !== "skipped").length, skipped: rows.filter((r) => r.state === "skipped").length };
  }
  async openBroadcast(job: WhatsAppBroadcastView) {
    this.detailFeedback = ""; this.recipientFilter = "all"; this.recipientQuery = ""; this.confirmRecipient = "";
    this.detailLoading = true;
    try {
      const full = await this.api.broadcastDetail(job.id);
      if (this.destroyed) return;
      this.detail = { kind: "broadcast", job: full };
      this.scheduleDetail();
    } catch (error) {
      this.detailFeedback = this.error(error);
    } finally { this.detailLoading = false; }
  }
  openSingle(item: WhatsAppOutboxView) {
    this.detailFeedback = "";
    this.detail = { kind: "single", item };
  }
  closeDetail() {
    this.detail = null;
    if (this.detailTimer) clearTimeout(this.detailTimer);
  }
  /** A running queue refreshes its card every 3 seconds while it is open. */
  private scheduleDetail() {
    if (this.detailTimer) clearTimeout(this.detailTimer);
    const open = this.detail;
    if (open?.kind !== "broadcast" || (open.job.status !== "running" && !open.job.sending)) return;
    this.detailTimer = setTimeout(async () => {
      if (this.detail?.kind !== "broadcast" || this.detail.job.id !== open.job.id) return;
      try {
        const full = await this.api.broadcastDetail(open.job.id);
        if (this.detail?.kind === "broadcast" && this.detail.job.id === full.id) this.detail = { kind: "broadcast", job: full };
        this.broadcasts = this.broadcasts.map((job) => (job.id === full.id ? full : job));
      } catch { /* next try in 3 seconds */ }
      this.scheduleDetail();
    }, 3000);
  }
  async broadcastAction(action: "cancel" | "resume" | "retry") {
    if (this.detail?.kind !== "broadcast") return;
    const id = this.detail.job.id;
    this.busy = true;
    try {
      if (action === "cancel") await this.api.cancelBroadcast(id);
      else if (action === "retry") await this.api.retryBroadcast(id);
      else await this.api.resumeBroadcast(id);
      const full = await this.api.broadcastDetail(id);
      this.detail = { kind: "broadcast", job: full };
      this.broadcasts = this.broadcasts.map((job) => (job.id === full.id ? full : job));
      this.scheduleDetail();
    } catch (error) {
      this.detailFeedback = this.error(error);
    } finally { this.busy = false; }
  }
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
      this.qr = result.qr; this.linkCode = result.linkCode; this.linkMethod = result.method;
      // Linked on the phone: reload the whole state once.
      if (result.state !== "pairing") { this.stopQr(); await this.refresh(); }
    } catch { /* the 8s refresh reports errors */ }
  }
  private error(error: unknown): string { return humanError(error, "WhatsApp non disponibile. Aggiorna lo stato."); }
  async refresh() {
    if (this.refreshing || this.destroyed) return;
    this.refreshing = true;
    try {
      const [connections, archives] = await Promise.all([
        this.api.sessions(), this.api.archives(), this.feed.refresh(),
      ]);
      if (this.destroyed) return;
      this.connections = connections; this.archives = archives;
      this.fresh = true; this.feedback = ""; this.updatedAt = new Date();
      if (!archives.some(a => a.id === this.archiveId)) {
        // The history of the number connected now first; the others stay selectable.
        this.archiveId = archives.find(a => a.id === this.active?.archiveId)?.id || archives[0]?.id || ""; this.chatId = ""; this.messages = []; this.selection++;
      }
      await this.loadConversations();
      this.followDraft();
      if (this.active?.state === "pairing" && this.canManage) {
        const result = await this.api.qr(this.active.id);
        if (!this.destroyed) { this.qr = result.qr; this.linkCode = result.linkCode; this.linkMethod = result.method; }
      } else { this.qr = null; this.linkCode = null; }
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
    this.draft = null; this.newChatOpen = false;
    if (chat.chatId !== this.chatId) { this.reply = ""; this.replyImage = null; this.replyFeedback = ""; this.clearMedia(); }
    this.selection++; this.chatId = chat.chatId; this.messages = []; this.hasOlder = false;
    try { await this.loadMessages(); } catch (error) { this.feedback = this.error(error); }
  }
  closeChat() { this.chatId = ""; this.draft = null; this.newChatOpen = false; this.clearMedia(); }

  /** «Conversazioni»: search by name, number or text, and customers to start a chat with. */
  chatQuery = "";
  get filteredConversations() {
    const q = this.chatQuery.trim().toLowerCase(), digits = q.replace(/\D/g, "");
    if (!q) return this.conversations;
    return this.conversations.filter((c) => this.chatLabel(c).toLowerCase().includes(q)
      || (digits.length >= 3 && (c.phone ?? "").replace(/\D/g, "").includes(digits))
      || (c.preview ?? "").toLowerCase().includes(q));
  }
  /** Customers matching the search that can be written to (they have a phone). */
  get customerMatches() {
    const q = this.chatQuery.trim().toLowerCase();
    if (q.length < 2 || !this.canSend) return [];
    return this.customers.filter((c) => c.hasPhone && `${c.firstName} ${c.lastName}`.toLowerCase().includes(q)).slice(0, 6);
  }
  /** A number typed in the search box: offer to write to it. */
  get searchedNumber() { return this.canSend ? whatsAppNumber(this.chatQuery) : null; }
  /** New chat not on WhatsApp yet: to a customer of the salon or to a number. */
  draft: { customerId?: string; to?: string; label: string; detail: string; outboxId?: string } | null = null;
  /** Name of the new chat, kept until WhatsApp's conversation list knows it. */
  private draftLabel = "";
  private draftTimer?: ReturnType<typeof setTimeout>;
  /**
   * After the first message of a new chat: once WhatsApp verified it, its message ID
   * names the chat (a number or a private «@lid» one): the real conversation opens.
   */
  private followDraft() {
    const draft = this.draft;
    if (!draft?.outboxId) return;
    const item = this.outbox.find((o) => o.id === draft.outboxId);
    if (item?.state === "sent" && item.chatId) {
      const chatId = item.chatId, chat = this.conversations.find((c) => c.chatId === chatId);
      this.draftLabel = draft.label; this.draft = null; this.replyFeedback = "";
      if (chat) { void this.selectChat(chat); return; }
      this.selection++; this.chatId = chatId; this.messages = []; this.hasOlder = false;
      void this.loadMessages().catch(() => undefined);
      return;
    }
    if (item && (item.state === "failed" || item.state === "cancelled")) this.replyFeedback = item.problem || "Messaggio non partito.";
    else if (item && sendStatus(item).tone === "progress") this.replyFeedback = item.problem || "In verifica su WhatsApp: la conversazione si apre appena il telefono conferma.";
    // Faster while waiting for the verified outcome.
    if (this.draftTimer) clearTimeout(this.draftTimer);
    if (!item || sendStatus(item).tone === "progress") this.draftTimer = setTimeout(() => {
      if (!this.destroyed) void this.feed.refresh().then(() => this.followDraft());
    }, 3000);
  }
  newChatOpen = false; newChatMode: "customer" | "number" = "customer"; newChatNumber = ""; newChatFeedback = "";
  openNewChat() {
    this.newChatOpen = true; this.newChatFeedback = ""; this.newChatNumber = ""; this.chatId = ""; this.draft = null;
    this.recipientAuthorized = false; this.clearMedia();
    if (this.canSend) void this.customerDirectory.load();
  }
  /** A customer: their number from the card, then the same path as a number typed by hand. */
  async startChatWithCustomer(id: string) {
    if (!id) return;
    this.newChatFeedback = "";
    try {
      const found = await this.api.customerNumber(id);
      if (!found.to || found.issue === "landline") {
        this.newChatOpen = true;
        this.newChatFeedback = found.issue === "landline"
          ? `${found.name}: in scheda c’è un numero fisso, WhatsApp non lo raggiunge.`
          : `${found.name}: il numero in scheda non è leggibile. Correggilo nella scheda cliente.`;
        return;
      }
      this.startChatWithNumber(found.to, found.name, found.customerId);
    } catch (error) { this.newChatOpen = true; this.newChatFeedback = this.error(error); }
  }
  startChatWithNumber(value = this.newChatNumber, name?: string, customerId?: string) {
    const to = whatsAppNumber(value);
    if (!to) { this.newChatFeedback = "Numero non valido: scrivi il prefisso internazionale (es. +39) oppure un cellulare italiano."; return; }
    const digits = to.slice(1);
    const existing = this.conversations.find((c) => (c.phone ?? "").replace(/\D/g, "") === digits);
    if (existing) { this.newChatOpen = false; this.chatQuery = ""; void this.selectChat(existing); return; }
    const pretty = to.replace(/^(\+\d{2})(\d{3})(\d+)$/, "$1 $2 $3");
    this.openDraft(name
      ? { to, customerId, label: name, detail: `${pretty} · cliente del salone` }
      : { to, label: pretty, detail: "Nuovo numero" });
  }
  private openDraft(draft: NonNullable<WhatsAppComponent["draft"]>) {
    this.selection++; this.chatId = ""; this.messages = []; this.hasOlder = false; this.clearMedia();
    this.draft = draft; this.newChatOpen = false; this.chatQuery = ""; this.newChatFeedback = "";
    this.reply = ""; this.replyImage = null; this.replyFeedback = ""; this.recipientAuthorized = false;
  }
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
  mediaLabel(item: WhatsAppMessageView) {
    const kind = this.mediaKind(item);
    return kind === "image" ? (item.kind === "sticker" ? "Sticker" : "Foto") : kind === "audio" ? "Messaggio vocale" : kind === "video" ? "Video" : "Documento";
  }
  mediaIcon(item: WhatsAppMessageView) {
    const kind = this.mediaKind(item);
    return kind === "image" ? "📷" : kind === "audio" ? "🎤" : kind === "video" ? "🎬" : "📄";
  }
  /** The phone usually hands the original over within minutes; after that it is not coming by itself. */
  mediaRecent(item: WhatsAppMessageView) { return Date.now() - Date.parse(item.occurredAt) < 10 * 60_000; }
  retryMedia(id: string) { this.media.delete(id); void this.loadMedia(); }
  async loadMessages(older = false) {
    if (!this.archiveId || !this.chatId || this.loadingSelection === this.selection) return;
    const version = this.selection, archiveId = this.archiveId, chatId = this.chatId;
    this.loadingMessages = true;
    this.loadingSelection = version;
    try {
      const box = this.messagesBox?.nativeElement;
      const atEnd = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      const known = this.messages.length;
      const result = await this.api.messages(archiveId, chatId, older ? this.messages[0]?.id : undefined);
      if (this.destroyed || version !== this.selection) return;
      // Opening a chat, or new messages while reading the end: show the latest.
      if (!older && (!known || atEnd)) this.scrollToEnd = true;
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
  /** Linking by phone number: WhatsApp gives a code to type on the phone, handy when the QR is on the same phone. */
  linkCode: string | null = null;
  linkMethod: "qr" | "phone" = "qr";
  askPhone = false;
  linkPhone = "";
  get linkCodeParts() { return this.linkCode ? this.linkCode.replace(/-/g, "").match(/.{1,4}/g) ?? [] : []; }
  async switchLink(phone?: string) {
    const active = this.active;
    if (!active || this.busy) return;
    this.busy = true; this.connectionFeedback = ""; this.qr = null; this.linkCode = null;
    try {
      await this.api.relink(active.id, phone);
      this.linkMethod = phone ? "phone" : "qr"; this.askPhone = false;
    } catch (error) { this.connectionFeedback = this.error(error); }
    finally { this.busy = false; this.fresh = false; }
    await this.refresh();
  }
  async copyLinkCode() {
    if (!this.linkCode) return;
    try { await navigator.clipboard.writeText(this.linkCode.replace(/-/g, "")); this.connectionFeedback = "Codice copiato."; } catch { /* manual copy */ }
  }
  async connectionAction(action: "connect" | "reconnect" | "disconnect", id = "") {
    if (this.busy || !this.fresh) return;
    this.busy = true; this.qr = null; this.disconnectId = ""; this.connectionFeedback = "";
    try {
      if (action === "connect") await this.api.connect();
      else await this.api.action(id, action);
      this.connectionFeedback = action === "connect"
        ? "Collegamento creato. Inquadra il QR con il telefono."
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
    const chatId = this.chatId, draft = this.draft;
    if (this.sending || !this.canSend || !this.connected || (!chatId && !draft) || (!this.reply.trim() && !this.replyImage)) return;
    // Writing first to someone: the same confirmation as «Nuovo messaggio».
    if (draft && !this.recipientAuthorized) { this.replyFeedback = "Conferma che il destinatario ha accettato di ricevere messaggi."; return; }
    this.sending = true; this.replyFeedback = "";
    try {
      const target = draft ? (draft.to ? { to: draft.to } : { customerId: draft.customerId! }) : { to: chatId };
      const ack = await this.api.send(this.connected.id, {
        ...target, text: this.reply, ...(this.replyImage ? { image: this.replyImage } : {}), recipientAuthorized: true,
      });
      this.reply = ""; this.replyImage = null;
      if (this.replyBox) this.replyBox.nativeElement.style.height = "";
      this.scrollToEnd = true;
      this.replyFeedback = "Messaggio affidato a WhatsApp. Compare nella conversazione appena il telefono lo conferma.";
      if (draft && this.draft === draft) {
        this.draft = { ...draft, outboxId: ack.id };
        this.replyFeedback = "In verifica su WhatsApp: la conversazione si apre appena il telefono conferma.";
      }
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
  chatName() { if (this.draft) return this.draft.label; const chat = this.currentChat; return chat ? this.chatLabel(chat) : this.draftLabel || "Conversazione"; }
  trackId(_index: number, item: { id: string }) { return item.id; }
  trackChat(_index: number, item: WhatsAppConversationView) { return item.chatId; }
}

/** A typed number as WhatsApp wants it: «+39…»; Italian mobiles may skip the prefix. Null when not a number. */
export function whatsAppNumber(value: string): string | null {
  const compact = value.trim().replace(/[\s()./-]/g, "");
  if (!/^(\+|00)?\d{6,15}$/.test(compact)) return null;
  if (compact.startsWith("+")) return compact.length >= 9 ? compact : null;
  if (compact.startsWith("00")) return compact.length >= 10 ? "+" + compact.slice(2) : null;
  if (/^3\d{8,9}$/.test(compact)) return "+39" + compact;
  if (/^39\d{9,10}$/.test(compact)) return "+" + compact;
  return null;
}
