import { CommonModule, DecimalPipe, NgClass } from "@angular/common";
import { Component, OnInit, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { CalendarInputComponent } from "./calendar-input.component";
import { PublicBookingFacade } from "./core/public-booking.facade";
import { CustomSelectComponent } from "./custom-select.component";

@Component({
  selector: "barber-public-root",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgClass,
    DecimalPipe,
    CalendarInputComponent,
    CustomSelectComponent,
  ],
  template: `
    <main
      class="public-shell"
      [style.--brand]="brandColor"
      [style.--accent]="accentColor"
      [style.--brand-rgb]="brandColorRgb"
      [style.--accent-rgb]="accentColorRgb"
    >
      <section class="public-frame">
        <aside
          class="booking-hero public-hero text-white"
          [style.background]="publicHeroBackground"
        >
          <p class="eyebrow text-white/55">Booking experience</p>
          <div class="mt-5 flex flex-wrap items-center gap-4 md:gap-6">
            <img
              *ngIf="settings()?.logoUrl"
              [src]="absoluteAssetUrl(settings()?.logoUrl)"
              alt="Logo tenant"
              class="h-auto w-auto max-h-28 max-w-[24rem] object-contain md:max-h-36 md:max-w-[30rem]"
            />
            <h1 class="font-display text-5xl leading-none md:text-7xl">
              {{
                settings()?.publicTitle ?? settings()?.name ?? "Prenota online"
              }}
            </h1>
          </div>
          <p class="mt-5 max-w-xl text-base text-white/74 md:text-lg">
            {{
              settings()?.publicDescription ||
                "Flusso pubblico reale con servizi dal DB, disponibilita dinamica, scelta collaboratore e creazione prenotazione persistita."
            }}
          </p>

          <div class="mt-8 grid gap-3">
            <article
              *ngFor="let step of publicSteps; index as index"
              class="hero-step rounded-[1.4rem] p-4"
            >
              <div class="flex items-center gap-3">
                <span
                  class="grid size-10 place-items-center rounded-full bg-white text-[#101923] font-bold"
                  >{{ index + 1 }}</span
                >
                <div>
                  <strong class="block">{{ step.title }}</strong>
                  <span class="text-sm text-white/64">{{ step.caption }}</span>
                </div>
              </div>
            </article>
          </div>
        </aside>

        <section class="panel public-panel">
          <div class="public-panel-scroll">
            <p
              *ngIf="loading() && !settings()"
              role="status"
              aria-live="polite"
              class="rounded-2xl bg-white/70 p-4 text-sm text-[var(--muted)]"
            >
              Caricamento disponibilità...
            </p>
            <div
              class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between"
            >
              <div>
                <p class="eyebrow text-[var(--accent)]">Prenotazione</p>
                <h2 class="font-display text-4xl">Scegli servizio e slot</h2>
              </div>
              <label class="field public-date-field">
                <span>Data <em class="required-mark" aria-hidden="true">*</em></span>
                <barber-calendar-input
                  [value]="selectedDateValue"
                  (valueChange)="onSelectedDateChange($event)"
                  label="Data"
                  name="selectedDate"
                  placeholder="Scegli il giorno"
                ></barber-calendar-input>
              </label>
            </div>

            <div class="mt-4 grid gap-2 md:grid-cols-7">
              <button
                *ngFor="let day of facade.availabilityWeek()"
                type="button"
                class="rounded-[1rem] border px-3 py-3 text-left text-sm"
                [ngClass]="{
                  'border-[var(--accent)] bg-[rgba(var(--accent-rgb),0.12)]':
                    day.isSelected,
                  'ring-1 ring-[rgba(var(--accent-rgb),0.28)]':
                    day.isToday && !day.isSelected,
                  'border-amber-200 bg-amber-50 text-amber-900':
                    day.isUnavailable,
                  'border-[var(--line)]/70 bg-white/80':
                    !day.isSelected && !day.isUnavailable,
                }"
                (click)="onSelectedDateChange(day.key)"
              >
                <strong class="block">{{ day.label }}</strong>
                <span class="mt-1 block text-xs opacity-70">
                  {{ day.statusLabel }}
                </span>
              </button>
            </div>

            <div class="mt-3 grid gap-2 md:grid-cols-7">
              <button
                *ngFor="let day of facade.availabilityMonth()"
                type="button"
                class="min-h-[4.25rem] rounded-[1rem] border px-3 py-2 text-left text-sm"
                [ngClass]="{
                  'border-[var(--accent)] bg-[rgba(var(--accent-rgb),0.12)]':
                    day.isSelected,
                  'ring-1 ring-[rgba(var(--accent-rgb),0.28)]':
                    day.isToday && !day.isSelected,
                  'border-amber-200 bg-amber-50 text-amber-900':
                    day.isUnavailable,
                  'border-[var(--line)]/60 bg-slate-50/70 text-slate-400':
                    !day.inMonth,
                  'border-[var(--line)]/70 bg-white/80':
                    day.inMonth && !day.isSelected && !day.isUnavailable,
                }"
                (click)="onSelectedDateChange(day.key)"
              >
                <strong class="block">{{ day.dayNumber }}</strong>
                <span class="mt-1 block text-[11px] opacity-70">
                  {{ day.statusLabel }}
                </span>
              </button>
            </div>

            <div class="mt-6 grid gap-3">
              <button
                *ngFor="let service of services()"
                type="button"
                class="service-card text-left"
                [ngClass]="{ active: selectedService()?.id === service.id }"
                [style.border-color]="service.color || 'var(--brand)'"
                [style.box-shadow]="
                  selectedService()?.id === service.id
                    ? '0 0 0 1px ' + (service.color || 'var(--brand)')
                    : null
                "
                (click)="selectService(service)"
              >
                <div>
                  <div class="flex items-center gap-3">
                    <span
                      class="inline-flex size-3 rounded-full"
                      [style.background]="service.color || 'var(--brand)'"
                    ></span>
                    <h3 class="font-display text-2xl">{{ service.name }}</h3>
                  </div>
                  <p class="mt-1 text-sm text-[var(--muted)]">
                    {{
                      service.publicDescription ||
                        "Prenotazione online disponibile"
                    }}
                  </p>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <span class="status-pill status-pill-neutral"
                      >{{ service.collaborators?.length || 0 }} barber</span
                    >
                    <span
                      *ngFor="
                        let linkedProduct of service.serviceProducts || []
                      "
                      class="status-pill status-pill-blue"
                    >
                      {{ linkedProduct.product?.name }}
                    </span>
                  </div>
                </div>
                <div class="text-right">
                  <strong class="text-lg"
                    >€{{ service.basePrice | number: "1.0-2" }}</strong
                  >
                  <p class="text-sm text-[var(--muted)]">
                    {{ service.durationMinutes }} min
                  </p>
                </div>
              </button>
              <article
                *ngIf="!loading() && !services().length"
                class="rounded-[1.4rem] border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]"
              >
                Nessun servizio prenotabile online in questo momento.
              </article>
            </div>

            <div
              *ngIf="selectedService()"
              class="mt-6 grid gap-4 md:grid-cols-2"
            >
              <label class="field">
                <span>Collaboratore <em class="required-mark" aria-hidden="true">*</em></span>
                <barber-custom-select
                  [value]="selectedCollaboratorId()"
                  (valueChange)="onSelectedCollaboratorChange($event)"
                  [options]="collaboratorSelectOptions"
                  label="Collaboratore"
                  placeholder="Seleziona collaboratore"
                ></barber-custom-select>
              </label>
              <label class="field">
                <span>Slot disponibili <em class="required-mark" aria-hidden="true">*</em></span>
                <barber-custom-select
                  [value]="selectedSlot()"
                  (valueChange)="onSelectedSlotChange($event)"
                  [disabled]="!selectedCollaboratorId() || !slots().length"
                  [options]="slotSelectOptions"
                  label="Orario"
                  [placeholder]="
                    !selectedCollaboratorId()
                      ? 'Prima seleziona il collaboratore'
                      : slots().length
                        ? 'Seleziona orario'
                        : 'Nessuno slot disponibile'
                  "
                ></barber-custom-select>
              </label>
            </div>

            <form class="mt-6 grid gap-4" (ngSubmit)="submitBooking()">
              <div class="grid gap-4 md:grid-cols-2">
                <label class="field">
                  <span>Nome e cognome <em class="required-mark" aria-hidden="true">*</em></span>
                  <input
                    [ngModel]="bookingForm().customerName"
                    (ngModelChange)="
                      onBookingFieldChange('customerName', $event)
                    "
                    name="customerName"
                    placeholder="Mario Rossi"
                    autocomplete="name"
                    required
                  />
                </label>
                <label class="field">
                  <span>Email</span>
                  <input
                    [ngModel]="bookingForm().email"
                    (ngModelChange)="onBookingFieldChange('email', $event)"
                    name="email"
                    type="email"
                    placeholder="mario@email.it"
                    autocomplete="email"
                  />
                </label>
              </div>
              <div class="grid gap-4 md:grid-cols-2">
                <label class="field">
                  <span>Telefono</span>
                  <input
                    [ngModel]="bookingForm().phone"
                    (ngModelChange)="onBookingFieldChange('phone', $event)"
                    name="phone"
                    type="tel"
                    placeholder="+39 333 123 4567"
                    autocomplete="tel"
                  />
                </label>
                <label class="field">
                  <span>Richieste</span>
                  <input
                    [ngModel]="bookingForm().customerNotes"
                    (ngModelChange)="
                      onBookingFieldChange('customerNotes', $event)
                    "
                    name="customerNotes"
                    placeholder="Preferenza orario o note utili"
                  />
                </label>
              </div>

              <p
                *ngIf="feedback()"
                role="status"
                aria-live="polite"
                class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                {{ feedback() }}
              </p>

              <button
                type="submit"
                class="primary-btn"
                [disabled]="
                  loading() ||
                  !selectedService() ||
                  !selectedSlot() ||
                  !bookingForm().customerName.trim()
                "
              >
                {{ loading() ? "Invio in corso..." : "Conferma prenotazione" }}
              </button>
            </form>

            <article
              *ngIf="bookingResult()"
              class="success-card mt-6 rounded-[1.8rem] p-5"
            >
              <p class="eyebrow text-emerald-700">Prenotazione registrata</p>
              <h3 class="mt-2 font-display text-3xl text-emerald-950">
                {{ bookingResult().customer.firstName }}
                {{ bookingResult().customer.lastName }}
              </h3>
              <p class="mt-2 text-sm text-emerald-900/76">
                {{ bookingResult().service.name }} ·
                {{ formatDateTime(bookingResult().startsAt) }} · Stato
                {{ bookingResult().status }}
              </p>
            </article>
          </div>
        </section>
      </section>
    </main>
  `,
})
export class PublicBookingAppComponent implements OnInit {
  protected readonly facade = inject(PublicBookingFacade);
  private readonly route = inject(ActivatedRoute);

  tenantSlug = this.facade.tenantSlug;
  loading = this.facade.loading;
  feedback = this.facade.feedback;
  settings = this.facade.settings;
  services = this.facade.services;
  selectedService = this.facade.selectedService;
  selectedCollaboratorId = this.facade.selectedCollaboratorId;
  selectedSlot = this.facade.selectedSlot;
  slots = this.facade.slots;
  bookingResult = this.facade.bookingResult;
  bookingForm = this.facade.bookingForm;

  get selectedDateValue(): string {
    return this.facade.selectedDate();
  }

  onSelectedDateChange(value: string): void {
    this.facade.setSelectedDate(value);
  }

  onSelectedCollaboratorChange(value: string): void {
    this.facade.setSelectedCollaboratorId(value);
  }

  onSelectedSlotChange(value: string): void {
    this.facade.setSelectedSlot(value);
  }

  onBookingFieldChange(
    key: "customerName" | "email" | "phone" | "customerNotes",
    value: string,
  ): void {
    this.facade.updateBookingForm({ [key]: value });
  }

  get brandColor(): string {
    return this.facade.brandColor();
  }

  get accentColor(): string {
    return this.facade.accentColor();
  }

  get brandColorRgb(): string {
    return this.facade.brandColorRgb();
  }

  get accentColorRgb(): string {
    return this.facade.accentColorRgb();
  }

  get publicBasePath(): string {
    return this.facade.publicBasePath();
  }

  get selectedSlotRecord(): any {
    return this.facade.selectedSlotRecord();
  }

  get publicSteps(): Array<{ title: string; caption: string }> {
    return this.facade.publicSteps();
  }

  absoluteAssetUrl(path: string): string {
    return this.facade.absoluteAssetUrl(path);
  }

  get publicHeroBackground(): string {
    return this.facade.publicHeroBackground();
  }

  get collaboratorSelectOptions(): Array<{ value: string; label: string }> {
    return this.facade.collaboratorSelectOptions();
  }

  get slotSelectOptions(): Array<{ value: string; label: string }> {
    return this.facade.slotSelectOptions();
  }

  async ngOnInit(): Promise<void> {
    this.facade.setTenantSlug(
      this.route.snapshot.paramMap.get("tenantSlug") ||
        this.route.snapshot.queryParamMap.get("tenant") ||
        "default",
    );
    await this.facade.loadInitialData();
  }

  async loadInitialData(): Promise<void> {
    await this.facade.loadInitialData();
  }

  selectService(service: any): void {
    this.facade.selectService(service);
  }

  async submitBooking(): Promise<void> {
    await this.facade.submitBooking();
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
