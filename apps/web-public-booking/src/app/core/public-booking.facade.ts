import { Injectable, computed, inject, signal } from "@angular/core";
import { Title } from "@angular/platform-browser";
import { toLocalDateKey } from "@barber/shared/utils";
import { Subject, catchError, firstValueFrom, of, switchMap } from "rxjs";
import { PublicBookingApiService } from "./public-booking-api.service";

@Injectable({ providedIn: "root" })
export class PublicBookingFacade {
  private readonly api = inject(PublicBookingApiService);
  private readonly titleService = inject(Title);
  private readonly availabilityRefresh = new Subject<void>();

  readonly tenantSlug = signal("default");
  readonly loading = signal(false);
  readonly feedback = signal("");
  readonly settings = signal<any>(null);
  readonly services = signal<any[]>([]);
  readonly selectedService = signal<any>(null);
  readonly selectedCollaboratorId = signal("");
  readonly selectedSlot = signal("");
  readonly slots = signal<any[]>([]);
  readonly bookingResult = signal<any>(null);
  readonly selectedDate = signal(toLocalDateKey(new Date()));
  readonly bookingForm = signal({
    customerName: "",
    email: "",
    phone: "",
    customerNotes: "",
  });

  constructor() {
    this.availabilityRefresh
      .pipe(
        switchMap(() => {
          const selectedService = this.selectedService();
          const selectedCollaboratorId = this.selectedCollaboratorId();

          if (!selectedService || !selectedCollaboratorId) {
            return of({ slots: [] });
          }

          return this.api
            .availability(this.publicBasePath(), {
              serviceId: selectedService.id,
              date: this.selectedDate(),
              collaboratorId: selectedCollaboratorId,
            })
            .pipe(
              catchError((error: any) => {
                this.feedback.set(
                  error?.error?.message ||
                    error?.message ||
                    "Errore nel caricamento slot",
                );
                return of({ slots: [] });
              }),
            );
        }),
      )
      .subscribe((response: any) => {
        const slots = response?.slots || [];
        this.slots.set(slots);
        this.selectedSlot.set(slots[0]?.startsAt || "");
      });
  }

  readonly publicBasePath = computed(() =>
    this.api.resolveBasePath(this.tenantSlug()),
  );
  readonly selectedSlotRecord = computed(
    () =>
      this.slots().find((slot) => slot.startsAt === this.selectedSlot()) ||
      null,
  );
  readonly brandColor = computed(
    () => this.settings()?.primaryColor || "#1c7c64",
  );
  readonly accentColor = computed(
    () => this.settings()?.accentColor || "#f97316",
  );
  readonly brandColorRgb = computed(() => this.hexToRgb(this.brandColor()));
  readonly accentColorRgb = computed(() => this.hexToRgb(this.accentColor()));
  readonly publicSteps = computed(() => {
    const configured = Array.isArray(this.settings()?.publicSteps)
      ? this.settings().publicSteps
      : [];

    if (!configured.length) {
      return this.steps;
    }

    return configured.map((line: string) => {
      const [title, caption] = line.split("|");
      return {
        title: title?.trim() || "Step",
        caption: caption?.trim() || "",
      };
    });
  });
  readonly publicHeroBackground = computed(() => {
    const settings = this.settings();
    const coverUrl = settings?.coverUrl
      ? `linear-gradient(180deg, rgba(16, 25, 35, 0.72), rgba(13, 20, 28, 0.9)), url(${this.absoluteAssetUrl(settings.coverUrl)}) center/cover`
      : "";

    return [
      `radial-gradient(circle at top right, rgba(${this.accentColorRgb()}, 0.18), transparent 18rem)`,
      coverUrl,
      `linear-gradient(180deg, ${this.brandColor()} 0%, #0d141c 100%)`,
    ]
      .filter(Boolean)
      .join(", ");
  });
  readonly collaboratorSelectOptions = computed(() => {
    const defaultCollaboratorId = this.settings()?.defaultCollaboratorId;

    return [...(this.selectedService()?.collaborators || [])]
      .sort((left: any, right: any) => {
        if (left.id === defaultCollaboratorId) return -1;
        if (right.id === defaultCollaboratorId) return 1;
        return `${left.firstName} ${left.lastName}`.localeCompare(
          `${right.firstName} ${right.lastName}`,
          "it",
        );
      })
      .map((collaborator: any) => ({
        value: collaborator.id,
        label: `${collaborator.firstName} ${collaborator.lastName}${
          collaborator.id === defaultCollaboratorId ? " · default" : ""
        }`,
      }));
  });
  readonly slotSelectOptions = computed(() =>
    this.slots().map((slot) => ({
      value: slot.startsAt,
      label: slot.label,
    })),
  );
  readonly availabilityWeek = computed(() => {
    const base = new Date(`${this.selectedDate()}T00:00:00`);
    const start = new Date(base);
    const weekday = start.getDay();
    const diff = weekday === 0 ? -6 : 1 - weekday;
    start.setDate(start.getDate() + diff);

    return Array.from({ length: 7 }, (_, index) => {
      const current = new Date(start);
      current.setDate(current.getDate() + index);
      const key = toLocalDateKey(current);
      return {
        key,
        label: current.toLocaleDateString("it-IT", {
          weekday: "short",
          day: "2-digit",
        }),
        isToday: key === toLocalDateKey(new Date()),
        isPast: key < toLocalDateKey(new Date()),
        isSelected: key === this.selectedDate(),
        isUnavailable:
          key === this.selectedDate() &&
          Boolean(this.selectedCollaboratorId()) &&
          this.slots().length === 0,
        statusLabel:
          key === this.selectedDate() &&
          Boolean(this.selectedCollaboratorId()) &&
          this.slots().length === 0
            ? "Bloccato"
            : "Disponibile",
      };
    });
  });
  readonly availabilityMonth = computed(() => {
    const selected = new Date(`${this.selectedDate()}T00:00:00`);
    const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const gridStart = new Date(monthStart);
    const weekday = gridStart.getDay();
    const diff = weekday === 0 ? -6 : 1 - weekday;
    gridStart.setDate(gridStart.getDate() + diff);

    return Array.from({ length: 42 }, (_, index) => {
      const current = new Date(gridStart);
      current.setDate(current.getDate() + index);
      const key = toLocalDateKey(current);
      return {
        key,
        dayNumber: current.getDate(),
        inMonth: current.getMonth() === selected.getMonth(),
        isToday: key === toLocalDateKey(new Date()),
        isPast: key < toLocalDateKey(new Date()),
        isSelected: key === this.selectedDate(),
        isUnavailable:
          key === this.selectedDate() &&
          Boolean(this.selectedCollaboratorId()) &&
          this.slots().length === 0,
        statusLabel:
          key === this.selectedDate() &&
          Boolean(this.selectedCollaboratorId()) &&
          this.slots().length === 0
            ? "Bloccato"
            : "Disponibile",
      };
    });
  });

  readonly steps = [
    { title: "Servizio", caption: "Catalogo reale dal tenant" },
    { title: "Slot", caption: "Disponibilita per data e collaboratore" },
    { title: "Conferma", caption: "Prenotazione persistita su DB" },
  ];

  setTenantSlug(slug: string): void {
    this.tenantSlug.set(slug || "default");
  }

  setSelectedDate(value: string): void {
    this.selectedDate.set(value);
    this.requestAvailability();
  }

  setSelectedCollaboratorId(value: string): void {
    this.selectedCollaboratorId.set(value);
    this.requestAvailability();
  }

  setSelectedSlot(value: string): void {
    this.selectedSlot.set(value);
  }

  updateBookingForm(
    patch: Partial<{
      customerName: string;
      email: string;
      phone: string;
      customerNotes: string;
    }>,
  ): void {
    this.bookingForm.update((current) => ({ ...current, ...patch }));
  }

  absoluteAssetUrl(path: string): string {
    return this.api.absoluteAssetUrl(path);
  }

  async loadInitialData(): Promise<void> {
    this.loading.set(true);

    try {
      const { settings, services } = (await firstValueFrom(
        this.api.loadInitialData(this.publicBasePath()),
      )) as any;

      this.settings.set(settings);
      this.titleService.setTitle(
        settings?.publicTitle ?? settings?.name ?? "Prenota online",
      );
      this.services.set(services as any[]);

      const selectedService = (services as any[])[0] || null;
      this.selectedService.set(selectedService);

      const defaultCollaboratorId = settings?.defaultCollaboratorId;
      const availableCollaborators = selectedService?.collaborators || [];
      this.selectedCollaboratorId.set(
        availableCollaborators.some(
          (collaborator: any) => collaborator.id === defaultCollaboratorId,
        )
          ? defaultCollaboratorId
          : availableCollaborators[0]?.id || "",
      );

      this.requestAvailability();
    } catch (error: any) {
      this.feedback.set(
        error?.error?.message ||
          error?.message ||
          "Impossibile caricare il booking pubblico",
      );
    } finally {
      this.loading.set(false);
    }
  }

  requestAvailability(): void {
    this.availabilityRefresh.next();
  }

  selectService(service: any): void {
    this.selectedService.set(service);
    const defaultCollaboratorId = this.settings()?.defaultCollaboratorId;
    this.selectedCollaboratorId.set(
      (service.collaborators || []).some(
        (collaborator: any) => collaborator.id === defaultCollaboratorId,
      )
        ? defaultCollaboratorId
        : service.collaborators?.[0]?.id || "",
    );
    this.selectedSlot.set("");
    this.slots.set([]);
    this.requestAvailability();
  }

  async submitBooking(): Promise<void> {
    if (!this.selectedService() || !this.selectedSlot()) {
      return;
    }

    this.loading.set(true);
    this.feedback.set("");

    try {
      const result = await firstValueFrom(
        this.api.createBooking(this.publicBasePath(), {
          serviceId: this.selectedService().id,
          collaboratorId:
            this.selectedCollaboratorId() ||
            this.selectedSlotRecord()?.collaboratorId ||
            undefined,
          startsAt: this.selectedSlot(),
          ...this.bookingForm(),
        }),
      );

      this.bookingResult.set(result);
      this.feedback.set("Prenotazione inviata correttamente");
      this.bookingForm.set({
        customerName: "",
        email: "",
        phone: "",
        customerNotes: "",
      });
      this.requestAvailability();
    } catch (error: any) {
      this.feedback.set(
        error?.error?.message ||
          error?.message ||
          "Invio prenotazione non riuscito",
      );
    } finally {
      this.loading.set(false);
    }
  }

  private hexToRgb(value: string): string {
    const normalized = value.replace("#", "").trim();
    const full =
      normalized.length === 3
        ? normalized
            .split("")
            .map((char) => `${char}${char}`)
            .join("")
        : normalized;

    if (!/^[0-9a-fA-F]{6}$/.test(full)) {
      return "28, 124, 100";
    }

    const red = Number.parseInt(full.slice(0, 2), 16);
    const green = Number.parseInt(full.slice(2, 4), 16);
    const blue = Number.parseInt(full.slice(4, 6), 16);

    return `${red}, ${green}, ${blue}`;
  }
}
