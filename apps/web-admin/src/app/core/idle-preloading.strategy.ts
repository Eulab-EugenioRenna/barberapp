import { Injectable } from "@angular/core";
import type { PreloadingStrategy, Route } from "@angular/router";
import { EMPTY, Observable, switchMap } from "rxjs";

/** Wait after the first render before even asking the browser for idle time. */
const FIRST_RENDER_DELAY_MS = 2000;
/** Upper bound for requestIdleCallback, so preloading eventually happens. */
const IDLE_TIMEOUT_MS = 5000;

type NetworkInformationLike = { saveData?: boolean; effectiveType?: string };
type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** True on data saver or 2G: those users download a page only when they open it. */
export function isSlowConnection(nav: Navigator | undefined = globalThis.navigator): boolean {
  const connection = (nav as (Navigator & { connection?: NetworkInformationLike }) | undefined)
    ?.connection;
  if (!connection) return false;
  if (connection.saveData) return true;
  return connection.effectiveType === "2g" || connection.effectiveType === "slow-2g";
}

/**
 * Preloads only routes marked `data: { preload: true }`, once the browser is
 * idle about two seconds after the first render, and never on slow or
 * data-saving connections. Other routes load when they are opened.
 */
@Injectable({ providedIn: "root" })
export class IdlePreloadingStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    if (route.data?.["preload"] !== true || isSlowConnection()) return EMPTY;
    return this.whenIdle().pipe(
      switchMap(() => (isSlowConnection() ? EMPTY : load())),
    );
  }

  /** Emits once the delay has passed and the browser reports idle time. */
  private whenIdle(): Observable<void> {
    return new Observable<void>((subscriber) => {
      const win = (typeof window === "undefined" ? undefined : window) as IdleWindow | undefined;
      let idleHandle: number | null = null;
      let fallback: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        subscriber.next();
        subscriber.complete();
      };
      const delay = setTimeout(() => {
        if (win?.requestIdleCallback) {
          idleHandle = win.requestIdleCallback(done, { timeout: IDLE_TIMEOUT_MS });
        } else {
          fallback = setTimeout(done, 0);
        }
      }, FIRST_RENDER_DELAY_MS);
      return () => {
        clearTimeout(delay);
        if (fallback) clearTimeout(fallback);
        if (idleHandle !== null) win?.cancelIdleCallback?.(idleHandle);
      };
    });
  }
}
