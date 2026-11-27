import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { appointmentStatusLabel } from "../shared/presentation-copy";

@Component({
  selector: "barber-admin-appointments-page",
  standalone: true,
  imports: [CommonModule],
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        min-height: 0;
      }

      .appointments-list-layout {
        display: grid;
        height: 100%;
        min-height: 0;
        gap: 1rem;
      }

      /* Una sola colonna: la lista. */
      .appointments-list-layout.appointments-single {
        grid-template-columns: minmax(0, 1fr);
      }

      .appointments-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }

      .appointments-panel-scroll {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        padding-right: 0.25rem;
        align-content: start;
      }

      /* Mobile: i pannelli si impilano e scorre la pagina, non la card. */
      @media (max-width: 63.99rem) {
        :host {
          height: auto;
        }

        :host .appointments-list-layout {
          height: auto;
        }

        :host .appointments-panel {
          height: auto;
          overflow: visible;
        }

        :host .appointments-panel-scroll {
          overflow: visible;
        }
      }
    `,
  ],
  template: `
    <section
      class="appointments-list-layout appointments-single"
    >
      <article
        class="appointments-panel panel rounded-[2rem] p-4 sm:p-5"
        data-tour="appointments-list"
      >
        <div class="min-w-0">
          <p class="eyebrow text-[var(--accent)]">Agenda del salone</p>
          <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 class="font-display text-2xl sm:text-3xl">Appuntamenti</h3>
            <span class="status-pill status-pill-neutral"
              >{{ appointments.length }} appuntamenti</span
            >
          </div>
        </div>
        <p
          *ngIf="!appointments.length"
          class="mt-4 rounded-[1.2rem] border border-dashed border-[var(--line)]/80 bg-white/70 px-4 py-3 text-sm text-[var(--muted)]"
        >
          Nessun appuntamento trovato per il filtro selezionato.
        </p>
        <div class="appointments-panel-scroll mt-4">
          <div class="grid gap-3">
            <button
              *ngFor="let appointment of appointments"
              type="button"
              class="list-card text-left"
              [attr.data-appointment-id]="appointment.id"
              (click)="editAppointment.emit(appointment)"
            >
              <div>
                <strong
                  >{{ appointment.customer.firstName }}
                  {{ appointment.customer.lastName }}</strong
                >
                <p class="text-sm text-[var(--muted)]">
                  {{ appointment.service.name }} ·
                  {{ formatDateTime(appointment.startsAt) }}
                </p>
              </div>
              <span
                class="status-pill"
                [ngClass]="appointmentStatusClass(appointment.status)"
                >{{ formatAppointmentStatus(appointment.status) }}</span
              >
            </button>
          </div>
        </div>
      </article>

    </section>
  `,
})
/** List of the agenda; the booking editor is the agenda modal. */
export class AdminAppointmentsPageComponent {
  /** Kept for the callers: the page shows only the list. */
  @Input() listOnly = true;
  @Input() appointments: any[] = [];
  @Input() loading = false;
  @Output() editAppointment = new EventEmitter<any>();

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
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
