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
 * Multiple choice with a filter, "select all" and "none". The panel stays
 * open while ticking. Use `[(ngModel)]` or `[values]`/`(valuesChange)`.
 */
@Component({
  selector: "ui-multi-select",
  standalone: true,
  imports: [CommonModule, UiListboxPanelComponent],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => UiMultiSelectComponent), multi: true },
  ],
  template: `
    <span *ngIf="showLabel && label" class="ui-field-label">{{ label }}</span>
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
      [attr.aria-label]="accessibleName + ': ' + summary"
      (click)="toggle()"
      (keydown)="onKey($event)"
    >
      <span class="ui-trigger-value" [class.ui-placeholder]="!values.length">{{ summary }}</span>
      <span *ngIf="values.length > 1" class="ui-count">{{ values.length }}</span>
      <svg class="ui-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7.5l5 5 5-5" /></svg>
    </button>

    <ng-template #panel>
      <div class="ui-pop">
        <div class="ui-pop-sheet-title">
          <span>{{ label || placeholder }}</span>
          <button type="button" (click)="close()">Fatto</button>
        </div>
        <ui-listbox-panel
          [options]="visibleOptions"
          [listboxId]="listboxId"
          [label]="accessibleName"
          [activeIndex]="activeIndex"
          [multiple]="true"
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
          (bulk)="selectAll($event)"
          (create)="requestCreate()"
        ></ui-listbox-panel>
      </div>
    </ng-template>
  `,
  styles: [
    UI_FIELD_STYLES,
    UI_POPOVER_STYLES,
    `
      .ui-count {
        display: inline-grid;
        place-items: center;
        min-width: 1.5rem;
        height: 1.5rem;
        padding: 0 0.4rem;
        border-radius: 999rem;
        background: var(--alora-lime);
        color: var(--alora-forest);
        font-size: 0.75rem;
        font-weight: 800;
      }
    `,
  ],
})
export class UiMultiSelectComponent extends UiListboxBase {
  @Input() values: UiOptionValue[] = [];
  @Input() showLabel = false;
  /** Summary when nothing is selected (e.g. "Tutta la squadra"). */
  @Input() override placeholder = "Nessuna selezione";
  @Output() readonly valuesChange = new EventEmitter<any[]>();

  @ViewChild("trigger", { static: true }) private trigger!: ElementRef<HTMLButtonElement>;

  get summary(): string {
    if (!this.values.length) return this.placeholder;
    const labels = this.options.filter((o) => this.isSelected(o)).map((o) => o.label);
    if (labels.length && labels.length === this.options.length && this.options.length > 2)
      return "Tutti";
    if (labels.length <= 2) return labels.join(", ") || `${this.values.length} selezionati`;
    return `${labels.slice(0, 2).join(", ")} e altri ${labels.length - 2}`;
  }

  isSelected(option: UiOption): boolean {
    return this.values.some((value) => uiSameValue(value, option.value));
  }

  choose(option: UiOption): void {
    if (option.disabled) return;
    const next = this.isSelected(option)
      ? this.values.filter((value) => !uiSameValue(value, option.value))
      : [...this.values, option.value];
    this.setValues(next);
  }

  /** Applies to the filtered options only, so "tutti i risultati" is precise. */
  selectAll(select: boolean): void {
    const visible = this.visibleOptions.filter((o) => !o.disabled);
    const next = select
      ? [...this.values, ...visible.map((o) => o.value).filter((v) => !this.values.some((x) => uiSameValue(x, v)))]
      : this.values.filter((value) => !visible.some((o) => uiSameValue(o.value, value)));
    this.setValues(next);
  }

  writeValue(value: unknown): void {
    this.values = Array.isArray(value) ? [...value] : [];
    this.cdr.markForCheck();
  }

  protected anchorElement(): HTMLElement {
    return this.trigger.nativeElement;
  }

  protected focusElement(): HTMLElement | null {
    return this.trigger.nativeElement;
  }

  private setValues(values: UiOptionValue[]): void {
    this.values = values;
    this.onChange(values);
    this.valuesChange.emit(values);
  }
}
