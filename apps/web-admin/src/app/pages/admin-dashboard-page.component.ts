import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { AdminMetricsGridComponent } from "../shared/admin-metrics-grid.component";

@Component({
  selector: "barber-admin-dashboard-page",
  standalone: true,
  imports: [CommonModule, AdminMetricsGridComponent],
  template: `
    <section class="grid gap-4">
      <barber-admin-metrics-grid
        [metrics]="revenueMetrics"
      ></barber-admin-metrics-grid>

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
              *ngFor="let appointment of appointments.slice(0, 6)"
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
  @Output() editAppointment = new EventEmitter<any>();

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
