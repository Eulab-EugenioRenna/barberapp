import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  inject,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { AdminAppointmentsPageComponent } from "../pages/admin-appointments-page.component";
import {
  QuickCreateDialogComponent,
  QuickCreateKind,
} from "../quick-create-dialog.component";
import { AppointmentsFacade } from "./appointments.facade";

@Component({
  selector: "barber-admin-appointments-editor-modal",
  standalone: true,
  imports: [
    CommonModule,
    AdminAppointmentsPageComponent,
    QuickCreateDialogComponent,
  ],
  styles: [
    `
      .editor-overlay {
        padding: 0.75rem;
      }

      .editor-panel {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        width: min(48rem, 100%);
        height: min(90vh, 52rem);
        max-height: min(90vh, 52rem);
        overflow: hidden;
        border-radius: 1.8rem;
        padding: 0;
      }

      .editor-body {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }

      .editor-body > * {
        flex: 1 1 auto;
        min-height: 0;
        width: 100%;
      }

      /*
       * Dentro il modale il form e l'unica card: togliamo il bordo/ombra
       * interni per evitare l'effetto "card dentro la card".
       */
      :host ::ng-deep barber-admin-appointments-page .appointments-panel {
        border: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
      }

      :host
        ::ng-deep
        barber-admin-appointments-page
        .appointments-list-layout {
        gap: 0;
      }

      .editor-close {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        z-index: 3;
        display: inline-grid;
        place-items: center;
        width: 2.4rem;
        height: 2.4rem;
        border: 0.0625rem solid var(--line);
        border-radius: 999rem;
        background: rgba(255, 255, 255, 0.94);
        color: var(--ink);
        font-size: 1.3rem;
        line-height: 1;
        cursor: pointer;
      }

      .editor-close:hover {
        background: #fff;
        transform: translateY(-0.0625rem);
      }

      @media (max-width: 63.99rem) {
        .editor-overlay {
          padding: 0;
        }

        .editor-panel {
          width: 100%;
          height: 100dvh;
          max-height: 100dvh;
          border-radius: 0;
        }

        :host ::ng-deep barber-admin-appointments-page .appointments-panel {
          border-radius: 0;
        }

        :host
          ::ng-deep
          barber-admin-appointments-page
          .appointments-panel-scroll {
          padding: 0 1rem 1.5rem;
        }
      }
    `,
  ],
  template: `
    <div class="confirm-overlay editor-overlay">
      <button
        type="button"
        class="confirm-backdrop"
        aria-label="Chiudi nuova prenotazione"
        (click)="close.emit()"
      ></button>
      <article
        class="confirm-dialog panel editor-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointments-editor-title"
      >
        <button
          type="button"
          class="editor-close"
          aria-label="Chiudi"
          (click)="close.emit()"
        >
          ×
        </button>
        <div class="editor-body">
          <barber-admin-appointments-page
            [formOnly]="true"
            [appointmentForm]="appointmentsFacade.appointmentForm()"
            [appointmentCustomerOptions]="
              appointmentsFacade.appointmentCustomerOptions()
            "
            [serviceSelectOptions]="appointmentsFacade.serviceSelectOptions()"
            [appointmentCollaboratorOptions]="
              appointmentsFacade.appointmentCollaboratorOptions()
            "
            [appointmentSelectedDate]="
              appointmentsFacade.appointmentSelectedDate()
            "
            [appointmentSlots]="appointmentsFacade.appointmentSlots()"
            [appointmentSlotOptions]="
              appointmentsFacade.appointmentSlotOptions()
            "
            [appointmentStatusOptions]="
              appointmentsFacade.appointmentStatusOptions()
            "
            [loading]="appointmentsFacade.loading()"
            (appointmentValueChange)="
              appointmentsFacade.setAppointmentValue($event.key, $event.value)
            "
            (appointmentCustomerSelect)="
              appointmentsFacade.selectAppointmentCustomer($event)
            "
            (appointmentSelectedDateChange)="
              appointmentsFacade.setAppointmentSelectedDate($event)
            "
            (updateAppointmentSlots)="
              appointmentsFacade.updateAppointmentSlots()
            "
            (quickCreate)="quickCreateKind = $event"
            (save)="saveAppointment()"
            (confirmOrder)="confirmOrderFromEditor()"
            (remove)="removeAppointment()"
            (cancel)="cancelAppointment()"
            (reset)="appointmentsFacade.prepareNewAppointment()"
          ></barber-admin-appointments-page>
        </div>
      </article>

      <barber-quick-create-dialog
        *ngIf="quickCreateKind"
        [kind]="quickCreateKind"
        (cancel)="quickCreateKind = null"
        (created)="onQuickCreated($event.kind, $event.entity)"
      ></barber-quick-create-dialog>
    </div>
  `,
})
export class AdminAppointmentsEditorModalComponent implements OnInit {
  readonly appointmentsFacade = inject(AppointmentsFacade);

  @Input() appointment: any = null;
  @Output() close = new EventEmitter<void>();
  @Output() saved = new EventEmitter<void>();
  @Output() createOrder = new EventEmitter<any>();

  quickCreateKind: QuickCreateKind | null = null;

  async ngOnInit(): Promise<void> {
    if (!this.appointmentsFacade.services().length) {
      try {
        await this.appointmentsFacade.loadViewData();
      } catch {
        // The facade exposes the load error through its feedback signal.
      }
    }

    if (this.appointment) {
      this.appointmentsFacade.editAppointment(this.appointment);
    } else {
      this.appointmentsFacade.prepareNewAppointment();
    }
  }

  onQuickCreated(kind: "customer" | "service", entity: any): void {
    this.appointmentsFacade.selectQuickCreatedEntity(kind, entity);
    this.quickCreateKind = null;
  }

  async saveAppointment(): Promise<void> {
    const status = this.appointmentsFacade.appointmentForm().status;
    const formId = this.appointmentsFacade.appointmentForm().id;
    const wasCompleted = this.appointment?.status === "completed";
    try {
      const saved = await this.appointmentsFacade.saveAppointment();
      await this.appointmentsFacade.loadViewData();
      this.saved.emit();
      // Un appuntamento appena completato va chiuso con una vendita:
      // dopo il salvataggio apriamo direttamente la conferma dell'ordine.
      if (status === "completed" && !wasCompleted) {
        const appointment = this.resolveSavedAppointment(saved, formId);
        if (appointment) {
          this.createOrder.emit(appointment);
        }
      }
      this.close.emit();
    } catch {
      // The facade exposes the save error through its feedback signal.
    }
  }

  async confirmOrderFromEditor(): Promise<void> {
    const formId = this.appointmentsFacade.appointmentForm().id;
    if (!formId) {
      return;
    }
    try {
      const saved = await this.appointmentsFacade.saveAppointment();
      await this.appointmentsFacade.loadViewData();
      const appointment = this.resolveSavedAppointment(saved, formId);
      if (appointment) {
        this.createOrder.emit(appointment);
      }
    } catch {
      return;
    }
    this.saved.emit();
    this.close.emit();
  }

  private resolveSavedAppointment(saved: any, formId: string): any {
    const id = saved?.id || formId;
    if (!id) {
      return saved || null;
    }
    return (
      this.appointmentsFacade
        .appointments()
        .find((item) => item.id === id) ||
      saved ||
      null
    );
  }

  async removeAppointment(): Promise<void> {
    try {
      await this.appointmentsFacade.removeAppointment();
      await this.appointmentsFacade.loadViewData();
      this.saved.emit();
      this.close.emit();
    } catch {
      // The facade exposes the error through its feedback signal.
    }
  }

  async cancelAppointment(): Promise<void> {
    try {
      await this.appointmentsFacade.cancelAppointment();
      await this.appointmentsFacade.loadViewData();
      this.saved.emit();
      this.close.emit();
    } catch {
      // The facade exposes the error through its feedback signal.
    }
  }
}
