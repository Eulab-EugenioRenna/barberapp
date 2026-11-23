import { Injectable, computed, inject, signal } from "@angular/core";
import { UiBreakpointService } from "@alora/ui";
import { canAccessLocalView, canUseLocalFunction } from "@barber/shared/functions";
import type { AdminNavKey } from "../admin-navigation";
import { AdminFacade } from "../admin.facade";
import { SessionStore } from "../session.store";
import { ADMIN_TOURS } from "./tours";
import {
  resolveDynamic,
  type ResolvedTourStep,
  type TourContext,
  type TourDefinition,
} from "./tour.types";

const SEEN_KEY = "alora.tours.seen";
const AUTO_KEY = "alora.tours.auto";
/** How long a step waits for its element (lists and panels load async). */
const TARGET_WAIT_MS = 1500;

interface ActiveTour {
  definition: TourDefinition;
  steps: readonly ResolvedTourStep[];
}

/**
 * Step-by-step guide: highlights one control at a time and explains it.
 * Tours are personalised per account: steps the user cannot use (role,
 * plan functions, missing data) are filtered out before they are shown.
 */
@Injectable({ providedIn: "root" })
export class TourService {
  private readonly session = inject(SessionStore);
  private readonly facade = inject(AdminFacade);
  private readonly breakpoints = inject(UiBreakpointService);

  private readonly activeState = signal<ActiveTour | null>(null);
  private readonly indexState = signal(0);
  /** Element highlighted by the current step; null for centred steps. */
  readonly targetElement = signal<HTMLElement | null>(null);
  /** True while looking for the element of the next step. */
  readonly resolving = signal(false);

  readonly active = computed(() => this.activeState() !== null);
  readonly title = computed(() => this.activeState()?.definition.title ?? "");
  readonly index = this.indexState.asReadonly();
  readonly total = computed(() => this.activeState()?.steps.length ?? 0);
  readonly step = computed(() => this.activeState()?.steps[this.indexState()] ?? null);
  readonly isLast = computed(() => this.indexState() >= this.total() - 1);

  /** Whether tours start by themselves on first visit (user preference). */
  readonly autoStart = signal(localStorage.getItem(AUTO_KEY) !== "0");

  private resolveToken = 0;
  private currentNavKey: AdminNavKey | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | null = null;

  context(): TourContext {
    const user = this.session.currentUser();
    const fullName: string = user?.firstName || user?.name || user?.displayName || "";
    return {
      user,
      role: user?.role ?? "",
      firstName: String(fullName).trim().split(/\s+/)[0] ?? "",
      tenant: this.facade.tenant(),
      can: (key) => canUseLocalFunction(user, key),
      canView: (view) => canAccessLocalView(user, view),
      isMobile: this.breakpoints.isMobile(),
    };
  }

  /** Tour of a page, if one exists and applies to this account. */
  tourFor(navKey: AdminNavKey | null): TourDefinition | null {
    const ctx = this.context();
    return (
      ADMIN_TOURS.find(
        (tour) => tour.navKey === navKey && (!tour.when || tour.when(ctx)),
      ) ?? null
    );
  }

  hasTour(navKey: AdminNavKey | null): boolean {
    return this.tourFor(navKey) !== null;
  }

  start(tourOrNavKey: TourDefinition | AdminNavKey | null): void {
    const definition =
      tourOrNavKey && typeof tourOrNavKey === "object"
        ? tourOrNavKey
        : this.tourFor(tourOrNavKey);
    if (!definition) return;
    this.cancelAuto();
    const ctx = this.context();
    const steps = definition
      .steps(ctx)
      .filter((step) => !step.when || step.when(ctx))
      .map<ResolvedTourStep>((step) => {
        const targets = step.target ? ([] as string[]).concat(step.target as string | string[]) : [];
        // A step on a tab button opens that tab, so its content shows below.
        const tabTarget = targets.find((target) => target.startsWith("tab-"));
        return {
          targets,
          tab: step.tab ?? (tabTarget ? tabTarget.slice(4) : null),
          title: resolveDynamic(step.title, ctx) ?? "",
          body: resolveDynamic(step.body, ctx) ?? "",
          fallback: resolveDynamic(step.fallback, ctx) ?? "",
        };
      });
    if (!steps.length) return;
    this.activeState.set({ definition, steps });
    void this.goTo(0, 1);
  }

  next(): void {
    if (this.isLast()) {
      this.finish();
      return;
    }
    void this.goTo(this.indexState() + 1, 1);
  }

  previous(): void {
    if (this.indexState() > 0) void this.goTo(this.indexState() - 1, -1);
  }

  /** Completed or skipped: either way it will not start by itself again. */
  finish(): void {
    const active = this.activeState();
    if (active) this.markSeen(active.definition);
    this.resolveToken++;
    this.activeState.set(null);
    this.targetElement.set(null);
    this.resolving.set(false);
    // After the general tour, continue with the guide of the page in front of the user.
    if (active && active.definition.navKey === null) this.scheduleAuto(this.currentNavKey);
  }

  setAutoStart(enabled: boolean): void {
    this.autoStart.set(enabled);
    localStorage.setItem(AUTO_KEY, enabled ? "1" : "0");
  }

  /** Restarts every guide from scratch (e.g. from the personal account page). */
  resetSeen(): void {
    localStorage.removeItem(this.seenKey());
    this.setAutoStart(true);
  }

  /**
   * First visit of a page: the general tour comes first, then the page tour.
   * Called by the shell after each navigation.
   */
  scheduleAuto(navKey: AdminNavKey | null, attempt = 0): void {
    this.cancelAuto();
    this.currentNavKey = navKey;
    if (!this.autoStart()) return;
    // Let the page render and load its data before measuring anything.
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      if (this.active()) return;
      // The profile may still be loading: tours depend on it, so wait for it.
      if (!this.session.currentUser()) {
        if (attempt < 8) this.scheduleAuto(navKey, attempt + 1);
        return;
      }
      const general = this.tourFor(null);
      if (general && !this.isSeen(general)) {
        this.start(general);
        return;
      }
      const page = this.tourFor(navKey);
      if (page && !this.isSeen(page)) this.start(page);
    }, 900);
  }

  cancelAuto(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
  }

  private async goTo(index: number, direction: 1 | -1): Promise<void> {
    const active = this.activeState();
    if (!active) return;
    const token = ++this.resolveToken;
    this.resolving.set(true);
    let cursor = index;
    while (cursor >= 0 && cursor < active.steps.length) {
      const step = active.steps[cursor];
      if (step.tab) await this.openTab(step.tab, token);
      if (token !== this.resolveToken) return;
      const element = step.targets.length ? await this.findTarget(step.targets, token) : null;
      if (token !== this.resolveToken) return;
      // Missing element and nothing to say about it: this account cannot use it.
      if (step.targets.length && !element && !step.fallback) {
        cursor += direction;
        continue;
      }
      element?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      this.indexState.set(cursor);
      this.targetElement.set(element);
      this.resolving.set(false);
      return;
    }
    this.resolving.set(false);
    // Ran out of steps going forward: tour done. Going back: stay where we were.
    if (direction === 1) this.finish();
  }

  /** Switches the page to the tab a step lives in, as if the user clicked it. */
  private async openTab(key: string, token: number): Promise<void> {
    const button = await this.findTarget([`tab-${key}`], token, 600);
    if (!button || button.getAttribute("aria-selected") === "true") return;
    button.click();
    // Let the page render the panel before its elements are measured.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  private async findTarget(
    targets: readonly string[],
    token: number,
    waitMs = TARGET_WAIT_MS,
  ): Promise<HTMLElement | null> {
    const deadline = Date.now() + waitMs;
    while (token === this.resolveToken) {
      for (const target of targets) {
        const element = this.visibleElement(target);
        if (element) return element;
      }
      if (Date.now() > deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  }

  private visibleElement(target: string): HTMLElement | null {
    const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(target)}"]`);
    for (const node of Array.from(nodes)) {
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      // Off-canvas (closed mobile drawer) counts as hidden; below the fold does not.
      if (rect.right <= 0 || rect.left >= window.innerWidth) continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none") continue;
      return node;
    }
    return null;
  }

  private seenKey(): string {
    const user = this.session.currentUser();
    return `${SEEN_KEY}.${user?.id ?? user?.email ?? "anon"}`;
  }

  private seenMap(): Record<string, number> {
    try {
      return JSON.parse(localStorage.getItem(this.seenKey()) ?? "{}") ?? {};
    } catch {
      return {};
    }
  }

  isSeen(definition: TourDefinition): boolean {
    return (this.seenMap()[definition.id] ?? 0) >= definition.version;
  }

  private markSeen(definition: TourDefinition): void {
    const map = this.seenMap();
    map[definition.id] = definition.version;
    localStorage.setItem(this.seenKey(), JSON.stringify(map));
  }
}
