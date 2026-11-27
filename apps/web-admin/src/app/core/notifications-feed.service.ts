import { Injectable, inject, signal } from "@angular/core";
import type { WhatsAppBroadcastView, WhatsAppOutboxView } from "@barber/shared/whatsapp";
import { SessionStore } from "./session.store";
import { WhatsAppApiService } from "./whatsapp-api.service";
import { sendStatus } from "./whatsapp-send-status";

/** Calm pace; fast only while a «Messaggio a tutti» or a message is really being sent. */
export const FEED_IDLE_MS = 60_000;
export const FEED_SENDING_MS = 5_000;

/** Next poll delay for what is on its way now. */
export function feedDelay(active: readonly WhatsAppBroadcastView[], singles: readonly WhatsAppOutboxView[]): number {
  const sending =
    active.some((job) => job.status === "running" || (job.sending ?? 0) > 0) ||
    singles.some((item) => sendStatus(item).tone === "progress");
  return sending ? FEED_SENDING_MS : FEED_IDLE_MS;
}

/**
 * WhatsApp sends for the notifications bell and the «Invii» tab: one poll for
 * the whole app (started by the shell), one request per poll.
 */
@Injectable({ providedIn: "root" })
export class NotificationsFeedService {
  private readonly session = inject(SessionStore);
  private readonly api = inject(WhatsAppApiService);
  readonly active = signal<WhatsAppBroadcastView[]>([]);
  readonly recent = signal<WhatsAppBroadcastView[]>([]);
  readonly singles = signal<WhatsAppOutboxView[]>([]);
  readonly unavailable = signal(false);
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private inFlight: Promise<void> | null = null;
  private loadedAt = 0;
  private readonly onVisible = () => {
    if (!document.hidden && Date.now() - this.loadedAt >= FEED_IDLE_MS) void this.refresh();
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener("visibilitychange", this.onVisible);
    void this.refresh();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    document.removeEventListener("visibilitychange", this.onVisible);
    this.active.set([]); this.recent.set([]); this.singles.set([]);
    this.loadedAt = 0;
  }

  /** Fresh data now, unless a poll answered less than `maxAgeMs` ago. */
  refresh(maxAgeMs = 0): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (maxAgeMs && Date.now() - this.loadedAt < maxAgeMs) return Promise.resolve();
    this.inFlight = this.poll().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async poll(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    if (!document.hidden && this.session.can("whatsapp.read")) {
      try {
        if (this.session.can("whatsapp.send")) {
          const feed = await this.api.notifications();
          this.active.set(feed.active); this.recent.set(feed.recent); this.singles.set(feed.outbox);
        } else {
          // Read-only accounts have no «Messaggio a tutti»: only the single messages.
          this.singles.set(await this.api.outbox());
        }
        this.unavailable.set(false);
        this.loadedAt = Date.now();
      } catch {
        this.unavailable.set(true);
      }
    }
    if (this.running)
      this.timer = setTimeout(() => void this.refresh(), feedDelay(this.active(), this.singles()));
  }
}
