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
import type { UiOption, UiOptionValue } from "./ui-option";

export function uiSameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

/**
 * Single choice with a filter inside. Use with `[(ngModel)]` or with
 * `[value]`/`(valueChange)`. `barber-custom-select` is a legacy alias.
 *
 * <ui-select label="Sede" [options]="locationOptions" [(ngModel)]="locationId" />
 */
@Component({
  selector: "ui-select, barber-custom-select",
  standalone: true,
  imports: [CommonModule, UiListboxPanelComponent],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => UiSelectComponent), multi: true },
  ],
  template: `
    <span *ngIf="showLabel && label" class="ui-field-label" [id]="listboxId + '-label'">{{ label }}</span>
    <button
      #trigger
      type="button"
      class="ui-trigger"
      role="combobox"
      aria-haspopup="listbox"
      [class.ui-open]="open"
      [disabled]="isDisabled"
      [attr.aria-expanded]="open"
      [attr.aria-controls]="listboxId"
      [attr.aria-label]="accessibleName + ': ' + (selected?.label || placeholder)"
      (click)="toggle()"
      (keydown)="onKey($event)"
    >
      <span class="ui-trigger-value" [class.ui-placeholder]="!selected">
        {{ selected?.label || placeholder }}
      </span>
      <span
        *ngIf="clearable && selected && !isDisabled"
        class="ui-clear"
        role="button"
        tabindex="-1"
        aria-label="Svuota"
        (click)="clear($event)"
      >×</span>
      <svg class="ui-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7.5l5 5 5-5" /></svg>
    </button>

    <ng-template #panel>
      <div class="ui-pop">
        <div class="ui-pop-sheet-title">
          <span>{{ label || placeholder }}</span>
          <button type="button" (click)="close()">Chiudi</button>
        </div>
        <ui-listbox-panel
          [options]="visibleOptions"
          [listboxId]="listboxId"
          [label]="accessibleName"
          [activeIndex]="activeIndex"
          [filterable]="filterable"
          [filterPlaceholder]="filterPlaceholder"
          [query]="query"
          [createLabel]="createLabel"
          [emptyText]="emptyText"
          [loading]="loading"
          [isSelected]="isSelectedFn"
          (queryChange)="setQuery($event)"
          (key)="onKey($event)"
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
      .ui-clear {
        display: inline-grid;
        place-items: center;
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 999rem;
        color: var(--muted);
        font-size: 1.1rem;
        line-height: 1;
      }
      .ui-clear:hover {
        background: rgba(30, 52, 37, 0.08);
        color: var(--ink);
      }
    `,
  ],
})
export class UiSelectComponent extends UiListboxBase {
  @Input() value: UiOptionValue = "";
  /** Shows `label` above the field. Off when a wrapping `.field` already labels it. */
  @Input() showLabel = false;
  /** Shows a × that resets to `clearValue`. */
  @Input() clearable = false;
  @Input() clearValue: UiOptionValue = "";
  @Output() readonly valueChange = new EventEmitter<any>();

  @ViewChild("trigger", { static: true }) private trigger!: ElementRef<HTMLButtonElement>;

  get selected(): UiOption | undefined {
    return this.options.find((option) => uiSameValue(option.value, this.value));
  }

  isSelected(option: UiOption): boolean {
    return uiSameValue(option.value, this.value);
  }

  choose(option: UiOption): void {
    if (option.disabled) return;
    this.setValue(option.value);
    this.close();
  }

  clear(event: Event): void {
    event.stopPropagation();
    this.setValue(this.clearValue);
  }

  writeValue(value: unknown): void {
    this.value = (value ?? null) as UiOptionValue;
    this.cdr.markForCheck();
  }

  protected anchorElement(): HTMLElement {
    return this.trigger.nativeElement;
  }

  protected focusElement(): HTMLElement | null {
    return this.trigger.nativeElement;
  }

  private setValue(value: UiOptionValue): void {
    if (uiSameValue(value, this.value) && value === this.value) return;
    this.value = value;
    this.onChange(value);
    this.valueChange.emit(value);
  }
}
