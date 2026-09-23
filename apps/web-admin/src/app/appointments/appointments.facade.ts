import { Injectable, computed, signal, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { AdminApiService } from "../core/admin-api.service";
import { AdminFacade } from "../core/admin.facade";
import { AppointmentsService } from "./appointments.service";

type CalendarView = "day" | "week" | "month";

type DrawerMode = "preview" | "detail";

type QuickRescheduleState = {
  appointmentId: string;
  sourceView: "week" | "month";
  targetDate: string;
  startsAt: string;
  collaboratorId: string;
};

@Injectable()
export class AppointmentsFacade {
  private readonly adminApi = inject(AdminApiService);
  private readonly adminFacade = inject(AdminFacade);
  private readonly appointmentsService = inject(AppointmentsService);

  private readonly appointmentsState = signal<any[]>([]);
  private readonly collaboratorsState = signal<any[]>([]);
  private readonly servicesState = signal<any[]>([]);
  private readonly customersState = signal<any[]>([]);
  private readonly tenantState = signal<any>(null);

  readonly appointmentStatuses = [
    "requested",
    "confirmed",
    "checked_in",
    "completed",
    "cancelled",
    "no_show",
    "rescheduled",
  ];

  readonly appointmentForm = signal(this.emptyAppointmentForm());
  readonly appointmentCustomerSearch = signal("");
  readonly filteredAppointmentCustomers = signal<any[]>([]);
  readonly appointmentSelectedDate = signal(
    new Date().toISOString().slice(0, 10),
  );
  readonly appointmentSlots = signal<
    Array<{ startsAt: string; label: string }>
  >([]);
  readonly calendarView = signal<CalendarView>("week");
  readonly calendarDate = signal(new Date());
  readonly selectedCollaboratorIds = signal<string[]>([]);
  readonly drawerAppointmentId = signal("");
  readonly drawerMode = signal<DrawerMode>("preview");
  readonly detailAppointmentId = signal("");
  readonly quickRescheduleState = signal<QuickRescheduleState | null>(null);
  readonly quickRescheduleSlots = signal<
    Array<{ startsAt: string; label: string }>
  >([]);
  readonly listFilterDate = signal("");
  readonly loading = signal(false);
  readonly feedback = signal("");

  readonly appointments = computed(() => this.appointmentsState());
  readonly collaborators = computed(() => this.collaboratorsState());
  readonly services = computed(() => this.servicesState());
  readonly customers = computed(() => this.customersState());
  readonly tenant = computed(() => this.tenantState());

  readonly serviceSelectOptions = computed(() =>
    this.services().map((service) => ({
      value: service.id,
      label: service.name,
    })),
  );

  readonly appointmentCustomerOptions = computed(() =>
    this.customers().map((customer) => ({
      value: customer.id,
      label: this.appointmentCustomerOptionLabel(customer),
    })),
  );

  readonly collaboratorFilterOptions = computed(() =>
    this.collaborators().map((collaborator) => ({
      value: collaborator.id,
      label: `${collaborator.firstName} ${collaborator.lastName}`.trim(),
    })),
  );

  readonly appointmentCollaboratorOptions = computed(() => {
    const defaultCollaboratorId = this.tenant()?.defaultCollaboratorId;

    return [...this.collaborators()]
      .sort((left, right) => {
        if (left.id === defaultCollaboratorId) return -1;
        if (right.id === defaultCollaboratorId) return 1;
        return `${left.firstName} ${left.lastName}`.localeCompare(
          `${right.firstName} ${right.lastName}`,
          "it",
        );
      })
      .map((collaborator) => ({
        value: collaborator.id,
        label: `${collaborator.firstName} ${collaborator.lastName}${
          collaborator.id === defaultCollaboratorId ? " · default" : ""
        }`,
      }));
  });

  readonly appointmentSlotOptions = computed(() =>
    this.appointmentSlots().map((slot) => ({
      value: slot.startsAt,
      label: slot.label,
    })),
  );

  readonly appointmentStatusOptions = computed(() =>
    this.appointmentStatuses.map((status) => ({
      value: status,
      label: this.formatAppointmentStatus(status),
    })),
  );

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
          .slice(0, 3),
        hiddenCount: Math.max(
          0,
          this.visibleAppointments().filter((appointment) => {
            const startsAt = new Date(appointment.startsAt);
            return startsAt >= dayStart && startsAt < dayEnd;
          }).length - 3,
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
            appointment.startsAt.slice(0, 10) === this.listFilterDate()),
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
    this.collaborators().map((collaborator) => ({
      value: collaborator.id,
      label: `${collaborator.firstName} ${collaborator.lastName}`.trim(),
    })),
  );

  readonly quickRescheduleSlotOptions = computed(() =>
    this.quickRescheduleSlots().map((slot) => ({
      value: slot.startsAt,
      label: slot.label,
    })),
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
    this.adminFacade.setCoreData(input);
    this.filteredAppointmentCustomers.set([...customers.items]);

    if (!this.appointmentForm().serviceId && services.items[0]) {
      this.appointmentForm.update((form) => ({
        ...form,
        serviceId: services.items[0].id,
      }));
    }
  }

  async loadViewData(): Promise<void> {
    this.loading.set(true);
    this.feedback.set("");
    try {
      const response: any = await firstValueFrom(
        this.adminApi.loadAppointmentsViewData(),
      );
      this.replaceSourceData({
        appointments: response.appointments || [],
        collaborators: response.collaborators || [],
        services: response.services || [],
        customers: response.customers || [],
        tenant: response.tenant || null,
      });
      try {
        await this.adminFacade.refreshStatsData();
      } catch {
        // The agenda state is already current; keep it visible if a secondary
        // dashboard metric cannot be refreshed.
      }
    } catch (error: any) {
      this.feedback.set(
        error?.error?.message ||
          error?.message ||
          "Errore nel caricamento appuntamenti",
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
  }

  goToToday(): void {
    this.calendarDate.set(new Date());
  }

  setCalendarDate(date: Date): void {
    this.calendarDate.set(new Date(date));
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
  }

  openQuickReschedule(input: QuickRescheduleState): void {
    this.quickRescheduleState.set(input);
    this.updateQuickRescheduleSlots();
  }

  closeQuickReschedule(): void {
    this.quickRescheduleState.set(null);
    this.quickRescheduleSlots.set([]);
  }

  prepareNewAppointment(): void {
    this.appointmentForm.set(this.emptyAppointmentForm());
    this.appointmentCustomerSearch.set("");
    this.filteredAppointmentCustomers.set([...this.customers()]);
    this.appointmentSelectedDate.set(new Date().toISOString().slice(0, 10));
    this.appointmentSlots.set([]);
    if (this.services()[0]) {
      this.appointmentForm.update((form) => ({
        ...form,
        serviceId: this.services()[0].id,
      }));
    }
  }

  editAppointment(appointment: any): void {
    const startsAt = new Date(appointment.startsAt);
    this.appointmentForm.set({
      id: appointment.id,
      customerId: appointment.customerId || "",
      customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      email: appointment.customer.email || "",
      phone: appointment.customer.phone || "",
      serviceId: appointment.serviceId,
      collaboratorId: appointment.collaboratorId || "",
      startsAt: this.toLocalDateTimeValue(startsAt),
      status: appointment.status,
      customerNotes: appointment.customerNotes || "",
    });
    this.appointmentCustomerSearch.set(
      this.appointmentCustomerOptionLabel(appointment.customer),
    );
    this.filteredAppointmentCustomers.set([...this.customers()]);
    this.appointmentSelectedDate.set(this.toDateInputValue(startsAt));
    this.updateAppointmentSlots();
  }

  setAppointmentValue(key: string, value: string): void {
    this.appointmentForm.update((form) => ({ ...form, [key]: value }));
  }

  setAppointmentSelectedDate(value: string): void {
    this.appointmentSelectedDate.set(value);
  }

  handleAppointmentCustomerInput(value: string): void {
    this.appointmentCustomerSearch.set(value);
    this.filterAppointmentCustomers();

    const customer = this.customers().find(
      (entry) => this.appointmentCustomerOptionLabel(entry) === value,
    );

    if (!customer) {
      this.appointmentForm.update((form) => ({
        ...form,
        customerId: "",
        customerName: "",
        email: "",
        phone: "",
      }));
      return;
    }

    this.appointmentForm.update((form) => ({
      ...form,
      customerId: customer.id,
      customerName: `${customer.firstName} ${customer.lastName}`,
      email: customer.email || "",
      phone: customer.phone || "",
    }));
    this.appointmentCustomerSearch.set(
      this.appointmentCustomerOptionLabel(customer),
    );
  }

  selectAppointmentCustomer(customerId: string): void {
    const customer = this.customers().find((entry) => entry.id === customerId);
    if (!customer) return;
    this.appointmentForm.update((form) => ({
      ...form,
      customerId: customer.id,
      customerName: `${customer.firstName} ${customer.lastName}`.trim(),
      email: customer.email || "",
      phone: customer.phone || "",
    }));
    this.appointmentCustomerSearch.set(this.appointmentCustomerOptionLabel(customer));
  }

  selectQuickCreatedEntity(kind: "customer" | "service", entity: any): void {
    if (kind === "customer") {
      this.customersState.update((items) => [entity, ...items]);
      this.selectAppointmentCustomer(entity.id);
      return;
    }
    this.servicesState.update((items) => [...items, entity]);
    this.setAppointmentValue("serviceId", entity.id);
    this.updateAppointmentSlots();
  }

  updateAppointmentSlots(): void {
    const form = this.appointmentForm();

    if (
      form.collaboratorId &&
      !this.appointmentCollaboratorOptions().some(
        (option) => option.value === form.collaboratorId,
      )
    ) {
      this.appointmentForm.update((current) => ({
        ...current,
        collaboratorId: "",
      }));
    }

    const selectedDate = this.appointmentSelectedDate();
    const collaboratorId = this.appointmentForm().collaboratorId;
    const service = this.services().find(
      (item) => item.id === this.appointmentForm().serviceId,
    );
    const currentAppointmentId = this.appointmentForm().id;
    const currentSelected = this.appointmentForm().startsAt;
    const currentIsOnSelectedDate =
      Boolean(currentSelected) &&
      currentSelected.startsWith(`${selectedDate}T`);

    // Senza servizio, data o collaboratore non possiamo proporre la griglia
    // degli slot. Se stiamo modificando un appuntamento esistente conserviamo
    // comunque l'orario reale (es. ordine rapido senza collaboratore), cosi
    // l'utente puo salvare le altre modifiche senza reinserire l'ora.
    if (!service || !selectedDate || !collaboratorId) {
      const preserved = this.preserveCurrentAppointmentSlot(
        [],
        currentAppointmentId,
        currentSelected,
        currentIsOnSelectedDate,
      );
      this.appointmentSlots.set(preserved);
      if (!preserved.some((slot) => slot.startsAt === currentSelected)) {
        this.appointmentForm.update((current) => ({
          ...current,
          startsAt: "",
        }));
      }
      return;
    }

    const durationMinutes = Number(service.durationMinutes || 30);
    const dayStart = new Date(`${selectedDate}T00:00`);
    const dayEnd = new Date(`${selectedDate}T23:59:59`);
    const slots: Array<{ startsAt: string; label: string }> = [];

    for (let hour = 9; hour < 19; hour += 1) {
      for (const minute of [0, 30]) {
        const startsAt = new Date(dayStart);
        startsAt.setHours(hour, minute, 0, 0);
        const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000);

        if (
          endsAt > dayEnd ||
          endsAt.getHours() > 19 ||
          (endsAt.getHours() === 19 && endsAt.getMinutes() > 0)
        ) {
          continue;
        }

        const hasConflict = this.appointments().some((appointment) => {
          if (appointment.id === currentAppointmentId) {
            return false;
          }
          if (appointment.collaboratorId !== collaboratorId) {
            return false;
          }
          if (["cancelled", "no_show"].includes(appointment.status)) {
            return false;
          }

          const appointmentStartsAt = new Date(appointment.startsAt);
          const appointmentEndsAt = new Date(appointment.endsAt);
          return appointmentStartsAt < endsAt && appointmentEndsAt > startsAt;
        });

        if (!hasConflict) {
          slots.push({
            startsAt: this.toLocalDateTimeValue(startsAt),
            label: startsAt.toLocaleTimeString("it-IT", {
              hour: "2-digit",
              minute: "2-digit",
            }),
          });
        }
      }
    }

    this.preserveCurrentAppointmentSlot(
      slots,
      currentAppointmentId,
      currentSelected,
      currentIsOnSelectedDate,
    );
    this.appointmentSlots.set(slots);

    if (!slots.some((slot) => slot.startsAt === currentSelected)) {
      this.appointmentForm.update((current) => ({ ...current, startsAt: "" }));
    }
  }

  /**
   * Gli ordini rapidi generano appuntamenti a consuntivo con orari non
   * allineati alla griglia di 30 minuti (Now() - durata servizi). Quando si
   * modifica un appuntamento esistente dobbiamo conservarne l'orario reale
   * invece di azzerarlo, altrimenti il form obbliga a reinserire l'ora.
   */
  private preserveCurrentAppointmentSlot(
    slots: Array<{ startsAt: string; label: string }>,
    currentAppointmentId: string,
    currentSelected: string,
    currentIsOnSelectedDate: boolean,
  ): Array<{ startsAt: string; label: string }> {
    if (
      currentAppointmentId &&
      currentIsOnSelectedDate &&
      currentSelected &&
      !slots.some((slot) => slot.startsAt === currentSelected)
    ) {
      const currentDate = new Date(currentSelected);
      slots.push({
        startsAt: currentSelected,
        label: currentDate.toLocaleTimeString("it-IT", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });
      slots.sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    }

    return slots;
  }

  async saveAppointment(): Promise<string> {
    await this.appointmentsService.saveAppointment(this.appointmentForm());
    const message = this.appointmentForm().id
      ? "Appuntamento aggiornato"
      : "Appuntamento creato";
    this.prepareNewAppointment();
    return message;
  }

  async cancelAppointment(): Promise<string> {
    await this.appointmentsService.cancelAppointment(this.appointmentForm().id);
    this.prepareNewAppointment();
    return "Appuntamento annullato";
  }

  async removeAppointment(): Promise<string> {
    await this.appointmentsService.removeAppointment(this.appointmentForm().id);
    this.prepareNewAppointment();
    return "Appuntamento eliminato";
  }

  async moveAppointment(input: {
    appointmentId: string;
    collaboratorId: string;
    startsAt: string;
  }): Promise<string> {
    await this.appointmentsService.moveAppointment({
      id: input.appointmentId,
      collaboratorId: input.collaboratorId,
      startsAt: input.startsAt,
    });
    return "Appuntamento spostato";
  }

  async confirmQuickReschedule(): Promise<string> {
    const state = this.quickRescheduleState();
    if (!state) {
      return "";
    }
    await this.moveAppointment({
      appointmentId: state.appointmentId,
      collaboratorId: state.collaboratorId,
      startsAt: state.startsAt,
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
    this.quickRescheduleState.set(next);
    if (key !== "startsAt") {
      this.updateQuickRescheduleSlots();
    }
  }

  appointmentCustomerOptionLabel(customer: any): string {
    const segments = [`${customer.firstName} ${customer.lastName}`.trim()];
    if (customer.email) {
      segments.push(customer.email);
    }
    if (customer.phone) {
      segments.push(customer.phone);
    }
    return segments.join(" · ");
  }

  formatAppointmentStatus(status: string): string {
    return status.replace(/_/g, " ");
  }

  private filterAppointmentCustomers(): void {
    const query = this.appointmentCustomerSearch().trim().toLowerCase();
    if (!query) {
      this.filteredAppointmentCustomers.set([...this.customers()]);
      return;
    }

    this.filteredAppointmentCustomers.set(
      this.customers().filter((customer) => {
        const haystack = [
          customer.firstName,
          customer.lastName,
          customer.email,
          customer.phone,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      }),
    );
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
      source: appointment,
    };
  }

  private updateQuickRescheduleSlots(): void {
    const state = this.quickRescheduleState();
    if (!state) {
      this.quickRescheduleSlots.set([]);
      return;
    }

    const appointment = this.appointments().find(
      (item) => item.id === state.appointmentId,
    );
    const service = this.services().find(
      (item) => item.id === appointment?.serviceId,
    );
    if (!service || !state.targetDate || !state.collaboratorId) {
      this.quickRescheduleSlots.set([]);
      return;
    }

    const durationMinutes = Number(service.durationMinutes || 30);
    const dayStart = new Date(`${state.targetDate}T00:00`);
    const dayEnd = new Date(`${state.targetDate}T23:59:59`);
    const slots: Array<{ startsAt: string; label: string }> = [];

    for (let hour = 9; hour < 19; hour += 1) {
      for (const minute of [0, 30]) {
        const startsAt = new Date(dayStart);
        startsAt.setHours(hour, minute, 0, 0);
        const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000);
        if (
          endsAt > dayEnd ||
          endsAt.getHours() > 19 ||
          (endsAt.getHours() === 19 && endsAt.getMinutes() > 0)
        ) {
          continue;
        }

        const hasConflict = this.appointments().some((entry) => {
          if (entry.id === state.appointmentId) {
            return false;
          }
          if (entry.collaboratorId !== state.collaboratorId) {
            return false;
          }
          if (["cancelled", "no_show"].includes(entry.status)) {
            return false;
          }
          const appointmentStartsAt = new Date(entry.startsAt);
          const appointmentEndsAt = new Date(entry.endsAt);
          return appointmentStartsAt < endsAt && appointmentEndsAt > startsAt;
        });

        if (!hasConflict) {
          slots.push({
            startsAt: this.toLocalDateTimeValue(startsAt),
            label: startsAt.toLocaleTimeString("it-IT", {
              hour: "2-digit",
              minute: "2-digit",
            }),
          });
        }
      }
    }

    this.quickRescheduleSlots.set(slots);
    if (!slots.some((slot) => slot.startsAt === state.startsAt) && slots[0]) {
      this.quickRescheduleState.set({ ...state, startsAt: slots[0].startsAt });
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
    const dateKey = day.toISOString().slice(0, 10);
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

  private emptyAppointmentForm() {
    return {
      id: "",
      customerId: "",
      customerName: "",
      email: "",
      phone: "",
      serviceId: "",
      collaboratorId: "",
      startsAt: "",
      status: "confirmed",
      customerNotes: "",
    };
  }

  private toDateInputValue(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private toLocalDateTimeValue(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    const hours = String(value.getHours()).padStart(2, "0");
    const minutes = String(value.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
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
