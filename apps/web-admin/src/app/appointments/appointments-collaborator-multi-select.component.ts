import { CommonModule } from "@angular/common";
import {
  AfterViewChecked,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";

type MultiSelectOption = {
  value: string;
  label: string;
};

@Component({
  selector: "barber-appointments-collaborator-multi-select",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="multi-shell" [class.open]="open()">
      <button
        #trigger
        type="button"
        class="multi-trigger"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
      >
        <span class="multi-copy">
          <span class="multi-label">Collaboratori</span>
          <span
            class="multi-value"
            [class.placeholder]="!selectedLabels().length"
          >
            {{ triggerLabel() }}
          </span>
        </span>
        <svg viewBox="0 0 20 20" fill="none" class="multi-chevron">
          <path
            d="M5 7.5L10 12.5L15 7.5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <div
        *ngIf="open()"
        #popover
        class="multi-popover"
        [ngStyle]="popoverStyle"
        (click)="$event.stopPropagation()"
      >
        <label class="multi-filter-shell">
          <input
            [(ngModel)]="filterQuery"
            class="multi-filter-input"
            placeholder="Filtra collaboratori"
            (pointerdown)="$event.stopPropagation()"
            (click)="$event.stopPropagation()"
          />
        </label>

        <button type="button" class="multi-clear" (click)="clearAll()">
          Tutti i collaboratori
        </button>

        <button
          *ngFor="let option of filteredOptions()"
          type="button"
          class="multi-option"
          [class.active]="isSelected(option.value)"
          (click)="toggleValue(option.value)"
        >
          <span>{{ option.label }}</span>
          <span class="multi-check">{{
            isSelected(option.value) ? "✓" : ""
          }}</span>
        </button>

        <div *ngIf="!filteredOptions().length" class="multi-empty">
          Nessun risultato
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 16rem;
      }

      .multi-shell {
        position: relative;
      }

      .multi-trigger {
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
      }

      .open .multi-trigger {
        border-color: rgba(28, 124, 100, 0.3);
        box-shadow: 0 0 0 0.22rem rgba(28, 124, 100, 0.1);
      }

      .multi-copy {
        display: grid;
        gap: 0.2rem;
        min-width: 0;
      }

      .multi-label {
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba(15, 23, 32, 0.45);
      }

      .multi-value {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .multi-value.placeholder {
        color: rgba(15, 23, 32, 0.45);
      }

      .multi-chevron {
        width: 1rem;
        height: 1rem;
        transition: transform 180ms ease;
      }

      .open .multi-chevron {
        transform: rotate(180deg);
      }

      .multi-popover {
        position: absolute;
        top: calc(100% + 0.5rem);
        right: 0;
        z-index: 40;
        width: min(22rem, 90vw);
        max-height: 20rem;
        overflow: auto;
        border: 0.0625rem solid rgba(15, 23, 32, 0.08);
        border-radius: 1.3rem;
        background: rgba(255, 255, 255, 0.98);
        padding: 0.45rem;
        box-shadow: 0 1.25rem 3rem rgba(15, 23, 32, 0.14);
      }

      .multi-filter-shell {
        display: block;
        margin-bottom: 0.35rem;
      }

      .multi-filter-input {
        width: 100%;
        border: 0.0625rem solid rgba(15, 23, 32, 0.08);
        border-radius: 1rem;
        background: rgba(15, 23, 32, 0.03);
        padding: 0.78rem 0.9rem;
        color: #0f1720;
      }

      .multi-clear,
      .multi-option {
        display: flex;
        width: 100%;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        border: 0;
        border-radius: 1rem;
        background: transparent;
        padding: 0.8rem 0.9rem;
        color: #0f1720;
        text-align: left;
      }

      .multi-clear {
        font-weight: 700;
      }

      .multi-option.active,
      .multi-option:hover,
      .multi-clear:hover {
        background: rgba(15, 23, 32, 0.06);
      }

      .multi-check {
        font-weight: 800;
        color: var(--accent);
      }

      .multi-empty {
        padding: 0.9rem;
        color: rgba(15, 23, 32, 0.5);
        text-align: center;
      }
    `,
  ],
})
export class AppointmentsCollaboratorMultiSelectComponent
  implements AfterViewChecked, OnDestroy
{
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private popoverMounted = false;

  @ViewChild("trigger", { read: ElementRef })
  private readonly triggerRef?: ElementRef<HTMLElement>;

  @ViewChild("popover", { read: ElementRef })
  private readonly popoverRef?: ElementRef<HTMLElement>;

  @Input() options: MultiSelectOption[] = [];
  @Input() values: string[] = [];
  @Output() valuesChange = new EventEmitter<string[]>();

  readonly open = signal(false);
  filterQuery = "";
  popoverStyle: Record<string, string> = {};

  readonly filteredOptions = computed(() => {
    const query = this.filterQuery.trim().toLowerCase();

    if (!query) {
      return this.options;
    }

    return this.options.filter((option) =>
      option.label.toLowerCase().includes(query),
    );
  });

  readonly selectedLabels = computed(() =>
    this.options
      .filter((option) => this.values.includes(option.value))
      .map((option) => option.label),
  );

  readonly triggerLabel = computed(() => {
    const labels = this.selectedLabels();

    if (!labels.length) {
      return "Tutti i collaboratori";
    }

    if (labels.length <= 2) {
      return labels.join(", ");
    }

    return `${labels.length} collaboratori selezionati`;
  });

  @HostListener("document:pointerdown", ["$event"])
  onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target as Node | null;
    const popover = this.popoverRef?.nativeElement;

    if (
      target &&
      !this.elementRef.nativeElement.contains(target) &&
      !(popover && popover.contains(target))
    ) {
      this.close();
    }
  }

  @HostListener("window:resize")
  @HostListener("window:scroll")
  onViewportChange(): void {
    if (this.open()) {
      this.syncPopoverPosition();
    }
  }

  ngAfterViewChecked(): void {
    if (this.open() && !this.popoverMounted) {
      this.mountPopover();
    }

    if (this.open() && this.popoverMounted) {
      this.syncPopoverPosition();
    }
  }

  ngOnDestroy(): void {
    this.unmountPopover();
  }

  toggle(): void {
    if (this.open()) {
      this.close();
    } else {
      this.open.set(true);
      this.filterQuery = "";
    }
  }

  isSelected(value: string): boolean {
    return this.values.includes(value);
  }

  toggleValue(value: string): void {
    const next = this.isSelected(value)
      ? this.values.filter((entry) => entry !== value)
      : [...this.values, value];
    this.valuesChange.emit(next);
  }

  clearAll(): void {
    this.valuesChange.emit([]);
  }

  private close(): void {
    this.open.set(false);
    this.unmountPopover();
  }

  private mountPopover(): void {
    const popover = this.popoverRef?.nativeElement;

    if (!popover || this.popoverMounted) {
      return;
    }

    document.body.appendChild(popover);
    this.popoverMounted = true;
    this.syncPopoverPosition();
  }

  private unmountPopover(): void {
    const popover = this.popoverRef?.nativeElement;

    if (!popover || !this.popoverMounted) {
      return;
    }

    if (popover.parentElement === document.body) {
      document.body.removeChild(popover);
    }

    this.popoverMounted = false;
  }

  private syncPopoverPosition(): void {
    const trigger = this.triggerRef?.nativeElement;
    const popover = this.popoverRef?.nativeElement;

    if (!trigger || !popover) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 256), window.innerWidth - 24);
    const left = Math.min(rect.right - width, window.innerWidth - width - 12);
    const top = Math.min(rect.bottom + 8, window.innerHeight - 12);

    this.popoverStyle = {
      position: "fixed",
      top: `${top}px`,
      left: `${Math.max(12, left)}px`,
      width: `${width}px`,
      zIndex: "90",
    };
  }
}
