import { Injectable, OnDestroy, computed, signal } from "@angular/core";

/**
 * Breakpoints of the design system (mobile first). Media queries in component
 * styles must use the same values:
 *   mobile   < 48rem            (base styles, no media query)
 *   tablet   >= 48rem           @media (min-width: 48rem)
 *   desktop  >= 64rem           @media (min-width: 64rem)
 */
export const UI_BREAKPOINTS = { tablet: "48rem", desktop: "64rem" } as const;

export type UiViewport = "mobile" | "tablet" | "desktop";

@Injectable({ providedIn: "root" })
export class UiBreakpointService implements OnDestroy {
  private readonly tabletQuery = this.query(UI_BREAKPOINTS.tablet);
  private readonly desktopQuery = this.query(UI_BREAKPOINTS.desktop);
  private readonly state = signal<UiViewport>(this.read());
  private readonly listener = () => this.state.set(this.read());

  readonly viewport = this.state.asReadonly();
  readonly isMobile = computed(() => this.state() === "mobile");
  readonly isTablet = computed(() => this.state() === "tablet");
  readonly isDesktop = computed(() => this.state() === "desktop");

  constructor() {
    this.tabletQuery?.addEventListener("change", this.listener);
    this.desktopQuery?.addEventListener("change", this.listener);
  }

  ngOnDestroy(): void {
    this.tabletQuery?.removeEventListener("change", this.listener);
    this.desktopQuery?.removeEventListener("change", this.listener);
  }

  private query(minWidth: string): MediaQueryList | null {
    return typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(`(min-width: ${minWidth})`)
      : null;
  }

  private read(): UiViewport {
    if (this.desktopQuery?.matches) return "desktop";
    if (this.tabletQuery?.matches) return "tablet";
    return "mobile";
  }
}
