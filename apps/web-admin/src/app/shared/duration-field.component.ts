import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, OnChanges, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";

type Unit = 1 | 60 | 1440;
const UNITS: Array<{ value: Unit; label: string }> = [
  { value: 1, label: "minuti" },
  { value: 60, label: "ore" },
  { value: 1440, label: "giorni" },
];

/** Picks the largest unit that represents the minutes exactly: 1440 → 1 giorno. */
export function splitMinutes(minutes: number): { amount: number; unit: Unit } {
  for (const unit of [1440, 60] as const) if (minutes >= unit && minutes % unit === 0) return { amount: minutes / unit, unit };
  return { amount: minutes, unit: 1 };
}

/** A length of time typed as «2 ore» or «1 giorno»; the value is always in minutes. */
@Component({
  selector: "alora-duration-field",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <span class="duration">
      <input type="number" [attr.aria-label]="label + ' (quantità)'" [min]="1" step="1" [ngModel]="amount" (ngModelChange)="setAmount($event)" [disabled]="disabled" />
      <select [attr.aria-label]="label + ' (unità)'" [ngModel]="unit" (ngModelChange)="setUnit($event)" [disabled]="disabled">
        <option *ngFor="let item of units" [ngValue]="item.value">{{ item.label }}</option>
      </select>
    </span>
  `,
  styles: [
    `
      .duration { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 8rem); gap: 8px; }
      input, select {
        font: inherit; font-weight: 400; color: inherit; min-width: 0; width: 100%; box-sizing: border-box;
        border: 1px solid var(--line, #ccd6ce); border-radius: 12px; padding: 12px; background: #fffefb;
      }
    `,
  ],
})
export class DurationFieldComponent implements OnChanges {
  @Input() minutes = 0;
  @Input() label = "Durata";
  @Input() disabled = false;
  @Output() minutesChange = new EventEmitter<number>();
  readonly units = UNITS;
  amount = 0;
  unit: Unit = 1;

  ngOnChanges() {
    // Keep the unit the user chose when the value still fits it.
    if (this.amount * this.unit === this.minutes) return;
    ({ amount: this.amount, unit: this.unit } = splitMinutes(this.minutes || 0));
  }
  setAmount(value: number) {
    this.amount = Math.max(0, Math.round(Number(value) || 0));
    this.minutesChange.emit(this.amount * this.unit);
  }
  setUnit(value: Unit) {
    this.unit = value;
    this.minutesChange.emit(this.amount * this.unit);
  }
}
