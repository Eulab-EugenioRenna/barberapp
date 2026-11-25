import { Component, EventEmitter, Input, Output } from "@angular/core";
import { UiSelectComponent, type UiOption } from "@alora/ui";

/** Every five minutes of the day, «HH:mm». */
const STEPS: string[] = Array.from({ length: 288 }, (_, index) => {
  const minutes = index * 5;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});
const STEP_OPTIONS: UiOption[] = STEPS.map((time) => ({ value: time, label: time }));

/** Options for a time field; a saved time outside the five-minute grid stays selectable. */
export function timeOptions(current: string | null | undefined): UiOption[] {
  const value = /^([01]\d|2[0-3]):[0-5]\d$/.test(current ?? "") ? current! : "";
  if (!value || STEPS.includes(value)) return STEP_OPTIONS;
  return [...STEP_OPTIONS, { value, label: value }].sort((a, b) =>
    String(a.value).localeCompare(String(b.value)),
  );
}

/** ALORA's time picker, in place of the browser's `<input type="time">`. */
@Component({
  selector: "alora-time-select",
  standalone: true,
  imports: [UiSelectComponent],
  template: `<ui-select
    [value]="value"
    [options]="options"
    [label]="label"
    [placeholder]="placeholder"
    [disabled]="disabled"
    (valueChange)="pick($event)"
  ></ui-select>`,
  styles: [":host { display: block; min-width: 6.5rem; }"],
})
export class TimeSelectComponent {
  @Input() label = "Orario";
  @Input() placeholder = "--:--";
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();
  options: UiOption[] = STEP_OPTIONS;
  private current = "";
  @Input() set value(value: string | null | undefined) {
    this.current = value ?? "";
    this.options = timeOptions(this.current);
  }
  get value(): string {
    return this.current;
  }
  pick(value: unknown) {
    this.current = String(value ?? "");
    this.valueChange.emit(this.current);
  }
}
