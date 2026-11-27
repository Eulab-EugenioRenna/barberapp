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

  /**
   * Whether pages with an unseen guide suggest it next to «Guida» (user
   * preference). Guides never open by themselves: the name is historical.
   */
  readonly autoStart = signal(localStorage.getItem(AUTO_KEY) !== "0");

  private resolveToken = 0;
  /** Page in front of the user, as reported by the shell after navigation. */
  private readonly currentNav = signal<AdminNavKey | null>(null);
  /** Bumped when the seen map changes, since localStorage is not reactive. */
  private readonly seenRevision = signal(0);

  /**
   * Tour the «Guida» button of the current page suggests: the general tour
   * while it was never seen, then the page tour. Null when nothing to suggest.
   */
  readonly hintTour = computed<TourDefinition | null>(() => {
    const navKey = this.currentNav();
    this.seenRevision();
    if (!this.autoStart() || this.active() || !this.session.currentUser()) return null;
    const page = this.tourFor(navKey);
    // The hint lives on the page's «Guida» button: no page tour, no hint.
    if (!page) return null;
    const general = this.tourFor(null);
    if (general && !this.isSeen(general)) return general;
    return this.isSeen(page) ? null : page;
  });

  /** Page whose «Guida» button shows the hint, or null. */
  readonly hintNavKey = computed<AdminNavKey | null>(() =>
    this.hintTour() ? this.currentNav() : null,
  );

  hintFor(navKey: AdminNavKey | null): boolean {
    return navKey !== null && this.hintNavKey() === navKey;
  }

  /** «Guida» button: starts the suggested tour, otherwise the page tour. */
  startGuide(navKey: AdminNavKey | null): void {
    const hinted = this.hintFor(navKey) ? this.hintTour() : null;
    this.start(hinted ?? navKey);
  }

  /** «×» on the hint: the user knows the page, stop suggesting its guide. */
  dismissHint(navKey: AdminNavKey | null): void {
    const page = this.tourFor(navKey);
    const general = this.tourFor(null);
    if (general) this.markSeen(general);
    if (page) this.markSeen(page);
  }

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

  /**
   * Completed or skipped: either way it is no longer suggested. After the
   * general tour the page tour is only suggested (hint recomputes), never opened.
   */
  finish(): void {
    const active = this.activeState();
    if (active) this.markSeen(active.definition);
    this.resolveToken++;
    this.activeState.set(null);
    this.targetElement.set(null);
    this.resolving.set(false);
  }

  setAutoStart(enabled: boolean): void {
    this.autoStart.set(enabled);
    localStorage.setItem(AUTO_KEY, enabled ? "1" : "0");
  }

  /** Restarts every guide from scratch (e.g. from the personal account page). */
  resetSeen(): void {
    localStorage.removeItem(this.seenKey());
    this.seenRevision.update((value) => value + 1);
    this.setAutoStart(true);
  }

  /**
   * Called by the shell after each navigation. Guides never start by
   * themselves: this only records the page so `hintTour` can suggest its guide.
   * The profile may still be loading; the hint follows it reactively.
   */
  scheduleAuto(navKey: AdminNavKey | null, _attempt = 0): void {
    this.currentNav.set(navKey);
  }

  /** Kept for callers: there is no pending automatic start to cancel. */
  cancelAuto(): void {
    // Nothing scheduled any more.
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
    this.seenRevision.update((value) => value + 1);
  }
}
