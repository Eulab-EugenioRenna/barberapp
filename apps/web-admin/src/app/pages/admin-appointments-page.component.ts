import { SessionStore } from "../core/session.store";
import { FunctionAccessDirective } from "../shared/function-access.directive";
import { CommonModule } from "@angular/common";
import { Component, inject, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CalendarInputComponent } from "../calendar-input.component";
import { UiSelectComponent } from "@alora/ui";
import { CustomerSelectComponent } from "../shared/customer-select.component";
import { UiIconComponent } from "../shared/ui-icon.component";
import { appointmentStatusLabel } from "../shared/presentation-copy";

@Component({
  selector: "barber-admin-appointments-page",
  standalone: true,
  host: {
    // Quando il form vive dentro un modale l'altezza resta gestita dal
    // modale stesso (scroll interno), anche su mobile.
    "[class.appointments-embedded]": "formOnly",
  },
  imports: [
    CustomerSelectComponent,
    FunctionAccessDirective,
    CommonModule,
    FormsModule,
    CalendarInputComponent,
    UiSelectComponent,
    UiIconComponent,
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

      /* Una sola colonna quando si mostra solo la lista o solo il form. */
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

      .appointments-form-actions {
        position: sticky;
        bottom: 0;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        margin-top: 0.25rem;
        padding: 0.85rem 0 0.25rem;
        background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0) 0%,
          rgba(255, 255, 255, 0.92) 40%
        );
      }

      .appointments-form-actions-group {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }

      @media (max-width: 47.99rem) {
        .appointments-form-actions,
        .appointments-form-actions-group {
          width: 100%;
        }

        .appointments-form-actions-group > * {
          flex: 1 1 auto;
          justify-content: center;
        }
      }

      /* Mobile: i pannelli si impilano e scorre la pagina, non la card. */
      @media (max-width: 63.99rem) {
        :host:not(.appointments-embedded) {
          height: auto;
        }

        :host:not(.appointments-embedded) .appointments-list-layout {
          height: auto;
        }

        :host:not(.appointments-embedded) .appointments-panel {
          height: auto;
          overflow: visible;
        }

        :host:not(.appointments-embedded) .appointments-panel-scroll {
          overflow: visible;
        }
      }
    `,
  ],
  template: `
    <section
      class="appointments-list-layout xl:grid-cols-[1.08fr_0.92fr]"
      [class.appointments-single]="listOnly || formOnly"
    >
      <article
        *ngIf="!formOnly"
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

      <article
        *ngIf="!listOnly"
        class="appointments-panel panel rounded-[2rem] p-4 sm:p-5"
      >
        <p class="eyebrow text-[var(--accent)]">Scheda appuntamento</p>
        <h3 class="font-display text-2xl sm:text-3xl">
          {{
            appointmentForm.id ? "Aggiorna appuntamento" : "Nuovo appuntamento"
          }}
        </h3>
        <form
          class="appointments-panel-scroll mt-4 grid gap-4"
          (ngSubmit)="save.emit()"
        >
          <div class="grid gap-3 sm:gap-4 md:grid-cols-2">
            <div class="field md:col-span-2">
              <span
                >Cliente
                <em class="required-mark" aria-hidden="true">*</em></span
              >
              <alora-customer-select
                [value]="appointmentForm.customerId"
                (valueChange)="appointmentCustomerSelect.emit($event)"
                [extra]="appointmentForm.customerId ? { id: appointmentForm.customerId, firstName: appointmentForm.customerName } : null"
                [createLabel]="
                  session.can('clients.manage') ? 'Aggiungi nuovo cliente' : ''
                "
                (createRequest)="quickCreate.emit('customer')"
              ></alora-customer-select>
            </div>
          </div>
          <div
            *ngIf="!appointmentForm.id && bookingLocationOptions.length > 1"
            class="field"
            data-tour="appointments-location"
          >
            <span>Sede</span>
            <ui-select
              [value]="bookingLocationId"
              (valueChange)="
                appointmentValueChange.emit({ key: 'locationId', value: $event });
                updateAppointmentSlots.emit()
              "
              [options]="bookingLocationOptions"
              label="Sede"
              placeholder="Scegli la sede"
            ></ui-select>
            <small class="text-xs text-[var(--muted)]"
              >Compaiono solo i servizi delle attività svolte in questa sede.</small
            >
          </div>
          <div class="grid gap-3 sm:gap-4 md:grid-cols-2">
            <div class="field">
              <span
                >Servizio
                <em class="required-mark" aria-hidden="true">*</em></span
              >
              <ui-select
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
                [createLabel]="
                  session.can('services.manage')
                    ? 'Aggiungi nuovo servizio'
                    : ''
                "
                (createRequest)="quickCreate.emit('service')"
              ></ui-select>
            </div>
            <div class="field">
              <span>Professionista</span>
              <ui-select
                [value]="appointmentForm.collaboratorId"
                (valueChange)="
                  appointmentValueChange.emit({
                    key: 'collaboratorId',
                    value: $event,
                  });
                  updateAppointmentSlots.emit()
                "
                [options]="appointmentCollaboratorOptions"
                label="Professionista"
                placeholder="Nessuna preferenza"
              ></ui-select>
            </div>
          </div>
          <section
            *ngIf="multipleServices && !appointmentForm.id"
            class="grid gap-3 rounded-2xl border border-[var(--line)] p-4"
            aria-label="Sequenza dei servizi"
          >
            <p class="text-sm text-[var(--muted)]">
              Il servizio principale viene eseguito per primo. Aggiungi gli
              altri nell'ordine desiderato.
            </p>
            <article
              *ngFor="let row of additionalServices; let index = index"
              class="grid gap-2 rounded-xl bg-slate-50 p-3"
              [attr.aria-label]="'Servizio ' + (index + 2)"
            >
              <strong
                >{{ index + 2 }}. {{ row.name }} ·
                {{ row.durationMinutes }} min</strong
              >
              <ui-select
                *ngIf="row.requiresCollaborator"
                [value]="row.collaboratorId"
                [options]="row.options"
                [label]="'Professionista per ' + row.name"
                [showLabel]="true"
                (valueChange)="
                  serviceCollaborator.emit({ index, collaboratorId: $event })
                "
              ></ui-select>
              <button
                type="button"
                class="secondary-btn"
                [attr.aria-label]="'Rimuovi ' + row.name"
                (click)="removeService.emit(index)"
              >
                Rimuovi
              </button>
            </article>
            <ui-select
              *ngIf="additionalServices.length < 19"
              value=""
              label="Aggiungi un servizio"
              [showLabel]="true"
              placeholder="Aggiungi un servizio della sede"
              [options]="additionalServiceOptions"
              (valueChange)="addService.emit($event)"
            ></ui-select>
          </section>
          <div class="grid gap-3 sm:gap-4 md:grid-cols-2">
            <label class="field">
              <span>Data</span>
              <barber-calendar-input
              compact
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
            <div class="field">
              <span
                >Ora <em class="required-mark" aria-hidden="true">*</em></span
              >
              <ui-select
                [value]="appointmentForm.startsAt"
                (valueChange)="
                  appointmentValueChange.emit({
                    key: 'startsAt',
                    value: $event,
                  })
                "
                [disabled]="availabilityLoading || !appointmentSlots.length"
                [options]="appointmentSlotOptions"
                label="Orario"
                [placeholder]="
                  availabilityLoading
                    ? 'Verifica degli orari...'
                    : appointmentSlots.length
                      ? 'Orari suggeriti'
                      : 'Nessun orario suggerito'
                "
              ></ui-select>
              <label class="field mt-2">
                <span>Oppure scrivi l'ora</span>
                <input
                  type="time"
                  name="appointmentTypedTime"
                  [value]="typedTime"
                  (change)="typeTime($any($event.target).value)"
                />
              </label>
              <p *ngIf="timeNote" class="text-sm text-amber-800">
                {{ timeNote }}
              </p>
            </div>
          </div>
          <div class="grid gap-3 sm:gap-4 md:grid-cols-2">
            <div class="field">
              <span>Stato</span>
              <ui-select
                [value]="appointmentForm.status"
                (valueChange)="
                  appointmentValueChange.emit({ key: 'status', value: $event })
                "
                [options]="appointmentStatusOptions"
                label="Stato"
              ></ui-select>
            </div>
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
          <label *ngIf="!appointmentForm.id" class="flex items-start gap-3 text-sm leading-6">
            <input type="checkbox" name="appointmentWhatsAppConsent" [ngModel]="appointmentForm.appointmentWhatsAppConsent" (ngModelChange)="appointmentValueChange.emit({key:'appointmentWhatsAppConsent',value:$event})" />
            <span>Il cliente autorizza promemoria e richieste di conferma WhatsApp per questa prenotazione. È richiesto il numero con prefisso internazionale.</span>
          </label>
          <div class="appointments-form-actions">
            <div class="appointments-form-actions-group">
              <button
                [aloraFunction]="
                  appointmentForm.id
                    ? 'appointments.update.all'
                    : 'appointments.create'
                "
                type="submit"
                class="primary-btn"
                [disabled]="loading || availabilityLoading || !formValid"
              >
                <barber-ui-icon name="save"></barber-ui-icon>
                {{
                  appointmentForm.id ? "Salva modifiche" : "Crea appuntamento"
                }}
              </button>
              <button
                aloraFunction="sales.manage"
                *ngIf="appointmentForm.id"
                type="button"
                class="primary-btn"
                [disabled]="loading"
                (click)="confirmOrder.emit()"
              >
                <barber-ui-icon name="receipt"></barber-ui-icon> Chiudi il conto
              </button>
            </div>
            <div
              *ngIf="appointmentForm.id"
              class="appointments-form-actions-group"
            >
              <button
                aloraFunction="appointments.update.all"
                type="button"
                class="danger-btn"
                [disabled]="loading"
                (click)="remove.emit()"
              >
                <barber-ui-icon name="trash"></barber-ui-icon> Elimina
              </button>
              <button
                aloraFunction="appointments.update.all"
                type="button"
                class="pill-btn"
                [disabled]="loading"
                (click)="cancel.emit()"
              >
                Annulla
              </button>
            </div>
          </div>
        </form>
      </article>
    </section>
  `,
})
export class AdminAppointmentsPageComponent {
  readonly session = inject(SessionStore);

  @Input() listOnly = false;
  @Input() formOnly = false;
  @Input() appointments: any[] = [];
  @Input() appointmentForm: any = {};
  @Input() serviceSelectOptions: Array<{ value: string; label: string }> = [];
  @Input() bookingLocationOptions: Array<{ value: string; label: string }> = [];
  @Input() bookingLocationId = "";
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
  @Input() multipleServices = false;
  @Input() availabilityLoading = false;
  @Input() additionalServices: any[] = [];
  @Input() additionalServiceOptions: Array<{ value: string; label: string }> =
    [];
  @Output() addService = new EventEmitter<string>();
  @Output() removeService = new EventEmitter<number>();
  @Output() serviceCollaborator = new EventEmitter<{
    index: number;
    collaboratorId: string;
  }>();

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
      !this.availabilityLoading &&
      customer &&
      this.appointmentForm.serviceId &&
      this.appointmentForm.startsAt,
    );
  }

  /** HH:MM part of the chosen local time. */
  get typedTime(): string {
    const match = /T(\d{2}:\d{2})/.exec(String(this.appointmentForm?.startsAt || ""));
    return match ? match[1] : "";
  }

  /** The slot list is only a suggestion: staff may write any time. */
  typeTime(time: string): void {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !this.appointmentSelectedDate)
      return;
    this.appointmentValueChange.emit({
      key: "startsAt",
      value: `${this.appointmentSelectedDate}T${time}`,
    });
  }

  get timeNote(): string {
    const startsAt = this.appointmentForm?.startsAt;
    if (!startsAt || this.availabilityLoading) return "";
    const slot = this.appointmentSlots.find(
      (row: { startsAt: string; outsideHours?: boolean }) =>
        row.startsAt === startsAt,
    ) as { outsideHours?: boolean } | undefined;
    if (!slot)
      return "Orario scritto a mano: si controlla solo che il professionista sia libero.";
    return slot.outsideHours
      ? "Attenzione: fuori dall'orario di apertura o di lavoro."
      : "";
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
