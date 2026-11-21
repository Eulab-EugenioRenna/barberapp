import { bookingInstant, localBookingTime } from "./booking-local-time";
import { CreateRecoveryService } from "../core/create-recovery.service";
import { Injectable, computed, signal, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { AdminApiService } from "../core/admin-api.service";
import { AdminFacade } from "../core/admin.facade";
import { toLocalDateKey } from "@barber/shared/utils";
import { appointmentStatusLabel } from "../shared/presentation-copy";
import { AppointmentsService } from "./appointments.service";

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
  readonly additionalServices = signal<
    Array<{ serviceId: string; collaboratorId: string }>
  >([]);
  readonly availabilityLoading = signal(false);
  readonly quickRescheduleLoading = signal(false);
  readonly appointmentUpdateState = computed(() =>
    this.creations.state("appointment-update"),
  );
  private quickAvailabilityRequest = 0;
  private availabilityRequest = 0;
  readonly additionalServiceOptions = computed(() => {
    const primary = this.services().find(
      (row) => row.id === this.appointmentForm().serviceId,
    );
    return this.services()
      .filter(
        (row) =>
          primary && row.sector?.locationId === primary.sector?.locationId,
      )
      .map((row) => ({
        value: row.id,
        label: `${row.name} · ${row.durationMinutes} min`,
      }));
  });
  readonly additionalServiceRows = computed(() =>
    this.additionalServices().map((row) => {
      const service = this.services().find(
        (entry) => entry.id === row.serviceId,
      );
      return {
        ...row,
        name: service?.name || "Servizio",
        durationMinutes: service?.durationMinutes,
        requiresCollaborator: service?.requiresCollaborator,
        options: this.professionalOptions(service?.sectorId),
      };
    }),
  );
  readonly appointmentCustomerSearch = signal("");
  readonly filteredAppointmentCustomers = signal<any[]>([]);
  readonly appointmentSelectedDate = signal(toLocalDateKey(new Date()));
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
    const sectorId = this.services().find(
      (service) => service.id === this.appointmentForm().serviceId,
    )?.sectorId;
    return this.professionalOptions(sectorId);
  });
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

  readonly appointmentSlotOptions = computed(() =>
    this.appointmentSlots().map((slot) => ({
      value: slot.startsAt,
      label: slot.label,
    })),
  );

  readonly appointmentStatusOptions = computed(() =>
    this.appointmentStatuses
      .filter(
        (status) =>
          this.appointmentForm().id ||
          !["completed", "cancelled", "no_show"].includes(status),
      )
      .map((status) => ({
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
    } catch (error: any) {
      this.feedback.set(
        error?.error?.message ||
          error?.message ||
          "Non riusciamo a caricare gli appuntamenti",
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
    const appointment = this.appointments().find(
      (row) => row.id === input.appointmentId,
    );
    if (
      this.appointmentUpdateState().kind !== "empty" ||
      !appointment ||
      appointment.orderItem?.sale?.orderStatus !== "open" ||
      ["completed", "cancelled", "no_show"].includes(appointment.status)
    ) {
      this.feedback.set(
        "Recupera l'invio precedente oppure apri un servizio attivo di un conto aperto",
      );
      return;
    }
    const startsAt =
      this.instantForAppointment(input.startsAt, appointment) || "";
    this.quickRescheduleState.set({
      ...input,
      startsAt,
      revision: input.revision ?? appointment.orderItem.sale.revision,
    });
    void this.updateQuickRescheduleSlots();
  }

  closeQuickReschedule(): void {
    this.quickAvailabilityRequest++;
    this.quickRescheduleLoading.set(false);
    this.quickRescheduleState.set(null);
    this.quickRescheduleSlots.set([]);
  }

  prepareNewAppointment(): void {
    this.availabilityRequest++;
    this.additionalServices.set([]);
    this.appointmentForm.set(this.emptyAppointmentForm());
    this.appointmentCustomerSearch.set("");
    this.filteredAppointmentCustomers.set([...this.customers()]);
    this.appointmentSelectedDate.set(toLocalDateKey(new Date()));
    this.appointmentSlots.set([]);
    if (this.services()[0]) {
      this.appointmentForm.update((form) => ({
        ...form,
        serviceId: this.services()[0].id,
      }));
    }
    this.updateAppointmentSlots();
  }

  editAppointment(appointment: any, loadSlots = true): void {
    this.availabilityRequest++;
    this.availabilityLoading.set(false);
    this.additionalServices.set([]);
    const startsAt = new Date(appointment.startsAt);
    this.appointmentForm.set({
      id: appointment.id,
      orderRevision: appointment.orderItem?.sale?.revision ?? Number.NaN,
      heldServiceId: appointment.serviceId,
      heldRoomId: appointment.roomId || "",
      heldStartsAt: appointment.startsAt,
      heldLocal: localBookingTime(appointment.startsAt),
      customerId: appointment.customerId || "",
      customerName: `${appointment.customer.firstName} ${appointment.customer.lastName}`,
      email: appointment.customer.email || "",
      phone: appointment.customer.phone || "",
      serviceId: appointment.serviceId,
      collaboratorId: appointment.collaboratorId || "",
      startsAt: this.toLocalDateTimeValue(startsAt),
      status: appointment.status,
      customerNotes: appointment.customerNotes || "",
      appointmentWhatsAppConsent: false,
    });
    this.appointmentCustomerSearch.set(
      this.appointmentCustomerOptionLabel(appointment.customer),
    );
    this.filteredAppointmentCustomers.set([...this.customers()]);
    this.appointmentSelectedDate.set(this.toDateInputValue(startsAt));
    if (loadSlots) this.updateAppointmentSlots();
  }

  setAppointmentValue(key: string, value: string): void {
    this.appointmentForm.update((form) => ({ ...form, [key]: value }));
    if (key === "serviceId") {
      const allowed = new Set(
        this.additionalServiceOptions().map((row) => row.value),
      );
      this.additionalServices.update((rows) =>
        rows.filter((row) => allowed.has(row.serviceId)),
      );
      if (
        !this.appointmentCollaboratorOptions().some(
          (option) => option.value === this.appointmentForm().collaboratorId,
        )
      )
        this.appointmentForm.update((form) => ({
          ...form,
          collaboratorId: "",
        }));
    }
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
    this.appointmentCustomerSearch.set(
      this.appointmentCustomerOptionLabel(customer),
    );
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
    if (!this.appointmentForm().id) void this.loadCreationSlots();
    else void this.loadEditSlots();
  }
  private async loadEditSlots(): Promise<void> {
    const request = ++this.availabilityRequest,
      form = this.appointmentForm();
    this.appointmentSlots.set([]);
    this.availabilityLoading.set(true);
    try {
      const startsAt = bookingInstant(
        form.startsAt,
        form.heldStartsAt,
        form.heldLocal,
      );
      const response = await firstValueFrom(
        this.adminApi.reschedulingAvailability(form.id, {
          date: this.appointmentSelectedDate(),
          startsAt: startsAt || undefined,
          lines: [
            {
              serviceId: form.serviceId,
              collaboratorId: form.collaboratorId || undefined,
              roomId:
                form.serviceId === form.heldServiceId
                  ? form.heldRoomId || undefined
                  : undefined,
            },
          ],
        }),
      );
      if (request !== this.availabilityRequest) return;
      if (response.orderRevision !== form.orderRevision)
        throw new Error(
          "Il conto è cambiato. Riapri la prenotazione prima di modificarla",
        );
      const slots = (response.slots || []).map((slot: any) => ({
        ...slot,
        startsAt: localBookingTime(slot.startsAt),
      }));
      this.appointmentSlots.set(slots);
      if (
        !slots.some(
          (slot: any) => slot.startsAt === this.appointmentForm().startsAt,
        )
      )
        this.appointmentForm.update((current) => ({
          ...current,
          startsAt: "",
        }));
    } catch (error: any) {
      if (request === this.availabilityRequest)
        this.feedback.set(
          error?.error?.message ||
            error?.message ||
            "Disponibilità non consultabile",
        );
    } finally {
      if (request === this.availabilityRequest)
        this.availabilityLoading.set(false);
    }
  }

  addService(serviceId: string): void {
    if (
      this.appointmentForm().id ||
      this.additionalServices().length >= 19 ||
      !this.additionalServiceOptions().some((row) => row.value === serviceId)
    )
      return;
    this.additionalServices.update((rows) => [
      ...rows,
      { serviceId, collaboratorId: "" },
    ]);
    this.updateAppointmentSlots();
  }
  removeService(index: number): void {
    this.additionalServices.update((rows) =>
      rows.filter((_row, i) => i !== index),
    );
    this.updateAppointmentSlots();
  }
  setServiceCollaborator(index: number, collaboratorId: string): void {
    this.additionalServices.update((rows) =>
      rows.map((row, i) => (i === index ? { ...row, collaboratorId } : row)),
    );
    this.updateAppointmentSlots();
  }
  private async loadCreationSlots(): Promise<void> {
    const request = ++this.availabilityRequest;
    const form = this.appointmentForm();
    const date = this.appointmentSelectedDate();
    this.appointmentSlots.set([]);
    if (!form.serviceId || !date) {
      this.availabilityLoading.set(false);
      return;
    }
    this.availabilityLoading.set(true);
    try {
      const response = await firstValueFrom(
        this.adminApi.bookingAvailability({
          date,
          lines: [
            {
              serviceId: form.serviceId,
              collaboratorId: form.collaboratorId || undefined,
            },
            ...this.additionalServices().map((row) => ({
              serviceId: row.serviceId,
              collaboratorId: row.collaboratorId || undefined,
            })),
          ],
        }),
      );
      if (request !== this.availabilityRequest) return;
      this.feedback.set("");
      const slots = (response.slots || []).map((slot: any) => ({
        ...slot,
        startsAt: this.toLocalDateTimeValue(new Date(slot.startsAt)),
      }));
      this.appointmentSlots.set(slots);
      if (
        !slots.some(
          (slot: any) => slot.startsAt === this.appointmentForm().startsAt,
        )
      )
        this.appointmentForm.update((current) => ({
          ...current,
          startsAt: "",
        }));
    } catch (error: any) {
      if (request !== this.availabilityRequest) return;
      this.feedback.set(
        typeof error?.error?.message === "string"
          ? error.error.message
          : "Disponibilità non consultabile. Riprova.",
      );
      this.appointmentForm.update((current) => ({ ...current, startsAt: "" }));
    } finally {
      if (request === this.availabilityRequest)
        this.availabilityLoading.set(false);
    }
  }

  async saveAppointment(): Promise<any> {
    this.loading.set(true);
    this.feedback.set("");
    try {
      if (this.availabilityLoading())
        throw new Error("Attendi la verifica degli orari prima di salvare");
      if (
        !this.appointmentForm().id &&
        (this.availabilityLoading() ||
          !this.appointmentSlots().some(
            (row) => row.startsAt === this.appointmentForm().startsAt,
          ))
      )
        throw new Error("Scegli un orario disponibile per tutti i servizi");
      const saved = await this.appointmentsService.saveAppointment(
        this.appointmentForm(),
        this.additionalServices().map((row) => ({
          serviceId: row.serviceId,
          collaboratorId: row.collaboratorId || undefined,
        })),
      );
      this.prepareNewAppointment();
      return saved;
    } catch (error: any) {
      this.feedback.set(
        error?.error?.message || error?.message || "Salvataggio non riuscito",
      );
      throw error;
    } finally {
      this.loading.set(false);
    }
  }
  async retryAppointmentCreation(): Promise<any> {
    this.loading.set(true);
    this.feedback.set("");
    try {
      const saved = await firstValueFrom(
        this.adminApi.retryAppointmentCreation(),
      );
      this.prepareNewAppointment();
      return saved;
    } catch (error: any) {
      this.feedback.set(
        error?.error?.message || error?.message || "Esito non disponibile",
      );
      throw error;
    } finally {
      this.loading.set(false);
    }
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
      if (!startsAt || !Number.isInteger(revision))
        throw new Error(
          "Riapri una prenotazione riconciliata e scegli un orario valido",
        );
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
        error?.error?.message || error?.message || "Spostamento non riuscito",
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
        error?.error?.message || error?.message || "Esito non disponibile",
      );
    } finally {
      this.loading.set(false);
    }
  }

  async confirmQuickReschedule(): Promise<string> {
    const state = this.quickRescheduleState();
    if (
      !state ||
      this.quickRescheduleLoading() ||
      !this.quickRescheduleSlots().some(
        (slot) => slot.startsAt === state.startsAt,
      )
    ) {
      throw new Error("Scegli un orario verificato dal server");
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
    return appointmentStatusLabel(status);
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
      if (response.orderRevision !== state.revision)
        throw new Error(
          "Il conto è cambiato. Riapri la prenotazione prima di spostarla",
        );
      const slots = (response.slots || []).map((slot: any) => ({
        startsAt: slot.startsAt,
        label: `${slot.label} – ${new Date(slot.endsAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`,
      }));
      this.quickRescheduleSlots.set(slots);
      if (
        !slots.some(
          (slot: any) =>
            slot.startsAt === this.quickRescheduleState()?.startsAt,
        )
      )
        this.quickRescheduleState.update((current) =>
          current ? { ...current, startsAt: "" } : null,
        );
      this.feedback.set("");
    } catch (error: any) {
      if (request === this.quickAvailabilityRequest) {
        this.feedback.set(
          error?.error?.message ||
            error?.message ||
            "Disponibilità non consultabile",
        );
        this.quickRescheduleState.update((current) =>
          current ? { ...current, startsAt: "" } : null,
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

  private emptyAppointmentForm() {
    return {
      id: "",
      orderRevision: Number.NaN,
      heldServiceId: "",
      heldRoomId: "",
      heldStartsAt: "",
      heldLocal: "",
      customerId: "",
      customerName: "",
      email: "",
      phone: "",
      serviceId: "",
      collaboratorId: "",
      startsAt: "",
      status: "confirmed",
      customerNotes: "",
      appointmentWhatsAppConsent: false,
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
