import { localBookingTime } from "./booking-local-time";
import { SessionStore } from "../core/session.store";
import { CommonModule } from "@angular/common";
import {
  AfterViewInit,
  Component,
  inject,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from "@angular/core";
import { CalendarInputComponent } from "../calendar-input.component";
import { toLocalDateKey } from "@barber/shared/utils";
import { buildDayListingEvent } from "./calendar-date";
import {
  Interval,
  bookingInterval,
  clockToMinutes,
  closedSegments,
  fitPxPerMinute,
  hourMarks,
  layoutLanes,
  localDateTime,
  magnetEdges,
  minutesToClock,
  minutesToPx,
  overlaps,
  pxToMinutes,
  snapStart,
  timeRange,
  timeRangeLabel,
  visibleDays,
} from "./calendar-time-grid";

interface GridCard {
  id: string;
  start: number;
  end: number;
  duration: number;
  left: string;
  width: string;
  color: string;
  startLabel: string;
  endLabel: string;
  title: string;
  subtitle: string;
  ariaLabel: string;
  collaboratorId: string;
  status: string;
  revision?: number;
}

interface GridColumn {
  key: string;
  date: Date;
  dateKey: string;
  label: string;
  sublabel: string;
  color?: string;
  collaboratorId?: string;
  isToday: boolean;
  isSelected: boolean;
  closed: boolean;
  window: Interval | null;
  shaded: Array<Interval & { duration: number }>;
  cards: GridCard[];
}

interface GridModel {
  view: "day" | "week";
  range: Interval;
  hours: number[];
  columns: GridColumn[];
}

interface PointerDrag {
  pointerId: number;
  pointerType: string;
  element: HTMLElement;
  card: GridCard;
  sourceColumnKey: string;
  startX: number;
  startY: number;
  /** Minutes between the booking start and the grab point. */
  grabOffset: number;
  active: boolean;
  longPress?: ReturnType<typeof setTimeout>;
}

interface DragGhost {
  columnKey: string;
  start: number;
  duration: number;
  label: string;
  title: string;
  color: string;
  conflict: boolean;
  magnet: number | null;
}

/** Mouse/pen: movement before a press becomes a drag (clicks stay clicks). */
const DRAG_THRESHOLD_PX = 4;
/** Touch: hold this long to pick a booking up; moving earlier scrolls. */
const TOUCH_HOLD_MS = 350;
const TOUCH_SLOP_PX = 10;
const HEADER_HEIGHT_PX = 58;
const AUTO_SCROLL_EDGE_PX = 36;

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
        container-type: inline-size;
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

      .calendar-drag-preview {
        outline: 2px dashed rgba(136, 189, 57, 0.45);
        outline-offset: -4px;
        background: rgba(136, 189, 57, 0.08);
      }

      .calendar-current-time-line {
        position: absolute;
        left: 0;
        right: 0;
        height: 2px;
        background: #ef4444;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.38);
        z-index: 3;
        pointer-events: none;
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

      .calendar-month-cell.calendar-is-selected {
        box-shadow: 0 0 0 2px rgba(136, 189, 57, 0.22) inset;
      }

      .calendar-month-cell.calendar-is-today {
        border-color: rgba(136, 189, 57, 0.42);
      }

      .calendar-main {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
        margin-top: 1.25rem;
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

      /* Time grid (week and day): one scroller, one shared time axis. */
      .tg-shell {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        min-height: 0;
        gap: 0.75rem;
      }

      .tg-scroll {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        max-height: var(--tg-max-height, 40rem);
        overflow: auto;
        overscroll-behavior: contain;
        border: 1px solid rgba(30, 52, 37, 0.08);
        border-radius: 1.4rem;
        background: rgba(255, 255, 255, 0.82);
      }

      .tg-grid {
        display: grid;
        grid-template-rows: auto auto;
        width: 100%;
      }

      .tg-corner {
        position: sticky;
        top: 0;
        left: 0;
        z-index: 6;
        background: rgba(244, 248, 236, 0.98);
        border-bottom: 1px solid rgba(30, 52, 37, 0.08);
      }

      .tg-col-header {
        position: sticky;
        top: 0;
        z-index: 5;
        min-width: 0;
        padding: 0.6rem 0.7rem 0.55rem;
        background: rgba(244, 248, 236, 0.96);
        backdrop-filter: blur(12px);
        border-bottom: 1px solid rgba(30, 52, 37, 0.08);
        border-left: 1px solid rgba(30, 52, 37, 0.06);
        cursor: default;
        user-select: none;
      }

      .tg-grid:not(.tg-grid-day) .tg-col-header {
        cursor: pointer;
      }

      .tg-col-header-selected {
        box-shadow: inset 0 -3px 0 rgba(136, 189, 57, 0.55);
      }

      .tg-col-header-today {
        background: rgba(233, 244, 214, 0.98);
      }

      .tg-col-header-closed {
        background: rgba(253, 243, 226, 0.98);
      }

      .tg-col-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        min-width: 0;
      }

      .tg-col-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.9rem;
      }

      .tg-col-count {
        flex: 0 0 auto;
        min-width: 1.5rem;
        padding: 0.05rem 0.45rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.85);
        border: 1px solid rgba(30, 52, 37, 0.08);
        font-size: 0.7rem;
        font-weight: 700;
        text-align: center;
        color: var(--muted);
      }

      .tg-col-sub {
        margin-top: 0.15rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.72rem;
        color: var(--muted);
      }

      .tg-col-sub-closed {
        color: #b45309;
        font-weight: 600;
      }

      .tg-axis {
        position: sticky;
        left: 0;
        z-index: 4;
        background: rgba(244, 248, 236, 0.96);
      }

      .tg-axis-label {
        position: absolute;
        right: 0.5rem;
        transform: translateY(-50%);
        font-size: 0.7rem;
        font-variant-numeric: tabular-nums;
        color: var(--muted);
        line-height: 1;
      }

      .tg-axis-label-first {
        transform: translateY(0.2rem);
      }

      .tg-col {
        position: relative;
        min-width: 0;
        border-left: 1px solid rgba(30, 52, 37, 0.06);
        /* Hour lines and half-hour dots; size set from the scale. */
        background-image:
          linear-gradient(to bottom, rgba(148, 163, 184, 0.26) 1px, transparent 1px),
          linear-gradient(to bottom, transparent 50%, rgba(148, 163, 184, 0.1) 50%, rgba(148, 163, 184, 0.1) calc(50% + 1px), transparent calc(50% + 1px));
        background-repeat: repeat-y;
        touch-action: auto;
      }

      .tg-col-today {
        background-color: rgba(136, 189, 57, 0.04);
      }

      .tg-off-hours {
        position: absolute;
        left: 0;
        right: 0;
        pointer-events: none;
        background: repeating-linear-gradient(
          135deg,
          rgba(245, 158, 11, 0.07) 0 6px,
          rgba(245, 158, 11, 0.02) 6px 12px
        );
      }

      .tg-card {
        position: absolute;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 0.05rem;
        min-height: 0;
        overflow: hidden;
        margin-left: 2px;
        padding: 0.25rem 0.45rem;
        border: 1px solid rgba(255, 255, 255, 0.55);
        border-radius: 0.65rem;
        color: white;
        text-align: left;
        line-height: 1.2;
        box-shadow: 0 2px 6px rgba(30, 52, 37, 0.14);
        -webkit-touch-callout: none;
        -webkit-user-select: none;
        user-select: none;
        transition: opacity 120ms ease, box-shadow 120ms ease;
      }

      .tg-card:hover,
      .tg-card:focus-visible {
        z-index: 2;
        box-shadow: 0 6px 16px rgba(30, 52, 37, 0.24);
      }

      .tg-card:focus-visible {
        outline: 2px solid var(--focus, #88bd39);
        outline-offset: 1px;
      }

      .tg-card-draggable {
        cursor: grab;
      }

      .tg-is-dragging,
      .tg-is-dragging .tg-card {
        cursor: grabbing;
      }

      .tg-card-source {
        opacity: 0.35;
      }

      .tg-card-time,
      .tg-card-title,
      .tg-card-sub,
      .tg-ghost-time,
      .tg-ghost-warning {
        display: block;
        flex-shrink: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }

      .tg-card-time,
      .tg-ghost-time {
        font-size: 0.68rem;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        opacity: 0.9;
      }

      .tg-card-title {
        font-size: 0.78rem;
      }

      .tg-card-sub {
        font-size: 0.68rem;
        opacity: 0.8;
      }

      /* Short bookings: time and client side by side, wrapping when narrow. */
      .tg-card-compact {
        flex-direction: row;
        flex-wrap: wrap;
        align-content: flex-start;
        align-items: baseline;
        column-gap: 0.3rem;
        row-gap: 0;
        padding-block: 1px;
      }

      .tg-card-compact .tg-card-title {
        flex: 1 1 3rem;
      }

      .tg-card-compact .tg-card-time {
        flex: 0 0 auto;
      }

      .tg-card-compact .tg-card-sub {
        display: none;
      }

      /* Narrow lanes keep the start time and drop the end. */
      .tg-card {
        container-type: inline-size;
      }

      @container (max-width: 6.5rem) {
        .tg-card-end {
          display: none;
        }
      }

      .tg-card-tiny {
        padding-block: 0;
        align-items: center;
      }

      .tg-card-tiny .tg-card-time,
      .tg-card-tiny .tg-card-title {
        font-size: 0.62rem;
      }

      .tg-ghost {
        position: absolute;
        left: 3px;
        right: 3px;
        z-index: 4;
        pointer-events: none;
        overflow: hidden;
        padding: 0.25rem 0.45rem;
        border: 2px dashed rgba(255, 255, 255, 0.95);
        border-radius: 0.65rem;
        background: var(--tg-ghost-color, #1c7c64);
        color: white;
        line-height: 1.2;
        opacity: 0.88;
        box-shadow:
          0 0 0 2px rgba(136, 189, 57, 0.75),
          0 14px 28px rgba(30, 52, 37, 0.28);
        transition: top 70ms ease-out;
      }

      .tg-ghost-magnet {
        border-style: solid;
      }

      .tg-ghost-conflict {
        border-color: #fff;
        box-shadow:
          0 0 0 3px #dc2626,
          0 14px 28px rgba(127, 29, 29, 0.35);
        background-image: repeating-linear-gradient(
          135deg,
          rgba(220, 38, 38, 0.45) 0 6px,
          transparent 6px 12px
        );
      }

      .tg-ghost-warning {
        margin-top: 0.1rem;
        font-size: 0.66rem;
        font-weight: 700;
      }

      @media (prefers-reduced-motion: reduce) {
        .tg-card,
        .tg-ghost {
          transition: none;
        }
      }

      .calendar-week-legend {
        flex: 0 0 auto;
        padding: 0.5rem 0.65rem;
      }

      .calendar-week-legend,
      .calendar-month-legend {
        min-height: 0;
        max-height: min(6rem, 20dvh);
        overflow: auto;
        overscroll-behavior: contain;
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
        background: rgba(244, 248, 236, 0.92);
        padding-bottom: 0.1rem;
        backdrop-filter: blur(12px);
      }

      .calendar-month-weekday {
        border: 1px solid rgba(30, 52, 37, 0.08);
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
        grid-template-columns: minmax(0, 1fr);
        gap: 0.75rem;
        min-height: 0;
        overflow: auto;
      }

      .calendar-month-cell {
        min-width: 0;
        overflow: hidden;
      }

      @container (min-width: 40rem) {
        .calendar-month-grid { grid-template-columns: repeat(7, minmax(0, 1fr)); }
      }
      @container (max-width: 39.99rem) {
        .calendar-month-weekdays { display: none; }
        .calendar-month-cell { min-height: auto; }
      }

      /*
       * Mobile: il calendario smette di essere una "app dentro la app".
       * L'altezza diventa naturale e lasciamo scorrere il contenitore della
       * pagina; la griglia oraria resta un riquadro scorrevole alto quanto
       * lo schermo, con intestazioni e orari sempre visibili.
       */
      @media (max-width: 79.99rem) {
        :host {
          height: auto;
        }

        .calendar-shell {
          height: auto;
          overflow: visible;
        }

        .calendar-main {
          margin-top: 0.75rem;
          overflow: visible;
        }

        .calendar-view-viewport,
        .calendar-month-shell,
        .calendar-month-grid {
          overflow: visible;
        }
      }
    `,
  ],
  template: `
    <article class="calendar-shell panel rounded-[2rem] p-4 sm:p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="eyebrow text-[var(--accent)]">Agenda del salone</p>
          <h3 class="font-display text-2xl sm:text-3xl">{{ title }}</h3>
        </div>
        <div
          class="ml-auto flex w-full flex-col gap-2 sm:w-auto sm:min-w-[16rem]"
          data-tour="appointments-date-nav"
        >
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
              Indietro
            </button>
            <button type="button" class="pill-btn" (click)="navigate.emit(1)">
              Avanti
            </button>
          </div>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap gap-2" data-tour="appointments-views">
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

      <div
        class="mt-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4"
        data-tour="appointments-summary"
      >
        <article
          class="rounded-[1.2rem] border border-[var(--line)]/70 bg-white/75 p-3 md:rounded-[1.4rem] md:p-4"
        >
          <p
            class="text-[0.66rem] uppercase tracking-[0.18em] text-[var(--muted)] md:text-xs md:tracking-[0.22em]"
          >
            Eventi
          </p>
          <strong
            class="mt-1 block font-display text-2xl md:mt-2 md:text-3xl"
            >{{ summary.total }}</strong
          >
        </article>
        <article
          class="rounded-[1.2rem] border border-[var(--line)]/70 bg-white/75 p-3 md:rounded-[1.4rem] md:p-4"
        >
          <p
            class="text-[0.66rem] uppercase tracking-[0.18em] text-[var(--muted)] md:text-xs md:tracking-[0.22em]"
          >
            Confermati
          </p>
          <strong
            class="mt-1 block font-display text-2xl md:mt-2 md:text-3xl"
            >{{ summary.confirmed }}</strong
          >
        </article>
        <article
          class="rounded-[1.2rem] border border-[var(--line)]/70 bg-white/75 p-3 md:rounded-[1.4rem] md:p-4"
        >
          <p
            class="text-[0.66rem] uppercase tracking-[0.18em] text-[var(--muted)] md:text-xs md:tracking-[0.22em]"
          >
            Completati
          </p>
          <strong
            class="mt-1 block font-display text-2xl md:mt-2 md:text-3xl"
            >{{ summary.completed }}</strong
          >
        </article>
        <article
          class="rounded-[1.2rem] border border-[var(--line)]/70 bg-white/75 p-3 md:rounded-[1.4rem] md:p-4"
        >
          <p
            class="text-[0.66rem] uppercase tracking-[0.18em] text-[var(--muted)] md:text-xs md:tracking-[0.22em]"
          >
            Valore
          </p>
          <strong class="mt-1 block font-display text-2xl md:mt-2 md:text-3xl"
            >€{{ summary.revenue.toFixed(0) }}</strong
          >
        </article>
      </div>

      <main class="calendar-main" data-tour="appointments-grid">
        <section
          *ngIf="(view === 'day' || view === 'week') && grid"
          class="calendar-view-viewport"
        >
          <div class="tg-shell">
            <div
              *ngIf="view === 'week'"
              class="calendar-week-legend flex flex-wrap gap-2 rounded-[1.4rem] border border-[var(--line)]/70 bg-white/72"
              role="region"
              aria-label="Professionisti nel calendario settimanale"
              tabindex="0"
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

            <article
              *ngIf="!grid.columns.length"
              class="rounded-[1.4rem] border border-[var(--line)]/70 bg-white/80 p-5 text-sm text-[var(--muted)]"
            >
              {{
                view === "day"
                  ? "Nessun professionista disponibile per il giorno selezionato o dati ancora in caricamento."
                  : "Salone chiuso tutta la settimana e nessun appuntamento in programma."
              }}
            </article>

            <div
              *ngIf="grid.columns.length"
              #gridScroll
              class="tg-scroll"
              [style.--tg-max-height.px]="gridMaxHeight"
            >
              <div
                class="tg-grid"
                [class.tg-grid-day]="view === 'day'"
                [class.tg-is-dragging]="!!dragActive"
                [style.grid-template-columns]="gridTemplateColumns"
                [style.min-width]="gridMinWidth"
                [attr.data-ppm]="ppm"
                [attr.data-range-start]="grid.range.start"
                [attr.data-range-end]="grid.range.end"
              >
                <div class="tg-corner" aria-hidden="true"></div>
                <header
                  *ngFor="let column of grid.columns; trackBy: trackByKey"
                  class="tg-col-header"
                  data-tg-header
                  [class.tg-col-header-today]="column.isToday"
                  [class.tg-col-header-selected]="
                    view === 'week' && column.isSelected
                  "
                  [class.tg-col-header-closed]="column.closed"
                  (click)="view === 'week' && selectCalendarDate(column.date)"
                  (dblclick)="view === 'week' && openDayView(column.date)"
                >
                  <div class="tg-col-header-row">
                    <strong
                      class="tg-col-title"
                      [class.text-accent-strong]="column.isToday"
                      >{{ column.label }}</strong
                    >
                    <span
                      *ngIf="column.color"
                      class="inline-flex size-3 shrink-0 rounded-full"
                      [style.background]="column.color"
                    ></span>
                    <span *ngIf="!column.color" class="tg-col-count">{{
                      column.cards.length
                    }}</span>
                  </div>
                  <p class="tg-col-sub" [class.tg-col-sub-closed]="column.closed">
                    {{ column.sublabel }}
                  </p>
                </header>

                <div
                  class="tg-axis"
                  aria-hidden="true"
                  [style.height.px]="trackHeight"
                >
                  <span
                    *ngFor="let mark of grid.hours; let first = first"
                    class="tg-axis-label"
                    [class.tg-axis-label-first]="first"
                    [style.top.px]="px(mark)"
                    >{{ clock(mark) }}</span
                  >
                </div>

                <div
                  *ngFor="let column of grid.columns; trackBy: trackByKey"
                  class="tg-col"
                  data-tg-column
                  [attr.data-column-key]="column.key"
                  [attr.data-date]="column.dateKey"
                  [attr.data-collaborator-id]="column.collaboratorId || null"
                  [class.tg-col-today]="column.isToday"
                  [class.tg-col-closed]="column.closed"
                  [style.height.px]="trackHeight"
                  [style.background-size]="gridBackgroundSize"
                  (click)="view === 'week' && selectCalendarDate(column.date)"
                  (dblclick)="view === 'week' && openDayView(column.date)"
                >
                  <div
                    *ngFor="let segment of column.shaded"
                    class="tg-off-hours"
                    [style.top.px]="px(segment.start)"
                    [style.height.px]="segment.duration * ppm"
                  ></div>
                  <div
                    *ngIf="column.isToday && nowVisible()"
                    class="calendar-current-time-line"
                    [style.top.px]="px(nowMinutes())"
                  >
                    <span class="calendar-current-time-dot"></span>
                  </div>
                  <button
                    *ngFor="let card of column.cards; trackBy: trackByAppointment"
                    type="button"
                    class="tg-card"
                    [class.tg-card-compact]="card.duration * ppm < 38"
                    [class.tg-card-tiny]="card.duration * ppm < 16"
                    [class.tg-card-source]="dragActive?.card?.id === card.id"
                    [class.tg-card-draggable]="canMove"
                    [style.top.px]="px(card.start) + 1"
                    [style.height.px]="card.duration * ppm - 2"
                    [style.left]="card.left"
                    [style.width]="card.width"
                    [style.background]="card.color"
                    [attr.data-appointment-id]="card.id"
                    [attr.title]="card.ariaLabel"
                    [attr.aria-label]="card.ariaLabel"
                    (pointerdown)="onCardPointerDown($event, card, column)"
                    (pointermove)="onCardPointerMove($event)"
                    (pointerup)="onCardPointerUp($event)"
                    (pointercancel)="cancelPointerDrag()"
                    (lostpointercapture)="onLostPointerCapture($event)"
                    (touchmove)="onCardTouchMove($event)"
                    (contextmenu)="onCardContextMenu($event)"
                    (click)="onCardClick($event, card)"
                  >
                    <span class="tg-card-time"
                      >{{ card.startLabel
                      }}<span class="tg-card-end">–{{ card.endLabel }}</span></span
                    >
                    <strong class="tg-card-title">{{ card.title }}</strong>
                    <span class="tg-card-sub">{{ card.subtitle }}</span>
                  </button>
                  <div
                    *ngIf="ghost && ghost.columnKey === column.key"
                    class="tg-ghost"
                    [class.tg-ghost-conflict]="ghost.conflict"
                    [class.tg-ghost-magnet]="ghost.magnet !== null"
                    [style.top.px]="px(ghost.start) + 1"
                    [style.height.px]="ghost.duration * ppm - 2"
                    [style.--tg-ghost-color]="ghost.color"
                    role="status"
                  >
                    <span class="tg-ghost-time">{{ ghost.label }}</span>
                    <strong class="tg-card-title">{{ ghost.title }}</strong>
                    <span *ngIf="ghost.conflict" class="tg-ghost-warning"
                      >Si sovrappone a un altro appuntamento</span
                    >
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section *ngIf="view === 'month'" class="calendar-view-viewport">
          <div class="calendar-month-shell">
            <div
              class="calendar-month-legend flex flex-wrap gap-2 rounded-[1.4rem] border border-[var(--line)]/70 bg-white/72"
              role="region"
              aria-label="Professionisti nel calendario mensile"
              tabindex="0"
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

            <div class="calendar-month-grid">
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
                <div class="grid min-w-0 gap-2">
                  <button
                    *ngFor="
                      let appointment of cell.appointments;
                      trackBy: trackByAppointment
                    "
                    type="button"
                    class="w-full min-w-0 truncate rounded-[0.9rem] px-2 py-1 text-left text-xs text-white"
                    [style.background]="appointment.color"
                    [attr.data-appointment-id]="appointment.id"
                    [draggable]="session.can('appointments.update.all')"
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
                    +{{ cell.hiddenCount }} altri
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
  implements AfterViewInit, OnChanges, OnDestroy
{
  readonly session = inject(SessionStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  @ViewChild("gridScroll")
  private readonly gridScroll?: ElementRef<HTMLElement>;

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
  /** Month view keeps the native drag and drop. */
  dragOverKey = "";
  draggedAppointment: any = null;

  /** Week and day views: one time grid. */
  grid: GridModel | null = null;
  ppm = 1;
  gridMaxHeight = 640;
  gridTemplateColumns = "";
  gridMinWidth = "";
  gridBackgroundSize = "";
  trackHeight = 0;
  ghost: DragGhost | null = null;
  dragActive: PointerDrag | null = null;
  private pointerDrag: PointerDrag | null = null;
  private suppressClickId = "";

  @Output() viewChange = new EventEmitter<"day" | "week" | "month">();
  @Output() navigate = new EventEmitter<-1 | 1>();
  @Output() today = new EventEmitter<void>();
  @Output() calendarDateSelect = new EventEmitter<Date>();
  @Output() appointmentClick = new EventEmitter<string>();
  @Output() appointmentDrop = new EventEmitter<{
    appointmentId: string;
    collaboratorId: string;
    startsAt: string;
    revision?: number;
  }>();
  @Output() appointmentRescheduleRequest = new EventEmitter<{
    appointmentId: string;
    targetDate: string;
    suggestedStartsAt: string;
    suggestedCollaboratorId: string;
    revision?: number;
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

  get canMove(): boolean {
    return this.session.can("appointments.update.all");
  }

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  isCurrentCalendarDate(): boolean {
    return this.isSameDay(this.calendarDate, new Date());
  }

  nowMinutes(): number {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }

  nowVisible(): boolean {
    const now = this.nowMinutes();
    return !!this.grid && now >= this.grid.range.start && now <= this.grid.range.end;
  }

  px(minutes: number): number {
    return this.grid ? minutesToPx(minutes, this.grid.range.start, this.ppm) : 0;
  }

  clock(minutes: number): string {
    return minutesToClock(minutes);
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
    return toLocalDateKey(date);
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
    this.scrollGridIntoPosition();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes["view"] ||
      changes["calendarDate"] ||
      changes["weekDays"] ||
      changes["dayColumns"]
    ) {
      this.rebuildGrid();
    }
    if (changes["view"] || changes["calendarDate"]) {
      queueMicrotask(() => this.scrollGridIntoPosition());
    }
  }

  ngOnDestroy(): void {
    this.cancelPointerDrag();
  }

  @HostListener("window:resize")
  onResize(): void {
    this.applyScale();
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    if (this.pointerDrag) this.cancelPointerDrag();
  }

  /** Builds the columns, the shared time range and the card lanes. */
  private rebuildGrid(): void {
    if (this.view === "week") this.grid = this.buildWeekGrid();
    else if (this.view === "day") this.grid = this.buildDayGrid();
    else this.grid = null;
    this.applyScale();
  }

  private buildWeekGrid(): GridModel {
    const days = visibleDays(
      this.weekDays || [],
      (day: any) => !!day.isUnavailable,
      (day: any) => (day.visibleAppointments || []).length,
    );
    const columns = days.map((day: any) => {
      const window = day.isUnavailable ? null : this.toInterval(day.workingWindow);
      return {
        key: `week:${day.key}`,
        date: new Date(day.date),
        dateKey: toLocalDateKey(new Date(day.date)),
        label: day.label,
        sublabel: day.isUnavailable ? "Chiuso · appuntamenti forzati" : day.statusLabel,
        isToday: !!day.isToday,
        isSelected: !!day.isSelected,
        closed: !!day.isUnavailable,
        window,
        cards: this.placeCards(day.visibleAppointments || []),
      };
    });
    return this.finishGrid("week", columns);
  }

  private buildDayGrid(): GridModel {
    const date = new Date(this.calendarDate);
    const isToday = this.isSameDay(date, new Date());
    const columns = (this.dayColumns || []).map((column: any) => {
      const working = column.workingWindow;
      const window = working?.isAvailable ? this.toInterval(working) : null;
      return {
        key: `day:${column.id}`,
        date,
        dateKey: toLocalDateKey(date),
        label: column.label,
        sublabel: working?.isAvailable
          ? `${working.startTime} - ${working.endTime}`
          : working?.isHoliday
            ? "Festivo"
            : "Non disponibile",
        color: column.color,
        collaboratorId: column.id,
        isToday,
        isSelected: true,
        closed: !working?.isAvailable,
        window,
        cards: this.placeCards(column.appointments || []),
      };
    });
    return this.finishGrid("day", columns);
  }

  private finishGrid(
    view: "day" | "week",
    columns: Array<Omit<GridColumn, "shaded">>,
  ): GridModel {
    const range = timeRange(
      columns
        .map((column) => column.window)
        .filter((window): window is Interval => !!window),
      columns.flatMap((column) => column.cards),
    );
    return {
      view,
      range,
      hours: hourMarks(range),
      columns: columns.map((column) => ({
        ...column,
        shaded: closedSegments(range, column.window).map((segment) => ({
          ...segment,
          duration: segment.end - segment.start,
        })),
      })),
    };
  }

  private placeCards(cards: any[]): GridCard[] {
    const items = cards.map((card) => ({
      card,
      id: String(card.id),
      ...bookingInterval(card.startsAt, card.endsAt ?? card.source?.endsAt),
    }));
    const lanes = layoutLanes(items);
    return items.map(({ card, id, start, end }) => {
      const placement = lanes.get(id) || { lane: 0, lanes: 1, span: 1 };
      const timeLabel = timeRangeLabel({ start, end });
      return {
        id,
        start,
        end,
        duration: end - start,
        left: `${(placement.lane / placement.lanes) * 100}%`,
        width: `calc(${(placement.span / placement.lanes) * 100}% - 4px)`,
        color: card.color,
        startLabel: minutesToClock(start),
        endLabel: minutesToClock(end),
        title: card.title,
        subtitle: card.subtitle,
        ariaLabel: `${timeLabel} · ${card.title} · ${card.subtitle}`,
        collaboratorId: card.collaboratorId || "",
        status: card.status || "",
        revision: card.source?.orderItem?.sale?.revision,
      };
    });
  }

  private toInterval(
    window: { startTime?: string; endTime?: string } | null | undefined,
  ): Interval | null {
    const start = clockToMinutes(window?.startTime);
    const end = clockToMinutes(window?.endTime);
    return start !== null && end !== null && end > start ? { start, end } : null;
  }

  /** Scale that shows the whole range in a screen-high grid when possible. */
  private applyScale(): void {
    const viewportHeight =
      typeof window !== "undefined" ? window.innerHeight : 800;
    this.gridMaxHeight = Math.max(448, viewportHeight - 112);
    if (!this.grid) return;
    const minutes = this.grid.range.end - this.grid.range.start;
    this.ppm =
      Math.round(
        fitPxPerMinute(this.gridMaxHeight - HEADER_HEIGHT_PX - 4, minutes, 1, 2) *
          100,
      ) / 100;
    this.trackHeight = minutes * this.ppm;
    const columnMin = this.view === "day" ? "12rem" : "8.5rem";
    this.gridTemplateColumns = `3.25rem repeat(${this.grid.columns.length}, minmax(${columnMin}, 1fr))`;
    this.gridMinWidth = `calc(3.25rem + ${this.grid.columns.length} * ${columnMin})`;
    this.gridBackgroundSize = `100% ${60 * this.ppm}px`;
  }

  private isSameDay(left: Date, right: Date): boolean {
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    );
  }

  /** Today: bring the current time into view; otherwise the opening. */
  private scrollGridIntoPosition(): void {
    if (this.view === "month" || typeof requestAnimationFrame === "undefined") {
      return;
    }
    requestAnimationFrame(() => {
      const container = this.gridScroll?.nativeElement;
      if (!container || !this.grid) {
        return;
      }
      const showsToday = this.grid.columns.some((column) => column.isToday);
      const target =
        showsToday && this.nowVisible()
          ? Math.max(0, this.px(this.nowMinutes() - 60))
          : 0;
      container.scrollTo({ top: target, behavior: "auto" });
    });
  }

  // ---- Pointer drag (week and day) -------------------------------------

  onCardPointerDown(
    event: PointerEvent,
    card: GridCard,
    column: GridColumn,
  ): void {
    if (!this.canMove || this.pointerDrag || !this.grid) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const element = event.currentTarget as HTMLElement;
    const rect = element.getBoundingClientRect();
    this.pointerDrag = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      element,
      card,
      sourceColumnKey: column.key,
      startX: event.clientX,
      startY: event.clientY,
      grabOffset: Math.max(0, (event.clientY - rect.top) / this.ppm),
      active: false,
    };
    if (event.pointerType !== "touch") {
      // Moves keep reaching the card even when they leave it at once.
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer: moves outside the card are simply missed.
      }
    } else {
      this.pointerDrag.longPress = setTimeout(() => {
        if (this.pointerDrag && !this.pointerDrag.active) {
          this.activateDrag(this.pointerDrag.startX, this.pointerDrag.startY);
        }
      }, TOUCH_HOLD_MS);
    }
  }

  onCardPointerMove(event: PointerEvent): void {
    const drag = this.pointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const distance = Math.hypot(
      event.clientX - drag.startX,
      event.clientY - drag.startY,
    );
    if (!drag.active) {
      if (drag.pointerType === "touch") {
        // Moving before the hold: the finger is scrolling, not dragging.
        if (distance > TOUCH_SLOP_PX) this.cancelPointerDrag();
        return;
      }
      if (distance < DRAG_THRESHOLD_PX) return;
      this.activateDrag(event.clientX, event.clientY);
    }
    event.preventDefault();
    this.autoScroll(event.clientX, event.clientY);
    this.updateGhost(event.clientX, event.clientY);
  }

  onCardPointerUp(event: PointerEvent): void {
    const drag = this.pointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      this.cancelPointerDrag();
      return;
    }
    // The ghost already shows the last snapped place: drop exactly there.
    const ghost = this.ghost;
    const column = ghost
      ? this.grid?.columns.find((entry) => entry.key === ghost.columnKey)
      : undefined;
    this.suppressClickId = drag.card.id;
    setTimeout(() => (this.suppressClickId = ""), 400);
    this.cancelPointerDrag();
    if (!ghost || !column) return;
    if (column.key === drag.sourceColumnKey && ghost.start === drag.card.start) {
      return;
    }
    this.appointmentDrop.emit({
      appointmentId: drag.card.id,
      // Week: same professional, new day and time. Day: the column's.
      collaboratorId: column.collaboratorId || drag.card.collaboratorId,
      startsAt: localDateTime(column.date, ghost.start),
      revision: drag.card.revision,
    });
  }

  onLostPointerCapture(event: PointerEvent): void {
    // Pointerup releases the capture first; anything else aborts the drag.
    if (this.pointerDrag?.active && event.pointerId === this.pointerDrag.pointerId) {
      queueMicrotask(() => {
        if (this.pointerDrag?.pointerId === event.pointerId) {
          this.cancelPointerDrag();
        }
      });
    }
  }

  /** While a booking is held, the finger moves it instead of the page. */
  onCardTouchMove(event: TouchEvent): void {
    if (this.pointerDrag?.active && event.cancelable) event.preventDefault();
  }

  onCardContextMenu(event: Event): void {
    if (this.pointerDrag?.pointerType === "touch") event.preventDefault();
  }

  onCardClick(event: MouseEvent, card: GridCard): void {
    if (this.suppressClickId === card.id) {
      this.suppressClickId = "";
      event.stopPropagation();
      return;
    }
    this.appointmentClick.emit(card.id);
  }

  cancelPointerDrag(): void {
    const drag = this.pointerDrag;
    if (drag?.longPress) clearTimeout(drag.longPress);
    if (drag?.element.hasPointerCapture?.(drag.pointerId)) {
      try {
        drag.element.releasePointerCapture(drag.pointerId);
      } catch {
        // Already released by the browser.
      }
    }
    this.pointerDrag = null;
    this.dragActive = null;
    this.ghost = null;
  }

  private activateDrag(clientX: number, clientY: number): void {
    const drag = this.pointerDrag;
    if (!drag) return;
    drag.active = true;
    this.dragActive = drag;
    try {
      drag.element.setPointerCapture(drag.pointerId);
    } catch {
      // The pointer is gone: the next event cancels the drag.
    }
    this.updateGhost(clientX, clientY);
  }

  private columnElements(): HTMLElement[] {
    return Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>("[data-tg-column]"),
    );
  }

  /** Snapped landing place under the pointer, or none outside the grid. */
  private updateGhost(clientX: number, clientY: number): void {
    const drag = this.pointerDrag;
    const grid = this.grid;
    const scroller = this.gridScroll?.nativeElement;
    if (!drag || !grid || !scroller) return;
    const bounds = scroller.getBoundingClientRect();
    if (
      clientX < bounds.left - 24 ||
      clientX > bounds.right + 24 ||
      clientY < bounds.top - 24 ||
      clientY > bounds.bottom + 24
    ) {
      this.ghost = null;
      return;
    }
    const elements = this.columnElements();
    if (!elements.length) return;
    let target = elements[0];
    let best = Infinity;
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const distance =
        clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
      if (distance < best) {
        best = distance;
        target = element;
      }
    }
    const column = grid.columns.find(
      (entry) => entry.key === target.dataset["columnKey"],
    );
    if (!column) return;
    const rect = target.getBoundingClientRect();
    const duration = drag.card.duration;
    const raw =
      pxToMinutes(clientY - rect.top, grid.range.start, this.ppm) - drag.grabOffset;
    const others = column.cards.filter((card) => card.id !== drag.card.id);
    const snapped = snapStart(raw, duration, {
      magnets: magnetEdges(others, drag.card.id, column.window),
      min: grid.range.start,
      max: grid.range.end,
    });
    const landing = { start: snapped.start, end: snapped.start + duration };
    const professional = column.collaboratorId || drag.card.collaboratorId;
    const conflict = others.some(
      (card) =>
        card.status !== "cancelled" &&
        (column.collaboratorId || card.collaboratorId === professional) &&
        overlaps(card, landing),
    );
    this.ghost = {
      columnKey: column.key,
      start: landing.start,
      duration,
      label: timeRangeLabel(landing),
      title: drag.card.title,
      color: drag.card.color,
      conflict,
      magnet: snapped.magnet,
    };
  }

  private autoScroll(clientX: number, clientY: number): void {
    const scroller = this.gridScroll?.nativeElement;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const top = rect.top + HEADER_HEIGHT_PX;
    if (clientY < top + AUTO_SCROLL_EDGE_PX) scroller.scrollTop -= 12;
    else if (clientY > rect.bottom - AUTO_SCROLL_EDGE_PX) scroller.scrollTop += 12;
    if (clientX < rect.left + 52 + AUTO_SCROLL_EDGE_PX) scroller.scrollLeft -= 12;
    else if (clientX > rect.right - AUTO_SCROLL_EDGE_PX) scroller.scrollLeft += 12;
  }

  // ---- Month view: native drag and drop, unchanged --------------------

  handleDragStart(event: DragEvent, appointmentId: string): void {
    if (!this.session.can("appointments.update.all")) {
      event.preventDefault();
      return;
    }
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
          originalRevision: appointment.source?.orderItem?.sale?.revision,
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

  handleDragEnd(): void {
    this.dragOverKey = "";
    this.draggedAppointment = null;
  }

  handleMonthDrop(event: DragEvent, date: Date): void {
    if (!this.session.can("appointments.update.all")) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    this.dragOverKey = "";
    const payload = this.readDragPayload(event);
    if (!payload) {
      return;
    }

    const original = new Date(payload.originalStartsAt);
    const target = new Date(date);
    target.setHours(
      original.getHours(),
      original.getMinutes(),
      original.getSeconds(),
      original.getMilliseconds(),
    );
    this.appointmentRescheduleRequest.emit({
      appointmentId: payload.appointmentId,
      targetDate: toLocalDateKey(target),
      suggestedStartsAt: this.toLocalDateTimeValue(target),
      suggestedCollaboratorId: payload.originalCollaboratorId,
      revision: payload.originalRevision,
      sourceView: "month",
    });
  }

  openDayListing(date: Date, sourceView: "week" | "month"): void {
    this.showDayAppointments.emit(buildDayListingEvent(date, sourceView));
  }

  private readDragPayload(event: DragEvent): {
    appointmentId: string;
    originalStartsAt: string;
    originalCollaboratorId: string;
    originalRevision?: number;
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
      originalRevision: appointment.source?.orderItem?.sale?.revision,
    };
  }

  private findDraggedAppointment(appointmentId: string): any {
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
    return localBookingTime(value);
  }
}
