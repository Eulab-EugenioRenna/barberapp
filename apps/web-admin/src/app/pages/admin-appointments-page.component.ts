import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CalendarInputComponent } from "../calendar-input.component";
import { CustomSelectComponent } from "../custom-select.component";

@Component({
  selector: "barber-admin-appointments-page",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CalendarInputComponent,
    CustomSelectComponent,
  ],
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
    `,
  ],
  template: `
    <section class="appointments-list-layout xl:grid-cols-[1.08fr_0.92fr]">
      <article class="appointments-panel panel rounded-[2rem] p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="eyebrow text-[var(--accent)]">Gestione agenda</p>
            <h3 class="font-display text-3xl">Modifica appuntamenti</h3>
          </div>
          <span class="status-pill status-pill-neutral"
            >{{ appointments.length }} records</span
          >
        </div>
        <p
          *ngIf="!appointments.length"
          class="mt-5 rounded-[1.2rem] border border-dashed border-[var(--line)]/80 bg-white/70 px-4 py-3 text-sm text-[var(--muted)]"
        >
          Nessun appuntamento trovato per il filtro selezionato.
        </p>
        <div class="appointments-panel-scroll mt-5">
          <div class="grid gap-3">
            <button
              *ngFor="let appointment of appointments"
              type="button"
              class="list-card text-left"
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

      <article class="appointments-panel panel rounded-[2rem] p-5">
        <p class="eyebrow text-[var(--accent)]">Editor</p>
        <h3 class="font-display text-3xl">
          {{
            appointmentForm.id
              ? "Aggiorna appuntamento"
              : "Nuova prenotazione interna"
          }}
        </h3>
        <form
          class="appointments-panel-scroll mt-5 grid gap-4"
          (ngSubmit)="save.emit()"
        >
          <div class="grid gap-4 md:grid-cols-2">
            <label class="field md:col-span-2">
              <span>Cliente <em class="required-mark" aria-hidden="true">*</em></span>
              <barber-custom-select
                [value]="appointmentForm.customerId"
                (valueChange)="appointmentCustomerSelect.emit($event)"
                [options]="appointmentCustomerOptions"
                label="Cliente"
                placeholder="Cerca o seleziona il cliente"
                createLabel="Aggiungi nuovo cliente"
                (createRequest)="quickCreate.emit('customer')"
              ></barber-custom-select>
            </label>
          </div>
          <div
            class="grid gap-4 md:grid-cols-2"
            *ngIf="!appointmentForm.customerId"
          >
            <label class="field">
              <span>Cliente <em class="required-mark" aria-hidden="true">*</em></span>
              <input
                [ngModel]="appointmentForm.customerName"
                (ngModelChange)="
                  appointmentValueChange.emit({
                    key: 'customerName',
                    value: $event,
                  })
                "
                name="appointmentCustomerName"
                placeholder="Mario Rossi"
              />
            </label>
            <label class="field">
              <span>Email</span>
              <input
                [ngModel]="appointmentForm.email"
                (ngModelChange)="
                  appointmentValueChange.emit({ key: 'email', value: $event })
                "
                name="appointmentEmail"
                placeholder="mario@email.it"
              />
            </label>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <label class="field">
              <span>Servizio <em class="required-mark" aria-hidden="true">*</em></span>
              <barber-custom-select
                [value]="appointmentForm.serviceId"
                (valueChange)="
                  appointmentValueChange.emit({
                    key: 'serviceId',
                    value: $event,
                  });
                  updateAppointmentSlots.emit()
                "
                [options]="serviceSelectOptions"
                label="Servizio"
                createLabel="Aggiungi nuovo servizio"
                (createRequest)="quickCreate.emit('service')"
              ></barber-custom-select>
            </label>
            <label class="field">
              <span>Collaboratore</span>
              <barber-custom-select
                [value]="appointmentForm.collaboratorId"
                (valueChange)="
                  appointmentValueChange.emit({
                    key: 'collaboratorId',
                    value: $event,
                  });
                  updateAppointmentSlots.emit()
                "
                [options]="appointmentCollaboratorOptions"
                label="Collaboratore"
                placeholder="Seleziona collaboratore"
              ></barber-custom-select>
            </label>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <label class="field">
              <span>Data</span>
              <barber-calendar-input
                [value]="appointmentSelectedDate"
                (valueChange)="
                  appointmentSelectedDateChange.emit($event);
                  updateAppointmentSlots.emit()
                "
                label="Data"
                name="appointmentSelectedDate"
                placeholder="Seleziona una data"
              ></barber-calendar-input>
            </label>
            <label class="field">
              <span>Ora <em class="required-mark" aria-hidden="true">*</em></span>
              <barber-custom-select
                [value]="appointmentForm.startsAt"
                (valueChange)="
                  appointmentValueChange.emit({
                    key: 'startsAt',
                    value: $event,
                  })
                "
                [disabled]="!appointmentSlots.length"
                [options]="appointmentSlotOptions"
                label="Orario"
                [placeholder]="
                  !appointmentForm.collaboratorId
                    ? 'Prima seleziona il collaboratore'
                    : appointmentSlots.length
                      ? 'Seleziona orario'
                      : 'Nessuno slot disponibile'
                "
              ></barber-custom-select>
            </label>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <label class="field">
              <span>Stato</span>
              <barber-custom-select
                [value]="appointmentForm.status"
                (valueChange)="
                  appointmentValueChange.emit({ key: 'status', value: $event })
                "
                [options]="appointmentStatusOptions"
                label="Stato"
              ></barber-custom-select>
            </label>
          </div>
          <label class="field">
            <span>Note</span>
            <textarea
              [ngModel]="appointmentForm.customerNotes"
              (ngModelChange)="
                appointmentValueChange.emit({
                  key: 'customerNotes',
                  value: $event,
                })
              "
              name="appointmentCustomerNotes"
              rows="4"
              placeholder="Dettagli cliente o richieste speciali"
            ></textarea>
          </label>
          <div class="flex flex-wrap gap-3">
            <button
              type="submit"
              class="primary-btn"
              [disabled]="loading || !formValid"
            >
              {{ appointmentForm.id ? "Salva modifiche" : "Crea appuntamento" }}
            </button>
            <button
              *ngIf="appointmentForm.id"
              type="button"
              class="primary-btn"
              [disabled]="loading"
              (click)="confirmOrder.emit()"
            >
              Conferma ordine
            </button>
            <button
              *ngIf="appointmentForm.id"
              type="button"
              class="pill-btn"
              [disabled]="loading"
              (click)="remove.emit()"
            >
              Elimina appuntamento
            </button>
            <button
              *ngIf="appointmentForm.id"
              type="button"
              class="pill-btn"
              [disabled]="loading"
              (click)="cancel.emit()"
            >
              Annulla appuntamento
            </button>
            <button
              type="button"
              class="secondary-btn"
              [disabled]="loading"
              (click)="reset.emit()"
            >
              Nuova prenotazione
            </button>
          </div>
        </form>
      </article>
    </section>
  `,
})
export class AdminAppointmentsPageComponent {
  @Input() appointments: any[] = [];
  @Input() appointmentForm: any = {};
  @Input() appointmentCustomerOptions: Array<{ value: string; label: string }> = [];
  @Input() serviceSelectOptions: Array<{ value: string; label: string }> = [];
  @Input() appointmentCollaboratorOptions: Array<{
    value: string;
    label: string;
  }> = [];
  @Input() appointmentSelectedDate = "";
  @Input() appointmentSlots: Array<{ startsAt: string; label: string }> = [];
  @Input() appointmentSlotOptions: Array<{ value: string; label: string }> = [];
  @Input() appointmentStatusOptions: Array<{ value: string; label: string }> =
    [];
  @Input() loading = false;

  @Output() editAppointment = new EventEmitter<any>();
  @Output() appointmentCustomerSelect = new EventEmitter<string>();
  @Output() quickCreate = new EventEmitter<"customer" | "service">();
  @Output() appointmentValueChange = new EventEmitter<{
    key: string;
    value: string;
  }>();
  @Output() appointmentSelectedDateChange = new EventEmitter<string>();
  @Output() updateAppointmentSlots = new EventEmitter<void>();
  @Output() save = new EventEmitter<void>();
  @Output() confirmOrder = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
  @Output() reset = new EventEmitter<void>();

  get formValid(): boolean {
    const customer = Boolean(
      this.appointmentForm.customerId ||
        (typeof this.appointmentForm.customerName === "string" &&
          this.appointmentForm.customerName.trim()),
    );

    return Boolean(
      customer && this.appointmentForm.serviceId && this.appointmentForm.startsAt,
    );
  }

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
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
