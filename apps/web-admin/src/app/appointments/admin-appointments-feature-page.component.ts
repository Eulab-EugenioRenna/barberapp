import { CommonModule } from "@angular/common";
import { Component, EventEmitter, OnInit, Output, inject } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { AdminAppointmentsDrawerComponent } from "./admin-appointments-drawer.component";
import { AdminAppointmentsQuickRescheduleModalComponent } from "./admin-appointments-quick-reschedule-modal.component";
import { AdminAppointmentsPageComponent } from "../pages/admin-appointments-page.component";
import { AdminAppointmentsCalendarComponent } from "./admin-appointments-calendar.component";
import { AppointmentsCollaboratorMultiSelectComponent } from "./appointments-collaborator-multi-select.component";
import { AppointmentsFacade } from "./appointments.facade";
import { QuickCreateDialogComponent, QuickCreateKind } from "../quick-create-dialog.component";

@Component({
  selector: "barber-admin-appointments-feature-page",
  standalone: true,
  imports: [
    CommonModule,
    AdminAppointmentsDrawerComponent,
    AdminAppointmentsQuickRescheduleModalComponent,
    AdminAppointmentsPageComponent,
    AdminAppointmentsCalendarComponent,
    AppointmentsCollaboratorMultiSelectComponent,
    QuickCreateDialogComponent,
  ],
  template: `
    <section class="appointments-shell">
      <div class="appointments-header panel rounded-[2rem] p-4 md:p-5">
        <div class="appointments-toolbar">
          <div class="appointments-tabs">
            <button
              type="button"
              class="pill-btn"
              [class.appointments-tab-active]="activeTab === 'calendar'"
              (click)="activeTab = 'calendar'"
            >
              Calendario
            </button>
            <button
              type="button"
              class="pill-btn"
              [class.appointments-tab-active]="activeTab === 'list'"
              (click)="activeTab = 'list'"
            >
              Lista appuntamenti
            </button>
          </div>

          <barber-appointments-collaborator-multi-select
            [options]="appointmentsFacade.collaboratorFilterOptions()"
            [values]="appointmentsFacade.selectedCollaboratorIds()"
            (valuesChange)="
              appointmentsFacade.setSelectedCollaboratorIds($event)
            "
          ></barber-appointments-collaborator-multi-select>
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
            (editAppointment)="openEditor.emit($event)"
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
      <barber-quick-create-dialog
        *ngIf="quickCreateKind"
        [kind]="quickCreateKind"
        (cancel)="quickCreateKind = null"
        (created)="onQuickCreated($event.kind, $event.entity)"
      ></barber-quick-create-dialog>
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
      @media (max-width: 63.99rem) {
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
  readonly appointmentsFacade = inject(AppointmentsFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  @Output() createOrder = new EventEmitter<any>();
  @Output() dataChanged = new EventEmitter<"dashboard" | "all">();
  @Output() openEditor = new EventEmitter<any>();
  activeTab: "calendar" | "list" = "calendar";
  quickCreateKind: QuickCreateKind | null = null;

  onQuickCreated(kind: "customer" | "service", entity: any): void {
    this.appointmentsFacade.selectQuickCreatedEntity(kind, entity);
    this.quickCreateKind = null;
    this.dataChanged.emit("all");
  }

  async ngOnInit(): Promise<void> {
    await this.reloadViewData();
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

  prepareNewAppointment(): void {
    this.activeTab = "list";
    this.appointmentsFacade.closeDrawer();
    this.appointmentsFacade.prepareNewAppointment();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { detail: null },
      queryParamsHandling: "merge",
    });
  }

  async saveAppointment(): Promise<void> {
    try {
      await this.appointmentsFacade.saveAppointment();
      await this.appointmentsFacade.loadViewData();
      this.dataChanged.emit("dashboard");
    } catch {
      // The facade exposes user-facing feedback for request failures.
    }
  }

  async confirmOrderFromEditor(): Promise<void> {
    const appointmentId = this.appointmentsFacade.appointmentForm().id;
    if (!appointmentId) {
      return;
    }
    try {
      await this.appointmentsFacade.saveAppointment();
      await this.appointmentsFacade.loadViewData();
      this.dataChanged.emit("dashboard");
    } catch {
      return;
    }
    const appointment = this.appointmentsFacade
      .appointments()
      .find((item) => item.id === appointmentId);
    if (appointment) {
      this.createOrder.emit(appointment);
    }
  }

  async cancelAppointment(): Promise<void> {
    try {
      await this.appointmentsFacade.cancelAppointment();
      await this.appointmentsFacade.loadViewData();
      this.dataChanged.emit("dashboard");
    } catch {
      // The facade exposes user-facing feedback for request failures.
    }
  }

  async removeAppointment(): Promise<void> {
    try {
      await this.appointmentsFacade.removeAppointment();
      await this.appointmentsFacade.loadViewData();
      this.dataChanged.emit("dashboard");
      await this.router.navigate([], {
        queryParams: { detail: null },
        queryParamsHandling: "merge",
      });
    } catch {
      // The facade exposes user-facing feedback for request failures.
    }
  }

  async moveAppointment(event: {
    appointmentId: string;
    collaboratorId: string;
    startsAt: string;
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
    sourceView: "week" | "month";
  }): void {
    this.appointmentsFacade.closeDrawer();
    this.appointmentsFacade.openQuickReschedule({
      appointmentId: event.appointmentId,
      targetDate: event.targetDate,
      startsAt: event.suggestedStartsAt,
      collaboratorId: event.suggestedCollaboratorId,
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
