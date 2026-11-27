import { CommonModule } from "@angular/common";
import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from "@angular/core";
import { CalendarInputComponent } from "../calendar-input.component";
import { UiSelectComponent } from "@alora/ui";
import { AutofocusFirstDirective } from "../shared/autofocus-first.directive";
import { parseLocalBookingTime } from "./booking-local-time";

@Component({
  selector: "barber-admin-appointments-quick-reschedule-modal",
  standalone: true,
  imports: [
    CommonModule,
    CalendarInputComponent,
    UiSelectComponent,
    AutofocusFirstDirective,
  ],
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 80;
      }

      .quick-modal-card {
        border: 1px solid rgba(30, 52, 37, 0.08);
        border-radius: 1.4rem;
        background: rgba(255, 255, 255, 0.74);
        padding: 1rem;
      }
    `,
  ],
  template: `
    <div
      class="absolute inset-0 bg-[rgba(15,23,32,0.4)]"
      (click)="!busy && cancel.emit()"
    ></div>
    <section
      barberAutofocusFirst
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-reschedule-title"
      class="absolute left-1/2 top-1/2 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 panel rounded-[2rem] p-4 sm:p-5"
    >
      <p class="eyebrow text-[var(--accent)]">Sposta appuntamento</p>
      <h3
        id="quick-reschedule-title"
        class="mt-2 font-display text-2xl sm:text-3xl"
      >
        Scegli il nuovo orario
      </h3>
      <p class="mt-2 text-sm text-[var(--muted)]">
        {{ appointment?.customer?.firstName }}
        {{ appointment?.customer?.lastName }} · {{ appointment?.service?.name }}
      </p>

      <article class="quick-modal-card mt-4">
        <div class="grid gap-3 md:grid-cols-2">
          <div>
            <p class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Vista di partenza
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

      <p *ngIf="feedback" role="status" class="mt-3 text-sm">{{ feedback }}</p>
      <article *ngIf="pending" role="status" class="quick-modal-card mt-3">
        <p>
          Lo spostamento precedente è ancora da verificare. Recupera la stessa
          richiesta prima di modificarlo.
        </p>
        <button
          type="button"
          class="primary-btn mt-2"
          [disabled]="!canRecover || saving"
          (click)="retry.emit()"
        >
          Verifica spostamento precedente
        </button>
      </article>
      <fieldset [disabled]="busy" style="border:0;padding:0;min-width:0">
        <div class="mt-4 grid gap-4">
          <barber-calendar-input
            [value]="state?.targetDate || ''"
            (valueChange)="
              fieldChange.emit({ key: 'targetDate', value: $event })
            "
            label="Data"
            name="quickRescheduleDate"
          ></barber-calendar-input>

          <ui-select
            [value]="state?.collaboratorId || ''"
            (valueChange)="
              fieldChange.emit({ key: 'collaboratorId', value: $event })
            "
            [options]="collaboratorOptions"
            label="Professionista"
            [showLabel]="true"
          ></ui-select>

          <ui-select
            [value]="state?.startsAt || ''"
            (valueChange)="fieldChange.emit({ key: 'startsAt', value: $event })"
            [options]="slotOptions"
            label="Orario"
            placeholder="Seleziona orario"
            [showLabel]="true"
          ></ui-select>

          <label class="field">
            <span>Oppure scrivi l'ora</span>
            <input
              type="time"
              name="quickRescheduleTypedTime"
              [value]="typedTime()"
              (change)="typeTime($any($event.target).value)"
            />
          </label>

          <p *ngIf="loadingSlots" role="status">
            Verifica disponibilità sul server…
          </p>
          <p
            *ngIf="!loadingSlots && !slotOptions.length"
            class="text-sm text-amber-800"
          >
            Nessun orario suggerito: puoi scrivere l'ora a mano.
          </p>
          <p
            *ngIf="state?.startsAt && !suggested()"
            class="text-sm text-amber-800"
          >
            Orario scritto a mano: si controlla solo che il professionista sia
            libero.
          </p>
        </div>
      </fieldset>
      <div class="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          class="primary-btn"
          [disabled]="busy || !state?.startsAt"
          (click)="confirm.emit()"
        >
          Conferma
        </button>
        <button
          type="button"
          class="secondary-btn"
          [disabled]="busy"
          (click)="!busy && cancel.emit()"
        >
          Annulla
        </button>
      </div>
    </section>
  `,
})
export class AdminAppointmentsQuickRescheduleModalComponent {
  @Input() busy = false;
  @Input() saving = false;
  @Input() loadingSlots = false;
  @Input() feedback = "";
  @Input() pending = false;
  @Input() canRecover = false;
  @Output() retry = new EventEmitter<void>();
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

  @HostListener("document:keydown.escape")
  closeOnEscape(): void {
    if (!this.busy) this.cancel.emit();
  }

  /** HH:MM of the chosen instant, in local time. */
  typedTime(): string {
    const at = this.state?.startsAt ? new Date(this.state.startsAt) : null;
    if (!at || !Number.isFinite(at.getTime())) return "";
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }

  suggested(): boolean {
    return this.slotOptions.some((row) => row.value === this.state?.startsAt);
  }

  typeTime(time: string): void {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !this.state?.targetDate)
      return;
    const at = parseLocalBookingTime(`${this.state.targetDate}T${time}`);
    if (at) this.fieldChange.emit({ key: "startsAt", value: at.toISOString() });
  }

  originalTimeLabel(): string {
    if (!this.appointment?.startsAt) {
      return "Non indicato";
    }
    return new Date(this.appointment.startsAt).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}
