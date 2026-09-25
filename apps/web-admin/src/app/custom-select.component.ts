import { CommonModule, DOCUMENT } from "@angular/common";
import {
  ApplicationRef,
  Component,
  EmbeddedViewRef,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  TemplateRef,
  ViewChild,
  inject,
} from "@angular/core";
import { FormsModule } from "@angular/forms";

type SelectOption = {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
};

@Component({
  selector: "barber-custom-select",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="select-shell" [class.open]="open" [class.disabled]="disabled">
      <div
        role="combobox"
        [attr.tabindex]="disabled ? -1 : 0"
        class="select-trigger"
        [attr.aria-expanded]="open"
        [attr.aria-disabled]="disabled"
        aria-haspopup="listbox"
        [attr.aria-controls]="listboxId"
        [attr.aria-label]="label || placeholder"
        (click)="onTriggerClick($event)"
        (keydown.enter)="onTriggerClick($event)"
        (keydown.space)="onTriggerClick($event)"
      >
        <span class="select-copy">
          <span class="select-label" *ngIf="label">{{ label }}</span>
          <span class="select-value" [class.placeholder]="!selectedOption">
            {{ selectedOption?.label || placeholder }}
          </span>
        </span>
        <svg viewBox="0 0 20 20" fill="none" class="select-chevron">
          <path
            d="M5 7.5L10 12.5L15 7.5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>

      <ng-template #popoverTemplate>
        <div
        role="listbox"
        [id]="listboxId"
        class="select-popover"
        (click)="$event.stopPropagation()"
      >
        <label class="select-filter-shell">
          <input
            [(ngModel)]="filterQuery"
            class="select-filter-input"
            placeholder="Filtra opzioni"
            aria-label="Filtra opzioni"
            (pointerdown)="$event.stopPropagation()"
            (click)="$event.stopPropagation()"
          />
        </label>
        <button
          *ngIf="createLabel"
          type="button"
          class="select-create-action"
          (pointerdown)="requestCreate($event)"
        >
          <span aria-hidden="true">+</span>{{ createLabel }}
        </button>
        <div
          *ngFor="let option of filteredOptions"
          role="option"
          [attr.tabindex]="option.disabled ? -1 : 0"
          [attr.aria-selected]="option.value === value"
          [attr.aria-disabled]="option.disabled || null"
          class="select-option"
          [class.active]="option.value === value"
          [class.option-disabled]="option.disabled"
          (pointerdown)="choose(option, $event)"
          (keydown.enter)="choose(option, $event)"
          (keydown.space)="choose(option, $event)"
        >
          <span>{{ option.label }}</span>
          <small *ngIf="option.hint">{{ option.hint }}</small>
        </div>
        <div *ngIf="!filteredOptions.length" class="select-empty">
          Nessun risultato
        </div>
        </div>
      </ng-template>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .select-shell {
        position: relative;
      }

      .select-trigger {
        display: flex;
        width: 100%;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        border: 0.0625rem solid rgba(15, 23, 32, 0.08);
        border-radius: 1.2rem;
        background: rgba(255, 255, 255, 0.94);
        padding: 0.92rem 1rem;
        color: #0f1720;
        text-align: left;
        box-shadow: 0 0.75rem 2rem rgba(15, 23, 32, 0.06);
        transition:
          border-color 180ms ease,
          box-shadow 180ms ease,
          transform 180ms ease;
      }

      .select-trigger:hover {
        transform: translateY(-0.0625rem);
        border-color: rgba(28, 124, 100, 0.22);
      }

      .open .select-trigger {
        border-color: rgba(28, 124, 100, 0.3);
        box-shadow: 0 0 0 0.22rem rgba(28, 124, 100, 0.1);
      }

      .disabled .select-trigger {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .select-copy {
        display: grid;
        gap: 0.2rem;
        min-width: 0;
      }

      .select-label {
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(15, 23, 32, 0.45);
      }

      .select-value.placeholder {
        color: rgba(15, 23, 32, 0.45);
      }

      .select-chevron {
        width: 1rem;
        height: 1rem;
        transition: transform 180ms ease;
      }

      .open .select-chevron {
        transform: rotate(180deg);
      }

      .select-popover {
        position: fixed;
        z-index: 1000;
        width: 100%;
        max-height: 18rem;
        overflow: auto;
        border: 0.0625rem solid rgba(15, 23, 32, 0.08);
        border-radius: 1.3rem;
        background: rgba(255, 255, 255, 0.98);
        padding: 0.45rem;
        box-shadow: 0 1.25rem 3rem rgba(15, 23, 32, 0.14);
      }

      .select-filter-shell {
        display: block;
        margin-bottom: 0.35rem;
      }

      .select-filter-input {
        width: 100%;
        border: 0.0625rem solid rgba(15, 23, 32, 0.08);
        border-radius: 1rem;
        background: rgba(15, 23, 32, 0.03);
        padding: 0.78rem 0.9rem;
        color: #0f1720;
      }

      .select-empty {
        padding: 0.9rem;
        color: rgba(15, 23, 32, 0.5);
        text-align: center;
      }

      .select-create-action {
        display: flex;
        width: 100%;
        align-items: center;
        gap: 0.5rem;
        border: 0.0625rem dashed rgba(28, 124, 100, 0.38);
        border-radius: 1rem;
        background: rgba(28, 124, 100, 0.06);
        padding: 0.72rem 0.9rem;
        color: #176b57;
        font-weight: 800;
        text-align: left;
      }

      .select-create-action:hover {
        background: rgba(28, 124, 100, 0.12);
      }

      .select-option {
        display: grid;
        width: 100%;
        gap: 0.2rem;
        border: 0;
        border-radius: 1rem;
        background: transparent;
        padding: 0.8rem 0.9rem;
        text-align: left;
        color: #0f1720;
      }

      .select-option small {
        color: rgba(15, 23, 32, 0.5);
      }

      .select-option:hover,
      .select-option.active {
        background: rgba(15, 23, 32, 0.06);
      }

      .select-option.option-disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    `,
  ],
})
export class CustomSelectComponent implements OnDestroy {
  private static nextId = 0;
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly document = inject(DOCUMENT);
  private readonly applicationRef = inject(ApplicationRef);
  @ViewChild("popoverTemplate") private popoverTemplate?: TemplateRef<unknown>;
  private portalView?: EmbeddedViewRef<unknown>;
  private popoverElement?: HTMLElement;
  readonly listboxId = `select-listbox-${CustomSelectComponent.nextId++}`;

  @Input() value = "";
  @Input() options: SelectOption[] = [];
  @Input() label = "";
  @Input() placeholder = "Seleziona";
  @Input() disabled = false;
  @Input() createLabel = "";
  @Output() valueChange = new EventEmitter<string>();
  @Output() createRequest = new EventEmitter<void>();

  open = false;
  filterQuery = "";

  get selectedOption(): SelectOption | undefined {
    return this.options.find((option) => option.value === this.value);
  }

  get filteredOptions(): SelectOption[] {
    const query = this.filterQuery.trim().toLowerCase();

    if (!query) {
      return this.options;
    }

    return this.options.filter((option) => {
      const haystack = `${option.label} ${option.hint || ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  ngOnDestroy(): void {
    this.closePopover();
  }

  @HostListener("document:pointerdown", ["$event"])
  onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target as Node | null;

    if (
      target &&
      !this.elementRef.nativeElement.contains(target) &&
      !this.popoverElement?.contains(target)
    ) {
      this.closePopover();
    }
  }

  @HostListener("document:keydown.escape")
  closeOnEscape(): void {
    this.closePopover();
  }

  @HostListener("window:resize")
  @HostListener("window:scroll")
  repositionPopover(): void {
    if (this.open) {
      this.positionPopover();
    }
  }

  onTriggerClick(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.disabled) {
      return;
    }

    this.toggleOpen();
  }

  toggleOpen(): void {
    if (this.disabled) {
      return;
    }

    if (this.open) {
      this.closePopover();
    } else {
      this.openPopover();
    }
  }

  choose(option: SelectOption, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    if (option.disabled) {
      return;
    }

    this.valueChange.emit(option.value);
    this.closePopover();
  }

  requestCreate(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.closePopover();
    this.createRequest.emit();
  }

  private openPopover(): void {
    const template = this.popoverTemplate;
    if (!template) return;

    this.open = true;
    this.filterQuery = "";
    this.portalView = template.createEmbeddedView({});
    this.applicationRef.attachView(this.portalView);
    this.portalView.detectChanges();
    this.popoverElement = this.portalView.rootNodes.find(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );

    if (!this.popoverElement) {
      this.closePopover();
      return;
    }

    this.document.body.appendChild(this.popoverElement);
    this.positionPopover();
    this.focusFilterInput();
  }

  private closePopover(): void {
    this.open = false;
    if (!this.portalView) return;

    this.applicationRef.detachView(this.portalView);
    this.portalView.destroy();
    this.portalView = undefined;
    this.popoverElement = undefined;
  }

  private positionPopover(): void {
    const trigger = this.elementRef.nativeElement.querySelector(
      ".select-trigger",
    ) as HTMLElement | null;
    const popover = this.popoverElement;
    if (!trigger || !popover) return;

    const gap = 8;
    const viewportPadding = 8;
    const scale = 1;
    const triggerRect = trigger.getBoundingClientRect();
    const width = Math.min(
      triggerRect.width / scale,
      window.innerWidth / scale - viewportPadding * 2,
    );
    const left = Math.max(
      viewportPadding,
      Math.min(
        triggerRect.left / scale,
        window.innerWidth / scale - width - viewportPadding,
      ),
    );
    const popoverHeight = Math.min(popover.offsetHeight / scale, 288);
    const top =
      triggerRect.bottom / scale + gap + popoverHeight <=
      window.innerHeight / scale - viewportPadding
        ? triggerRect.bottom / scale + gap
        : Math.max(viewportPadding, triggerRect.top / scale - gap - popoverHeight);

    Object.assign(popover.style, {
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
    });
  }

  private focusFilterInput(): void {
    setTimeout(() => {
      const input = this.popoverElement?.querySelector(
        ".select-filter-input",
      ) as HTMLInputElement | null;
      input?.focus();
    });
  }
}
