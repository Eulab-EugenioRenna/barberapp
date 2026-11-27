import { SessionStore } from "../core/session.store";
import { CommonModule, DOCUMENT } from "@angular/common";
import {
  Component,
  EventEmitter,
  HostListener,
  OnInit,
  Output,
  inject,
} from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { AdminAppointmentsDrawerComponent } from "./admin-appointments-drawer.component";
import { AdminAppointmentsQuickRescheduleModalComponent } from "./admin-appointments-quick-reschedule-modal.component";
import { AdminAppointmentsPageComponent } from "../pages/admin-appointments-page.component";
import { AdminAppointmentsCalendarComponent } from "./admin-appointments-calendar.component";
import { UiMultiSelectComponent } from "@alora/ui";
import { AppointmentsFacade } from "./appointments.facade";

@Component({
  selector: "barber-admin-appointments-feature-page",
  standalone: true,
  imports: [
    CommonModule,
    AdminAppointmentsDrawerComponent,
    AdminAppointmentsQuickRescheduleModalComponent,
    AdminAppointmentsPageComponent,
    AdminAppointmentsCalendarComponent,
    UiMultiSelectComponent,
  ],
  template: `
    <article
      *ngIf="appointmentsFacade.appointmentUpdateState().kind !== 'empty'"
      class="panel rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-3"
      role="status"
    >
      <p>
        Uno spostamento precedente è ancora da verificare. Recupera lo stesso
        invio prima di effettuare altre modifiche.
      </p>
      <button
        type="button"
        class="primary-btn mt-2"
        [disabled]="
          appointmentsFacade.loading() ||
          appointmentsFacade.appointmentUpdateState().kind !== 'pending'
        "
        (click)="appointmentsFacade.retryAppointmentUpdate()"
      >
        Verifica spostamento precedente
      </button>
    </article>
    <section class="appointments-shell">
      <div class="appointments-header panel rounded-[2rem] p-4 md:p-5">
        <div class="appointments-toolbar">
          <div class="appointments-tabs" data-tour="appointments-tabs">
            <button
              type="button"
              class="pill-btn"
              data-tour="tab-calendar"
              [attr.aria-selected]="activeTab === 'calendar'"
              [class.appointments-tab-active]="activeTab === 'calendar'"
              (click)="activeTab = 'calendar'"
            >
              Calendario
            </button>
            <button
              type="button"
              class="pill-btn"
              data-tour="tab-list"
              [attr.aria-selected]="activeTab === 'list'"
              [class.appointments-tab-active]="activeTab === 'list'"
              (click)="activeTab = 'list'"
            >
              Lista appuntamenti
            </button>
          </div>

          <ui-multi-select
            class="appointments-team-filter"
            data-tour="appointments-team"
            [options]="appointmentsFacade.collaboratorFilterOptions()"
            [values]="appointmentsFacade.selectedCollaboratorIds()"
            (valuesChange)="
              appointmentsFacade.setSelectedCollaboratorIds($event)
            "
            label="Squadra"
            [showLabel]="true"
            placeholder="Tutta la squadra"
            filterPlaceholder="Cerca professionisti"
            emptyText="Nessun risultato"
          ></ui-multi-select>
        </div>
      </div>

      <div *ngIf="activeTab === 'calendar'" class="appointments-view">
        <article
          *ngIf="appointmentsFacade.feedback()"
          class="panel rounded-[2rem] border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"
        >
          {{ appointmentsFacade.feedback() }}
        </article>

        <article
          *ngIf="appointmentsFacade.loading()"
          class="panel rounded-[2rem] p-4 sm:p-5 text-sm text-[var(--muted)]"
        >
          Caricamento calendario in corso...
        </article>

        <barber-admin-appointments-calendar
          *ngIf="appointmentsFacade.tenant()"
          class="appointments-calendar-panel"
          [title]="appointmentsFacade.calendarTitle()"
          [view]="appointmentsFacade.calendarView()"
          [calendarDate]="appointmentsFacade.calendarDate()"
          [summary]="appointmentsFacade.summary()"
          [dayColumns]="appointmentsFacade.dayColumns()"
          [weekDays]="appointmentsFacade.weekDays()"
          [monthCells]="appointmentsFacade.monthCells()"
          (viewChange)="appointmentsFacade.setCalendarView($event)"
          (navigate)="appointmentsFacade.shiftCalendar($event)"
          (today)="appointmentsFacade.goToToday()"
          (calendarDateSelect)="appointmentsFacade.setCalendarDate($event)"
          (appointmentClick)="openPreview($event)"
          (appointmentDrop)="moveAppointment($event)"
          (appointmentRescheduleRequest)="openQuickReschedule($event)"
          (showDayAppointments)="showDayAppointments($event)"
        ></barber-admin-appointments-calendar>
      </div>

      <div *ngIf="activeTab === 'list'" class="appointments-view">
        <article
          *ngIf="appointmentsFacade.feedback()"
          class="panel rounded-[2rem] border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"
        >
          {{ appointmentsFacade.feedback() }}
        </article>

        <article
          *ngIf="appointmentsFacade.listFilterDate()"
          class="panel rounded-[2rem] p-4 text-sm"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span>
              Lista filtrata per il giorno
              <strong>{{ appointmentsFacade.listFilterDate() }}</strong>
            </span>
            <button
              type="button"
              class="pill-btn"
              (click)="appointmentsFacade.clearListFilterDate()"
            >
              Rimuovi filtro
            </button>
          </div>
        </article>

        <article class="appointments-list-shell">
          <barber-admin-appointments-page
            [listOnly]="true"
            [appointments]="appointmentsFacade.listAppointments()"
            [loading]="appointmentsFacade.loading()"
            (editAppointment)="editAppointmentById($event.id)"
          ></barber-admin-appointments-page>
        </article>
      </div>

      <barber-admin-appointments-drawer
        *ngIf="appointmentsFacade.drawerAppointment()"
        [appointment]="appointmentsFacade.drawerAppointment()"
        [mode]="appointmentsFacade.drawerMode()"
        (close)="closeDrawer()"
        (details)="openDetails($event)"
        (edit)="editAppointmentById($event)"
        (createOrder)="createOrder.emit($event)"
      ></barber-admin-appointments-drawer>

      <barber-admin-appointments-quick-reschedule-modal
        *ngIf="appointmentsFacade.quickRescheduleState()"
        [appointment]="appointmentsFacade.quickRescheduleAppointment()"
        [busy]="
          appointmentsFacade.loading() ||
          appointmentsFacade.appointmentUpdateState().kind !== 'empty'
        "
        [saving]="appointmentsFacade.loading()"
        [loadingSlots]="appointmentsFacade.quickRescheduleLoading()"
        [feedback]="appointmentsFacade.feedback()"
        [pending]="appointmentsFacade.appointmentUpdateState().kind !== 'empty'"
        [canRecover]="
          appointmentsFacade.appointmentUpdateState().kind === 'pending'
        "
        (retry)="appointmentsFacade.retryAppointmentUpdate()"
        [state]="appointmentsFacade.quickRescheduleState()"
        [collaboratorOptions]="
          appointmentsFacade.quickRescheduleCollaboratorOptions()
        "
        [slotOptions]="appointmentsFacade.quickRescheduleSlotOptions()"
        (cancel)="appointmentsFacade.closeQuickReschedule()"
        (confirm)="confirmQuickReschedule()"
        (fieldChange)="
          appointmentsFacade.setQuickRescheduleValue($event.key, $event.value)
        "
      ></barber-admin-appointments-quick-reschedule-modal>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        min-height: 0;
      }

      .appointments-shell {
        display: grid;
        height: 100%;
        min-height: 0;
        gap: 1rem;
        grid-template-rows: auto minmax(0, 1fr);
        align-content: start;
      }

      .appointments-view {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        gap: 1rem;
      }

      .appointments-calendar-panel {
        display: block;
        flex: 1 1 auto;
        min-height: 0;
        height: 100%;
      }

      .appointments-header {
        align-self: start;
        height: auto;
      }

      .appointments-list-shell {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        min-height: 0;
        gap: 1rem;
      }

      .appointments-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .appointments-team-filter {
        flex: 0 1 18rem;
        min-width: min(16rem, 100%);
      }

      .appointments-tabs {
        display: inline-flex;
        width: fit-content;
        height: fit-content;
        max-width: 100%;
        align-self: center;
        flex: 0 0 auto;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .appointments-tab-active {
        background: var(--accent);
        color: white;
        border-color: transparent;
      }

      /*
       * Mobile: niente altezze fisse annidate. Il calendario cresce in modo
       * naturale e a scorrere e il contenitore della pagina.
       */
      @media (max-width: 79.99rem) {
        :host {
          height: auto;
        }

        .appointments-shell {
          height: auto;
          grid-template-rows: auto auto;
        }

        .appointments-view {
          height: auto;
          gap: 0.75rem;
        }

        .appointments-calendar-panel {
          height: auto;
          flex: 0 0 auto;
        }
      }
    `,
  ],
})
export class AdminAppointmentsFeaturePageComponent implements OnInit {
  private readonly session = inject(SessionStore);

  readonly appointmentsFacade = inject(AppointmentsFacade);
  private readonly document = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  @Output() createOrder = new EventEmitter<any>();
  @Output() dataChanged = new EventEmitter<"dashboard" | "all">();
  @Output() openEditor = new EventEmitter<any>();
  activeTab: "calendar" | "list" = "calendar";

  async ngOnInit(): Promise<void> {
    await this.reloadViewData();
  }

  @HostListener("document:visibilitychange")
  @HostListener("window:online")
  async refreshOnResume(): Promise<void> {
    if (
      this.document.hidden ||
      !this.document.defaultView?.navigator.onLine ||
      this.appointmentsFacade.loading()
    ) {
      return;
    }
    try {
      await this.appointmentsFacade.loadViewData();
    } catch {
      // The facade exposes the load error; preserve the current editor state.
    }
  }

  async reloadViewData(): Promise<void> {
    try {
      await this.appointmentsFacade.loadViewData();
      const detailId = this.route.snapshot.queryParamMap.get("detail");
      this.appointmentsFacade.syncDetailAppointment(detailId);
    } catch {
      // The facade exposes the current load error to the template.
    }
  }

  async moveAppointment(event: {
    appointmentId: string;
    collaboratorId: string;
    startsAt: string;
    revision?: number;
  }): Promise<void> {
    try {
      await this.appointmentsFacade.moveAppointment(event);
      await this.appointmentsFacade.loadViewData();
      this.dataChanged.emit("dashboard");
    } catch {
      // The facade exposes user-facing feedback for request failures.
    }
  }

  editAppointmentById(appointmentId: string): void {
    if (this.appointmentsFacade.appointmentUpdateState().kind !== "empty") {
      this.appointmentsFacade.feedback.set(
        "Recupera prima lo spostamento precedente",
      );
      return;
    }
    if (!this.session.can("appointments.update.all")) {
      this.openDetails(appointmentId);
      return;
    }
    const appointment = this.appointmentsFacade
      .appointments()
      .find((item) => item.id === appointmentId);
    if (appointment) {
      this.appointmentsFacade.closeDrawer();
      this.openEditor.emit(appointment);
    }
  }

  openPreview(appointmentId: string): void {
    this.appointmentsFacade.openDrawerPreview(appointmentId);
  }

  openDetails(appointmentId: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { detail: appointmentId },
      queryParamsHandling: "merge",
    });
    this.appointmentsFacade.openDrawerDetail(appointmentId);
  }

  closeDrawer(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { detail: null },
      queryParamsHandling: "merge",
    });
    this.appointmentsFacade.closeDrawer();
  }

  openQuickReschedule(event: {
    appointmentId: string;
    targetDate: string;
    suggestedStartsAt: string;
    suggestedCollaboratorId: string;
    revision?: number;
    sourceView: "week" | "month";
  }): void {
    this.appointmentsFacade.closeDrawer();
    this.appointmentsFacade.openQuickReschedule({
      appointmentId: event.appointmentId,
      targetDate: event.targetDate,
      startsAt: event.suggestedStartsAt,
      collaboratorId: event.suggestedCollaboratorId,
      revision: event.revision,
      sourceView: event.sourceView,
    });
  }

  async confirmQuickReschedule(): Promise<void> {
    try {
      await this.appointmentsFacade.confirmQuickReschedule();
      await this.appointmentsFacade.loadViewData();
      this.dataChanged.emit("dashboard");
    } catch {
      // The facade exposes request feedback.
    }
  }

  showDayAppointments(event: {
    date: string;
    sourceView: "week" | "month";
  }): void {
    this.activeTab = "list";
    this.appointmentsFacade.applyListFilterDate(event.date);
  }

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}
