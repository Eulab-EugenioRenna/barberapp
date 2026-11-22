import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  signal,
} from "@angular/core";
import { UiIconComponent } from "@alora/ui";
import { TourService } from "../core/onboarding/tour.service";

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const GAP = 14;
const CARD_WIDTH = 340;

/**
 * Renders the active guide: a dimmed page with a hole around the highlighted
 * control and a card explaining it. Clicks outside the card are swallowed so
 * the user reads the step instead of leaving the page mid-tour.
 */
@Component({
  selector: "alora-tour-overlay",
  standalone: true,
  imports: [CommonModule, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-container *ngIf="tour.active() && tour.step() as step">
    <div class="tour-blocker" (click)="$event.stopPropagation()"></div>
    <div
      class="tour-spot"
      [class.tour-spot-none]="!spot()"
      [style.top.px]="spot()?.top"
      [style.left.px]="spot()?.left"
      [style.width.px]="spot()?.width"
      [style.height.px]="spot()?.height"
    ></div>
    <section
      #card
      class="tour-card"
      [class.tour-card-center]="!spot()"
      [class.tour-card-sheet]="sheet()"
      [style.top.px]="sheet() || !spot() ? null : cardPos().top"
      [style.left.px]="sheet() || !spot() ? null : cardPos().left"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="'tour-title'"
      [attr.aria-describedby]="'tour-body'"
      tabindex="-1"
    >
      <header class="tour-head">
        <p class="tour-eyebrow">
          {{ tour.title() }} · {{ tour.index() + 1 }} di {{ tour.total() }}
        </p>
        <button type="button" class="tour-close" aria-label="Chiudi guida" (click)="tour.finish()">
          <ui-icon name="close"></ui-icon>
        </button>
      </header>
      <h2 id="tour-title" class="tour-title">{{ step.title }}</h2>
      <p id="tour-body" class="tour-body" aria-live="polite">
        {{ spot() || !step.fallback ? step.body : step.fallback }}
      </p>
      <div class="tour-progress" aria-hidden="true">
        <span
          *ngFor="let dot of dots(); let i = index"
          class="tour-dot"
          [class.tour-dot-on]="i === tour.index()"
        ></span>
      </div>
      <footer class="tour-actions">
        <button type="button" class="tour-skip" (click)="tour.finish()">
          {{ tour.isLast() ? "Chiudi" : "Salta guida" }}
        </button>
        <span class="tour-spacer"></span>
        <button
          *ngIf="tour.index() > 0"
          type="button"
          class="ghost-btn tour-btn"
          [disabled]="tour.resolving()"
          (click)="tour.previous()"
        >
          Indietro
        </button>
        <button
          type="button"
          class="primary-btn tour-btn"
          [disabled]="tour.resolving()"
          (click)="tour.next()"
        >
          {{ tour.isLast() ? "Fine" : "Avanti" }}
        </button>
      </footer>
      <label *ngIf="tour.isLast()" class="tour-auto">
        <input
          type="checkbox"
          [checked]="!tour.autoStart()"
          (change)="tour.setAutoStart(!$any($event.target).checked)"
        />
        Non aprire più le guide da sole (restano sul pulsante «Guida»)
      </label>
    </section>
  </ng-container>`,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 2000;
        pointer-events: none;
      }
      .tour-blocker {
        position: fixed;
        inset: 0;
        pointer-events: auto;
      }
      .tour-spot {
        position: fixed;
        border-radius: 1rem;
        box-shadow:
          0 0 0 0.2rem var(--alora-lime, #c8f169),
          0 0 0 100vmax rgba(10, 20, 14, 0.58);
        transition:
          top 0.25s ease,
          left 0.25s ease,
          width 0.25s ease,
          height 0.25s ease;
        pointer-events: none;
      }
      .tour-spot-none {
        top: 50%;
        left: 50%;
        width: 0;
        height: 0;
        box-shadow: 0 0 0 100vmax rgba(10, 20, 14, 0.58);
      }
      .tour-card {
        position: fixed;
        width: min(${CARD_WIDTH}px, calc(100vw - 1.5rem));
        display: grid;
        gap: 0.6rem;
        border: 0.0625rem solid var(--line);
        border-radius: 1.25rem;
        background: var(--panel, #fff);
        color: var(--ink);
        box-shadow: 0 1.5rem 4rem rgba(10, 20, 14, 0.3);
        padding: 1rem 1.1rem;
        pointer-events: auto;
        transition:
          top 0.25s ease,
          left 0.25s ease;
        outline: none;
      }
      .tour-card-center {
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(26rem, calc(100vw - 1.5rem));
      }
      .tour-card-sheet {
        top: auto;
        left: 0.75rem;
        right: 0.75rem;
        bottom: calc(0.75rem + env(safe-area-inset-bottom));
        width: auto;
        transform: none;
      }
      .tour-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .tour-eyebrow {
        margin: 0;
        color: var(--muted, #5b6b60);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .tour-close {
        display: inline-grid;
        place-items: center;
        width: 2rem;
        height: 2rem;
        border: 0;
        border-radius: 999rem;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .tour-close:hover {
        background: rgba(30, 52, 37, 0.06);
      }
      .tour-title {
        margin: 0;
        font-family: var(--font-display);
        font-size: 1.15rem;
        font-weight: 600;
        line-height: 1.25;
      }
      .tour-body {
        margin: 0;
        font-size: 0.93rem;
        line-height: 1.5;
        white-space: pre-line;
      }
      .tour-progress {
        display: flex;
        flex-wrap: wrap;
        gap: 0.3rem;
      }
      .tour-dot {
        width: 0.4rem;
        height: 0.4rem;
        border-radius: 999rem;
        background: rgba(30, 52, 37, 0.18);
      }
      .tour-dot-on {
        width: 1.1rem;
        background: var(--alora-forest, #1e3425);
      }
      .tour-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .tour-spacer {
        flex: 1;
      }
      .tour-skip {
        border: 0;
        background: transparent;
        color: var(--muted, #5b6b60);
        font-weight: 700;
        cursor: pointer;
        padding: 0.5rem 0;
      }
      .tour-btn {
        min-height: 2.5rem;
        padding: 0.6rem 1rem;
      }
      .tour-auto {
        display: flex;
        gap: 0.5rem;
        align-items: flex-start;
        font-size: 0.8rem;
        color: var(--muted, #5b6b60);
      }
      @media (prefers-reduced-motion: reduce) {
        .tour-spot,
        .tour-card {
          transition: none;
        }
      }
    `,
  ],
})
export class TourOverlayComponent implements OnDestroy {
  readonly tour = inject(TourService);
  private readonly zone = inject(NgZone);

  @ViewChild("card") private cardRef?: ElementRef<HTMLElement>;

  readonly spot = signal<Box | null>(null);
  readonly cardPos = signal({ top: 0, left: 0 });
  readonly sheet = signal(false);
  readonly dots = () => Array.from({ length: this.tour.total() });

  private frame = 0;
  private lastFocus: HTMLElement | null = null;

  constructor() {
    effect(
      () => {
        const active = this.tour.active();
        this.tour.index();
        if (active) {
          if (!this.lastFocus) this.lastFocus = document.activeElement as HTMLElement | null;
          this.startTracking();
          // Move focus into the card so keyboard and screen readers follow.
          queueMicrotask(() => this.cardRef?.nativeElement.focus({ preventScroll: true }));
        } else {
          this.stopTracking();
          this.lastFocus?.focus?.({ preventScroll: true });
          this.lastFocus = null;
        }
      },
      { allowSignalWrites: true },
    );
  }

  ngOnDestroy(): void {
    this.stopTracking();
  }

  @HostListener("document:keydown", ["$event"])
  onKey(event: KeyboardEvent): void {
    if (!this.tour.active()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.tour.finish();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (!this.tour.resolving()) this.tour.next();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (!this.tour.resolving()) this.tour.previous();
    }
  }

  /** Follows the target through scrolling, resizing and late layout shifts. */
  private startTracking(): void {
    if (this.frame) return;
    this.zone.runOutsideAngular(() => {
      const tick = () => {
        this.measure();
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    });
  }

  private stopTracking(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private measure(): void {
    const element = this.tour.targetElement();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const sheet = vw < 640;
    if (this.sheet() !== sheet) this.zone.run(() => this.sheet.set(sheet));
    if (!element || !element.isConnected) {
      if (this.spot()) this.zone.run(() => this.spot.set(null));
      return;
    }
    const rect = element.getBoundingClientRect();
    const box: Box = {
      top: Math.round(rect.top - PAD),
      left: Math.round(rect.left - PAD),
      width: Math.round(rect.width + PAD * 2),
      height: Math.round(rect.height + PAD * 2),
    };
    const card = this.cardRef?.nativeElement;
    const cardW = card?.offsetWidth ?? CARD_WIDTH;
    const cardH = card?.offsetHeight ?? 200;
    let top: number;
    let left: number;
    if (box.top + box.height + GAP + cardH <= vh - 8) {
      top = box.top + box.height + GAP; // below
      left = box.left;
    } else if (box.top - GAP - cardH >= 8) {
      top = box.top - GAP - cardH; // above
      left = box.left;
    } else if (box.left + box.width + GAP + cardW <= vw - 8) {
      top = box.top; // right (tall targets such as the sidebar)
      left = box.left + box.width + GAP;
    } else {
      top = vh - cardH - 12;
      left = box.left;
    }
    left = Math.min(Math.max(8, left), vw - cardW - 8);
    top = Math.min(Math.max(8, top), vh - cardH - 8);
    const current = this.spot();
    const pos = this.cardPos();
    const changed =
      !current ||
      current.top !== box.top ||
      current.left !== box.left ||
      current.width !== box.width ||
      current.height !== box.height ||
      pos.top !== Math.round(top) ||
      pos.left !== Math.round(left);
    if (changed) {
      this.zone.run(() => {
        this.spot.set(box);
        this.cardPos.set({ top: Math.round(top), left: Math.round(left) });
      });
    }
  }
}
