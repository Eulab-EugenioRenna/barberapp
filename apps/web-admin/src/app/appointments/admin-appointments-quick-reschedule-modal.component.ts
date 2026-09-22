import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { CalendarInputComponent } from "../calendar-input.component";
import { CustomSelectComponent } from "../custom-select.component";

@Component({
  selector: "barber-admin-appointments-quick-reschedule-modal",
  standalone: true,
  imports: [CommonModule, CalendarInputComponent, CustomSelectComponent],
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 80;
      }

      .quick-modal-card {
        border: 1px solid rgba(15, 23, 32, 0.08);
        border-radius: 1.4rem;
        background: rgba(255, 255, 255, 0.74);
        padding: 1rem;
      }
    `,
  ],
  template: `
    <div
      class="absolute inset-0 bg-[rgba(15,23,32,0.4)]"
      (click)="cancel.emit()"
    ></div>
    <section
      class="absolute left-1/2 top-1/2 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 panel rounded-[2rem] p-5"
    >
      <p class="eyebrow text-[var(--accent)]">Sposta appuntamento</p>
      <h3 class="mt-2 font-display text-3xl">Conferma nuova collocazione</h3>
      <p class="mt-2 text-sm text-[var(--muted)]">
        {{ appointment?.customer?.firstName }}
        {{ appointment?.customer?.lastName }} · {{ appointment?.service?.name }}
      </p>

      <article class="quick-modal-card mt-5">
        <div class="grid gap-3 md:grid-cols-2">
          <div>
            <p class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Vista origine
            </p>
            <strong class="mt-2 block capitalize">{{
              state?.sourceView
            }}</strong>
          </div>
          <div>
            <p class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Orario originale
            </p>
            <strong class="mt-2 block">{{ originalTimeLabel() }}</strong>
          </div>
        </div>
      </article>

      <div class="mt-5 grid gap-4">
        <barber-calendar-input
          [value]="state?.targetDate || ''"
          (valueChange)="fieldChange.emit({ key: 'targetDate', value: $event })"
          label="Data"
          name="quickRescheduleDate"
        ></barber-calendar-input>

        <barber-custom-select
          [value]="state?.collaboratorId || ''"
          (valueChange)="
            fieldChange.emit({ key: 'collaboratorId', value: $event })
          "
          [options]="collaboratorOptions"
          label="Collaboratore"
        ></barber-custom-select>

        <barber-custom-select
          [value]="state?.startsAt || ''"
          (valueChange)="fieldChange.emit({ key: 'startsAt', value: $event })"
          [options]="slotOptions"
          label="Orario"
          placeholder="Seleziona orario"
        ></barber-custom-select>

        <p *ngIf="!slotOptions.length" class="text-sm text-amber-800">
          Nessuno slot disponibile con la configurazione corrente. Cambia data o
          collaboratore.
        </p>
      </div>

      <div class="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          class="primary-btn"
          [disabled]="!state?.startsAt"
          (click)="confirm.emit()"
        >
          Conferma
        </button>
        <button type="button" class="secondary-btn" (click)="cancel.emit()">
          Annulla
        </button>
      </div>
    </section>
  `,
})
export class AdminAppointmentsQuickRescheduleModalComponent {
  @Input() appointment: any = null;
  @Input() state: any = null;
  @Input() collaboratorOptions: Array<{ value: string; label: string }> = [];
  @Input() slotOptions: Array<{ value: string; label: string }> = [];
  @Output() cancel = new EventEmitter<void>();
  @Output() confirm = new EventEmitter<void>();
  @Output() fieldChange = new EventEmitter<{
    key: "targetDate" | "startsAt" | "collaboratorId";
    value: string;
  }>();

  originalTimeLabel(): string {
    if (!this.appointment?.startsAt) {
      return "N/D";
    }
    return new Date(this.appointment.startsAt).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}
