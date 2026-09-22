import { CommonModule } from "@angular/common";
import { Component, OnInit, inject } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { AdminAppointmentsDrawerComponent } from "./admin-appointments-drawer.component";
import { AdminAppointmentsQuickRescheduleModalComponent } from "./admin-appointments-quick-reschedule-modal.component";
import { AdminAppointmentsPageComponent } from "../pages/admin-appointments-page.component";
import { AdminAppointmentsCalendarComponent } from "./admin-appointments-calendar.component";
import { AppointmentsCollaboratorMultiSelectComponent } from "./appointments-collaborator-multi-select.component";
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
    AppointmentsCollaboratorMultiSelectComponent,
  ],
  providers: [AppointmentsFacade],
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
          class="panel rounded-[2rem] p-5 text-sm text-[var(--muted)]"
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
            [appointments]="appointmentsFacade.listAppointments()"
            [appointmentForm]="appointmentsFacade.appointmentForm()"
            [appointmentCustomerSearch]="
              appointmentsFacade.appointmentCustomerSearch()
            "
            (appointmentValueChange)="
              appointmentsFacade.setAppointmentValue($event.key, $event.value)
            "
            [filteredAppointmentCustomers]="
              appointmentsFacade.filteredAppointmentCustomers()
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
            (editAppointment)="appointmentsFacade.editAppointment($event)"
            (appointmentCustomerInput)="
              appointmentsFacade.handleAppointmentCustomerInput($event)
            "
            (appointmentSelectedDateChange)="
              appointmentsFacade.setAppointmentSelectedDate($event)
            "
            (updateAppointmentSlots)="
              appointmentsFacade.updateAppointmentSlots()
            "
            (save)="saveAppointment()"
            (remove)="removeAppointment()"
            (cancel)="cancelAppointment()"
            (reset)="appointmentsFacade.prepareNewAppointment()"
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
    `,
  ],
})
export class AdminAppointmentsFeaturePageComponent implements OnInit {
  readonly appointmentsFacade = inject(AppointmentsFacade);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  activeTab: "calendar" | "list" = "calendar";

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
    } catch {
      // The facade exposes user-facing feedback for request failures.
    }
  }

  async cancelAppointment(): Promise<void> {
    try {
      await this.appointmentsFacade.cancelAppointment();
      await this.appointmentsFacade.loadViewData();
    } catch {
      // The facade exposes user-facing feedback for request failures.
    }
  }

  async removeAppointment(): Promise<void> {
    try {
      await this.appointmentsFacade.removeAppointment();
      await this.appointmentsFacade.loadViewData();
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
    } catch {
      // The facade exposes user-facing feedback for request failures.
    }
  }

  editAppointmentById(appointmentId: string): void {
    const appointment = this.appointmentsFacade
      .appointments()
      .find((item) => item.id === appointmentId);
    if (appointment) {
      this.activeTab = "list";
      this.appointmentsFacade.editAppointment(appointment);
      this.appointmentsFacade.closeDrawer();
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
