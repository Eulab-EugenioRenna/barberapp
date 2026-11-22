import { CommonModule } from "@angular/common";
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  forwardRef,
} from "@angular/core";
import { NG_VALUE_ACCESSOR } from "@angular/forms";
import { UiListboxPanelComponent } from "./ui-listbox-panel.component";
import { UI_FIELD_STYLES, UI_POPOVER_STYLES, UiListboxBase } from "./ui-listbox-base";
import { uiSameValue } from "./ui-select.component";
import type { UiOption, UiOptionValue } from "./ui-option";

/**
 * Text field with suggestions. The field itself is the filter; suggestions
 * hang from <body>. Local filtering by default, `remoteSearch` for server
 * lookups (listen to `searchChange`, debounce on the caller side if needed).
 *
 * The model is the chosen option value. With `freeText` the model is the typed
 * text and suggestions only help completing it.
 */
@Component({
  selector: "ui-autocomplete",
  standalone: true,
  imports: [CommonModule, UiListboxPanelComponent],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => UiAutocompleteComponent), multi: true },
  ],
  template: `
    <span *ngIf="showLabel && label" class="ui-field-label">{{ label }}</span>
    <div class="ui-trigger ui-ac" [class.ui-open]="open" #anchor>
      <svg class="ui-search" viewBox="0 0 20 20" aria-hidden="true"><path d="M13.5 13.5 17 17M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12Z" /></svg>
      <input
        #input
        type="text"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        [attr.aria-label]="accessibleName"
        [attr.aria-expanded]="open"
        [attr.aria-controls]="listboxId"
        [attr.aria-activedescendant]="open && activeIndex >= 0 ? listboxId + '-' + activeIndex : null"
        [placeholder]="placeholder"
        [disabled]="isDisabled"
        [value]="text"
        (input)="onInput($any($event.target).value)"
        (focus)="onFocus()"
        (keydown)="onKey($event)"
        (blur)="onBlur()"
      />
      <button
        *ngIf="text && !isDisabled"
        type="button"
        class="ui-ac-clear"
        aria-label="Svuota"
        (click)="clear()"
      >×</button>
    </div>

    <ng-template #panel>
      <div class="ui-pop ui-pop-ac">
        <div class="ui-pop-sheet-title">
          <input
            class="ui-ac-sheet-input"
            type="text"
            autocomplete="off"
            [attr.aria-label]="accessibleName"
            [attr.aria-controls]="listboxId"
            [placeholder]="placeholder"
            [value]="text"
            (input)="onInput($any($event.target).value)"
            (keydown)="onKey($event)"
          />
          <button type="button" (click)="close()">Chiudi</button>
        </div>
        <ui-listbox-panel
          [options]="visibleOptions"
          [listboxId]="listboxId"
          [label]="accessibleName"
          [activeIndex]="activeIndex"
          [filterable]="false"
          [query]="query"
          [createLabel]="createLabel"
          [emptyText]="emptyText"
          [loading]="loading"
          [isSelected]="isSelectedFn"
          (active)="setActive($event)"
          (pick)="choose($event)"
          (create)="requestCreate()"
        ></ui-listbox-panel>
      </div>
    </ng-template>
  `,
  styles: [
    UI_FIELD_STYLES,
    UI_POPOVER_STYLES,
    `
      .ui-ac {
        cursor: text;
        padding-block: 0.25rem;
      }
      .ui-ac input {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 2.3rem;
        border: 0;
        background: transparent;
        color: var(--ink);
        font: inherit;
        font-size: 16px;
        outline: none;
      }
      .ui-ac:focus-within {
        border-color: rgba(30, 52, 37, 0.45);
        box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--focus) 35%, transparent);
      }
      .ui-search {
        flex: 0 0 auto;
        width: 1.05rem;
        height: 1.05rem;
        fill: none;
        stroke: var(--muted);
        stroke-width: 1.8;
        stroke-linecap: round;
      }
      .ui-ac-clear {
        border: 0;
        border-radius: 999rem;
        background: transparent;
        width: 1.75rem;
        height: 1.75rem;
        color: var(--muted);
        font-size: 1.15rem;
        cursor: pointer;
      }
      .ui-ac-clear:hover {
        background: rgba(30, 52, 37, 0.08);
      }
      .ui-ac-sheet-input {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 2.6rem;
        border: 0.0625rem solid var(--line);
        border-radius: 0.9rem;
        padding: 0.5rem 0.8rem;
        font: inherit;
        font-size: 16px;
        font-weight: 400;
      }
    `,
  ],
})
export class UiAutocompleteComponent extends UiListboxBase {
  @Input() value: UiOptionValue = null;
  @Input() showLabel = false;
  @Input() override placeholder = "Cerca";
  @Input() override emptyText = "Nessun suggerimento";
  /** Model is the typed text; suggestions only complete it. */
  @Input() freeText = false;
  /** Characters needed before suggestions open. */
  @Input() minChars = 0;
  @Output() readonly valueChange = new EventEmitter<any>();
  /** The whole chosen option, useful to read extra fields. */
  @Output() readonly optionSelected = new EventEmitter<UiOption>();

  @ViewChild("anchor", { static: true }) private anchor!: ElementRef<HTMLElement>;
  @ViewChild("input", { static: true }) private input!: ElementRef<HTMLInputElement>;

  text = "";

  override get visibleOptions(): UiOption[] {
    if (this.text.trim().length < this.minChars) return [];
    return super.visibleOptions;
  }

  isSelected(option: UiOption): boolean {
    return !this.freeText && uiSameValue(option.value, this.value);
  }

  onInput(text: string): void {
    this.text = text;
    if (this.freeText) this.emit(text);
    if (!this.open && text.trim().length >= this.minChars) this.openPanel();
    this.setQuery(text);
  }

  onFocus(): void {
    if (this.text.trim().length >= this.minChars && this.options.length) this.openPanel();
  }

  onBlur(): void {
    // Restore the chosen label when the user leaves a partial search.
    setTimeout(() => {
      if (this.open) return;
      if (!this.freeText) this.text = this.labelOf(this.value);
      this.onTouched();
      this.cdr.markForCheck();
    }, 150);
  }

  override openPanel(): void {
    const keep = this.text;
    super.openPanel();
    // The base resets the query on open: the typed text is the query here.
    this.query = keep;
    if (this.remoteSearch) this.searchChange.emit(keep);
    // Mobile sheet covers the field: continue typing in the sheet's own input.
    queueMicrotask(() => {
      const panel = this.panelElement;
      if (panel?.classList.contains("ui-pop-sheet"))
        panel.querySelector<HTMLInputElement>(".ui-ac-sheet-input")?.focus();
    });
  }

  choose(option: UiOption): void {
    if (option.disabled) return;
    this.text = option.label;
    this.emit(this.freeText ? option.label : option.value);
    this.optionSelected.emit(option);
    this.close();
  }

  clear(): void {
    this.text = "";
    this.emit(this.freeText ? "" : null);
    this.setQuery("");
    this.input.nativeElement.focus();
  }

  writeValue(value: unknown): void {
    this.value = (value ?? null) as UiOptionValue;
    this.text = this.freeText ? String(value ?? "") : this.labelOf(this.value);
    this.cdr.markForCheck();
  }

  protected anchorElement(): HTMLElement {
    return this.anchor.nativeElement;
  }

  protected focusElement(): HTMLElement | null {
    return this.input.nativeElement;
  }

  private labelOf(value: UiOptionValue): string {
    if (value == null || value === "") return "";
    return this.options.find((o) => uiSameValue(o.value, value))?.label ?? this.text;
  }

  private emit(value: UiOptionValue): void {
    this.value = value;
    this.onChange(value);
    this.valueChange.emit(value);
  }
}
