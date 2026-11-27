import { CommonModule } from "@angular/common";
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  ViewEncapsulation,
} from "@angular/core";
import {
  isTopLayer,
  nextLayerId,
  popLayer,
  prefersReducedMotion,
  pushLayer,
} from "./ui-sheet-stack";

export type UiSheetSize = "lg" | "md" | "sm";

/**
 * The one sheet of the app, modelled on the till ("cassa"): blurred
 * backdrop, big title + subtitle, scrolling body, dark bottom bar with the
 * single primary action. Styles live in `ui-sheet.css` (global) so the
 * projected content can use the shared utilities (`ui-steps`, `touch-grid`,
 * `touch-card`, `ui-sheet-col`, ...).
 *
 * Slots:
 * - default: body. With `split` the body is two columns (`ui-sheet-col`),
 *   each scrolling on its own; on a phone everything flows in one column.
 * - `[uiSheetHead]`: extra header actions, beside «Chiudi».
 * - `[uiSheetBar]`: the fixed bottom bar (hidden when empty).
 *
 * Sizes: `lg` = the till (up to 1180×780), `md` = forms (up to 880 wide,
 * grows with content), `sm` = small quick forms.
 */
@Component({
  selector: "ui-sheet",
  standalone: true,
  imports: [CommonModule],
  encapsulation: ViewEncapsulation.None,
  template: `<div
    class="ui-sheet-overlay"
    [class.ui-sheet-closing]="closing"
    [style.z-index]="layer"
    role="dialog"
    aria-modal="true"
    [attr.aria-labelledby]="titleId"
    [attr.aria-busy]="busy || null"
  >
    <button
      type="button"
      class="ui-sheet-backdrop"
      [attr.aria-label]="closeLabel"
      [disabled]="busy"
      tabindex="-1"
      (click)="requestClose()"
    ></button>
    <section
      #panel
      class="ui-sheet"
      [class.ui-sheet-md]="size === 'md'"
      [class.ui-sheet-sm]="size === 'sm'"
      tabindex="-1"
    >
      <header class="ui-sheet-head">
        <div class="ui-sheet-title">
          <p *ngIf="eyebrow" class="ui-sheet-eyebrow">{{ eyebrow }}</p>
          <h2 [id]="titleId" class="ui-sheet-h">{{ title }}</h2>
          <p *ngIf="subtitle" class="ui-sheet-sub">{{ subtitle }}</p>
        </div>
        <div class="ui-sheet-head-actions">
          <ng-content select="[uiSheetHead]"></ng-content>
          <button
            type="button"
            class="ui-sheet-close"
            [disabled]="busy"
            [attr.aria-label]="closeLabel"
            (click)="requestClose()"
          >
            Chiudi
          </button>
        </div>
      </header>
      <div class="ui-sheet-body" [class.ui-sheet-split]="split">
        <ng-content></ng-content>
      </div>
      <footer class="ui-sheet-bar"><ng-content select="[uiSheetBar]"></ng-content></footer>
    </section>
  </div>`,
})
export class UiSheetComponent implements AfterViewInit, OnDestroy {
  @Input() eyebrow = "";
  @Input() title = "";
  @Input() subtitle = "";
  @Input() size: UiSheetSize = "md";
  /** Two columns with their own scroll (desktop/tablet). */
  @Input() split = false;
  /** While true the sheet cannot be closed (saving). */
  @Input() busy = false;
  /** Stacking: raise it for a sheet opened over another overlay. */
  @Input() layer = 85;
  @Input() closeLabel = "Chiudi";
  @Output() close = new EventEmitter<void>();

  @ViewChild("panel", { static: true }) panel!: ElementRef<HTMLElement>;

  readonly titleId = nextLayerId("ui-sheet-title");
  closing = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly previousFocus =
    typeof document !== "undefined"
      ? (document.activeElement as HTMLElement | null)
      : null;

  constructor() {
    pushLayer(this);
  }

  ngAfterViewInit(): void {
    const target =
      this.panel.nativeElement.querySelector<HTMLElement>("[autofocus]") ||
      this.panel.nativeElement;
    setTimeout(() => target.focus({ preventScroll: true }));
  }

  ngOnDestroy(): void {
    popLayer(this);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }

  @HostListener("document:keydown.escape", ["$event"])
  onEscape(event: Event): void {
    if (!isTopLayer(this)) return;
    event.preventDefault();
    this.requestClose();
  }

  /** User-initiated close: plays the exit transition, then emits. */
  requestClose(): void {
    if (this.busy || this.closing) return;
    if (prefersReducedMotion()) {
      this.close.emit();
      return;
    }
    this.closing = true;
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      this.closing = false;
      this.close.emit();
    }, 180);
  }
}
