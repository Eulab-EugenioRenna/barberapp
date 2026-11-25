import { slotOptions } from "../core/slot-options";
import { CommonModule } from "@angular/common";
import { HttpClient } from "@angular/common/http";
import { Component, EventEmitter, Input, OnInit, Output, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { firstValueFrom } from "rxjs";
import { UiSelectComponent, type UiOption } from "@alora/ui";
import { ADMIN_API_URL } from "../core/api-config";
import { AdminApiService } from "../core/admin-api.service";
import { CreateRecoveryService } from "../core/create-recovery.service";
import { CustomerDirectoryService } from "../core/customer-directory.service";
import { OperationalContextService } from "../core/operational-context.service";
import { sectorForActivity } from "../core/activity-placement";
import { CustomerSelectComponent } from "../shared/customer-select.component";

interface ContextService {
  id: string;
  name: string;
  activityId?: string | null;
  sectorId: string;
  durationMinutes: number;
  sector?: { id: string; locationId: string } | null;
}

/**
 * «Nuovo appuntamento» in «La mia agenda»: the professional books in their own
 * agenda. Each field appears once the one before is chosen: sede (only with
 * more than one), cliente, servizio, giorno, orario.
 */
@Component({
  selector: "alora-personal-booking",
  standalone: true,
  imports: [CommonModule, FormsModule, UiSelectComponent, CustomerSelectComponent],
  template: `
    <section class="panel rounded-[2rem] p-5 sm:p-6" data-tour="my-agenda-booking" aria-labelledby="personal-booking-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="personal-booking-title" class="font-display text-2xl">Nuovo appuntamento</h2>
        <button type="button" class="secondary-btn" [disabled]="saving" (click)="closed.emit()">Chiudi</button>
      </div>
      <p class="mt-2 text-sm opacity-75">L’appuntamento va nella tua agenda. Scegli cliente, servizio e giorno: ALORA ti mostra solo gli orari liberi.</p>
      <p *ngIf="loading" class="mt-4 text-sm" role="status">Preparo il modulo…</p>
      <p *ngIf="!loading && !services.length" class="mt-4 text-sm">
        Non hai servizi prenotabili: chiedi al titolare di associarti ai servizi che esegui in «Squadra».
      </p>
      <form *ngIf="!loading && services.length" class="mt-4 grid gap-4 md:grid-cols-2" (ngSubmit)="book()">
        <div *ngIf="locationOptions.length > 1" class="field md:col-span-2">
          <span>Sede</span>
          <ui-select name="location" label="Sede" [options]="locationOptions" [filterable]="false" [ngModel]="locationId" (ngModelChange)="setLocation($event)"></ui-select>
        </div>

        <ng-container *ngIf="locationId">
          <div class="field md:col-span-2">
            <span>Cliente <em class="required-mark" aria-hidden="true">*</em></span>
            <alora-customer-select *ngIf="!newCustomer" [value]="customerId" (valueChange)="customerId = $event"></alora-customer-select>
            <div *ngIf="newCustomer" class="grid gap-3 sm:grid-cols-2">
              <label class="field"><span>Nome e cognome</span><input name="customerName" [(ngModel)]="customerName" maxlength="240" autocomplete="off" /></label>
              <label class="field"><span>Telefono (facoltativo)</span><input name="customerPhone" type="tel" [(ngModel)]="customerPhone" maxlength="50" autocomplete="off" /></label>
            </div>
            <button type="button" class="ghost-btn justify-self-start" (click)="toggleNewCustomer()">
              {{ newCustomer ? "Scegli un cliente già registrato" : "Il cliente non è in elenco? Inseriscilo" }}
            </button>
          </div>

          <div class="field md:col-span-2">
            <span>Servizio <em class="required-mark" aria-hidden="true">*</em></span>
            <ui-select name="service" label="Servizio" [options]="serviceOptions" [ngModel]="serviceId" (ngModelChange)="setService($event)" placeholder="Scegli il servizio"></ui-select>
          </div>

          <label *ngIf="serviceId" class="field">
            <span>Giorno <em class="required-mark" aria-hidden="true">*</em></span>
            <input type="date" name="date" [min]="todayKey" [ngModel]="date" (ngModelChange)="setDate($event)" />
          </label>

          <div *ngIf="serviceId && date" class="field">
            <span>Orario <em class="required-mark" aria-hidden="true">*</em></span>
            <p *ngIf="slotsLoading" class="text-sm opacity-75" role="status">Cerco gli orari liberi…</p>
            <ui-select *ngIf="!slotsLoading && slotOptions.length" name="slot" label="Orario" [options]="slotOptions" [(ngModel)]="startsAt" placeholder="Scegli l’orario"></ui-select>
            <p *ngIf="!slotsLoading && !slotOptions.length" class="text-sm opacity-75">Nessun orario libero in questo giorno: prova un altro giorno.</p>
          </div>

          <label *ngIf="startsAt" class="field md:col-span-2">
            <span>Note per l’appuntamento (facoltative)</span>
            <textarea name="notes" rows="2" maxlength="4000" [(ngModel)]="notes"></textarea>
          </label>

          <div class="flex flex-wrap items-center gap-3 md:col-span-2">
            <button class="primary-btn" type="submit" [disabled]="!ready || saving">{{ saving ? "Prenotazione in corso…" : "Prenota" }}</button>
            <button *ngIf="retryable" type="button" class="secondary-btn" [disabled]="saving" (click)="retry()">Verifica la stessa prenotazione</button>
          </div>
        </ng-container>
      </form>
      <p *ngIf="feedback" class="mt-4 text-sm" role="status" aria-live="polite">{{ feedback }}</p>
    </section>
  `,
})
export class PersonalBookingComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly api = inject(AdminApiService);
  private readonly creations = inject(CreateRecoveryService);
  private readonly customers = inject(CustomerDirectoryService);
  private readonly context = inject(OperationalContextService);
  /** The professional profile of the person booking. */
  @Input({ required: true }) collaboratorId = "";
  @Output() readonly booked = new EventEmitter<void>();
  @Output() readonly closed = new EventEmitter<void>();

  loading = true;
  saving = false;
  slotsLoading = false;
  retryable = false;
  feedback = "";
  private allServices: ContextService[] = [];
  private mySectorIds = new Set<string>();
  services: ContextService[] = [];
  locationOptions: UiOption[] = [];
  serviceOptions: UiOption[] = [];
  slotOptions: UiOption[] = [];
  locationId = "";
  customerId = "";
  newCustomer = false;
  customerName = "";
  customerPhone = "";
  serviceId = "";
  date = "";
  startsAt = "";
  notes = "";
  private slotsRequest = 0;
  readonly todayKey = new Date().toLocaleDateString("sv-SE");

  get ready(): boolean {
    const customer = this.newCustomer ? !!this.customerName.trim() : !!this.customerId;
    return !!this.locationId && customer && !!this.serviceId && !!this.startsAt;
  }

  async ngOnInit() {
    try {
      const [agenda] = await Promise.all([
        firstValueFrom(this.http.get<{ services: ContextService[]; collaborators: Array<{ id: string; sectors: Array<{ sectorId: string }> }> }>(`${ADMIN_API_URL}/appointments/context`)),
        this.context.locations().length ? Promise.resolve() : this.context.load().catch(() => undefined),
        this.customers.load(),
      ]);
      const me = agenda.collaborators.find((row) => row.id === this.collaboratorId);
      this.mySectorIds = new Set(me?.sectors.map((row) => row.sectorId) ?? []);
      this.allServices = agenda.services;
      const sectors = this.context.sectors.filter((sector) => this.mySectorIds.has(sector.id));
      this.locationOptions = this.context
        .locations()
        .filter((location) => location.isActive && sectors.some((sector) => sector.locationId === location.id))
        .map((location) => ({ value: location.id, label: location.name }));
      if (this.locationOptions.length === 1) this.setLocation(String(this.locationOptions[0].value));
      // More than one location: the services appear once the location is chosen.
      else if (this.locationOptions.length > 1) this.services = this.allServices;
    } catch {
      this.feedback = "Non riesco a preparare la prenotazione. Aggiorna la pagina o chiedi al titolare di verificare i tuoi permessi.";
      this.services = [];
    } finally {
      this.loading = false;
    }
  }

  /** The sector where this professional performs the service at the chosen location. */
  private sectorAt(service: ContextService, locationId: string): string | undefined {
    const sectorId = service.activityId
      ? sectorForActivity(this.context.sectors, service.activityId, locationId)?.id
      : service.sector?.locationId === locationId
        ? service.sectorId
        : undefined;
    return sectorId && this.mySectorIds.has(sectorId) ? sectorId : undefined;
  }

  setLocation(locationId: string) {
    this.locationId = locationId;
    this.services = this.allServices.filter((service) => !!this.sectorAt(service, locationId));
    this.serviceOptions = this.services.map((service) => ({ value: service.id, label: `${service.name} · ${service.durationMinutes} min` }));
    if (!this.services.some((service) => service.id === this.serviceId)) this.setService("");
  }
  setService(serviceId: string) {
    this.serviceId = serviceId;
    this.loadSlots();
  }
  setDate(date: string) {
    this.date = date;
    this.loadSlots();
  }
  toggleNewCustomer() {
    this.newCustomer = !this.newCustomer;
    this.customerId = "";
    this.customerName = "";
    this.customerPhone = "";
  }

  private async loadSlots() {
    const request = ++this.slotsRequest;
    this.startsAt = "";
    this.slotOptions = [];
    if (!this.serviceId || !this.date) return;
    this.slotsLoading = true;
    try {
      const response = await firstValueFrom(
        this.api.bookingAvailability({
          date: this.date,
          locationId: this.locationId,
          lines: [{ serviceId: this.serviceId, collaboratorId: this.collaboratorId }],
        }),
      );
      if (request !== this.slotsRequest) return;
      this.slotOptions = slotOptions(response.slots || []);
    } catch (error: any) {
      if (request === this.slotsRequest) this.feedback = error?.error?.message || "Orari non disponibili: riprova.";
    } finally {
      if (request === this.slotsRequest) this.slotsLoading = false;
    }
  }

  async book() {
    if (!this.ready || this.saving) return;
    const customer = this.newCustomer
      ? { customerName: this.customerName.trim(), ...(this.customerPhone.trim() ? { phone: this.customerPhone.trim() } : {}) }
      : { customerId: this.customerId };
    await this.submit(() =>
      this.creations.create("appointment", {
        ...customer,
        locationId: this.locationId,
        startsAt: this.startsAt,
        status: "confirmed",
        appointmentWhatsAppConsent: false,
        ...(this.notes.trim() ? { customerNotes: this.notes.trim() } : {}),
        lines: [{ serviceId: this.serviceId, collaboratorId: this.collaboratorId }],
      }),
    );
  }
  async retry() {
    await this.submit(() => this.creations.retry("appointment"));
  }
  private async submit(send: () => Promise<unknown>) {
    this.saving = true;
    this.feedback = "";
    try {
      await send();
      this.retryable = false;
      if (this.newCustomer) void this.customers.load(true);
      this.booked.emit();
    } catch (error: any) {
      this.retryable = this.creations.state("appointment").kind === "pending";
      this.feedback =
        error?.error?.message ||
        (this.retryable
          ? "Esito da verificare: premi «Verifica la stessa prenotazione», non viene creato un doppione."
          : "Prenotazione non riuscita: riprova.");
      if (!this.retryable) this.loadSlots();
    } finally {
      this.saving = false;
    }
  }
}
