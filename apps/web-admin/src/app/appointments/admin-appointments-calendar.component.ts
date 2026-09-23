import { CommonModule } from "@angular/common";
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from "@angular/core";
import { CalendarInputComponent } from "../calendar-input.component";

@Component({
  selector: "barber-admin-appointments-calendar",
  standalone: true,
  imports: [CommonModule, CalendarInputComponent],
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        min-height: 0;
      }

      .calendar-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }

      .calendar-view-active {
        background: var(--accent);
        color: white;
        border-color: transparent;
      }

      .text-accent-strong {
        color: var(--accent);
      }

      .calendar-month-cell-active {
        background: rgba(255, 255, 255, 0.8);
      }

      .calendar-month-cell-muted {
        background: rgba(241, 245, 249, 0.7);
      }

      .calendar-unavailable-day {
        background: rgba(245, 158, 11, 0.08);
      }

      .calendar-day-track {
        background-image: linear-gradient(
          to bottom,
          rgba(148, 163, 184, 0.18) 1px,
          transparent 1px
        );
        background-size: 100% 2.75rem;
      }

      .calendar-hour-grid {
        display: grid;
        grid-template-rows: repeat(20, 2.75rem);
      }

      .calendar-hour-label {
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
        padding-right: 0.75rem;
        font-size: 0.72rem;
        color: var(--muted);
      }

      .calendar-slot-line {
        border-top: 1px dashed rgba(148, 163, 184, 0.2);
      }

      .calendar-slot-line-half {
        border-top: 1px dotted rgba(148, 163, 184, 0.12);
      }

      .calendar-working-band {
        position: absolute;
        left: 0.5rem;
        right: 0.5rem;
        border-radius: 1rem;
        background: rgba(16, 185, 129, 0.08);
        border: 1px dashed rgba(16, 185, 129, 0.22);
      }

      .calendar-drag-preview {
        outline: 2px dashed rgba(249, 115, 22, 0.45);
        outline-offset: -4px;
        background: rgba(249, 115, 22, 0.08);
      }

      .calendar-drag-ghost {
        pointer-events: none;
        z-index: 2;
        opacity: 0.55;
        border: 1px dashed rgba(255, 255, 255, 0.65);
        box-shadow: 0 18px 30px rgba(15, 23, 32, 0.2);
        transition:
          top 120ms ease,
          min-height 120ms ease;
      }

      .calendar-current-time-line {
        position: absolute;
        left: 0.5rem;
        right: 0.5rem;
        height: 2px;
        background: #ef4444;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.38);
        z-index: 3;
      }

      .calendar-current-time-dot {
        position: absolute;
        left: -0.2rem;
        top: -0.27rem;
        width: 0.6rem;
        height: 0.6rem;
        border-radius: 999px;
        background: #ef4444;
      }

      .calendar-month-cell.calendar-is-selected,
      .calendar-week-day.calendar-is-selected {
        box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.22) inset;
      }

      .calendar-month-cell.calendar-is-today,
      .calendar-week-day.calendar-is-today {
        border-color: rgba(249, 115, 22, 0.42);
      }

      .calendar-sticky-header {
        position: sticky;
        top: 0;
        z-index: 6;
        backdrop-filter: blur(12px);
      }

      .calendar-day-column-header-surface {
        min-height: 4.75rem;
        border: 1px solid rgba(15, 23, 32, 0.08);
        border-radius: 1.6rem 1.6rem 0 0;
        background: rgba(249, 246, 240, 0.94);
        padding: 1rem 1rem 0.95rem;
      }

      .calendar-main {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
        margin-top: 1.25rem;
        overflow: hidden;
      }

      .calendar-day-scroll {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        width: 100%;
        max-width: 100%;
        min-height: 0;
        overflow: hidden;
      }

      .calendar-view-viewport {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        width: 100%;
        min-height: 0;
        overflow: hidden;
      }

      .calendar-day-grid {
        display: flex;
        width: 100%;
        max-width: 100%;
        height: 100%;
        min-height: 0;
        align-items: flex-start;
        gap: 1rem;
        min-width: 0;
        overflow: auto;
      }

      .calendar-day-columns {
        display: flex;
        flex: 1 1 auto;
        gap: 1rem;
        align-items: flex-start;
        min-width: 0;
        width: 100%;
      }

      .calendar-day-column {
        flex: 1 1 0;
        min-width: 0;
        max-width: 100%;
        display: flex;
        flex-direction: column;
        align-self: flex-start;
        border-radius: 1.6rem;
        overflow: visible;
      }

      .calendar-hour-rail {
        position: sticky;
        left: 0;
        top: 0;
        z-index: 5;
        flex: 0 0 4.25rem;
        background: rgba(244, 241, 234, 0.92);
        align-self: flex-start;
      }

      .calendar-hour-rail-spacer {
        height: 5rem;
      }

      .calendar-day-empty {
        position: absolute;
        inset-inline: 1rem;
        top: 1rem;
        z-index: 1;
      }

      .calendar-day-column-track {
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
        border: 1px solid rgba(15, 23, 32, 0.08);
        border-top: 0;
        border-radius: 0 0 1.6rem 1.6rem;
        background: rgba(255, 255, 255, 0.82);
        display: block;
        width: 100%;
        margin-top: -1px;
        padding: 0.75rem 0.75rem 0.75rem;
      }

      .calendar-week-shell {
        display: grid;
        flex: 1 1 auto;
        grid-template-rows: auto minmax(0, 1fr);
        min-height: 0;
        gap: 0.75rem;
        overflow: hidden;
      }

      .calendar-week-grid {
        display: grid;
        gap: 0.75rem;
        min-height: 0;
        overflow: auto;
      }

      .calendar-week-day-card {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }

      .calendar-week-day-scroll {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        padding-right: 0.25rem;
      }

      .calendar-week-day-header {
        position: sticky;
        top: 0;
        z-index: 2;
        background: rgba(255, 255, 255, 0.92);
        backdrop-filter: blur(12px);
      }

      .calendar-week-legend {
        flex: 0 0 auto;
        padding: 0.5rem 0.65rem;
      }

      .calendar-week-legend-chip {
        padding: 0.34rem 0.65rem;
        font-size: 0.78rem;
      }

      .calendar-month-shell {
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        flex: 1 1 auto;
        min-height: 0;
        gap: 0.75rem;
        overflow: hidden;
      }

      .calendar-month-legend {
        padding: 0.5rem 0.65rem;
      }

      .calendar-month-legend-chip {
        padding: 0.34rem 0.65rem;
        font-size: 0.78rem;
      }

      .calendar-month-weekdays {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 0.75rem;
        position: sticky;
        top: 0;
        z-index: 3;
        background: rgba(244, 241, 234, 0.92);
        padding-bottom: 0.1rem;
        backdrop-filter: blur(12px);
      }

      .calendar-month-weekday {
        border: 1px solid rgba(15, 23, 32, 0.08);
        border-radius: 1rem;
        background: rgba(255, 255, 255, 0.72);
        padding: 0.75rem;
        text-align: center;
        font-size: 0.76rem;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .calendar-month-grid {
        display: grid;
        gap: 0.75rem;
        min-height: 0;
        overflow: auto;
      }
    `,
  ],
  template: `
    <article class="calendar-shell panel rounded-[2rem] p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="eyebrow text-[var(--accent)]">Calendario agenda</p>
          <h3 class="font-display text-3xl">{{ title }}</h3>
        </div>
        <div class="ml-auto flex w-full flex-col gap-2 sm:w-auto sm:min-w-[16rem]">
          <barber-calendar-input
            [value]="calendarDateKey"
            (valueChange)="selectDateKey($event)"
            label="Vai a"
            placeholder="Seleziona data"
          ></barber-calendar-input>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="pill-btn" (click)="today.emit()">
              Oggi
            </button>
            <button type="button" class="pill-btn" (click)="navigate.emit(-1)">
              Prev
            </button>
            <button type="button" class="pill-btn" (click)="navigate.emit(1)">
              Next
            </button>
          </div>
        </div>
      </div>

      <div class="mt-5 flex flex-wrap gap-2">
        <button
          *ngFor="let option of viewOptions"
          type="button"
          class="pill-btn"
          [class.calendar-view-active]="view === option.value"
          (click)="viewChange.emit(option.value)"
        >
          {{ option.label }}
        </button>
      </div>

      <div class="mt-5 grid gap-3 md:grid-cols-4">
        <article
          class="rounded-[1.4rem] border border-[var(--line)]/70 bg-white/75 p-4"
        >
          <p class="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
            Eventi
          </p>
          <strong class="mt-2 block font-display text-3xl">{{
            summary.total
          }}</strong>
        </article>
        <article
          class="rounded-[1.4rem] border border-[var(--line)]/70 bg-white/75 p-4"
        >
          <p class="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
            Confermati
          </p>
          <strong class="mt-2 block font-display text-3xl">{{
            summary.confirmed
          }}</strong>
        </article>
        <article
          class="rounded-[1.4rem] border border-[var(--line)]/70 bg-white/75 p-4"
        >
          <p class="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
            Completati
          </p>
          <strong class="mt-2 block font-display text-3xl">{{
            summary.completed
          }}</strong>
        </article>
        <article
          class="rounded-[1.4rem] border border-[var(--line)]/70 bg-white/75 p-4"
        >
          <p class="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">
            Valore
          </p>
          <strong class="mt-2 block font-display text-3xl"
            >€{{ summary.revenue.toFixed(0) }}</strong
          >
        </article>
      </div>

      <main class="calendar-main">
        <section
          *ngIf="view === 'day'"
          class="calendar-day-scroll calendar-view-viewport"
        >
          <article
            *ngIf="!dayColumns.length"
            class="rounded-[1.4rem] border border-[var(--line)]/70 bg-white/80 p-5 text-sm text-[var(--muted)]"
          >
            Nessun collaboratore disponibile per il giorno selezionato o dati
            ancora in caricamento.
          </article>

          <div
            *ngIf="dayColumns.length"
            #dayScrollContainer
            class="calendar-day-grid gap-4"
          >
            <div class="calendar-hour-rail">
              <div class="calendar-hour-rail-spacer"></div>
              <div class="calendar-hour-grid">
                <div
                  *ngFor="let slot of timeSlots; let i = index"
                  class="calendar-hour-label"
                >
                  <span *ngIf="i % 2 === 0">{{ slot }}</span>
                </div>
              </div>
            </div>

            <div class="calendar-day-columns">
              <article
                *ngFor="let column of dayColumns; trackBy: trackByColumn"
                class="calendar-day-column"
                [class.calendar-is-today]="isCurrentCalendarDate()"
                [class.calendar-is-selected]="isCurrentCalendarDate()"
              >
                <header
                  class="calendar-sticky-header calendar-day-column-header-surface flex items-center justify-between gap-4"
                >
                  <div>
                    <strong>{{ column.label }}</strong>
                    <p class="mt-1 text-xs text-[var(--muted)]">
                      <ng-container
                        *ngIf="
                          column.workingWindow.isAvailable;
                          else unavailableDay
                        "
                      >
                        {{ column.workingWindow.startTime }} -
                        {{ column.workingWindow.endTime }}
                      </ng-container>
                      <ng-template #unavailableDay>
                        {{
                          column.workingWindow.isHoliday
                            ? "Festivo"
                            : "Non disponibile"
                        }}
                      </ng-template>
                    </p>
                  </div>
                  <span
                    class="inline-flex size-3 rounded-full"
                    [style.background]="column.color"
                  ></span>
                </header>
                <div
                  class="calendar-day-column-track"
                  [class.calendar-unavailable-day]="
                    !column.workingWindow.isAvailable
                  "
                >
                  <div
                    class="calendar-day-track relative min-h-[55rem] rounded-[1.2rem] bg-white/80"
                    (dragover)="handleDayDragOver($event, column)"
                    (dragleave)="handleDayDragLeave($event, column.id)"
                    (drop)="handleDrop($event, column.id)"
                  >
                    <div
                      class="calendar-hour-grid absolute inset-0 pointer-events-none"
                    >
                      <div
                        *ngFor="let slot of timeSlots; let i = index"
                        [class.calendar-slot-line]="i % 2 === 0"
                        [class.calendar-slot-line-half]="i % 2 === 1"
                      ></div>
                    </div>
                    <div
                      *ngIf="isCurrentCalendarDate()"
                      class="calendar-current-time-line"
                      [style.top.rem]="currentTimeTop()"
                    >
                      <span class="calendar-current-time-dot"></span>
                    </div>
                    <div
                      *ngIf="column.workingWindow.isAvailable"
                      class="calendar-working-band"
                      [style.top.rem]="
                        workingBandTop(column.workingWindow.startTime)
                      "
                      [style.height.rem]="
                        workingBandHeight(
                          column.workingWindow.startTime,
                          column.workingWindow.endTime
                        )
                      "
                    ></div>
                    <div
                      *ngIf="
                        draggedAppointment &&
                        dayDragPreview &&
                        dayDragPreview.columnId === column.id
                      "
                      class="calendar-drag-ghost absolute left-2 right-2 rounded-[1rem] px-3 py-2 text-left text-white"
                      [style.top.rem]="dayDragPreview.top"
                      [style.min-height.rem]="dayDragPreview.height"
                      [style.background]="dayDragPreview.color"
                    >
                      <strong class="block text-sm"
                        >{{ dayDragPreview.timeLabel }} ·
                        {{ dayDragPreview.title }}</strong
                      >
                      <span class="block text-xs text-white/80">{{
                        dayDragPreview.subtitle
                      }}</span>
                    </div>
                    <button
                      *ngFor="
                        let appointment of column.appointments;
                        trackBy: trackByAppointment
                      "
                      type="button"
                      class="absolute left-2 right-2 rounded-[1rem] px-3 py-2 text-left text-white shadow-lg"
                      [style.top.rem]="appointment.top"
                      [style.min-height.rem]="appointment.height"
                      [style.background]="appointment.color"
                      draggable="true"
                      (dragstart)="handleDragStart($event, appointment.id)"
                      (dragend)="handleDragEnd()"
                      (click)="appointmentClick.emit(appointment.id)"
                    >
                      <strong class="block text-sm"
                        >{{ appointment.timeLabel }} ·
                        {{ appointment.title }}</strong
                      >
                      <span class="block text-xs text-white/80">{{
                        appointment.subtitle
                      }}</span>
                    </button>
                    <div
                      *ngIf="!column.appointments.length"
                      class="calendar-day-empty rounded-[0.9rem] border border-dashed border-[var(--line)]/80 bg-white/70 px-3 py-2 text-xs text-[var(--muted)]"
                    >
                      Nessun appuntamento pianificato
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section *ngIf="view === 'week'" class="calendar-view-viewport">
          <div class="calendar-week-shell">
            <div
              class="calendar-week-legend flex flex-wrap gap-2 rounded-[1.4rem] border border-[var(--line)]/70 bg-white/72"
            >
              <div
                *ngFor="let option of weekDays[0]?.collaboratorLegend || []"
                class="calendar-week-legend-chip inline-flex items-center gap-2 rounded-full border border-[var(--line)]/70 bg-white/80"
              >
                <span
                  class="inline-flex size-2.5 rounded-full"
                  [style.background]="option.color"
                ></span>
                <span>{{ option.collaboratorLabel }}</span>
              </div>
            </div>

            <div class="calendar-week-grid lg:grid-cols-7">
              <article
                *ngFor="let day of weekDays; trackBy: trackByKey"
                class="calendar-week-day calendar-week-day-card rounded-[1.5rem] border border-[var(--line)]/70 bg-white/80 p-3"
                [class.calendar-unavailable-day]="day.isUnavailable"
                [class.calendar-is-today]="day.isToday"
                [class.calendar-is-selected]="day.isSelected"
                [class.calendar-drag-preview]="
                  dragOverKey === 'week:' + day.key
                "
                (click)="selectCalendarDate(day.date)"
                (dblclick)="openDayView(day.date)"
                (dragenter)="dragOverKey = 'week:' + day.key"
                (dragover)="handleDragOver($event, 'week:' + day.key)"
                (drop)="handleWeekDrop($event, day)"
              >
                <header
                  class="calendar-week-day-header mb-3 border-b border-[var(--line)]/70 pb-3"
                >
                  <strong [class.text-accent-strong]="day.isToday">{{
                    day.label
                  }}</strong>
                  <p class="mt-1 text-xs text-[var(--muted)]">
                    {{ day.statusLabel }}
                  </p>
                </header>
                <div class="calendar-week-day-scroll">
                  <div class="grid gap-2">
                    <button
                      *ngFor="
                        let appointment of day.appointments;
                        trackBy: trackByAppointment
                      "
                      type="button"
                      class="rounded-[1rem] px-3 py-2 text-left text-white"
                      [style.background]="appointment.color"
                      draggable="true"
                      (dragstart)="handleDragStart($event, appointment.id)"
                      (click)="appointmentClick.emit(appointment.id)"
                    >
                      <strong class="block text-sm"
                        >{{ appointment.timeLabel }} ·
                        {{ appointment.title }}</strong
                      >
                      <span class="block text-xs text-white/75">{{
                        appointment.subtitle
                      }}</span>
                    </button>
                    <p
                      *ngIf="!day.appointments.length"
                      class="text-sm text-[var(--muted)]"
                    >
                      Nessun evento
                    </p>
                    <button
                      *ngIf="day.hiddenCount > 0"
                      type="button"
                      class="pill-btn justify-start"
                      (click)="
                        openDayListing(day.date, 'week');
                        $event.stopPropagation()
                      "
                    >
                      +{{ day.hiddenCount }} more
                    </button>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section *ngIf="view === 'month'" class="calendar-view-viewport">
          <div class="calendar-month-shell">
            <div
              class="calendar-month-legend flex flex-wrap gap-2 rounded-[1.4rem] border border-[var(--line)]/70 bg-white/72"
            >
              <div
                *ngFor="let option of weekDays[0]?.collaboratorLegend || []"
                class="calendar-month-legend-chip inline-flex items-center gap-2 rounded-full border border-[var(--line)]/70 bg-white/80"
              >
                <span
                  class="inline-flex size-2.5 rounded-full"
                  [style.background]="option.color"
                ></span>
                <span>{{ option.collaboratorLabel }}</span>
              </div>
            </div>

            <div class="calendar-month-weekdays">
              <div
                *ngFor="let weekday of monthWeekdays"
                class="calendar-month-weekday"
              >
                {{ weekday }}
              </div>
            </div>

            <div class="calendar-month-grid md:grid-cols-7">
              <article
                *ngFor="let cell of monthCells; trackBy: trackByKey"
                class="calendar-month-cell min-h-[9rem] rounded-[1.4rem] border border-[var(--line)]/70 p-3"
                [class.calendar-month-cell-active]="cell.inMonth"
                [class.calendar-month-cell-muted]="!cell.inMonth"
                [class.calendar-unavailable-day]="cell.isUnavailable"
                [class.calendar-is-today]="cell.isToday"
                [class.calendar-is-selected]="cell.isSelected"
                [class.calendar-drag-preview]="
                  dragOverKey === 'month:' + cell.key
                "
                (click)="selectCalendarDate(cell.date)"
                (dblclick)="openDayView(cell.date)"
                (dragenter)="dragOverKey = 'month:' + cell.key"
                (dragover)="handleDragOver($event, 'month:' + cell.key)"
                (drop)="handleMonthDrop($event, cell.date)"
              >
                <header class="mb-2 flex items-center justify-between gap-2">
                  <strong [class.text-accent-strong]="cell.isToday">{{
                    cell.date.getDate()
                  }}</strong>
                </header>
                <div class="grid gap-2">
                  <button
                    *ngFor="
                      let appointment of cell.visibleAppointments;
                      trackBy: trackByAppointment
                    "
                    type="button"
                    class="rounded-[0.9rem] px-2 py-1 text-left text-xs text-white"
                    [style.background]="appointment.color"
                    draggable="true"
                    (dragstart)="handleDragStart($event, appointment.id)"
                    (click)="appointmentClick.emit(appointment.id)"
                  >
                    {{ appointment.timeLabel }} · {{ appointment.title }}
                  </button>
                  <button
                    *ngIf="cell.hiddenCount > 0"
                    type="button"
                    class="pill-btn justify-start"
                    (click)="
                      openDayListing(cell.date, 'month');
                      $event.stopPropagation()
                    "
                  >
                    +{{ cell.hiddenCount }} more
                  </button>
                </div>
              </article>
            </div>
          </div>
        </section>
      </main>
    </article>
  `,
})
export class AdminAppointmentsCalendarComponent
  implements AfterViewInit, OnChanges
{
  private static readonly DAY_START_MINUTES = 9 * 60;
  private static readonly DAY_END_MINUTES = 19 * 60;
  private static readonly SLOT_HEIGHT_REM = 2.75;

  @ViewChild("dayScrollContainer")
  private readonly dayScrollContainer?: ElementRef<HTMLElement>;

  @Input() title = "";
  @Input() view: "day" | "week" | "month" = "week";
  @Input() calendarDate: Date = new Date();
  @Input() summary = {
    total: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
    revenue: 0,
    durationHours: 0,
  };
  @Input() dayColumns: any[] = [];
  @Input() weekDays: any[] = [];
  @Input() monthCells: any[] = [];
  dragOverKey = "";
  draggedAppointment: any = null;
  dayDragPreview: {
    columnId: string;
    top: number;
    height: number;
    color: string;
    timeLabel: string;
    title: string;
    subtitle: string;
  } | null = null;

  @Output() viewChange = new EventEmitter<"day" | "week" | "month">();
  @Output() navigate = new EventEmitter<-1 | 1>();
  @Output() today = new EventEmitter<void>();
  @Output() calendarDateSelect = new EventEmitter<Date>();
  @Output() appointmentClick = new EventEmitter<string>();
  @Output() appointmentDrop = new EventEmitter<{
    appointmentId: string;
    collaboratorId: string;
    startsAt: string;
  }>();
  @Output() appointmentRescheduleRequest = new EventEmitter<{
    appointmentId: string;
    targetDate: string;
    suggestedStartsAt: string;
    suggestedCollaboratorId: string;
    sourceView: "week" | "month";
  }>();
  @Output() showDayAppointments = new EventEmitter<{
    date: string;
    sourceView: "week" | "month";
  }>();

  readonly viewOptions = [
    { value: "day" as const, label: "Giorno" },
    { value: "week" as const, label: "Settimana" },
    { value: "month" as const, label: "Mese" },
  ];
  readonly monthWeekdays = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

  readonly hours = Array.from(
    { length: 10 },
    (_, index) =>
      `${String(index + AdminAppointmentsCalendarComponent.DAY_START_MINUTES / 60).padStart(2, "0")}:00`,
  );
  readonly timeSlots = Array.from({ length: 20 }, (_, index) => {
    const totalMinutes =
      AdminAppointmentsCalendarComponent.DAY_START_MINUTES + index * 30;
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  });

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  workingBandTop(startTime: string): number {
    const startMinutes = this.parseTime(startTime);
    return this.minutesToTrackRem(startMinutes);
  }

  workingBandHeight(startTime: string, endTime: string): number {
    const clampedStart = this.clampMinutesToTrack(this.parseTime(startTime));
    const clampedEnd = this.clampMinutesToTrack(this.parseTime(endTime));
    const diffMinutes = Math.max(0, clampedEnd - clampedStart);
    return Math.max(
      AdminAppointmentsCalendarComponent.SLOT_HEIGHT_REM,
      (diffMinutes / 30) * AdminAppointmentsCalendarComponent.SLOT_HEIGHT_REM,
    );
  }

  isCurrentCalendarDate(): boolean {
    return this.isSameDay(this.calendarDate, new Date());
  }

  currentTimeTop(): number {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    return this.minutesToTrackRem(minutes);
  }

  selectCalendarDate(date: Date): void {
    this.calendarDateSelect.emit(new Date(date));
  }

  trackByColumn(_index: number, item: any): string {
    return item.id;
  }

  trackByKey(_index: number, item: any): string {
    return item.key;
  }

  trackByAppointment(_index: number, item: any): string {
    return item.id;
  }

  get calendarDateKey(): string {
    const date =
      this.calendarDate instanceof Date
        ? this.calendarDate
        : new Date(this.calendarDate);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  selectDateKey(value: string): void {
    if (!value) {
      return;
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, (month ?? 1) - 1, day ?? 1);
    if (!Number.isNaN(date.getTime())) {
      this.calendarDateSelect.emit(date);
    }
  }

  openDayView(date: Date): void {
    this.calendarDateSelect.emit(new Date(date));
    this.viewChange.emit("day");
  }

  ngAfterViewInit(): void {
    this.scrollDayViewIntoPosition();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["view"] || changes["calendarDate"]) {
      queueMicrotask(() => this.scrollDayViewIntoPosition());
    }
  }

  private parseTime(value: string): number {
    const [hours, minutes] = value.split(":").map((segment) => Number(segment));
    return hours * 60 + minutes;
  }

  private isSameDay(left: Date, right: Date): boolean {
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    );
  }

  private scrollDayViewIntoPosition(): void {
    if (this.view !== "day") {
      return;
    }

    requestAnimationFrame(() => {
      const container = this.dayScrollContainer?.nativeElement;
      if (!container) {
        return;
      }

      const targetTopRem = this.isCurrentCalendarDate()
        ? Math.max(0, this.currentTimeTop() - 8)
        : 0;
      const maxScrollTop = Math.max(
        0,
        container.scrollHeight - container.clientHeight,
      );
      const targetTopPx = Math.min(maxScrollTop, targetTopRem * 16);

      container.scrollTo({ top: targetTopPx, behavior: "auto" });
    });
  }

  private clampMinutesToTrack(minutes: number): number {
    return Math.min(
      AdminAppointmentsCalendarComponent.DAY_END_MINUTES,
      Math.max(AdminAppointmentsCalendarComponent.DAY_START_MINUTES, minutes),
    );
  }

  private minutesToTrackRem(minutes: number): number {
    return (
      ((this.clampMinutesToTrack(minutes) -
        AdminAppointmentsCalendarComponent.DAY_START_MINUTES) /
        30) *
      AdminAppointmentsCalendarComponent.SLOT_HEIGHT_REM
    );
  }

  handleDragStart(event: DragEvent, appointmentId: string): void {
    event.dataTransfer?.setData("text/plain", appointmentId);
    const appointment = this.findDraggedAppointment(appointmentId);
    if (appointment) {
      this.draggedAppointment = appointment;
      event.dataTransfer?.setData(
        "application/json",
        JSON.stringify({
          appointmentId,
          originalStartsAt: appointment.startsAt,
          originalCollaboratorId: appointment.collaboratorId,
        }),
      );
    }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      const ghost = document.createElement("div");
      ghost.style.width = "1px";
      ghost.style.height = "1px";
      ghost.style.opacity = "0";
      ghost.style.position = "fixed";
      ghost.style.top = "0";
      ghost.style.left = "0";
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 0, 0);
      queueMicrotask(() => ghost.remove());
    }
  }

  handleDragOver(event: DragEvent, key?: string): void {
    event.preventDefault();
    if (key) {
      this.dragOverKey = key;
    }
  }

  handleDayDragOver(event: DragEvent, column: any): void {
    event.preventDefault();
    if (!this.draggedAppointment) {
      return;
    }
    const track = event.currentTarget as HTMLElement;
    const rect = track.getBoundingClientRect();
    if (!rect.height) {
      return;
    }
    const totalSlots = Math.round(
      (AdminAppointmentsCalendarComponent.DAY_END_MINUTES -
        AdminAppointmentsCalendarComponent.DAY_START_MINUTES) /
        30,
    );
    const slotPx = rect.height / totalSlots;
    const heightSlots = Math.max(
      1,
      Math.ceil(
        this.draggedAppointment.height /
          AdminAppointmentsCalendarComponent.SLOT_HEIGHT_REM,
      ),
    );
    const rawIndex = Math.floor((event.clientY - rect.top) / slotPx);
    const slotIndex = Math.max(
      0,
      Math.min(totalSlots - heightSlots, rawIndex),
    );
    const totalMinutes =
      AdminAppointmentsCalendarComponent.DAY_START_MINUTES + slotIndex * 30;
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    this.dragOverKey = "day:" + column.id;
    this.dayDragPreview = {
      columnId: column.id,
      top:
        slotIndex * AdminAppointmentsCalendarComponent.SLOT_HEIGHT_REM,
      height: this.draggedAppointment.height,
      color: this.draggedAppointment.color,
      timeLabel: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      title: this.draggedAppointment.title,
      subtitle: this.draggedAppointment.subtitle,
    };
  }

  handleDayDragLeave(event: DragEvent, columnId: string): void {
    const next = event.relatedTarget as Node | null;
    const current = event.currentTarget as HTMLElement;
    if (next && current.contains(next)) {
      return;
    }
    if (this.dayDragPreview?.columnId === columnId) {
      this.dayDragPreview = null;
    }
  }

  handleDragEnd(): void {
    this.dragOverKey = "";
    this.draggedAppointment = null;
    this.dayDragPreview = null;
  }

  clearDragPreview(key: string): void {
    if (this.dragOverKey === key) {
      this.dragOverKey = "";
    }
  }

  handleDrop(event: DragEvent, collaboratorId: string): void {
    event.preventDefault();
    this.dragOverKey = "";
    this.dayDragPreview = null;
    const payload = this.readDragPayload(event);
    if (!payload) {
      return;
    }

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const relativeY = Math.max(
      0,
      Math.min(rect.height, event.clientY - rect.top),
    );
    const startsAt = this.buildDropDateTime(
      relativeY,
      rect.height,
      new Date(this.calendarDate),
    );

    const nextCollaboratorId =
      payload.originalCollaboratorId === collaboratorId
        ? payload.originalCollaboratorId
        : collaboratorId;

    this.appointmentDrop.emit({
      appointmentId: payload.appointmentId,
      collaboratorId: nextCollaboratorId,
      startsAt,
    });
  }

  handleWeekDrop(
    event: DragEvent,
    day: {
      date: Date;
    },
  ): void {
    event.preventDefault();
    this.dragOverKey = "";
    const payload = this.readDragPayload(event);
    if (!payload) {
      return;
    }

    const original = new Date(payload.originalStartsAt);
    const target = new Date(day.date);
    target.setHours(original.getHours(), original.getMinutes(), 0, 0);
    this.appointmentRescheduleRequest.emit({
      appointmentId: payload.appointmentId,
      targetDate: target.toISOString().slice(0, 10),
      suggestedStartsAt: this.toLocalDateTimeValue(target),
      suggestedCollaboratorId: payload.originalCollaboratorId,
      sourceView: "week",
    });
  }

  handleMonthDrop(event: DragEvent, date: Date): void {
    event.preventDefault();
    this.dragOverKey = "";
    const payload = this.readDragPayload(event);
    if (!payload) {
      return;
    }

    const original = new Date(payload.originalStartsAt);
    const target = new Date(date);
    target.setHours(original.getHours(), original.getMinutes(), 0, 0);
    this.appointmentRescheduleRequest.emit({
      appointmentId: payload.appointmentId,
      targetDate: target.toISOString().slice(0, 10),
      suggestedStartsAt: this.toLocalDateTimeValue(target),
      suggestedCollaboratorId: payload.originalCollaboratorId,
      sourceView: "month",
    });
  }

  openDayListing(date: Date, sourceView: "week" | "month"): void {
    this.showDayAppointments.emit({
      date: date.toISOString().slice(0, 10),
      sourceView,
    });
  }

  private buildDropDateTime(
    relativeY: number,
    height: number,
    day: Date,
    workingWindow?: { startTime: string; endTime: string },
  ): string {
    const startMinutes = workingWindow
      ? this.parseTime(workingWindow.startTime)
      : 9 * 60;
    const endMinutes = workingWindow
      ? this.parseTime(workingWindow.endTime)
      : 19 * 60;
    const totalSlots = Math.max(
      1,
      Math.floor((endMinutes - startMinutes) / 30),
    );
    const slotSize = height / totalSlots;
    const slotIndex = Math.max(
      0,
      Math.min(totalSlots - 1, Math.floor(relativeY / slotSize)),
    );
    const totalMinutes = startMinutes + slotIndex * 30;
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;

    return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  private readDragPayload(event: DragEvent): {
    appointmentId: string;
    originalStartsAt: string;
    originalCollaboratorId: string;
  } | null {
    const raw = event.dataTransfer?.getData("application/json");
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    const appointmentId = event.dataTransfer?.getData("text/plain");
    if (!appointmentId) {
      return null;
    }
    const appointment = this.findDraggedAppointment(appointmentId);
    if (!appointment) {
      return null;
    }
    return {
      appointmentId,
      originalStartsAt: appointment.startsAt,
      originalCollaboratorId: appointment.collaboratorId,
    };
  }

  private findDraggedAppointment(appointmentId: string): any {
    for (const column of this.dayColumns || []) {
      const match = (column.appointments || []).find(
        (entry: any) => entry.id === appointmentId,
      );
      if (match) {
        return match;
      }
    }
    for (const day of this.weekDays || []) {
      const match = (day.appointments || []).find(
        (entry: any) => entry.id === appointmentId,
      );
      if (match) {
        return match;
      }
    }
    for (const cell of this.monthCells || []) {
      const match = (cell.visibleAppointments || []).find(
        (entry: any) => entry.id === appointmentId,
      );
      if (match) {
        return match;
      }
    }
    return null;
  }

  private toLocalDateTimeValue(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    const hours = String(value.getHours()).padStart(2, "0");
    const minutes = String(value.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }
}
