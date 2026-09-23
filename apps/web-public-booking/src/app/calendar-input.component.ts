import { CommonModule, DOCUMENT } from "@angular/common";
import {
  AfterViewChecked,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CustomSelectComponent } from "./custom-select.component";

type CalendarMode = "date" | "datetime";

type CalendarCell = {
  iso: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isDisabled: boolean;
  value: Date;
};

@Component({
  selector: "barber-calendar-input",
  standalone: true,
  imports: [CommonModule, FormsModule, CustomSelectComponent],
  template: `
    <div
      class="calendar-input-shell"
      [class.open]="open"
      [class.disabled]="disabled"
    >
      <button
        #trigger
        type="button"
        class="calendar-trigger"
        [disabled]="disabled"
        (click)="toggleOpen()"
      >
        <span class="calendar-trigger-copy">
          <span class="calendar-trigger-label">{{ label }}</span>
          <span
            class="calendar-trigger-value"
            [class.placeholder]="!displayValue"
          >
            {{ displayValue || placeholder }}
          </span>
        </span>
        <span class="calendar-trigger-icons" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" class="calendar-glyph">
            <rect
              x="3.5"
              y="5"
              width="17"
              height="15"
              rx="4"
              stroke="currentColor"
              stroke-width="1.5"
            />
            <path
              d="M7.5 3.75V7M16.5 3.75V7M3.5 9.5H20.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
          <svg viewBox="0 0 20 20" fill="none" class="calendar-chevron">
            <path
              d="M5 7.5L10 12.5L15 7.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
      </button>

      <div
        *ngIf="open"
        #popover
        class="calendar-popover"
        [ngStyle]="popoverStyle"
      >
        <div class="calendar-popover-head">
          <div>
            <p class="calendar-kicker">
              {{ mode === "datetime" ? "Data e ora" : "Calendario" }}
            </p>
            <strong>{{ monthLabel }}</strong>
          </div>
          <div class="calendar-head-actions">
            <button
              type="button"
              class="calendar-nav-btn"
              (click)="changeMonth(-1)"
            >
              ‹
            </button>
            <button
              type="button"
              class="calendar-nav-btn"
              (click)="changeMonth(1)"
            >
              ›
            </button>
          </div>
        </div>

        <div class="calendar-weekdays">
          <span *ngFor="let weekday of weekdays">{{ weekday }}</span>
        </div>

        <div class="calendar-grid">
          <button
            *ngFor="let cell of calendarCells"
            type="button"
            class="calendar-day"
            [class.outside]="!cell.inMonth"
            [class.today]="cell.isToday"
            [class.selected]="cell.isSelected"
            [disabled]="cell.isDisabled"
            (click)="selectDay(cell)"
          >
            {{ cell.day }}
          </button>
        </div>

        <div *ngIf="mode === 'datetime'" class="calendar-time-row">
          <label>
            <span>Ora</span>
            <barber-custom-select
              [(value)]="selectedHour"
              (valueChange)="syncSelectedTime()"
              [options]="hourOptions"
              placeholder="Ora"
            ></barber-custom-select>
          </label>
          <label>
            <span>Minuti</span>
            <barber-custom-select
              [(value)]="selectedMinute"
              (valueChange)="syncSelectedTime()"
              [options]="minuteOptions"
              placeholder="Minuti"
            ></barber-custom-select>
          </label>
        </div>

        <div class="calendar-quick-actions">
          <button type="button" class="calendar-chip" (click)="pickToday()">
            Oggi
          </button>
          <button type="button" class="calendar-chip" (click)="clearValue()">
            Pulisci
          </button>
          <button
            *ngIf="mode === 'datetime'"
            type="button"
            class="calendar-apply"
            (click)="applyDateTime()"
          >
            Applica
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .calendar-input-shell {
        position: relative;
      }

      .calendar-trigger {
        display: flex;
        width: 100%;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        border: 0.0625rem solid rgba(15, 23, 32, 0.08);
        border-radius: 1.2rem;
        background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.96),
          rgba(250, 248, 244, 0.92)
        );
        padding: 0.95rem 1rem;
        color: #0f1720;
        text-align: left;
        box-shadow: 0 0.75rem 2rem rgba(15, 23, 32, 0.08);
        cursor: pointer;
        transition:
          transform 180ms ease,
          border-color 180ms ease,
          box-shadow 180ms ease;
      }

      .calendar-trigger:hover {
        transform: translateY(-0.0625rem);
        border-color: rgba(var(--brand-rgb, 28, 124, 100), 0.2);
        box-shadow: 0 1rem 2.5rem rgba(15, 23, 32, 0.1);
      }

      .open .calendar-trigger {
        border-color: rgba(var(--brand-rgb, 28, 124, 100), 0.32);
        box-shadow: 0 0 0 0.22rem rgba(var(--brand-rgb, 28, 124, 100), 0.1);
      }

      .disabled .calendar-trigger {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .calendar-trigger-copy {
        display: grid;
        gap: 0.22rem;
        min-width: 0;
      }

      .calendar-trigger-label {
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: rgba(15, 23, 32, 0.45);
      }

      .calendar-trigger-value {
        font-weight: 700;
        line-height: 1.2;
      }

      .calendar-trigger-value.placeholder {
        color: rgba(15, 23, 32, 0.45);
      }

      .calendar-trigger-icons {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        color: rgba(15, 23, 32, 0.56);
      }

      .calendar-glyph {
        width: 1.1rem;
        height: 1.1rem;
      }

      .calendar-chevron {
        width: 1rem;
        height: 1rem;
        transition: transform 180ms ease;
      }

      .open .calendar-chevron {
        transform: rotate(180deg);
      }

      .calendar-popover {
        position: absolute;
        top: calc(100% + 0.6rem);
        left: 0;
        z-index: 30;
        width: min(22rem, 100vw - 2rem);
        border: 0.0625rem solid rgba(15, 23, 32, 0.08);
        border-radius: 1.5rem;
        background:
          radial-gradient(
            circle at top right,
            rgba(var(--accent-rgb, 249, 115, 22), 0.08),
            transparent 10rem
          ),
          linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.98),
            rgba(247, 244, 238, 0.98)
          );
        padding: 1rem;
        box-shadow: 0 1.5rem 3.5rem rgba(15, 23, 32, 0.16);
        backdrop-filter: blur(1rem);
      }

      .calendar-popover-head,
      .calendar-head-actions,
      .calendar-quick-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .calendar-kicker {
        margin: 0 0 0.2rem;
        font-size: 0.68rem;
        font-weight: 800;
        letter-spacing: 0.24em;
        text-transform: uppercase;
        color: rgba(15, 23, 32, 0.42);
      }

      .calendar-popover strong {
        font-family: "Syne", sans-serif;
        font-size: 1.35rem;
      }

      .calendar-nav-btn,
      .calendar-chip,
      .calendar-apply,
      .calendar-day {
        border: 0;
        cursor: pointer;
        transition: 180ms ease;
      }

      .calendar-nav-btn {
        display: grid;
        place-items: center;
        width: 2.25rem;
        height: 2.25rem;
        border-radius: 999rem;
        background: rgba(15, 23, 32, 0.05);
        color: #0f1720;
      }

      .calendar-nav-btn:hover,
      .calendar-chip:hover,
      .calendar-apply:hover {
        transform: translateY(-0.0625rem);
      }

      .calendar-weekdays,
      .calendar-grid {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
      }

      .calendar-weekdays {
        margin-top: 1rem;
        margin-bottom: 0.45rem;
        gap: 0.15rem;
        color: rgba(15, 23, 32, 0.42);
        font-size: 0.72rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }

      .calendar-weekdays span {
        display: grid;
        place-items: center;
      }

      .calendar-grid {
        gap: 0.2rem;
      }

      .calendar-day {
        display: grid;
        place-items: center;
        aspect-ratio: 1;
        border-radius: 1rem;
        background: transparent;
        color: #0f1720;
        font-weight: 700;
      }

      .calendar-day:hover {
        background: rgba(15, 23, 32, 0.06);
      }

      .calendar-day.outside {
        color: rgba(15, 23, 32, 0.28);
      }

      .calendar-day.today {
        box-shadow: inset 0 0 0 0.08rem
          rgba(var(--accent-rgb, 249, 115, 22), 0.32);
      }

      .calendar-day.selected {
        background: linear-gradient(135deg, var(--brand, #1c7c64), #123b33);
        color: white;
        box-shadow: 0 0.75rem 1.75rem rgba(var(--brand-rgb, 28, 124, 100), 0.24);
      }

      .calendar-day:disabled {
        cursor: not-allowed;
        opacity: 0.28;
      }

      .calendar-time-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.75rem;
        margin-top: 0.9rem;
      }

      .calendar-time-row label {
        display: grid;
        gap: 0.4rem;
      }

      .calendar-time-row span {
        font-size: 0.75rem;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: rgba(15, 23, 32, 0.45);
      }

      .calendar-quick-actions {
        margin-top: 0.9rem;
      }

      .calendar-chip,
      .calendar-apply {
        border-radius: 999rem;
        padding: 0.72rem 0.95rem;
        font-weight: 800;
      }

      .calendar-chip {
        background: rgba(15, 23, 32, 0.06);
        color: #0f1720;
      }

      .calendar-apply {
        margin-left: auto;
        background: linear-gradient(135deg, var(--brand, #1c7c64), #123b33);
        color: white;
      }

      @media (max-width: 48rem) {
        .calendar-popover {
          width: min(100%, 22rem);
        }
      }
    `,
  ],
})
export class CalendarInputComponent
  implements OnChanges, AfterViewChecked, OnDestroy
{
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly document = inject(DOCUMENT);
  private popoverMounted = false;

  @ViewChild("trigger", { read: ElementRef })
  private readonly triggerRef?: ElementRef<HTMLElement>;

  @ViewChild("popover", { read: ElementRef })
  private readonly popoverRef?: ElementRef<HTMLElement>;

  @Input() value = "";
  @Input() label = "Selezione";
  @Input() placeholder = "Seleziona una data";
  @Input() mode: CalendarMode = "date";
  @Input() min = "";
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();

  open = false;
  popoverStyle: Record<string, string> = {};
  visibleMonth = this.startOfMonth(new Date());
  selectedDate: Date | null = null;
  selectedHour = "09";
  selectedMinute = "00";
  calendarCells: CalendarCell[] = [];

  readonly weekdays = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  readonly hours = Array.from({ length: 24 }, (_, index) => this.pad(index));
  readonly minutes = ["00", "15", "30", "45"];
  readonly hourOptions = this.hours.map((hour) => ({
    value: hour,
    label: hour,
  }));
  readonly minuteOptions = this.minutes.map((minute) => ({
    value: minute,
    label: minute,
  }));

  get monthLabel(): string {
    return new Intl.DateTimeFormat("it-IT", {
      month: "long",
      year: "numeric",
    }).format(this.visibleMonth);
  }

  get displayValue(): string {
    const source =
      this.open && this.selectedDate
        ? this.selectedDate
        : this.parseValue(this.value);

    if (!source) {
      return "";
    }

    return new Intl.DateTimeFormat("it-IT", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(this.mode === "datetime"
        ? { hour: "2-digit", minute: "2-digit" }
        : {}),
    }).format(source);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["value"] || changes["mode"] || changes["min"]) {
      this.syncFromValue();
    }
  }

  @HostListener("document:mousedown", ["$event"])
  onDocumentMouseDown(event: MouseEvent): void {
    if (!this.open) {
      return;
    }

    const target = event.target as Node | null;

    if (
      target &&
      !this.elementRef.nativeElement.contains(target) &&
      !this.popoverRef?.nativeElement.contains(target)
    ) {
      this.closePopover();
    }
  }

  @HostListener("window:resize")
  @HostListener("window:scroll")
  onViewportChange(): void {
    if (this.open) this.syncPopoverPosition();
  }

  ngAfterViewChecked(): void {
    if (this.open && !this.popoverMounted) this.mountPopover();
    if (this.open && this.popoverMounted) this.syncPopoverPosition();
  }

  ngOnDestroy(): void {
    this.unmountPopover();
  }

  toggleOpen(): void {
    if (this.disabled) {
      return;
    }

    this.open = !this.open;

    if (this.open) {
      this.syncFromValue();
    } else {
      this.unmountPopover();
    }
  }

  changeMonth(offset: number): void {
    this.visibleMonth = new Date(
      this.visibleMonth.getFullYear(),
      this.visibleMonth.getMonth() + offset,
      1,
    );
    this.buildCalendar();
  }

  selectDay(cell: CalendarCell): void {
    if (cell.isDisabled) {
      return;
    }

    const base = this.selectedDate
      ? new Date(this.selectedDate)
      : this.defaultSelectionDate();
    base.setFullYear(
      cell.value.getFullYear(),
      cell.value.getMonth(),
      cell.value.getDate(),
    );
    this.selectedDate = base;
    this.visibleMonth = this.startOfMonth(base);
    this.buildCalendar();

    if (this.mode === "date") {
      this.emitValue(this.selectedDate);
      this.closePopover();
    }
  }

  syncSelectedTime(): void {
    if (!this.selectedDate) {
      this.selectedDate = this.defaultSelectionDate();
    }

    this.selectedDate.setHours(
      Number(this.selectedHour),
      Number(this.selectedMinute),
      0,
      0,
    );
  }

  pickToday(): void {
    const nextValue = this.defaultSelectionDate();
    this.selectedDate = nextValue;
    this.visibleMonth = this.startOfMonth(nextValue);
    this.selectedHour = this.pad(nextValue.getHours());
    this.selectedMinute = this.padToQuarter(nextValue.getMinutes());
    this.syncSelectedTime();
    this.buildCalendar();

    if (this.mode === "date") {
      this.emitValue(nextValue);
      this.closePopover();
    }
  }

  applyDateTime(): void {
    const nextValue = this.selectedDate || this.defaultSelectionDate();
    nextValue.setHours(
      Number(this.selectedHour),
      Number(this.selectedMinute),
      0,
      0,
    );
    this.selectedDate = nextValue;
    this.emitValue(nextValue);
    this.closePopover();
  }

  clearValue(): void {
    this.valueChange.emit("");
    this.selectedDate = null;
    this.closePopover();
    this.buildCalendar();
  }

  private closePopover(): void {
    this.open = false;
    this.unmountPopover();
  }

  private mountPopover(): void {
    const popover = this.popoverRef?.nativeElement;
    if (!popover || this.popoverMounted) return;

    this.document.body.appendChild(popover);
    this.popoverMounted = true;
    this.syncPopoverPosition();
  }

  private unmountPopover(): void {
    const popover = this.popoverRef?.nativeElement;
    if (!popover || !this.popoverMounted) return;

    if (popover.parentElement === this.document.body) {
      this.document.body.removeChild(popover);
    }
    this.popoverMounted = false;
  }

  private syncPopoverPosition(): void {
    const trigger = this.triggerRef?.nativeElement;
    const popover = this.popoverRef?.nativeElement;
    if (!trigger || !popover) return;

    const scale = 1;
    const viewportPadding = 8;
    const triggerRect = trigger.getBoundingClientRect();
    const width = Math.min(352, window.innerWidth / scale - viewportPadding * 2);
    const left = Math.max(
      viewportPadding,
      Math.min(
        triggerRect.left / scale,
        window.innerWidth / scale - width - viewportPadding,
      ),
    );
    const height = popover.offsetHeight / scale;
    const top =
      triggerRect.bottom / scale + 10 + height <=
      window.innerHeight / scale - viewportPadding
        ? triggerRect.bottom / scale + 10
        : Math.max(viewportPadding, triggerRect.top / scale - 10 - height);

    this.popoverStyle = {
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      zIndex: "1000",
    };
  }

  private syncFromValue(): void {
    const parsed = this.parseValue(this.value);
    this.selectedDate = parsed;

    const base = parsed || this.defaultSelectionDate();
    this.visibleMonth = this.startOfMonth(base);
    this.selectedHour = this.pad(base.getHours());
    this.selectedMinute = this.padToQuarter(base.getMinutes());
    this.syncSelectedTime();
    this.buildCalendar();
  }

  private buildCalendar(): void {
    const monthStart = this.startOfMonth(this.visibleMonth);
    const gridStart = new Date(monthStart);
    const normalizedDay = (monthStart.getDay() + 6) % 7;
    gridStart.setDate(monthStart.getDate() - normalizedDay);

    const selected = this.selectedDate ? this.toDateKey(this.selectedDate) : "";
    const today = this.toDateKey(new Date());
    const minDate = this.parseValue(this.min);
    const minKey = minDate ? this.toDateKey(minDate) : "";

    this.calendarCells = Array.from({ length: 42 }, (_, index) => {
      const value = new Date(gridStart);
      value.setDate(gridStart.getDate() + index);
      const key = this.toDateKey(value);

      return {
        iso: key,
        day: value.getDate(),
        inMonth: value.getMonth() === this.visibleMonth.getMonth(),
        isToday: key === today,
        isSelected: key === selected,
        isDisabled: Boolean(minKey) && key < minKey,
        value,
      };
    });
  }

  private emitValue(value: Date): void {
    if (this.mode === "date") {
      this.valueChange.emit(this.toDateKey(value));
      return;
    }

    this.valueChange.emit(
      `${this.toDateKey(value)}T${this.pad(value.getHours())}:${this.pad(value.getMinutes())}`,
    );
  }

  private parseValue(value: string): Date | null {
    if (!value) {
      return null;
    }

    if (this.mode === "date") {
      const [year, month, day] = value.split("-").map(Number);

      if (!year || !month || !day) {
        return null;
      }

      return new Date(year, month - 1, day, 0, 0, 0, 0);
    }

    const [datePart, timePart = "09:00"] = value.split("T");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hours, minutes] = timePart.split(":").map(Number);

    if (!year || !month || !day) {
      return null;
    }

    return new Date(year, month - 1, day, hours || 0, minutes || 0, 0, 0);
  }

  private defaultSelectionDate(): Date {
    const now = new Date();
    const minutes = Math.ceil(now.getMinutes() / 15) * 15;

    if (this.mode === "date") {
      return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        0,
        0,
        0,
      );
    }

    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      minutes % 60,
      0,
      0,
    );
  }

  private startOfMonth(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), 1);
  }

  private toDateKey(value: Date): string {
    return `${value.getFullYear()}-${this.pad(value.getMonth() + 1)}-${this.pad(value.getDate())}`;
  }

  private pad(value: number): string {
    return String(value).padStart(2, "0");
  }

  private padToQuarter(value: number): string {
    return this.pad(Math.min(45, Math.max(0, Math.round(value / 15) * 15)));
  }
}
