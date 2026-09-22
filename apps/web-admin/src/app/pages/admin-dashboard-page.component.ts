import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { AdminMetricsGridComponent } from "../shared/admin-metrics-grid.component";
import { CustomSelectComponent } from "../custom-select.component";

@Component({
  selector: "barber-admin-dashboard-page",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AdminMetricsGridComponent,
    CustomSelectComponent,
  ],
  template: `
    <section class="grid gap-4">
      <article class="panel rounded-[2rem] p-5">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="eyebrow text-[var(--accent)]">Controllo economico</p>
            <h3 class="font-display text-3xl">Fatturato</h3>
          </div>
          <button
            type="button"
            class="primary-btn"
            (click)="openQuickOrder.emit()"
          >
            + Ordine rapido
          </button>
        </div>
        <div class="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label class="field">
            <span>Periodo</span>
            <barber-custom-select
              [value]="revenueFilters.period"
              (valueChange)="revenueFilters.period = $event"
              [options]="periodOptions"
              label="Periodo"
            ></barber-custom-select>
          </label>
          <label class="field" *ngIf="revenueFilters.period !== 'all'">
            <span>Data di riferimento</span>
            <input
              [(ngModel)]="revenueFilters.date"
              name="revenueDate"
              type="date"
            />
          </label>
          <label class="field">
            <span>Cliente</span>
            <barber-custom-select
              [value]="revenueFilters.customerId"
              (valueChange)="revenueFilters.customerId = $event"
              [options]="customerOptions"
              label="Cliente"
              placeholder="Tutti i clienti"
            ></barber-custom-select>
          </label>
          <label class="field">
            <span>Postazione</span>
            <barber-custom-select
              [value]="revenueFilters.stationId"
              (valueChange)="revenueFilters.stationId = $event"
              [options]="stationOptions"
              label="Postazione"
              placeholder="Tutte le postazioni"
            ></barber-custom-select>
          </label>
        </div>
        <button
          type="button"
          class="secondary-btn mt-4"
          [disabled]="loading"
          (click)="applyRevenueFilters.emit()"
        >
          {{ loading ? "Aggiornamento..." : "Applica filtri" }}
        </button>
      </article>

      <barber-admin-metrics-grid
        [metrics]="revenueMetrics"
      ></barber-admin-metrics-grid>

      <div class="grid gap-4 lg:grid-cols-2" *ngIf="revenueReport">
        <article class="panel rounded-[2rem] p-5">
          <p class="eyebrow text-[var(--accent)]">Clienti</p>
          <h3 class="font-display text-2xl">Fatturato per cliente</h3>
          <div class="mt-4 grid max-h-96 gap-2 overflow-auto pr-1">
            <div *ngFor="let row of revenueReport.byCustomer" class="list-card">
              <strong>{{ row.label }}</strong
              ><span>€{{ row.revenue | number: "1.2-2" }}</span>
            </div>
            <p
              *ngIf="!revenueReport.byCustomer?.length"
              class="text-sm text-[var(--muted)]"
            >
              Nessun fatturato nel periodo selezionato.
            </p>
          </div>
        </article>
        <article class="panel rounded-[2rem] p-5">
          <p class="eyebrow text-[var(--accent)]">Postazioni</p>
          <h3 class="font-display text-2xl">Fatturato per postazione</h3>
          <div class="mt-4 grid max-h-96 gap-2 overflow-auto pr-1">
            <div *ngFor="let row of revenueReport.byStation" class="list-card">
              <strong>{{ row.label }}</strong
              ><span>€{{ row.revenue | number: "1.2-2" }}</span>
            </div>
            <p
              *ngIf="!revenueReport.byStation?.length"
              class="text-sm text-[var(--muted)]"
            >
              Nessun fatturato associato a postazioni.
            </p>
          </div>
        </article>
      </div>

      <div class="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <article class="panel rounded-[2rem] p-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="eyebrow text-[var(--accent)]">Agenda live</p>
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
                  {{ appointment.collaborator?.firstName || "Staff" }}</span
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
          <p class="eyebrow text-white/40">Performance</p>
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
                Ricavi: €{{ collaborator.revenue | number: "1.0-2" }} ·
                Upcoming:
                {{ collaborator.upcoming }}
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
  @Input() revenueFilters: any = {
    period: "month",
    date: "",
    customerId: "",
    stationId: "",
  };
  @Input() customerOptions: Array<{ value: string; label: string }> = [];
  @Input() stationOptions: Array<{ value: string; label: string }> = [];
  @Input() loading = false;
  @Output() editAppointment = new EventEmitter<any>();
  @Output() applyRevenueFilters = new EventEmitter<void>();
  @Output() openQuickOrder = new EventEmitter<void>();

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

  formatAppointmentStatus(status: string): string {
    return status.replace(/_/g, " ");
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
