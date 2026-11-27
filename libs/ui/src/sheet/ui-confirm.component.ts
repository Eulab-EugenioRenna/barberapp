import { CommonModule } from "@angular/common";
import {
  ApplicationRef,
  Component,
  EnvironmentInjector,
  EventEmitter,
  HostListener,
  Injectable,
  Input,
  OnDestroy,
  Output,
  ViewEncapsulation,
  createComponent,
  inject,
} from "@angular/core";
import { isTopLayer, nextLayerId, popLayer, pushLayer } from "./ui-sheet-stack";

export interface UiConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  eyebrow?: string;
  /** Red line under the body, e.g. «Questa operazione non può essere annullata». */
  note?: string;
  /** `danger` (default) paints the confirm button red. */
  tone?: "danger" | "neutral";
}

/**
 * The only small dialog left: confirms a destructive action. Editors and
 * forms use `ui-sheet`. Use it in a template, or imperatively with
 * `UiConfirmService.ask()` in place of `window.confirm`.
 */
@Component({
  selector: "ui-confirm",
  standalone: true,
  imports: [CommonModule],
  encapsulation: ViewEncapsulation.None,
  template: `<div class="ui-confirm-overlay" [style.z-index]="layer">
    <button
      type="button"
      class="ui-sheet-backdrop"
      tabindex="-1"
      [attr.aria-label]="cancelLabel"
      [disabled]="running"
      (click)="cancel.emit()"
    ></button>
    <article
      class="ui-confirm"
      role="alertdialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      [attr.aria-describedby]="body ? bodyId : null"
    >
      <p class="ui-sheet-eyebrow">{{ eyebrow }}</p>
      <h2 [id]="titleId" class="ui-confirm-title">{{ title }}</h2>
      <p *ngIf="body" [id]="bodyId" class="ui-confirm-body">{{ body }}</p>
      <p *ngIf="note" class="ui-confirm-note">{{ note }}</p>
      <ng-content></ng-content>
      <div class="ui-confirm-actions">
        <button
          type="button"
          class="pill-btn"
          [disabled]="running"
          (click)="cancel.emit()"
        >
          {{ cancelLabel }}
        </button>
        <button
          type="button"
          class="primary-btn"
          [class.destructive-btn]="tone === 'danger'"
          [disabled]="running || disabled"
          autofocus
          (click)="confirm.emit()"
        >
          {{ running ? runningLabel : confirmLabel }}
        </button>
      </div>
    </article>
  </div>`,
})
export class UiConfirmComponent implements OnDestroy {
  @Input() eyebrow = "Conferma";
  @Input() title = "";
  @Input() body = "";
  @Input() note = "";
  @Input() confirmLabel = "Conferma";
  @Input() cancelLabel = "Annulla";
  @Input() runningLabel = "Attendi...";
  @Input() tone: "danger" | "neutral" = "danger";
  @Input() running = false;
  @Input() disabled = false;
  @Input() layer = 1400;
  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  readonly titleId = nextLayerId("ui-confirm-title");
  readonly bodyId = nextLayerId("ui-confirm-body");

  constructor() {
    pushLayer(this);
  }

  ngOnDestroy(): void {
    popLayer(this);
  }

  @HostListener("document:keydown.escape", ["$event"])
  onEscape(event: Event): void {
    if (!isTopLayer(this) || this.running) return;
    event.preventDefault();
    this.cancel.emit();
  }
}

/** `await confirm.ask({...})` instead of `window.confirm(...)`. */
@Injectable({ providedIn: "root" })
export class UiConfirmService {
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);

  ask(options: UiConfirmOptions): Promise<boolean> {
    if (typeof document === "undefined") return Promise.resolve(false);
    const previousFocus = document.activeElement as HTMLElement | null;
    const ref = createComponent(UiConfirmComponent, {
      environmentInjector: this.injector,
    });
    ref.setInput("title", options.title);
    ref.setInput("body", options.body || "");
    ref.setInput("note", options.note || "");
    ref.setInput("eyebrow", options.eyebrow || "Conferma");
    ref.setInput("confirmLabel", options.confirmLabel || "Conferma");
    ref.setInput("cancelLabel", options.cancelLabel || "Annulla");
    ref.setInput("tone", options.tone || "danger");
    this.appRef.attachView(ref.hostView);
    document.body.appendChild(ref.location.nativeElement);
    ref.changeDetectorRef.detectChanges();
    setTimeout(() =>
      (ref.location.nativeElement as HTMLElement)
        .querySelector<HTMLElement>("[autofocus]")
        ?.focus(),
    );
    return new Promise<boolean>((resolve) => {
      const finish = (answer: boolean) => {
        this.appRef.detachView(ref.hostView);
        ref.destroy();
        if (previousFocus?.isConnected) previousFocus.focus();
        resolve(answer);
      };
      ref.instance.confirm.subscribe(() => finish(true));
      ref.instance.cancel.subscribe(() => finish(false));
    });
  }
}
