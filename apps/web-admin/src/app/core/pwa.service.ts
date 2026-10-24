import { DOCUMENT } from "@angular/common";
import { Injectable, computed, inject, signal } from "@angular/core";
import { UpdateReloadQueue } from "./update-reload-queue";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const INSTALL_DISMISS_KEY = "barber.pwa-install-dismissed";
const UPDATE_CHECK_INTERVAL = 5 * 60 * 1000;
const OPEN_MODAL_SELECTOR = '[role="dialog"][aria-modal="true"]';

/**
 * PWA installabile senza cache offline: richieste sempre in rete.
 * I deploy vengono rilevati confrontando index.html; il reload attende
 * la chiusura delle modali, mentre le cache storiche vengono eliminate.
 */
@Injectable({ providedIn: "root" })
export class AdminPwaService {
  private readonly document = inject(DOCUMENT);

  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private readonly updateReloadQueue: UpdateReloadQueue | null;

  readonly installAvailable = signal(false);
  readonly installed = signal(false);
  readonly offline = signal(false);
  readonly installDismissed = signal(false);

  readonly showInstallBanner = computed(
    () =>
      this.installAvailable() && !this.installed() && !this.installDismissed(),
  );

  constructor() {
    const window = this.document.defaultView;
    if (!window) {
      this.updateReloadQueue = null;
      return;
    }

    this.updateReloadQueue = new UpdateReloadQueue({
      hasOpenModal: () =>
        Boolean(this.document.querySelector(OPEN_MODAL_SELECTOR)),
      observeModalChanges: (onChange) => {
        const observer = new window.MutationObserver(onChange);
        observer.observe(this.document.body, {
          childList: true,
          subtree: true,
        });
        return () => observer.disconnect();
      },
      beforeReload: () => this.clearCaches(),
      reload: () => window.location.reload(),
    });

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

    this.registerServiceWorker(window);
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
    if (!window || this.offline()) {
      return false;
    }

    try {
      const response = await window.fetch("./index.html", {
        cache: "no-store",
      });
      if (!response.ok) {
        return false;
      }

      const remoteId = this.buildIdFromHtml(await response.text());
      const currentId = this.currentBuildId();

      if (remoteId && currentId && remoteId !== currentId) {
        this.updateReloadQueue?.request();
        return true;
      }
    } catch {
      // Rete non disponibile: riproveremo al prossimo check.
    }

    return false;
  }

  private registerServiceWorker(window: Window): void {
    const navigator = window.navigator as Navigator & {
      serviceWorker?: ServiceWorkerContainer;
    };

    if (!navigator.serviceWorker) {
      return;
    }

    navigator.serviceWorker
      .register("service-worker.js", {
        scope: "./",
        updateViaCache: "none",
      })
      .then((registration) => registration.update().catch(() => undefined))
      .catch(() => {
        // La PWA resta comunque utilizzabile senza service worker.
      });
  }

  private async clearCaches(): Promise<void> {
    const window = this.document.defaultView;
    if (!window) return;
    try {
      const keys = await window.caches?.keys();
      await Promise.all((keys ?? []).map((key) => window.caches.delete(key)));
    } catch {
      // The worker also clears legacy caches when activated.
    }
    window.navigator.serviceWorker?.controller?.postMessage({
      type: "CLEAR_CACHES",
    });
  }

  private currentBuildId(): string {
    const sources = Array.from(this.document.querySelectorAll("script[src]"))
      .map((script) => script.getAttribute("src") || "")
      .sort();

    return this.hash(sources.join("|"));
  }

  private buildIdFromHtml(html: string): string {
    const matches = html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi);
    const sources: string[] = [];
    for (const match of matches) {
      sources.push(match[1]);
    }

    return this.hash(sources.sort().join("|"));
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
