import {
  ApplicationRef,
  EmbeddedViewRef,
  NgZone,
  TemplateRef,
} from "@angular/core";
import { UI_BREAKPOINTS } from "../layout/ui-breakpoint.service";

const THEME_TOKENS = [
  "--accent", "--accent-rgb", "--focus", "--ink", "--muted", "--line", "--panel",
  "--brand", "--font-body", "--alora-lime", "--alora-forest",
];

/**
 * Renders a template directly under <body> so suggestions are never clipped
 * by scrolling or `overflow: hidden` containers, and keeps it attached to its
 * anchor while any ancestor scrolls or the window resizes.
 *
 * Mobile (< tablet breakpoint): the panel docks to the bottom as a sheet.
 * Tablet+: anchored below the trigger, flipped above when there is no room.
 */
export class UiBodyPopover {
  private view?: EmbeddedViewRef<unknown>;
  private element?: HTMLElement;
  private readonly reposition = () => this.position();
  private readonly outside = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (!target) return;
    if (this.anchor().contains(target) || this.element?.contains(target)) return;
    this.zone.run(() => this.onOutside());
  };

  constructor(
    private readonly document: Document,
    private readonly appRef: ApplicationRef,
    private readonly zone: NgZone,
    private readonly anchor: () => HTMLElement,
    private readonly onOutside: () => void,
  ) {}

  get isOpen(): boolean {
    return !!this.view;
  }

  get panel(): HTMLElement | undefined {
    return this.element;
  }

  open(template: TemplateRef<unknown>): void {
    if (this.view) return;
    this.view = template.createEmbeddedView({});
    this.appRef.attachView(this.view);
    this.view.detectChanges();
    this.element = this.view.rootNodes.find(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    if (!this.element) return this.close();
    this.document.body.appendChild(this.element);
    this.inheritTheme(this.element);
    this.position();
    this.zone.runOutsideAngular(() => {
      // Capture: scrolling any container (e.g. the shell main) moves the anchor.
      this.document.addEventListener("scroll", this.reposition, true);
      this.document.defaultView?.addEventListener("resize", this.reposition);
      this.document.addEventListener("pointerdown", this.outside, true);
    });
  }

  close(): void {
    this.document.removeEventListener("scroll", this.reposition, true);
    this.document.defaultView?.removeEventListener("resize", this.reposition);
    this.document.removeEventListener("pointerdown", this.outside, true);
    if (!this.view) return;
    this.appRef.detachView(this.view);
    this.view.destroy();
    this.view = undefined;
    this.element = undefined;
  }

  /**
   * Under <body> the panel would lose themes set on an ancestor of the field
   * (e.g. the tenant accent of the public booking): copy the brand tokens.
   */
  private inheritTheme(panel: HTMLElement): void {
    const win = this.document.defaultView;
    if (!win) return;
    const style = win.getComputedStyle(this.anchor());
    for (const token of THEME_TOKENS) {
      const value = style.getPropertyValue(token).trim();
      if (value) panel.style.setProperty(token, value);
    }
  }

  position(): void {
    const panel = this.element;
    const win = this.document.defaultView;
    if (!panel || !win) return;
    const sheet = !win.matchMedia(`(min-width: ${UI_BREAKPOINTS.tablet})`).matches;
    panel.classList.toggle("ui-pop-sheet", sheet);
    if (sheet) {
      Object.assign(panel.style, { top: "", left: "", width: "", maxHeight: "" });
      return;
    }
    const rect = this.anchor().getBoundingClientRect();
    const gap = 6;
    const pad = 8;
    const width = Math.min(Math.max(rect.width, 224), win.innerWidth - pad * 2);
    const left = Math.max(pad, Math.min(rect.left, win.innerWidth - width - pad));
    const below = win.innerHeight - rect.bottom - gap - pad;
    const above = rect.top - gap - pad;
    const natural = Math.min(panel.scrollHeight, 320);
    const placeBelow = below >= natural || below >= above;
    const maxHeight = Math.max(120, Math.min(320, placeBelow ? below : above));
    const height = Math.min(natural, maxHeight);
    const top = placeBelow ? rect.bottom + gap : rect.top - gap - height;
    Object.assign(panel.style, {
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      width: `${Math.round(width)}px`,
      maxHeight: `${Math.round(maxHeight)}px`,
    });
  }
}
