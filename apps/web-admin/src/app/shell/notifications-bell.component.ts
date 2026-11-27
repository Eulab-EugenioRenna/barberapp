import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, OnInit, computed, inject, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { Router } from "@angular/router";
import { UiIconComponent } from "@alora/ui";
import type { WhatsAppBroadcastView, WhatsAppOutboxView } from "@barber/shared/whatsapp";
import { AppointmentOrderNotificationsService } from "../core/appointment-order-notifications.service";
import { SessionStore } from "../core/session.store";
import { NotificationsFeedService } from "../core/notifications-feed.service";
import { broadcastShares, sendStatus, type SendTone } from "../core/whatsapp-send-status";

interface Notice {
  key: string; at: string; tone: SendTone; title: string; text: string;
  /** Running «Messaggio a tutti»: its progress bar. */
  job?: WhatsAppBroadcastView;
  open: () => void;
  /** Still in progress: always counted, never «seen». */
  live?: boolean;
}
const DAY = 24 * 3600_000;

/**
 * Bell next to «Guida»: app notices (accounts to close), progress of every «Messaggio a tutti»
 * and the outcome of single messages of the last 24 hours. The data comes from one shared feed
 * (NotificationsFeedService, polled once for the app), so a header per page costs no request.
 */
@Component({
  selector: "alora-notifications-bell",
  standalone: true,
  imports: [UiIconComponent, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="icon-btn bell-btn" [class.has-live]="liveCount() > 0" data-tour="notifications" data-tip="Notifiche"
      [attr.aria-expanded]="open()" aria-haspopup="dialog"
      [attr.aria-label]="badge() ? badge() + ' notifiche nuove' : 'Notifiche'" (click)="toggle()">
      <ui-icon name="bell"></ui-icon>
      @if (badge()) { <span class="bell-badge" aria-hidden="true">{{ badge() > 99 ? '99+' : badge() }}</span> }
    </button>
    @if (open()) {
      <section class="bell-panel panel" role="dialog" aria-label="Notifiche">
        <header>
          <strong>Notifiche</strong>
          @if (liveCount()) { <span class="bell-live">{{ liveCount() }} in corso</span> }
          <button type="button" class="pill-btn" (click)="open.set(false)">Chiudi</button>
        </header>
        @if (!notices().length) {
          <p class="bell-empty">Nessuna notifica nelle ultime 24 ore.</p>
        }
        <ol>
          @for (n of notices(); track n.key) {
            <li>
              <button type="button" class="bell-item" [class]="'bell-item tone-' + n.tone" [class.unseen]="!n.live && n.at > seen()" (click)="go(n)">
                <span class="bell-dot" aria-hidden="true"></span>
                <span class="bell-body">
                  <span class="bell-title"><strong>{{ n.title }}</strong><time>{{ n.at | date: 'HH:mm' }}</time></span>
                  @if (n.job; as job) {
                    @let s = shares(job);
                    <span class="bell-bar" aria-hidden="true">
                      <i class="s-ok" [style.width.%]="s.sent"></i><i class="s-progress" [style.width.%]="s.sending"></i><i class="s-error" [style.width.%]="s.failed"></i><i class="s-warn" [style.width.%]="s.uncertain"></i>
                    </span>
                  }
                  <span class="bell-text">{{ n.text }}</span>
                </span>
              </button>
            </li>
          }
        </ol>
        @if (waUnavailable()) { <p class="bell-empty">Invii WhatsApp non disponibili: accedi tramite Connect.</p> }
      </section>
    }
  `,
  styles: [`
    :host { position: relative; display: inline-flex; }
    .bell-btn { position: relative; display: inline-flex; align-items: center; gap: 0.4rem; }
    .bell-btn.has-live ui-icon { animation: bell-pulse 1.6s ease-in-out infinite; }
    @keyframes bell-pulse { 50% { opacity: 0.45; } }
    @media (prefers-reduced-motion: reduce) { .bell-btn.has-live ui-icon { animation: none; } }
    .bell-badge { position: absolute; top: -0.35rem; right: -0.35rem; min-width: 1.15rem; height: 1.15rem; padding: 0 0.3rem; border-radius: 999px; background: #b4432a; color: #fff; font-size: 0.68rem; font-weight: 800; line-height: 1.15rem; text-align: center; }
    .bell-panel { position: absolute; top: calc(100% + 0.5rem); right: 0; z-index: 60; width: min(24rem, calc(100vw - 1.5rem)); max-height: min(32rem, 75dvh); overflow-y: auto; padding: 0.75rem; border-radius: 1.1rem; box-shadow: 0 18px 40px rgba(20, 30, 24, 0.18); text-align: left; }
    header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
    header strong { flex: 1; font-size: 0.95rem; }
    .bell-live { padding: 0.15rem 0.55rem; border-radius: 999px; background: #e3ecf8; color: #24456e; font-size: 0.72rem; font-weight: 700; }
    ol { display: grid; gap: 0.3rem; margin: 0; padding: 0; list-style: none; }
    .bell-item { display: flex; gap: 0.6rem; width: 100%; padding: 0.55rem 0.6rem; border: 0; border-radius: 0.8rem; background: transparent; font: inherit; text-align: left; cursor: pointer; }
    .bell-item:hover, .bell-item:focus-visible { background: var(--surface); }
    .bell-item.unseen { background: rgba(30, 52, 37, 0.05); }
    .bell-dot { flex: none; width: 0.55rem; height: 0.55rem; margin-top: 0.4rem; border-radius: 50%; background: var(--muted); }
    .tone-ok .bell-dot { background: #2f7a52; } .tone-progress .bell-dot { background: #2f62a3; }
    .tone-error .bell-dot { background: #b4432a; } .tone-warn .bell-dot { background: #c08a12; }
    .bell-body { display: grid; flex: 1; gap: 0.25rem; min-width: 0; }
    .bell-title { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.85rem; }
    .bell-title time { color: var(--muted); font-size: 0.72rem; white-space: nowrap; }
    .bell-text { color: var(--muted); font-size: 0.78rem; overflow-wrap: anywhere; }
    .bell-bar { display: flex; height: 0.35rem; overflow: hidden; border-radius: 999px; background: var(--line); }
    .bell-bar i { display: block; height: 100%; transition: width 0.4s; }
    .s-ok { background: #2f7a52; } .s-progress { background: #2f62a3; } .s-error { background: #b4432a; } .s-warn { background: #c08a12; }
    .bell-empty { margin: 0.4rem 0.2rem; color: var(--muted); font-size: 0.82rem; }
    @media (max-width: 640px) { .bell-panel { position: fixed; top: 4rem; right: 0.75rem; left: 0.75rem; width: auto; } }
  `],
})
export class NotificationsBellComponent implements OnInit {
  private readonly session = inject(SessionStore);
  private readonly feed = inject(NotificationsFeedService);
  private readonly accounts = inject(AppointmentOrderNotificationsService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly open = signal(false);
  readonly seen = signal("");
  readonly waUnavailable = this.feed.unavailable;
  private readonly active = this.feed.active;
  private readonly recent = this.feed.recent;
  private readonly singles = this.feed.singles;
  readonly shares = broadcastShares;

  readonly notices = computed<Notice[]>(() => {
    const list: Notice[] = [];
    const toClose = this.accounts.appointments();
    if (toClose.length)
      list.push({ key: "accounts", at: new Date().toISOString(), tone: "warn", live: true, title: "Conti da chiudere",
        text: toClose.length === 1 ? "1 appuntamento trascorso aspetta il conto" : `${toClose.length} appuntamenti trascorsi aspettano il conto`,
        open: () => void this.router.navigate(["/sales"]) });
    for (const job of this.active()) {
      const sending = job.sending ?? 0;
      list.push({ key: "b:" + job.id, at: job.createdAt, tone: job.status === "paused" ? "warn" : "progress", live: true, job,
        title: job.status === "paused" ? "Messaggio a tutti in pausa" : "Messaggio a tutti in corso",
        text: job.status === "paused" && job.error ? job.error
          : [`${job.sent} inviati su ${job.total}`, sending ? `${sending} in verifica` : "", job.failed ? `${job.failed} non partiti` : "", job.uncertain ? `${job.uncertain} da verificare` : ""].filter(Boolean).join(" · "),
        open: () => this.openWhatsApp(job.id) });
    }
    const since = Date.now() - DAY;
    for (const job of this.recent()) {
      if (job.status === "running" || job.status === "paused" || !job.finishedAt || Date.parse(job.finishedAt) < since) continue;
      const problems = job.failed + (job.uncertain ?? 0);
      list.push({ key: "d:" + job.id, at: job.finishedAt, tone: problems ? (job.failed ? "error" : "warn") : "ok", job: undefined,
        title: job.status === "cancelled" ? "Messaggio a tutti annullato" : "Messaggio a tutti completato",
        text: [`${job.sent} inviati`, job.failed ? `${job.failed} non partiti` : "", job.uncertain ? `${job.uncertain} da verificare` : ""].filter(Boolean).join(" · "),
        open: () => this.openWhatsApp(job.id) });
    }
    for (const item of this.singles()) {
      if (item.broadcastId || Date.parse(item.createdAt) < since) continue;
      const status = sendStatus(item);
      list.push({ key: "m:" + item.id, at: item.createdAt, tone: status.tone, live: status.tone === "progress",
        title: `${item.recipientName || item.recipient || "Messaggio"} · ${status.label}`,
        text: item.problem || (item.preview ? (item.kind === "image" ? "📷 " : "") + item.preview : ""),
        open: () => this.openWhatsApp(null, item.id) });
    }
    return list.sort((a, b) => Number(!!b.live) - Number(!!a.live) || b.at.localeCompare(a.at)).slice(0, 40);
  });
  readonly liveCount = computed(() => this.notices().filter((n) => n.live && n.key !== "accounts").length);
  /** New since the panel was last opened, plus everything still in progress. */
  readonly badge = computed(() => this.notices().filter((n) => n.live || n.at > this.seen()).length);

  private get seenKey() { return `alora.notifications.seen:${this.session.currentUser()?.id ?? ""}`; }
  ngOnInit() {
    this.seen.set(localStorage.getItem(this.seenKey) ?? "");
  }
  toggle() {
    const next = !this.open();
    this.open.set(next);
    // Opening shows the latest news, without asking again within 10 seconds.
    if (next) { this.markSeen(); void this.feed.refresh(10_000).then(() => this.cdr.markForCheck()); }
  }
  go(n: Notice) { this.open.set(false); this.markSeen(); n.open(); }
  @HostListener("document:click", ["$event"]) outside(event: Event) {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
  @HostListener("document:keydown.escape") escape() { this.open.set(false); }
  private markSeen() {
    const now = new Date().toISOString();
    this.seen.set(now);
    try { localStorage.setItem(this.seenKey, now); } catch { /* private mode */ }
  }
  private openWhatsApp(broadcastId: string | null, messageId?: string) {
    void this.router.navigate(["/whatsapp"], { queryParams: broadcastId ? { invio: broadcastId } : { messaggio: messageId } });
  }
}
