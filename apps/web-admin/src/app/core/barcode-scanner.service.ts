import { Injectable } from "@angular/core";

export interface BarcodeScanEvent {
  barcode: string;
  source: "scanner" | "manual";
  timestamp: number;
}
export interface BarcodeScannerOptions {
  scanThresholdMs?: number;
  terminatorKey?: string;
  soundEnabled?: boolean;
  vibrationEnabled?: boolean;
}
type ScanHandler = (event: BarcodeScanEvent) => void | Promise<void>;
const DEFAULT_OPTIONS: Required<BarcodeScannerOptions> = {
  scanThresholdMs: 100,
  terminatorKey: "Enter",
  soundEnabled: false,
  vibrationEnabled: false,
};

/** Document-level keyboard wedge; editable fields retain their normal input.
 * Only the foreground attachment receives scans. Async lookups run in FIFO order.
 * The persistent hidden input is never focused; attaching cannot steal focus.
 */
@Injectable({ providedIn: "root" })
export class BarcodeScannerService {
  private options = { ...DEFAULT_OPTIONS };
  private buffer = "";
  private lastKeyTime = 0;
  private pending: Array<{ event: BarcodeScanEvent; handler: ScanHandler }> =
    [];
  private processing = false;
  private hiddenInput: HTMLInputElement | null = null;
  private handlers: ScanHandler[] = [];

  private readonly keydown = (event: KeyboardEvent) => {
    const active = document.activeElement as HTMLElement | null;
    const target = event.target as HTMLElement | null;
    if (
      [active, target].some(
        (element) =>
          element &&
          (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) ||
            element.isContentEditable),
      ) ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing ||
      event.repeat
    ) {
      this.reset();
      return;
    }
    const now = performance.now();
    if (this.buffer && now - this.lastKeyTime > this.options.scanThresholdMs)
      this.reset();
    if (event.key === this.options.terminatorKey) {
      if (this.buffer.length >= 3) {
        event.preventDefault();
        event.stopPropagation();
        this.enqueue(this.buffer, "scanner");
      }
      this.reset();
      return;
    }
    if (event.key === "Shift") return;
    if (event.key.length !== 1 || /[\s\x00-\x1f\x7f]/.test(event.key)) {
      this.reset();
      return;
    }
    this.lastKeyTime = now;
    this.buffer += event.key;
  };

  private reset(): void {
    this.buffer = "";
    this.lastKeyTime = 0;
  }

  private enqueue(barcode: string, source: BarcodeScanEvent["source"]): void {
    const handler = this.handlers[this.handlers.length - 1];
    if (!handler || !barcode) return;
    this.pending.push({
      event: { barcode, source, timestamp: Date.now() },
      handler,
    });
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.pending.length) {
        const next = this.pending.shift()!;
        if (!this.handlers.includes(next.handler)) continue;
        try {
          await next.handler(next.event);
          this.feedback();
        } catch {
          // A failed consumer must not strand subsequent scans. UI reports lookup errors.
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private feedback(): void {
    try {
      if (this.options.vibrationEnabled && navigator.vibrate)
        navigator.vibrate(50);
      if (this.options.soundEnabled) {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.onended = () => {
          void ctx.close();
        };
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      }
    } catch {
      // Optional feedback may be unavailable or blocked by browser policy.
    }
  }

  setOptions(options: BarcodeScannerOptions): void {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  attach(onScan: ScanHandler, _host?: HTMLElement): () => void {
    this.handlers.push(onScan);
    this.reset();
    if (!this.hiddenInput) {
      const input = document.createElement("input");
      input.type = "text";
      input.style.position = "fixed";
      input.style.left = "-1000px";
      input.style.opacity = "0";
      input.style.pointerEvents = "none";
      input.setAttribute("aria-hidden", "true");
      input.tabIndex = -1;
      document.body.appendChild(input);
      this.hiddenInput = input;
      document.addEventListener("keydown", this.keydown, true);
    }
    return () => {
      this.handlers = this.handlers.filter((handler) => handler !== onScan);
      this.pending = this.pending.filter((entry) => entry.handler !== onScan);
      this.reset();
      if (!this.handlers.length) {
        document.removeEventListener("keydown", this.keydown, true);
        this.hiddenInput?.remove();
        this.hiddenInput = null;
      }
    };
  }

  inject(barcode: string): void {
    this.enqueue(barcode.trim().replace(/\s+/g, ""), "manual");
  }
  flushPending(): void {
    void this.flush();
  }
  get isScanning(): boolean {
    return this.buffer.length > 0;
  }
}
