import { DOCUMENT } from "@angular/common";
import { Injectable, computed, inject, signal } from "@angular/core";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_DISMISS_KEY = "barber.pwa-install-dismissed";
const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000;

/**
 * PWA installabile con worker per le push, senza cache o intercettazione HTTP.
 * I deploy vengono rilevati confrontando index.html: la pagina non si ricarica
 * mai da sola, mostra un avviso e aggiorna solo quando l'utente lo chiede.
 */
@Injectable({ providedIn: "root" })
export class AdminPwaService {
  private readonly document = inject(DOCUMENT);

  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private checkingUpdate = false;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private readonly updateState = signal(false);
  private reloading = false;

  readonly installAvailable = signal(false);
  readonly installed = signal(false);
  readonly offline = signal(false);
  readonly installDismissed = signal(false);
  private readonly updateDismissed = signal(false);
  /**
   * A newer build is published and the user has not put it off («Più tardi»)
   * in this session; the user decides when to load it.
   */
  readonly updateAvailable = computed(
    () => this.updateState() && !this.updateDismissed(),
  );

  readonly showInstallBanner = computed(
    () =>
      this.installAvailable() && !this.installed() && !this.installDismissed(),
  );

  constructor() {
    const window = this.document.defaultView;
    if (!window) {
      return;
    }

    this.installed.set(this.isStandalone());
    this.offline.set(!window.navigator.onLine);
    this.installDismissed.set(
      window.localStorage.getItem(INSTALL_DISMISS_KEY) === "1",
    );

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      this.installAvailable.set(true);
    });

    window.addEventListener("appinstalled", () => {
      this.deferredPrompt = null;
      this.installAvailable.set(false);
      this.installed.set(true);
    });

    window.addEventListener("online", () => this.offline.set(false));
    window.addEventListener("offline", () => this.offline.set(true));

    window
      .matchMedia("(display-mode: standalone)")
      .addEventListener?.("change", (event) => {
        this.installed.set(event.matches || this.isStandalone());
      });

    window.document.addEventListener("visibilitychange", () => {
      if (!this.document.hidden) {
        void this.checkForUpdate();
      }
    });

    void this.clearCaches();
    void this.checkForUpdate();
    this.updateTimer = setInterval(
      () => void this.checkForUpdate(),
      UPDATE_CHECK_INTERVAL,
    );
  }

  /** Apre il prompt nativo di installazione, se disponibile. */
  async promptInstall(): Promise<void> {
    const prompt = this.deferredPrompt;
    if (!prompt) {
      return;
    }

    await prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);

    if (choice?.outcome === "accepted") {
      this.installed.set(true);
    }

    this.deferredPrompt = null;
    this.installAvailable.set(false);
    this.dismissInstall();
  }

  dismissInstall(): void {
    this.installDismissed.set(true);
    this.document.defaultView?.localStorage.setItem(INSTALL_DISMISS_KEY, "1");
  }

  /**
   * Confronta il build in esecuzione con `index.html` remoto. Se differiscono
   * significa che e stato pubblicato un nuovo deploy.
   */
  async checkForUpdate(): Promise<boolean> {
    const window = this.document.defaultView;
    if (
      !window ||
      this.offline() ||
      this.document.hidden ||
      this.checkingUpdate ||
      this.updateState()
    ) {
      return false;
    }

    this.checkingUpdate = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await window.fetch("./index.html", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        return false;
      }

      const remoteId = this.buildIdFromHtml(await response.text());
      const currentId = this.currentBuildId();

      if (remoteId && currentId && remoteId !== currentId) {
        this.updateState.set(true);
        return true;
      }
    } catch {
      // Rete non disponibile: riproveremo al prossimo check.
    } finally {
      clearTimeout(timer);
      this.checkingUpdate = false;
    }

    return false;
  }

  /** Hides the update notice until the next page load. */
  dismissUpdate(): void {
    this.updateDismissed.set(true);
  }

  /** Loads the new build: clears old caches, then reloads. Only on user request. */
  async applyUpdate(): Promise<void> {
    const window = this.document.defaultView;
    if (!window || this.reloading) return;
    this.reloading = true;
    await this.clearCaches();
    window.location.reload();
  }

  private async clearCaches(): Promise<void> {
    const window = this.document.defaultView;
    if (!window) return;
    try {
      const keys = await window.caches?.keys();
      await Promise.all((keys ?? []).map((key) => window.caches.delete(key)));
    } catch {
      // HTTP responses remain no-store even when browser storage is unavailable.
    }
    window.navigator.serviceWorker?.controller?.postMessage({
      type: "CLEAR_CACHES",
    });
  }

  private currentBuildId(): string {
    const sources = Array.from(this.document.querySelectorAll("script[src]"))
      .map((script) => script.getAttribute("src") || "")
      .sort();

    return sources.length ? this.hash(sources.join("|")) : "";
  }

  private buildIdFromHtml(html: string): string {
    const matches = html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi);
    const sources: string[] = [];
    for (const match of matches) {
      sources.push(match[1]);
    }

    return sources.length ? this.hash(sources.sort().join("|")) : "";
  }

  private hash(value: string): string {
    let hash = 5381;
    for (let index = 0; index < value.length; index += 1) {
      hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0;
    }
    return hash.toString(36);
  }

  private isStandalone(): boolean {
    const window = this.document.defaultView;
    if (!window) {
      return false;
    }

    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true
    );
  }
}
