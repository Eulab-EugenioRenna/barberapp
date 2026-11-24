import { CommonModule } from "@angular/common";
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
} from "@angular/core";
import type { UiOption } from "./ui-option";

/**
 * Body of every dropdown of the design system (select, multi-select,
 * autocomplete). Purely presentational: the owner keeps state and keyboard.
 */
@Component({
  selector: "ui-listbox-panel",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.Default,
  template: `
    <div class="ui-lb-head" *ngIf="filterable || createLabel || multiple">
      <input
        *ngIf="filterable"
        class="ui-lb-filter"
        type="search"
        autocomplete="off"
        [attr.aria-label]="filterPlaceholder"
        [attr.aria-controls]="listboxId"
        [attr.aria-activedescendant]="activeId"
        [placeholder]="filterPlaceholder"
        [value]="query"
        (input)="queryChange.emit($any($event.target).value)"
        (keydown)="key.emit($event)"
      />
      <div *ngIf="multiple && options.length" class="ui-lb-bulk">
        <button type="button" (click)="bulk.emit(true)">Seleziona tutti</button>
        <button type="button" (click)="bulk.emit(false)">Nessuno</button>
      </div>
      <button
        *ngIf="createLabel"
        type="button"
        class="ui-lb-create"
        (click)="create.emit()"
      >
        <span aria-hidden="true">+</span>{{ createLabel }}
      </button>
    </div>
    <ul
      class="ui-lb-list"
      role="listbox"
      [id]="listboxId"
      [attr.aria-multiselectable]="multiple || null"
      [attr.aria-label]="label"
    >
      <ng-container *ngFor="let option of options; let i = index; trackBy: track">
        <li
          *ngIf="option.group && option.group !== options[i - 1]?.group"
          class="ui-lb-group"
          role="presentation"
        >
          {{ option.group }}
        </li>
        <li
          role="option"
          class="ui-lb-option"
          [id]="listboxId + '-' + i"
          [class.ui-active]="i === activeIndex"
          [class.ui-selected]="isSelected(option)"
          [class.ui-disabled]="option.disabled"
          [attr.aria-selected]="isSelected(option)"
          [attr.aria-disabled]="option.disabled || null"
          (pointerdown)="$event.preventDefault()"
          (click)="!option.disabled && pick.emit(option)"
          (pointerenter)="active.emit(i)"
        >
          <span *ngIf="multiple" class="ui-lb-check" aria-hidden="true">
            <svg *ngIf="isSelected(option)" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>
          </span>
          <span class="ui-lb-text">
            <span class="ui-lb-label">{{ option.label }}</span>
            <small *ngIf="option.hint" class="ui-lb-hint">{{ option.hint }}</small>
          </span>
          <svg
            *ngIf="!multiple && isSelected(option)"
            class="ui-lb-tick"
            viewBox="0 0 16 16"
            aria-hidden="true"
          ><path d="M3.5 8.5l3 3 6-7" /></svg>
        </li>
      </ng-container>
      <li *ngIf="loading" class="ui-lb-empty" role="presentation">Caricamento…</li>
      <li *ngIf="!loading && !options.length" class="ui-lb-empty" role="presentation">
        {{ query ? "Nessun risultato per “" + query + "”" : emptyText }}
      </li>
    </ul>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        max-height: inherit;
        color: var(--ink);
      }
      .ui-lb-head {
        display: grid;
        gap: 0.4rem;
        padding: 0.45rem 0.45rem 0.35rem;
        border-bottom: 0.0625rem solid var(--line);
      }
      .ui-lb-filter {
        width: 100%;
        min-height: 2.6rem;
        border: 0.0625rem solid var(--line);
        border-radius: 0.9rem;
        background: rgba(30, 52, 37, 0.03);
        padding: 0.55rem 0.8rem;
        color: var(--ink);
        font: inherit;
        font-size: 16px;
      }
      .ui-lb-filter:focus {
        outline: 0.1875rem solid var(--focus);
        outline-offset: 0;
      }
      .ui-lb-bulk {
        display: flex;
        gap: 0.4rem;
      }
      .ui-lb-bulk button {
        border: 0;
        border-radius: 999rem;
        background: rgba(30, 52, 37, 0.06);
        padding: 0.35rem 0.75rem;
        color: var(--ink);
        font: inherit;
        font-size: 0.8rem;
        font-weight: 700;
        cursor: pointer;
      }
      .ui-lb-create {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        border: 0.0625rem dashed rgba(30, 52, 37, 0.38);
        border-radius: 0.9rem;
        background: rgba(30, 52, 37, 0.05);
        padding: 0.6rem 0.8rem;
        color: var(--accent);
        font: inherit;
        font-weight: 800;
        text-align: left;
        cursor: pointer;
      }
      .ui-lb-list {
        flex: 1 1 auto;
        min-height: 0;
        margin: 0;
        padding: 0.35rem;
        overflow-y: auto;
        overscroll-behavior: contain;
        list-style: none;
      }
      .ui-lb-group {
        padding: 0.65rem 0.75rem 0.3rem;
        color: var(--muted);
        font-size: 0.68rem;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      .ui-lb-option {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        min-height: 2.75rem;
        border-radius: 0.8rem;
        padding: 0.5rem 0.75rem;
        cursor: pointer;
      }
      .ui-lb-option.ui-active {
        background: rgba(30, 52, 37, 0.07);
      }
      .ui-lb-option.ui-selected .ui-lb-label {
        font-weight: 700;
      }
      .ui-lb-option.ui-disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .ui-lb-text {
        display: grid;
        flex: 1 1 auto;
        gap: 0.1rem;
        min-width: 0;
      }
      .ui-lb-label {
        overflow-wrap: anywhere;
      }
      .ui-lb-hint {
        color: var(--muted);
        font-size: 0.8rem;
      }
      .ui-lb-check {
        display: inline-grid;
        place-items: center;
        flex: 0 0 auto;
        width: 1.15rem;
        height: 1.15rem;
        border: 0.125rem solid rgba(30, 52, 37, 0.35);
        border-radius: 0.35rem;
      }
      .ui-selected .ui-lb-check {
        border-color: var(--alora-forest);
        background: var(--alora-forest);
        color: #fff;
      }
      svg {
        width: 0.9rem;
        height: 0.9rem;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .ui-lb-tick {
        flex: 0 0 auto;
        color: var(--accent);
      }
      .ui-lb-empty {
        padding: 0.9rem;
        color: var(--muted);
        text-align: center;
      }
    `,
  ],
})
export class UiListboxPanelComponent implements OnChanges, AfterViewInit {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);

  @Input() options: UiOption[] = [];
  @Input() listboxId = "";
  @Input() label = "";
  @Input() activeIndex = -1;
  @Input() multiple = false;
  @Input() filterable = true;
  @Input() filterPlaceholder = "Filtra";
  @Input() query = "";
  @Input() createLabel = "";
  @Input() emptyText = "Nessuna opzione";
  @Input() loading = false;
  @Input() isSelected: (option: UiOption) => boolean = () => false;

  @Output() readonly queryChange = new EventEmitter<string>();
  @Output() readonly pick = new EventEmitter<UiOption>();
  @Output() readonly active = new EventEmitter<number>();
  @Output() readonly key = new EventEmitter<KeyboardEvent>();
  @Output() readonly create = new EventEmitter<void>();
  @Output() readonly bulk = new EventEmitter<boolean>();

  get activeId(): string | null {
    return this.activeIndex >= 0 ? `${this.listboxId}-${this.activeIndex}` : null;
  }

  ngAfterViewInit(): void {
    if (this.filterable) {
      queueMicrotask(() =>
        (this.host.nativeElement as HTMLElement)
          .querySelector<HTMLInputElement>(".ui-lb-filter")
          ?.focus({ preventScroll: true }),
      );
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes["activeIndex"] && !changes["options"]) return;
    // Keep the keyboard-active option in view. Outside Angular: a microtask in
    // the zone triggers change detection again, and a parent that passes a
    // freshly built options array would loop forever and freeze the page.
    this.zone.runOutsideAngular(() => queueMicrotask(() => {
      const el = (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>(
        ".ui-lb-option.ui-active",
      );
      el?.scrollIntoView?.({ block: "nearest" });
    }));
  }

  track = (index: number, option: UiOption) => `${index}:${String(option.value)}`;
}
