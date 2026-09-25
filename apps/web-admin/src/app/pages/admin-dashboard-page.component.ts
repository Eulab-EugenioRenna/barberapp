import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { AdminMetricsGridComponent } from "../shared/admin-metrics-grid.component";
import { CalendarInputComponent } from "../calendar-input.component";
import { CustomSelectComponent } from "../custom-select.component";
import { InfiniteScrollDirective } from "../shared/infinite-scroll.directive";
import { UiIconComponent } from "../shared/ui-icon.component";
import { activityStatusLabel, appointmentStatusLabel } from "../shared/presentation-copy";

const BALANCE_STORAGE_KEY = "barber.balance-hidden";

@Component({
  selector: "barber-admin-dashboard-page",
  standalone: true,
  imports: [
    CommonModule,
    AdminMetricsGridComponent,
    CalendarInputComponent,
    CustomSelectComponent,
    InfiniteScrollDirective,
    UiIconComponent,
  ],
  template: `
    <section class="grid gap-4">
      <article class="panel rounded-[2rem] p-5">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="eyebrow text-[var(--accent)]">Andamento del salone</p>
            <h3 class="font-display text-3xl">Incassi</h3>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="ghost-btn balance-toggle"
              (click)="toggleBalance()"
              [attr.aria-pressed]="balanceHidden"
              [attr.aria-label]="balanceHidden ? 'Mostra saldo' : 'Nascondi saldo'"
              [title]="balanceHidden ? 'Mostra saldo' : 'Nascondi saldo'"
            >
              <barber-ui-icon
                [name]="balanceHidden ? 'eye-off' : 'eye'"
                [animated]="!balanceHidden"
              ></barber-ui-icon>
              {{ balanceHidden ? "Mostra saldo" : "Nascondi saldo" }}
            </button>
            <button
              type="button"
              class="ghost-btn"
              [disabled]="loading"
              (click)="resetRevenueFilters.emit()"
            >
              Azzera filtri
            </button>
            <button
              type="button"
              class="primary-btn"
              (click)="openQuickOrder.emit()"
            >
              + Vendita veloce
            </button>
          </div>
        </div>
        <div class="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label class="field">
            <span>Periodo</span>
            <barber-custom-select
              [value]="revenueFilters.period"
              (valueChange)="applyPeriod($event)"
              [options]="periodOptions"
              label="Periodo"
            ></barber-custom-select>
          </label>
          <label class="field" *ngIf="revenueFilters.period !== 'all'">
            <span>Data di riferimento</span>
            <barber-calendar-input
              [value]="revenueFilters.date"
              (valueChange)="applyDate($event)"
              label="Data"
              placeholder="Seleziona data"
            ></barber-calendar-input>
          </label>
          <label class="field">
            <span>Cliente</span>
            <barber-custom-select
              [value]="revenueFilters.customerId"
              (valueChange)="applyCustomer($event)"
              [options]="customerFilterOptions"
              label="Cliente"
              placeholder="Tutti i clienti"
            ></barber-custom-select>
          </label>
          <label class="field">
            <span>Professionista</span>
            <barber-custom-select
              [value]="revenueFilters.collaboratorId"
              (valueChange)="applyCollaborator($event)"
              [options]="collaboratorFilterOptions"
              label="Professionista"
              placeholder="Tutta la squadra"
            ></barber-custom-select>
          </label>
        </div>
      </article>

      <barber-admin-metrics-grid
        [metrics]="revenueMetrics"
        [masked]="balanceHidden"
      ></barber-admin-metrics-grid>

      <div class="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <article class="panel rounded-[2rem] p-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="eyebrow text-[var(--accent)]">Movimenti</p>
              <h3 class="font-display text-2xl">Vendite e appuntamenti</h3>
            </div>
            <span class="status-pill status-pill-neutral"
              >{{ activity.length }}</span
            >
          </div>
          <div class="mt-4 grid max-h-[32rem] gap-2 overflow-auto pr-1">
            <div
              *ngFor="let entry of activity"
              class="list-card items-center"
            >
              <div class="min-w-0 flex-1">
                <div class="activity-head flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    class="status-pill"
                    [ngClass]="
                      entry.kind === 'appointment'
                        ? 'status-pill-green'
                        : 'status-pill-blue'
                    "
                    >{{
                      entry.kind === "appointment"
                        ? "Appuntamento"
                        : entry.kind === "combined"
                          ? "Vendita e appuntamento"
                          : "Vendita"
                    }}</span
                  >
                  <strong class="min-w-0 truncate">{{
                    entry.customerName
                  }}</strong>
                </div>
                <p class="mt-1 text-sm text-[var(--muted)]">
                  {{ formatDateTime(entry.occurredAt) }} · {{ entry.detail }}
                </p>
                <p
                  *ngIf="entry.collaboratorName"
                  class="mt-1 text-xs text-[var(--muted)]"
                >
                  {{ entry.collaboratorName }}
                </p>
              </div>
              <div class="shrink-0 text-right">
                <strong>{{ money(entry.amount) }}</strong>
                <p class="text-sm text-[var(--muted)]">
                  {{ formatActivityStatus(entry.status) }}
                </p>
              </div>
            </div>
            <p
              *ngIf="!activity.length && !activityLoading"
              class="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]"
            >
              Nessuna vendita o appuntamento nel periodo selezionato.
            </p>
            <p
              *ngIf="activityLoading"
              class="py-2 text-center text-xs uppercase tracking-wider text-[var(--muted)]"
            >
              Caricamento...
            </p>
            <div
              *ngIf="activityHasMore"
              class="h-px w-full"
              barberInfiniteScroll
              (loadMore)="loadMoreActivity.emit()"
            ></div>
          </div>
        </article>

        <div class="grid gap-4">
          <article class="panel rounded-[2rem] p-5">
            <p class="eyebrow text-[var(--accent)]">Clienti</p>
            <h3 class="font-display text-2xl">Incassi per cliente</h3>
            <div class="mt-4 grid max-h-72 gap-2 overflow-auto pr-1">
              <div
                *ngFor="let row of revenueReport?.byCustomer"
                class="list-card"
              >
                <strong>{{ row.label }}</strong
                ><span>{{ money(row.revenue) }}</span>
              </div>
              <p
                *ngIf="!revenueReport?.byCustomer?.length"
                class="text-sm text-[var(--muted)]"
              >
                Nessun incasso nel periodo selezionato.
              </p>
            </div>
          </article>
          <article class="panel rounded-[2rem] p-5">
            <p class="eyebrow text-[var(--accent)]">Squadra</p>
            <h3 class="font-display text-2xl">Incassi per professionista</h3>
            <div class="mt-4 grid max-h-72 gap-2 overflow-auto pr-1">
              <div
                *ngFor="let row of revenueReport?.byCollaborator"
                class="list-card"
              >
                <strong>{{ row.label }}</strong
                ><span>{{ money(row.revenue) }}</span>
              </div>
              <p
                *ngIf="!revenueReport?.byCollaborator?.length"
                class="text-sm text-[var(--muted)]"
              >
                Nessun incasso associato alla squadra.
              </p>
            </div>
          </article>
        </div>
      </div>

      <div class="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <article class="panel rounded-[2rem] p-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="eyebrow text-[var(--accent)]">Agenda</p>
              <h3 class="font-display text-3xl">Prossimi appuntamenti</h3>
            </div>
            <span class="status-pill status-pill-green"
              >{{ appointmentStats?.total || 0 }} nel mese</span
            >
          </div>
          <div class="mt-5 grid gap-3">
            <button
              *ngFor="let appointment of upcomingAppointments"
              type="button"
              class="list-card text-left"
              (click)="editAppointment.emit(appointment)"
            >
              <div>
                <strong class="block text-lg"
                  >{{ formatTime(appointment.startsAt) }} ·
                  {{ appointment.customer.firstName }}
                  {{ appointment.customer.lastName }}</strong
                >
                <span class="text-sm text-[var(--muted)]"
                  >{{ appointment.service.name }} ·
                  {{ appointment.collaborator?.firstName || "Da assegnare" }}</span
                >
              </div>
              <span
                class="status-pill"
                [ngClass]="appointmentStatusClass(appointment.status)"
                >{{ formatAppointmentStatus(appointment.status) }}</span
              >
            </button>
            <p
              *ngIf="!upcomingAppointments.length"
              class="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]"
            >
              Nessun appuntamento futuro confermato o richiesto.
            </p>
          </div>
        </article>

        <article class="dark-panel rounded-[2rem] p-5 text-white">
          <p class="eyebrow text-white/40">Andamento della squadra</p>
          <div class="mt-5 grid gap-3">
            <div
              *ngFor="let collaborator of collaboratorStats"
              class="rounded-[1.4rem] bg-white/8 p-4"
            >
              <div class="flex items-center justify-between gap-3">
                <strong>{{ collaborator.collaboratorName }}</strong>
                <span class="status-pill status-pill-inverse"
                  >{{ collaborator.completed }} completate</span
                >
              </div>
              <p class="mt-2 text-sm text-white/65">
                Ricavi: {{ money(collaborator.revenue) }} ·
                Vendite: {{ collaborator.orderCount || 0 }} ·
                Prossimi appuntamenti: {{ collaborator.upcoming }}
              </p>
            </div>
          </div>
        </article>
      </div>
    </section>
  `,
})
export class AdminDashboardPageComponent {
  @Input() revenueMetrics: any[] = [];
  @Input() appointmentStats: any = null;
  @Input() appointments: any[] = [];
  @Input() collaboratorStats: any[] = [];
  @Input() revenueReport: any = null;
  @Input() activity: any[] = [];
  @Input() activityHasMore = false;
  @Input() activityLoading = false;
  @Input() revenueFilters: any = {
    period: "month",
    date: "",
    customerId: "",
    collaboratorId: "",
  };
  @Input() customerOptions: Array<{ value: string; label: string }> = [];
  @Input() collaboratorOptions: Array<{ value: string; label: string }> = [];
  @Input() loading = false;
  @Output() editAppointment = new EventEmitter<any>();
  @Output() applyRevenueFilters = new EventEmitter<void>();
  @Output() resetRevenueFilters = new EventEmitter<void>();
  @Output() loadMoreActivity = new EventEmitter<void>();
  @Output() openQuickOrder = new EventEmitter<void>();

  balanceHidden = readStoredBalanceHidden();

  toggleBalance(): void {
    this.balanceHidden = !this.balanceHidden;
    try {
      window.localStorage.setItem(
        BALANCE_STORAGE_KEY,
        this.balanceHidden ? "1" : "0",
      );
    } catch {
      // Storage can be unavailable (private mode); the toggle still works.
    }
  }

  money(value: number | string | null | undefined): string {
    if (this.balanceHidden) {
      return "**,**";
    }

    const amount = Number(value ?? 0);
    return `€${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
  }

  get customerFilterOptions(): Array<{ value: string; label: string }> {
    return [{ value: "", label: "Tutti i clienti" }, ...this.customerOptions];
  }

  applyPeriod(period: string): void {
    this.revenueFilters.period = period;
    this.applyRevenueFilters.emit();
  }

  applyCustomer(customerId: string): void {
    this.revenueFilters.customerId = customerId;
    this.applyRevenueFilters.emit();
  }

  applyCollaborator(collaboratorId: string): void {
    this.revenueFilters.collaboratorId = collaboratorId;
    this.applyRevenueFilters.emit();
  }

  applyDate(date: string): void {
    this.revenueFilters.date = date;
    this.applyRevenueFilters.emit();
  }

  get collaboratorFilterOptions(): Array<{ value: string; label: string }> {
    return [
      { value: "", label: "Tutta la squadra" },
      ...this.collaboratorOptions,
    ];
  }

  readonly periodOptions = [
    { value: "day", label: "Giorno" },
    { value: "week", label: "Settimana" },
    { value: "month", label: "Mese" },
    { value: "year", label: "Anno" },
    { value: "all", label: "Tutto" },
  ];

  get upcomingAppointments(): any[] {
    const now = Date.now();
    return this.appointments
      .filter(
        (appointment) =>
          new Date(appointment.startsAt).getTime() >= now &&
          ["requested", "confirmed", "checked_in", "rescheduled"].includes(
            appointment.status,
          ),
      )
      .sort(
        (left, right) =>
          new Date(left.startsAt).getTime() -
          new Date(right.startsAt).getTime(),
      )
      .slice(0, 6);
  }

  formatTime(value: string): string {
    return new Date(value).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString("it-IT", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  formatActivityStatus(status: string): string {
    return activityStatusLabel(status);
  }

  formatAppointmentStatus(status: string): string {
    return appointmentStatusLabel(status);
  }

  appointmentStatusClass(status: string): string {
    switch (status) {
      case "requested":
      case "rescheduled":
        return "status-pill-amber";
      case "confirmed":
      case "checked_in":
        return "status-pill-blue";
      case "completed":
        return "status-pill-green";
      case "cancelled":
      case "no_show":
        return "status-pill-red";
      default:
        return "status-pill-neutral";
    }
  }
}

function readStoredBalanceHidden(): boolean {
  try {
    return window.localStorage.getItem(BALANCE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
