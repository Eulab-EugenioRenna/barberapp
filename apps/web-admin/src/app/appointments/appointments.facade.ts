import { slotOptions } from "../core/slot-options";
import { humanError } from "../core/human-error";
import {
  bookingInstant,
  localBookingTime,
  parseLocalBookingTime,
} from "./booking-local-time";
import { agendaWindow, windowCovers } from "./agenda-window";
import { clockToMinutes } from "./calendar-time-grid";
import { CreateRecoveryService } from "../core/create-recovery.service";
import { Injectable, computed, signal, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { AdminApiService } from "../core/admin-api.service";
import { AdminFacade } from "../core/admin.facade";
import { CustomerDirectoryService } from "../core/customer-directory.service";
import { toLocalDateKey } from "@barber/shared/utils";
import { appointmentStatusLabel } from "../shared/presentation-copy";
import { AppointmentsService } from "./appointments.service";
import { OperationalContextService } from "../core/operational-context.service";
import { offeredAt, sectorForActivity } from "../core/activity-placement";

type CalendarView = "day" | "week" | "month";

type DrawerMode = "preview" | "detail";

type QuickRescheduleState = {
  appointmentId: string;
  sourceView: "week" | "month";
  targetDate: string;
  startsAt: string;
  collaboratorId: string;
  revision?: number;
};

@Injectable()
export class AppointmentsFacade {
  private readonly adminApi = inject(AdminApiService);
  readonly creations = inject(CreateRecoveryService);
  private readonly adminFacade = inject(AdminFacade);
  private readonly customerDirectory = inject(CustomerDirectoryService);
  private readonly appointmentsService = inject(AppointmentsService);
  private readonly context = inject(OperationalContextService);

  private readonly appointmentsState = signal<any[]>([]);
  private readonly collaboratorsState = signal<any[]>([]);
  private readonly servicesState = signal<any[]>([]);
  private readonly customersState = signal<any[]>([]);
  private readonly tenantState = signal<any>(null);

  readonly quickRescheduleLoading = signal(false);
  readonly appointmentUpdateState = computed(() =>
    this.creations.state("appointment-update"),
  );
  private quickAvailabilityRequest = 0;
  readonly calendarView = signal<CalendarView>("week");
  readonly calendarDate = signal(new Date());
  readonly selectedCollaboratorIds = signal<string[]>([]);
  readonly drawerAppointmentId = signal("");
  readonly drawerMode = signal<DrawerMode>("preview");
  readonly detailAppointmentId = signal("");
  readonly quickRescheduleState = signal<QuickRescheduleState | null>(null);
  readonly quickRescheduleSlots = signal<
    Array<{ startsAt: string; label: string; outsideHours?: boolean }>
  >([]);
  readonly listFilterDate = signal("");
  readonly loading = signal(false);
  readonly feedback = signal("");

  readonly appointments = computed(() => this.appointmentsState());
  readonly collaborators = computed(() => this.collaboratorsState());
  readonly services = computed(() => this.servicesState());
  readonly customers = computed(() => this.customersState());
  readonly tenant = computed(() => this.tenantState());

  /** Location of a new booking: the one of the scope, or the only one. */
  readonly defaultLocationId = computed(() => {
    const locations = this.context.locations();
    return (
      this.context.selected.locationId ||
      (locations.length === 1 ? locations[0].id : "")
    );
  });

  /** Locations to choose from when the account has more than one. */
  readonly bookingLocationOptions = computed(() =>
    this.context
      .locations()
      .filter((location) => location.isActive)
      .map((location) => ({ value: location.id, label: location.name })),
  );

  /** Only services whose activity runs at the location. */
  servicesAt(locationId: string): any[] {
    return this.services().filter((service) =>
      offeredAt(this.context.sectors, service, locationId),
    );
  }

  /** Sector of the service's activity at the location. */
  sectorIdAt(service: any, locationId: string): string | undefined {
    return (
      sectorForActivity(this.context.sectors, service?.activityId, locationId)
        ?.id || service?.sectorId
    );
  }

  /** Professionals of the service's activity at the location. */
  professionalOptionsFor(serviceId: string, locationId: string) {
    const service = this.services().find((row) => row.id === serviceId);
    return this.professionalOptions(
      service ? this.sectorIdAt(service, locationId) : undefined,
    );
  }

  /** A customer created from the editor is pickable everywhere at once. */
  addCustomer(entity: any): void {
    this.customersState.update((items) => [entity, ...items]);
    this.customerDirectory.add(entity);
  }

  /** A service created from the editor joins the catalog of the agenda. */
  addCatalogService(entity: any): void {
    this.servicesState.update((items) => [...items, entity]);
  }

  readonly collaboratorFilterOptions = computed(() =>
    this.collaborators().map((collaborator) => ({
      value: collaborator.id,
      label: `${collaborator.firstName} ${collaborator.lastName}`.trim(),
    })),
  );

  private professionalOptions(sectorId: string | undefined) {
    return [
      { value: "", label: "Nessuna preferenza" },
      ...[...this.collaborators()]
        .filter(
          (person) =>
            !sectorId ||
            person.sectors?.some(
              (membership: any) => membership.sectorId === sectorId,
            ),
        )
        .sort((left, right) => {
          return `${left.firstName} ${left.lastName}`.localeCompare(
            `${right.firstName} ${right.lastName}`,
            "it",
          );
        })
        .map((collaborator) => ({
          value: collaborator.id,
          label: `${collaborator.firstName} ${collaborator.lastName}`,
        })),
    ];
  }


  readonly visibleAppointments = computed(() => {
    const range = this.getVisibleRange();
    const selectedCollaboratorIds = this.selectedCollaboratorIds();

    return this.appointments()
      .filter((appointment) => {
        const startsAt = new Date(appointment.startsAt);
        const inRange = startsAt >= range.start && startsAt < range.end;
        const collaboratorMatch =
          !selectedCollaboratorIds.length ||
          selectedCollaboratorIds.includes(appointment.collaboratorId);
        return inRange && collaboratorMatch;
      })
      .sort(
        (left, right) =>
          new Date(left.startsAt).getTime() -
          new Date(right.startsAt).getTime(),
      );
  });

  readonly summary = computed(() => {
    const appointments = this.visibleAppointments();
    return {
      total: appointments.length,
      confirmed: appointments.filter((item) => item.status === "confirmed")
        .length,
      cancelled: appointments.filter((item) => item.status === "cancelled")
        .length,
      completed: appointments.filter((item) => item.status === "completed")
        .length,
      revenue: appointments.reduce(
        (sum, item) =>
          sum + Number(item.finalPrice || item.estimatedPrice || 0),
        0,
      ),
      durationHours: appointments.reduce((sum, item) => {
        const startsAt = new Date(item.startsAt).getTime();
        const endsAt = new Date(item.endsAt).getTime();
        return sum + Math.max(0, endsAt - startsAt) / 3600000;
      }, 0),
    };
  });

  readonly calendarTitle = computed(() => {
    const date = this.calendarDate();
    const view = this.calendarView();
    if (view === "day") {
      return date.toLocaleDateString("it-IT", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      });
    }
    if (view === "week") {
      const start = this.startOfWeek(date);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return `${start.toLocaleDateString("it-IT", {
        day: "2-digit",
        month: "short",
      })} - ${end.toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}`;
    }
    return date.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  });

  readonly dayColumns = computed(() => {
    const start = this.startOfDay(this.calendarDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const selectedCollaboratorIds = this.selectedCollaboratorIds();
    const collaborators = this.collaborators().filter(
      (collaborator) =>
        !selectedCollaboratorIds.length ||
        selectedCollaboratorIds.includes(collaborator.id),
    );

    return collaborators.map((collaborator) => ({
      id: collaborator.id,
      label: `${collaborator.firstName} ${collaborator.lastName}`.trim(),
      color: collaborator.calendarColor || "#1c7c64",
      workingWindow: this.resolveCollaboratorWorkingWindow(collaborator, start),
      appointments: this.appointments()
        .filter((appointment) => {
          const startsAt = new Date(appointment.startsAt);
          return (
            appointment.collaboratorId === collaborator.id &&
            startsAt >= start &&
            startsAt < end
          );
        })
        .map((appointment) =>
          this.toCalendarCard(appointment, collaborator.calendarColor),
        )
        .sort((left, right) => left.sortValue - right.sortValue),
    }));
  });

  readonly weekDays = computed(() => {
    const weekStart = this.startOfWeek(this.calendarDate());
    const selectedCollaboratorIds = this.selectedCollaboratorIds();
    const collaborators = this.collaborators().filter(
      (collaborator) =>
        !selectedCollaboratorIds.length ||
        selectedCollaboratorIds.includes(collaborator.id),
    );

    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(weekStart);
      day.setDate(day.getDate() + index);
      const dayStart = this.startOfDay(day);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      return {
        key: day.toISOString(),
        date: day,
        label: day.toLocaleDateString("it-IT", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
        }),
        isToday: this.isSameDay(day, new Date()),
        isSelected: this.isSameDay(day, this.calendarDate()),
        isUnavailable: this.isDayUnavailable(day),
        workingWindow: this.teamWorkingWindow(collaborators, day),
        statusLabel: this.isDayUnavailable(day)
          ? "Giorno libero / festivo"
          : collaborators.some((collaborator) => {
                const window = this.resolveCollaboratorWorkingWindow(
                  collaborator,
                  day,
                );
                return (
                  window.isAvailable &&
                  (window.startTime !== "09:00" || window.endTime !== "19:00")
                );
              })
            ? "Orario ridotto"
            : "Regolare",
        collaboratorLegend: collaborators.map((collaborator) => ({
          collaboratorId: collaborator.id,
          collaboratorLabel:
            `${collaborator.firstName} ${collaborator.lastName}`.trim(),
          color: collaborator.calendarColor || "#1c7c64",
        })),
        visibleAppointments: this.visibleAppointments()
          .filter((appointment) => {
            const startsAt = new Date(appointment.startsAt);
            return startsAt >= dayStart && startsAt < dayEnd;
          })
          .map((appointment) =>
            this.toCalendarCard(
              appointment,
              appointment.collaborator?.calendarColor || "#1c7c64",
            ),
          )
          .sort((left, right) => left.sortValue - right.sortValue),
        appointments: this.visibleAppointments()
          .filter((appointment) => {
            const startsAt = new Date(appointment.startsAt);
            return startsAt >= dayStart && startsAt < dayEnd;
          })
          .map((appointment) =>
            this.toCalendarCard(
              appointment,
              appointment.collaborator?.calendarColor || "#1c7c64",
            ),
          )
          .sort((left, right) => left.sortValue - right.sortValue)
          .slice(0, 5),
        hiddenCount: Math.max(
          0,
          this.visibleAppointments().filter((appointment) => {
            const startsAt = new Date(appointment.startsAt);
            return startsAt >= dayStart && startsAt < dayEnd;
          }).length - 5,
        ),
      };
    });
  });

  readonly monthCells = computed(() => {
    const monthStart = this.startOfMonth(this.calendarDate());
    const gridStart = this.startOfWeek(monthStart);

    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(gridStart);
      day.setDate(day.getDate() + index);
      const dayStart = this.startOfDay(day);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      return {
        key: day.toISOString(),
        date: day,
        inMonth: day.getMonth() === this.calendarDate().getMonth(),
        isToday: this.isSameDay(day, new Date()),
        isSelected: this.isSameDay(day, this.calendarDate()),
        isUnavailable: this.isDayUnavailable(day),
        statusLabel: this.isDayUnavailable(day)
          ? "Bloccato"
          : this.collaborators().some((collaborator) => {
                const window = this.resolveCollaboratorWorkingWindow(
                  collaborator,
                  day,
                );
                return (
                  window.isAvailable &&
                  (window.startTime !== "09:00" || window.endTime !== "19:00")
                );
              })
            ? "Ridotto"
            : "Disponibile",
        visibleAppointments: this.visibleAppointments()
          .filter((appointment) => {
            const startsAt = new Date(appointment.startsAt);
            return startsAt >= dayStart && startsAt < dayEnd;
          })
          .map((appointment) =>
            this.toCalendarCard(
              appointment,
              appointment.collaborator?.calendarColor || "#1c7c64",
            ),
          ),
        appointments: this.visibleAppointments()
          .filter((appointment) => {
            const startsAt = new Date(appointment.startsAt);
            return startsAt >= dayStart && startsAt < dayEnd;
          })
          .map((appointment) =>
            this.toCalendarCard(
              appointment,
              appointment.collaborator?.calendarColor || "#1c7c64",
            ),
          )
          .slice(0, 1),
        hiddenCount: Math.max(
          0,
          this.visibleAppointments().filter((appointment) => {
            const startsAt = new Date(appointment.startsAt);
            return startsAt >= dayStart && startsAt < dayEnd;
          }).length - 1,
        ),
      };
    });
  });

  readonly drawerAppointment = computed(
    () =>
      this.appointments().find(
        (appointment) => appointment.id === this.drawerAppointmentId(),
      ) || null,
  );

  readonly detailAppointment = computed(
    () =>
      this.appointments().find(
        (appointment) => appointment.id === this.detailAppointmentId(),
      ) || null,
  );

  readonly listAppointments = computed(() => {
    const selectedCollaboratorIds = this.selectedCollaboratorIds();

    return this.appointments()
      .filter(
        (appointment) =>
          (!selectedCollaboratorIds.length ||
            selectedCollaboratorIds.includes(appointment.collaboratorId)) &&
          (!this.listFilterDate() ||
            toLocalDateKey(appointment.startsAt) === this.listFilterDate()),
      )
      .sort(
        (left, right) =>
          new Date(left.startsAt).getTime() -
          new Date(right.startsAt).getTime(),
      );
  });

  readonly quickRescheduleAppointment = computed(() => {
    const state = this.quickRescheduleState();
    return state
      ? this.appointments().find(
          (appointment) => appointment.id === state.appointmentId,
        ) || null
      : null;
  });

  readonly quickRescheduleCollaboratorOptions = computed(() =>
    this.professionalOptions(this.quickRescheduleAppointment()?.sectorId),
  );

  readonly quickRescheduleSlotOptions = computed(() =>
    slotOptions(this.quickRescheduleSlots()),
  );

  replaceSourceData(input: {
    appointments: any[];
    collaborators: any;
    services: any;
    customers: any;
    tenant: any;
  }): void {
    const collaborators = unwrapPage(input.collaborators);
    const services = unwrapPage(input.services);
    const customers = unwrapPage(input.customers);

    this.appointmentsState.set(input.appointments || []);
    this.collaboratorsState.set(collaborators.items);
    this.servicesState.set(services.items);
    this.customersState.set(customers.items);
    this.tenantState.set(input.tenant || null);
    this.adminFacade.setCoreData({
      ...input,
      appointments: this.mergeWithShared(input.appointments || []),
    });
  }

  /** Calendar window on screen, widened by a week on each side. */
  agendaWindow(): { from: Date; to: Date } {
    return agendaWindow(
      this.calendarView(),
      this.calendarDate(),
      this.listFilterDate(),
    );
  }
  private loadedWindow: { from: number; to: number } | null = null;
  private windowRequest = 0;

  /** Other pages keep their bookings outside the agenda window. */
  private mergeWithShared(rows: any[]): any[] {
    const range = this.loadedWindow;
    if (!range) return rows;
    const outside = this.adminFacade.appointments().filter((row: any) => {
      const at = Date.parse(row?.startsAt);
      return !(at >= range.from && at <= range.to);
    });
    return [...outside, ...rows];
  }

  /** Reload only the bookings when the calendar moves out of the loaded window. */
  async ensureWindow(): Promise<void> {
    const wanted = this.agendaWindow();
    if (windowCovers(this.loadedWindow, wanted)) return;
    const request = ++this.windowRequest;
    try {
      const rows = await firstValueFrom(
        this.adminApi.loadAgendaAppointments(wanted),
      );
      if (request !== this.windowRequest) return;
      this.loadedWindow = {
        from: wanted.from.getTime(),
        to: wanted.to.getTime(),
      };
      this.appointmentsState.set(rows || []);
      const shared = this.mergeWithShared(rows || []);
      this.adminFacade.appointments.set(shared);
      this.adminFacade.dashboardAppointments.set(shared);
    } catch (error: any) {
      if (request === this.windowRequest)
        this.feedback.set(
          humanError(error, "Non riusciamo a caricare gli appuntamenti"),
        );
    }
  }

  async loadViewData(): Promise<void> {
    this.loading.set(true);
    this.feedback.set("");
    const range = this.agendaWindow();
    const request = ++this.windowRequest;
    try {
      const response: any = await firstValueFrom(
        this.adminApi.loadAppointmentsViewData(range),
      );
      if (request === this.windowRequest)
        this.loadedWindow = {
          from: range.from.getTime(),
          to: range.to.getTime(),
        };
      this.replaceSourceData({
        appointments: response.appointments || [],
        collaborators: response.collaborators || [],
        services: response.services || [],
        customers: response.customers || [],
        tenant: response.tenant || null,
      });
    } catch (error: any) {
      this.feedback.set(
        humanError(error, "Non riusciamo a caricare gli appuntamenti"),
      );
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  syncDetailAppointment(id: string | null): void {
    if (!id) {
      this.closeDrawer();
      return;
    }
    this.openDrawerDetail(id);
  }

  setCalendarView(view: CalendarView): void {
    this.calendarView.set(view);
    void this.ensureWindow();
  }

  shiftCalendar(direction: -1 | 1): void {
    const next = new Date(this.calendarDate());
    const view = this.calendarView();
    if (view === "day") {
      next.setDate(next.getDate() + direction);
    } else if (view === "week") {
      next.setDate(next.getDate() + direction * 7);
    } else {
      next.setMonth(next.getMonth() + direction);
    }
    this.calendarDate.set(next);
    void this.ensureWindow();
  }

  goToToday(): void {
    this.calendarDate.set(new Date());
    void this.ensureWindow();
  }

  setCalendarDate(date: Date): void {
    this.calendarDate.set(new Date(date));
    void this.ensureWindow();
  }

  setSelectedCollaboratorIds(value: string[]): void {
    this.selectedCollaboratorIds.set(value);
  }

  openDrawerPreview(appointmentId: string): void {
    this.drawerAppointmentId.set(appointmentId);
    this.drawerMode.set("preview");
  }

  openDrawerDetail(appointmentId: string): void {
    this.drawerAppointmentId.set(appointmentId);
    this.drawerMode.set("detail");
    this.detailAppointmentId.set(appointmentId);
  }

  closeDrawer(): void {
    this.drawerAppointmentId.set("");
    this.detailAppointmentId.set("");
    this.drawerMode.set("preview");
  }

  clearListFilterDate(): void {
    this.listFilterDate.set("");
  }

  applyListFilterDate(date: string): void {
    this.listFilterDate.set(date);
    void this.ensureWindow();
  }

  openQuickReschedule(input: QuickRescheduleState): void {
    const appointment = this.appointments().find(
      (row) => row.id === input.appointmentId,
    );
    if (this.appointmentUpdateState().kind !== "empty" || !appointment) {
      this.feedback.set("Recupera prima lo spostamento precedente");
      return;
    }
    const startsAt =
      this.instantForAppointment(input.startsAt, appointment) || "";
    this.quickRescheduleState.set({
      ...input,
      startsAt,
      revision: input.revision ?? appointment.orderItem?.sale?.revision,
    });
    void this.updateQuickRescheduleSlots();
  }

  closeQuickReschedule(): void {
    this.quickAvailabilityRequest++;
    this.quickRescheduleLoading.set(false);
    this.quickRescheduleState.set(null);
    this.quickRescheduleSlots.set([]);
  }

  async retryAppointmentCreation(): Promise<any> {
    this.loading.set(true);
    this.feedback.set("");
    try {
      return await firstValueFrom(this.adminApi.retryAppointmentCreation());
    } catch (error: any) {
      this.feedback.set(
        humanError(error, "Esito non disponibile"),
      );
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  private instantForAppointment(
    value: string,
    appointment: any,
  ): string | null {
    if (/(Z|[+-]\d{2}:\d{2})$/.test(value))
      return Number.isFinite(Date.parse(value))
        ? new Date(value).toISOString()
        : null;
    return bookingInstant(
      value,
      appointment?.startsAt,
      appointment ? localBookingTime(appointment.startsAt) : undefined,
    );
  }
  async moveAppointment(input: {
    appointmentId: string;
    collaboratorId: string;
    startsAt: string;
    revision?: number;
  }): Promise<string> {
    if (this.appointmentUpdateState().kind !== "empty")
      throw new Error("Recupera prima lo spostamento precedente");
    this.loading.set(true);
    try {
      const appointment = this.appointments().find(
        (row) => row.id === input.appointmentId,
      );
      const startsAt = this.instantForAppointment(input.startsAt, appointment);
      const revision = input.revision ?? appointment?.orderItem?.sale?.revision;
      if (!startsAt) throw new Error("Scegli un orario valido");
      await this.appointmentsService.moveAppointment({
        id: input.appointmentId,
        collaboratorId: input.collaboratorId,
        startsAt,
        revision,
      });
      this.feedback.set("");
      return "Appuntamento spostato";
    } catch (error: any) {
      this.feedback.set(
        humanError(error, "Spostamento non riuscito"),
      );
      throw error;
    } finally {
      this.loading.set(false);
    }
  }
  async retryAppointmentUpdate(): Promise<void> {
    this.loading.set(true);
    try {
      await firstValueFrom(this.adminApi.retryAppointmentUpdate());
      this.closeQuickReschedule();
      await this.loadViewData();
      this.feedback.set("Spostamento precedente recuperato");
    } catch (error: any) {
      this.feedback.set(
        humanError(error, "Esito non disponibile"),
      );
    } finally {
      this.loading.set(false);
    }
  }

  async confirmQuickReschedule(): Promise<string> {
    const state = this.quickRescheduleState();
    if (!state || !state.startsAt) {
      throw new Error("Scegli o scrivi l'orario");
    }
    await this.moveAppointment({
      appointmentId: state.appointmentId,
      collaboratorId: state.collaboratorId,
      startsAt: state.startsAt,
      revision: state.revision,
    });
    this.closeQuickReschedule();
    return "Appuntamento spostato";
  }

  setQuickRescheduleValue(
    key: "targetDate" | "startsAt" | "collaboratorId",
    value: string,
  ): void {
    const current = this.quickRescheduleState();
    if (!current) {
      return;
    }
    const next = { ...current, [key]: value };
    if (key === "targetDate" && current.startsAt) {
      // Same time on the new day: a typed time is never carried to the old date.
      const at = new Date(current.startsAt),
        pad = (number: number) => String(number).padStart(2, "0");
      next.startsAt =
        parseLocalBookingTime(
          `${value}T${pad(at.getHours())}:${pad(at.getMinutes())}`,
        )?.toISOString() || "";
    }
    this.quickRescheduleState.set(next);
    if (key !== "startsAt") {
      this.updateQuickRescheduleSlots();
    }
  }


  formatAppointmentStatus(status: string): string {
    return appointmentStatusLabel(status);
  }


  private getVisibleRange(): { start: Date; end: Date } {
    const view = this.calendarView();
    const date = this.calendarDate();
    if (view === "day") {
      const start = this.startOfDay(date);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return { start, end };
    }

    if (view === "week") {
      const start = this.startOfWeek(date);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return { start, end };
    }

    const start = this.startOfWeek(this.startOfMonth(date));
    const end = new Date(start);
    end.setDate(end.getDate() + 42);
    return { start, end };
  }

  private toCalendarCard(appointment: any, color: string) {
    const startsAt = new Date(appointment.startsAt);
    const endsAt = new Date(appointment.endsAt);
    const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
    const endMinutes = endsAt.getHours() * 60 + endsAt.getMinutes();
    const top = ((startMinutes - 9 * 60) / 30) * 2.75;
    const height = Math.max(2.75, ((endMinutes - startMinutes) / 30) * 2.75);

    return {
      id: appointment.id,
      title:
        `${appointment.customer?.firstName || "Cliente"} ${appointment.customer?.lastName || ""}`.trim(),
      subtitle: appointment.service?.name || "Servizio",
      timeLabel: startsAt.toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      status: appointment.status,
      statusLabel: this.formatAppointmentStatus(appointment.status),
      color,
      top,
      height,
      sortValue: startsAt.getTime(),
      collaboratorId: appointment.collaboratorId || "",
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      source: appointment,
    };
  }

  /** Earliest opening and latest closing of the team on a day, if open. */
  private teamWorkingWindow(
    collaborators: any[],
    day: Date,
  ): { startTime: string; endTime: string } | null {
    const windows = collaborators
      .map((collaborator) =>
        this.resolveCollaboratorWorkingWindow(collaborator, day),
      )
      .filter((window) => window.isAvailable);
    if (!windows.length) return null;
    const minutes = (value: string) => clockToMinutes(value) ?? 0;
    return {
      startTime: windows.reduce(
        (min, window) =>
          minutes(window.startTime) < minutes(min) ? window.startTime : min,
        windows[0].startTime,
      ),
      endTime: windows.reduce(
        (max, window) =>
          minutes(window.endTime) > minutes(max) ? window.endTime : max,
        windows[0].endTime,
      ),
    };
  }

  private async updateQuickRescheduleSlots(): Promise<void> {
    const request = ++this.quickAvailabilityRequest,
      state = this.quickRescheduleState();
    this.quickRescheduleSlots.set([]);
    if (!state) {
      this.quickRescheduleLoading.set(false);
      return;
    }
    const appointment = this.quickRescheduleAppointment();
    if (!appointment?.serviceId || !state.targetDate) return;
    this.quickRescheduleLoading.set(true);
    try {
      const response = await firstValueFrom(
        this.adminApi.reschedulingAvailability(state.appointmentId, {
          date: state.targetDate,
          startsAt: state.startsAt || undefined,
          lines: [
            {
              serviceId: appointment.serviceId,
              collaboratorId: state.collaboratorId || undefined,
              roomId: appointment.roomId || undefined,
            },
          ],
        }),
      );
      if (request !== this.quickAvailabilityRequest) return;
      if (Number.isInteger(response.orderRevision))
        this.quickRescheduleState.update((current) =>
          current ? { ...current, revision: response.orderRevision } : null,
        );
      const slots = (response.slots || []).map((slot: any) => ({
        startsAt: slot.startsAt,
        label: `${slot.label} – ${new Date(slot.endsAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`,
        outsideHours: !!slot.outsideHours,
      }));
      this.quickRescheduleSlots.set(slots);
      this.feedback.set("");
    } catch (error: any) {
      if (request === this.quickAvailabilityRequest) {
        this.feedback.set(
          humanError(error, "Disponibilità non consultabile"),
        );
      }
    } finally {
      if (request === this.quickAvailabilityRequest)
        this.quickRescheduleLoading.set(false);
    }
  }

  private isDayUnavailable(day: Date): boolean {
    const collaborators = this.collaborators().filter(
      (collaborator) =>
        !this.selectedCollaboratorIds().length ||
        this.selectedCollaboratorIds().includes(collaborator.id),
    );

    if (!collaborators.length) {
      return false;
    }

    return collaborators.every(
      (collaborator) =>
        !this.resolveCollaboratorWorkingWindow(collaborator, day).isAvailable,
    );
  }

  private resolveCollaboratorWorkingWindow(
    collaborator: any,
    day: Date,
  ): {
    isAvailable: boolean;
    isHoliday: boolean;
    startTime: string;
    endTime: string;
  } {
    const dateKey = toLocalDateKey(day);
    const override = (collaborator.dayOverrides || []).find(
      (entry: any) =>
        new Date(entry.date).toISOString().slice(0, 10) === dateKey,
    );

    if (override) {
      return {
        isAvailable: Boolean(override.isWorkingDay),
        isHoliday: Boolean(override.isHoliday),
        startTime: override.startTime || "09:00",
        endTime: override.endTime || "19:00",
      };
    }

    const weekday = (day.getDay() + 6) % 7;
    const weekly = (collaborator.weeklySchedules || []).find(
      (entry: any) => Number(entry.weekday) === weekday,
    );

    if (weekly) {
      return {
        isAvailable: Boolean(weekly.isWorkingDay),
        isHoliday: false,
        startTime: weekly.startTime || "09:00",
        endTime: weekly.endTime || "19:00",
      };
    }

    return {
      isAvailable: weekday < 5,
      isHoliday: false,
      startTime: "09:00",
      endTime: "19:00",
    };
  }

  private startOfDay(date: Date): Date {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
  }

  private startOfWeek(date: Date): Date {
    const next = this.startOfDay(date);
    const day = next.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    next.setDate(next.getDate() + diff);
    return next;
  }

  private startOfMonth(date: Date): Date {
    const next = this.startOfDay(date);
    next.setDate(1);
    return next;
  }

  private isSameDay(left: Date, right: Date): boolean {
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    );
  }

}

function unwrapPage(input: any): { items: any[]; hasMore: boolean } {
  if (Array.isArray(input)) {
    return { items: input, hasMore: false };
  }

  return {
    items: Array.isArray(input?.items) ? input.items : [],
    hasMore: Boolean(input?.hasMore),
  };
}
