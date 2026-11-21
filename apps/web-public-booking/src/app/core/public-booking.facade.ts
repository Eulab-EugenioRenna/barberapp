import { HttpErrorResponse } from "@angular/common/http";
import {
  beginPendingCommand,
  clearPendingCommand,
  readPendingCommand,
  type PendingCommand,
  type PendingCommandState,
} from "@barber/shared/utils";
import { Injectable, computed, inject, signal } from "@angular/core";
import { Title } from "@angular/platform-browser";
import { toLocalDateKey } from "@barber/shared/utils";
import {
  Subject,
  catchError,
  firstValueFrom,
  of,
  switchMap,
  from as rxFrom,
  mergeMap,
  toArray,
  map,
} from "rxjs";
import { PublicBookingApiService } from "./public-booking-api.service";

@Injectable({ providedIn: "root" })
export class PublicBookingFacade {
  private readonly api = inject(PublicBookingApiService);
  private readonly titleService = inject(Title);
  private readonly availabilityRefresh = new Subject<void>();
  private readonly rangeRefresh = new Subject<void>();

  readonly tenantSlug = signal("default");
  readonly loading = signal(false);
  readonly feedback = signal("");
  readonly settings = signal<any>(null);
  readonly services = signal<any[]>([]);
  readonly selectedLocationId = signal("");
  readonly selectedSectorId = signal("");
  readonly visibleServices = computed(() =>
    this.services().filter(
      (service) =>
        (!this.selectedLocationId() ||
          service.sector?.locationId === this.selectedLocationId()) &&
        (!this.selectedSectorId() ||
          service.sectorId === this.selectedSectorId()),
    ),
  );
  readonly selectedLocation = computed(() =>
    (this.settings()?.locations || []).find(
      (location: any) => location.id === this.selectedLocationId(),
    ),
  );
  readonly selectedService = signal<any>(null);
  readonly selectedCollaboratorId = signal("");
  readonly additionalServices = signal<
    Array<{ service: any; collaboratorId: string }>
  >([]);
  readonly availabilityLoading = signal(false);
  readonly bookingLines = computed(() =>
    this.selectedService()
      ? [
          {
            serviceId: this.selectedService().id,
            collaboratorId: this.selectedCollaboratorId() || undefined,
          },
          ...this.additionalServices().map((row) => ({
            serviceId: row.service.id,
            collaboratorId: row.collaboratorId || undefined,
          })),
        ]
      : [],
  );
  readonly additionalServiceOptions = computed(() =>
    this.services()
      .filter(
        (service) => service.sector?.locationId === this.selectedLocationId(),
      )
      .map((service) => ({
        value: service.id,
        label: `${service.name} · ${service.durationMinutes} min`,
      })),
  );
  readonly selectedSlot = signal("");
  readonly slots = signal<any[]>([]);
  readonly bookingResult = signal<any>(null);
  readonly availabilityByDate = signal<Record<string, boolean>>({});
  readonly selectedDate = signal(toLocalDateKey(new Date()));
  readonly bookingForm = signal({
    customerName: "",
    email: "",
    phone: "",
    customerNotes: "",
    appointmentWhatsAppConsent: false,
  });

  private readonly pendingVersion = signal(0);
  private lastSlotDate = "";
  private pendingKey() {
    return `alora.public.booking:${this.publicBasePath()}:${this.settings()?.id || this.tenantSlug()}`;
  }
  readonly pendingState = computed<PendingCommandState>(() => {
    this.pendingVersion();
    try {
      return readPendingCommand(sessionStorage, this.pendingKey());
    } catch {
      return { kind: "unreadable" };
    }
  });
  readonly displayedWhatsAppConsent = computed(() => {
    const state = this.pendingState();
    return state.kind === "pending"
      ? state.command.body["appointmentWhatsAppConsent"] === true
      : this.bookingForm().appointmentWhatsAppConsent;
  });
  constructor() {
    this.availabilityRefresh
      .pipe(
        switchMap(() => {
          if (!this.bookingLines().length) {
            return of({ slots: [] });
          }

          return this.api
            .sequenceAvailability(this.publicBasePath(), {
              lines: this.bookingLines(),
              date: this.selectedDate(),
            })
            .pipe(
              catchError((error: any) => {
                this.feedback.set(
                  error?.error?.message ||
                    error?.message ||
                    "Non riusciamo a caricare gli orari. Riprova tra poco.",
                );
                return of({ slots: [] });
              }),
            );
        }),
      )
      .subscribe((response: any) => {
        this.availabilityLoading.set(false);
        const slots: any[] = response?.slots || [];
        const unique = [
          ...new Map(slots.map((slot) => [slot.startsAt, slot])).values(),
        ];
        const selected = this.selectedSlot(),
          date = this.selectedDate();
        this.slots.set(unique);
        this.selectedSlot.set(
          unique.some((slot) => slot.startsAt === selected)
            ? selected
            : this.lastSlotDate === date && selected
              ? ""
              : unique[0]?.startsAt || "",
        );
        this.lastSlotDate = date;
      });

    this.rangeRefresh
      .pipe(
        switchMap(() => {
          if (!this.bookingLines().length) {
            return of({ days: [] });
          }

          const { from, to } = this.resolveAvailabilityRange();
          const chunks: Array<{ from: string; to: string }> = [];
          const end = Date.parse(to + "T00:00:00Z");
          for (
            let cursor = Date.parse(from + "T00:00:00Z");
            cursor <= end;
            cursor += 7 * 86400000
          )
            chunks.push({
              from: new Date(cursor).toISOString().slice(0, 10),
              to: new Date(Math.min(end, cursor + 6 * 86400000))
                .toISOString()
                .slice(0, 10),
            });
          const lines = this.bookingLines(),
            basePath = this.publicBasePath();
          return rxFrom(chunks).pipe(
            mergeMap(
              (chunk) =>
                this.api.sequenceAvailability(basePath, { lines, ...chunk }),
              2,
            ),
            toArray(),
            map((responses) => ({
              days: responses.flatMap((response) => response.days || []),
            })),
            catchError(() => of({ days: [] })),
          );
        }),
      )
      .subscribe((response: any) => {
        const days = Array.isArray(response?.days) ? response.days : [];
        const map: Record<string, boolean> = {};
        for (const day of days) {
          if (day?.date) {
            map[day.date] = Boolean(day.hasSlots);
          }
        }
        this.availabilityByDate.set(map);
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
    () => this.settings()?.primaryColor || "#1e3425",
  );
  readonly accentColor = computed(
    () => this.settings()?.accentColor || "#88bd39",
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
        title: title?.trim() || "Passaggio",
        caption: caption?.trim() || "",
      };
    });
  });
  readonly publicHeroBackground = computed(() => {
    const settings = this.settings();
    const coverUrl = settings?.coverUrl
      ? `linear-gradient(180deg, rgba(30, 52, 37, 0.72), rgba(23, 41, 29, 0.9)), url(${this.absoluteAssetUrl(settings.coverUrl)}) center/cover`
      : "";

    return [
      `radial-gradient(circle at top right, rgba(${this.accentColorRgb()}, 0.18), transparent 18rem)`,
      coverUrl,
      `linear-gradient(180deg, ${this.brandColor()} 0%, #17291d 100%)`,
    ]
      .filter(Boolean)
      .join(", ");
  });
  readonly collaboratorSelectOptions = computed(() => {
    return this.professionalOptions(this.selectedService());
  });
  professionalOptions(service: any): Array<{ value: string; label: string }> {
    const options = [...(service?.collaborators || [])]
      .sort((left: any, right: any) => {
        return `${left.firstName} ${left.lastName}`.localeCompare(
          `${right.firstName} ${right.lastName}`,
          "it",
        );
      })
      .map((collaborator: any) => ({
        value: collaborator.id,
        label: `${collaborator.firstName} ${collaborator.lastName}`,
      }));
    return [{ value: "", label: "Nessuna preferenza" }, ...options];
  }
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
      const known = this.availabilityByDate()[key];
      return {
        key,
        label: current.toLocaleDateString("it-IT", {
          weekday: "short",
          day: "2-digit",
        }),
        isToday: key === toLocalDateKey(new Date()),
        isPast: key < toLocalDateKey(new Date()),
        isSelected: key === this.selectedDate(),
        isUnavailable: known === false,
        statusLabel:
          known === false ? "Completo" : known === true ? "Disponibile" : "—",
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
      const known = this.availabilityByDate()[key];
      return {
        key,
        dayNumber: current.getDate(),
        inMonth: current.getMonth() === selected.getMonth(),
        isToday: key === toLocalDateKey(new Date()),
        isPast: key < toLocalDateKey(new Date()),
        isSelected: key === this.selectedDate(),
        isUnavailable: known === false,
        statusLabel:
          known === false ? "Completo" : known === true ? "Disponibile" : "—",
      };
    });
  });

  readonly steps = [
    { title: "Scegli", caption: "Trova il servizio che desideri" },
    { title: "Prenota", caption: "Scegli professionista, giorno e orario" },
    { title: "Conferma", caption: "Invia la richiesta al salone" },
  ];

  setTenantSlug(slug: string): void {
    this.tenantSlug.set(slug || "default");
  }

  setSelectedDate(value: string): void {
    this.selectedSlot.set("");
    this.slots.set([]);
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
      appointmentWhatsAppConsent: boolean;
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
        settings?.publicTitle ?? settings?.name ?? "Prenota online · ALORA",
      );
      this.services.set(services as any[]);

      this.selectedLocationId.set(settings?.locations?.[0]?.id || "");
      const selectedService = this.visibleServices()[0] || null;
      this.selectedService.set(selectedService);
      this.additionalServices.set([]);

      this.selectedCollaboratorId.set("");
      this.requestAvailability();
    } catch (error: any) {
      this.feedback.set(
        error?.error?.message ||
          error?.message ||
          "Al momento non riusciamo ad aprire le prenotazioni. Riprova tra poco.",
      );
    } finally {
      this.loading.set(false);
    }
  }

  requestAvailability(): void {
    this.availabilityLoading.set(true);
    this.slots.set([]);
    this.availabilityByDate.set({});
    this.availabilityRefresh.next();
    this.rangeRefresh.next();
  }

  private resolveAvailabilityRange(): { from: string; to: string } {
    const selected = new Date(`${this.selectedDate()}T00:00:00`);
    const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1);
    const gridStart = new Date(monthStart);
    const gridWeekday = gridStart.getDay();
    const gridDiff = gridWeekday === 0 ? -6 : 1 - gridWeekday;
    gridStart.setDate(gridStart.getDate() + gridDiff);

    const weekStart = new Date(selected);
    const weekWeekday = weekStart.getDay();
    const weekDiff = weekWeekday === 0 ? -6 : 1 - weekWeekday;
    weekStart.setDate(weekStart.getDate() + weekDiff);

    const start = gridStart < weekStart ? gridStart : weekStart;
    const end = new Date(gridStart);
    end.setDate(end.getDate() + 41);
    const today = toLocalDateKey(new Date());
    const from = toLocalDateKey(start) < today ? today : toLocalDateKey(start);

    return { from, to: toLocalDateKey(end) };
  }

  selectLocation(id: string): void {
    this.selectedLocationId.set(id);
    this.selectedSectorId.set("");
    this.selectService(this.visibleServices()[0] || null);
  }
  selectSector(id: string): void {
    this.selectedSectorId.set(id);
    this.selectService(this.visibleServices()[0] || null);
  }

  selectService(service: any): void {
    this.selectedService.set(service);
    this.additionalServices.set([]);
    this.slots.set([]);
    this.selectedSlot.set("");
    this.bookingResult.set(null);
    this.availabilityByDate.set({});
    this.selectedCollaboratorId.set("");
    this.selectedSlot.set("");
    this.slots.set([]);
    this.requestAvailability();
  }

  addService(id: string): void {
    const service = this.services().find(
      (row) =>
        row.id === id && row.sector?.locationId === this.selectedLocationId(),
    );
    if (!service || !this.selectedService() || this.bookingLines().length >= 20)
      return;
    this.additionalServices.update((rows) => [
      ...rows,
      { service, collaboratorId: "" },
    ]);
    this.bookingResult.set(null);
    this.requestAvailability();
  }
  removeService(index: number): void {
    this.additionalServices.update((rows) =>
      rows.filter((_row, i) => i !== index),
    );
    this.requestAvailability();
  }
  moveService(index: number, direction: -1 | 1): void {
    this.additionalServices.update((rows) => {
      const target = index + direction;
      if (target < 0 || target >= rows.length) return rows;
      const copy = [...rows];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
    this.requestAvailability();
  }
  setServiceCollaborator(index: number, collaboratorId: string): void {
    this.additionalServices.update((rows) =>
      rows.map((row, i) => (i === index ? { ...row, collaboratorId } : row)),
    );
    this.requestAvailability();
  }

  async submitBooking(): Promise<void> {
    if (this.loading()) return;
    const state = this.pendingState();
    if (state.kind === "unreadable") {
      this.feedback.set(
        "Dati dell'invio precedente non leggibili: verifica la prenotazione prima di riprendere.",
      );
      return;
    }
    if (
      state.kind === "empty" &&
      (this.availabilityLoading() ||
        !this.bookingLines().length ||
        !this.selectedSlotRecord())
    )
      return;
    this.loading.set(true);
    this.feedback.set("");
    const key = this.pendingKey();
    let attempt: PendingCommand | null =
      state.kind === "pending" ? state.command : null;
    try {
      if (!attempt) {
        attempt = beginPendingCommand(sessionStorage, key, {
          lines: this.bookingLines(),
          startsAt: this.selectedSlot(),
          ...this.bookingForm(),
        });
        this.pendingVersion.update((value) => value + 1);
      }
      const result = await firstValueFrom(
        this.api.createBooking(this.publicBasePath(), attempt.body),
      );
      clearPendingCommand(sessionStorage, key, attempt.body.idempotencyKey);
      this.pendingVersion.update((value) => value + 1);
      this.bookingResult.set(result);
      this.feedback.set(
        result?.status === "confirmed"
          ? "Appuntamento confermato. Ti aspettiamo in salone!"
          : "Richiesta inviata. Il salone ti comunicherà la conferma.",
      );
      this.bookingForm.set({
        customerName: "",
        email: "",
        phone: "",
        customerNotes: "",
        appointmentWhatsAppConsent: false,
      });
      this.requestAvailability();
    } catch (error: any) {
      if (
        attempt &&
        error instanceof HttpErrorResponse &&
        [400, 409].includes(error.status)
      ) {
        clearPendingCommand(sessionStorage, key, attempt.body.idempotencyKey);
        this.pendingVersion.update((value) => value + 1);
      }
      this.feedback.set(
        this.pendingState().kind === "pending"
          ? "Esito da verificare. Recupera la prenotazione precedente con lo stesso invio."
          : typeof error?.error?.message === "string"
            ? error.error.message
            : "Invio non riuscito. Controlla i dati e riprova.",
      );
    } finally {
      this.loading.set(false);
    }
  }

  startNewBooking(): void {
    if (this.pendingState().kind !== "empty") return;
    this.bookingResult.set(null);
    this.feedback.set("");
    this.selectedSlot.set("");
    this.requestAvailability();
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
      return "30, 52, 37";
    }

    const red = Number.parseInt(full.slice(0, 2), 16);
    const green = Number.parseInt(full.slice(2, 4), 16);
    const blue = Number.parseInt(full.slice(4, 6), 16);

    return `${red}, ${green}, ${blue}`;
  }
}
