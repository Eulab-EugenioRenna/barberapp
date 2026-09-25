import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CustomSelectComponent } from "../custom-select.component";
import { billingIntervalLabel, subscriptionStatusLabel } from "../shared/presentation-copy";

@Component({
  selector: "barber-admin-platform-page",
  standalone: true,
  imports: [CommonModule, FormsModule, CustomSelectComponent],
  template: `
    <section class="grid gap-4">
      <div class="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <article class="panel rounded-[2rem] p-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="eyebrow text-[var(--accent)]">Rete attività</p>
              <h3 class="font-display text-3xl">Saloni e boutique</h3>
            </div>
            <span class="status-pill status-pill-neutral"
              >{{ platformTenants.length }} attività</span
            >
          </div>
          <div class="mt-5 grid gap-3">
            <button
              *ngFor="let platformTenant of platformTenants"
              type="button"
              class="list-card text-left"
              (click)="selectTenant.emit(platformTenant)"
            >
              <div>
                <strong>{{ platformTenant.name }}</strong>
                <p class="text-sm text-[var(--muted)]">
                  {{ platformTenant.slug }} ·
                  {{ platformTenant.users?.[0]?.email || "responsabile non associato" }}
                </p>
              </div>
              <span
                class="status-pill"
                [ngClass]="platformTenantStatusClass(platformTenant)"
              >
                {{ formatPlatformTenantStatus(platformTenant) }}
              </span>
            </button>
          </div>
        </article>

        <article class="dark-panel rounded-[2rem] p-5 text-white">
          <p class="eyebrow text-white/45">Attività selezionata</p>
          <h3 class="font-display text-3xl">
            {{
              selectedPlatformTenant
                ? selectedPlatformTenant.name
                : "Seleziona un'attività"
            }}
          </h3>
          <p class="mt-2 text-sm text-white/65">
            {{
              selectedPlatformTenant
                ? selectedPlatformTenant.slug +
                  " · " +
                  (selectedPlatformTenant.users?.[0]?.email || "responsabile non associato")
                : "Seleziona un'attività dalla lista per gestirne dati, accesso e piano."
            }}
          </p>
          <form
            *ngIf="selectedPlatformTenant"
            class="mt-5 grid gap-4"
            (ngSubmit)="saveTenant.emit()"
          >
            <label class="field"
              ><span>Nome</span
              ><input
                [(ngModel)]="platformTenantForm.name"
                name="platformTenantName"
            /></label>
            <div class="grid gap-4 md:grid-cols-2">
              <label class="field"
                ><span>Identificativo web</span
                ><input
                  [(ngModel)]="platformTenantForm.slug"
                  name="platformTenantSlug"
              /></label>
              <label class="field"
                ><span>Indirizzo web prenotazioni</span
                ><input
                  [(ngModel)]="platformTenantForm.publicDomain"
                  name="platformTenantPublicDomain"
              /></label>
            </div>
            <label class="field"
              ><span>Note</span
              ><textarea
                [(ngModel)]="platformTenantForm.notes"
                name="platformTenantNotes"
                rows="3"
              ></textarea>
            </label>
            <div class="grid gap-4 md:grid-cols-2">
              <label class="field checkbox-field">
                <input
                  [(ngModel)]="platformTenantForm.publicEnabled"
                  name="platformTenantPublicEnabled"
                  type="checkbox"
                />
                <span>Prenotazioni online attive</span>
              </label>
              <label class="field">
                <span>Modalità di prenotazione</span>
                <barber-custom-select
                  [value]="platformTenantForm.bookingMode"
                  (valueChange)="platformTenantForm.bookingMode = $event"
                  [options]="bookingModeOptions"
                  label="Modalità di prenotazione"
                ></barber-custom-select>
              </label>
            </div>
            <div class="flex flex-wrap gap-3">
              <button
                type="submit"
                class="primary-btn"
                [disabled]="loading || !tenantFormValid"
              >
                Salva attività
              </button>
              <button
                type="button"
                class="pill-btn"
                [disabled]="loading"
                (click)="suspendTenant.emit()"
              >
                Sospendi
              </button>
              <button
                type="button"
                class="pill-btn"
                [disabled]="loading"
                (click)="reactivateTenant.emit()"
              >
                Riattiva
              </button>
              <button
                type="button"
                class="pill-btn"
                [disabled]="loading"
                (click)="resetTenantData.emit()"
              >
                Svuota dati attività
              </button>
              <button
                type="button"
                class="pill-btn"
                (click)="deleteTenant.emit()"
              >
                Elimina attività
              </button>
            </div>
          </form>
        </article>
      </div>

      <article *ngIf="!selectedPlatformTenant" class="panel rounded-[2rem] p-5">
        <p class="eyebrow text-[var(--accent)]">Operazioni attività</p>
        <h3 class="font-display text-3xl">Seleziona prima un'attività</h3>
        <p class="mt-3 max-w-2xl text-sm text-[var(--muted)]">
          Copia, ripristino, sospensione, riattivazione, eliminazione e piano
          riguarderanno soltanto l'attività selezionata.
        </p>
      </article>

      <div class="grid gap-4 xl:grid-cols-3">
        <article class="panel rounded-[2rem] p-5 xl:col-span-2">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="eyebrow text-[var(--accent)]">Copia di sicurezza</p>
              <h3 class="font-display text-3xl">Salva o ripristina i dati</h3>
            </div>
            <div class="flex gap-3">
              <button
                type="button"
                class="pill-btn"
                [disabled]="!selectedPlatformTenant"
                (click)="exportTenant.emit()"
              >
                Prepara copia completa
              </button>
              <button
                type="button"
                class="pill-btn"
                [disabled]="!selectedPlatformTenant"
                (click)="exportTenantCsv.emit()"
              >
                Prepara copia tabellare
              </button>
              <button
                type="button"
                class="primary-btn"
                [disabled]="!selectedPlatformTenant || !platformImportJson"
                (click)="importTenant.emit()"
              >
                Ripristina copia completa
              </button>
              <button
                type="button"
                class="primary-btn"
                [disabled]="!selectedPlatformTenant || !platformImportCsv"
                (click)="importTenantCsv.emit()"
              >
                Ripristina copia tabellare
              </button>
            </div>
          </div>
          <div class="mt-5 grid gap-4 lg:grid-cols-2">
            <label class="field">
              <span>Dati da conservare</span>
              <textarea
                [ngModel]="platformExportJson"
                name="platformExportJson"
                rows="16"
                readonly
              ></textarea>
            </label>
            <label class="field">
              <span>Dati completi da ripristinare</span>
              <textarea
                [ngModel]="platformImportJson"
                (ngModelChange)="platformImportJsonChange.emit($event)"
                name="platformImportJson"
                rows="16"
              ></textarea>
            </label>
          </div>
          <div class="mt-5 grid gap-4 lg:grid-cols-2">
            <label class="field">
              <span>Tabelle da conservare</span>
              <textarea
                [ngModel]="platformExportCsv"
                name="platformExportCsv"
                rows="16"
                readonly
              ></textarea>
            </label>
            <label class="field">
              <span>Tabelle da ripristinare</span>
              <textarea
                [ngModel]="platformImportCsv"
                (ngModelChange)="platformImportCsvChange.emit($event)"
                name="platformImportCsv"
                rows="16"
              ></textarea>
            </label>
          </div>
        </article>

        <article class="dark-panel rounded-[2rem] p-5 text-white">
          <p class="eyebrow text-white/45">Controllo dati</p>
          <h3 class="font-display text-3xl">Contenuti dell'attività</h3>
          <div
            *ngIf="platformHealthCheck"
            class="mt-5 grid gap-3 text-sm text-white/75"
          >
            <div class="rounded-[1.3rem] bg-white/8 p-4">
              Utenti: {{ platformHealthCheck.counts.users }}
            </div>
            <div class="rounded-[1.3rem] bg-white/8 p-4">
              Professionisti: {{ platformHealthCheck.counts.collaborators }}
            </div>
            <div class="rounded-[1.3rem] bg-white/8 p-4">
              Clienti: {{ platformHealthCheck.counts.customers }}
            </div>
            <div class="rounded-[1.3rem] bg-white/8 p-4">
              Appuntamenti: {{ platformHealthCheck.counts.appointments }}
            </div>
            <div class="rounded-[1.3rem] bg-white/8 p-4">
              Vendite: {{ platformHealthCheck.counts.sales }}
            </div>
          </div>
        </article>
      </div>

      <div class="grid gap-4 xl:grid-cols-2">
        <article class="panel rounded-[2rem] p-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="eyebrow text-[var(--accent)]">Offerta</p>
              <h3 class="font-display text-3xl">Piani</h3>
            </div>
            <button type="button" class="pill-btn" (click)="resetPlan.emit()">
              Nuovo piano
            </button>
          </div>
          <div class="mt-5 grid gap-3">
            <button
              *ngFor="let plan of platformPlans"
              type="button"
              class="list-card text-left"
              (click)="editPlan.emit(plan)"
            >
              <div>
                <strong>{{ plan.name }}</strong>
                <p class="text-sm text-[var(--muted)]">
                  {{ plan.code }} · {{ formatBillingInterval(plan.billingInterval) }}
                </p>
              </div>
              <span class="status-pill status-pill-blue"
                >EUR {{ plan.price }}</span
              >
            </button>
          </div>
          <form class="mt-5 grid gap-4" (ngSubmit)="savePlan.emit()">
            <div class="grid gap-4 md:grid-cols-2">
              <label class="field"
                ><span>Codice piano</span
                ><input
                  [(ngModel)]="platformPlanForm.code"
                  name="platformPlanCode"
              /></label>
              <label class="field"
                ><span>Nome</span
                ><input
                  [(ngModel)]="platformPlanForm.name"
                  name="platformPlanName"
              /></label>
            </div>
            <div class="grid gap-4 md:grid-cols-2">
              <label class="field"
                ><span>Prezzo</span
                ><input
                  [(ngModel)]="platformPlanForm.price"
                  name="platformPlanPrice"
                  type="number"
              /></label>
              <label class="field">
                <span>Frequenza</span>
                <barber-custom-select
                  [value]="platformPlanForm.billingInterval"
                  (valueChange)="platformPlanForm.billingInterval = $event"
                  [options]="billingIntervalOptions"
                  label="Frequenza"
                ></barber-custom-select>
              </label>
            </div>
            <button
              type="submit"
              class="primary-btn"
              [disabled]="loading || !planFormValid"
            >
              {{ platformPlanForm.id ? "Aggiorna piano" : "Crea piano" }}
            </button>
          </form>
        </article>

        <article class="dark-panel rounded-[2rem] p-5 text-white">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="eyebrow text-white/45">Abbonamenti</p>
              <h3 class="font-display text-3xl">Piani assegnati</h3>
            </div>
          </div>
          <div class="mt-5 grid gap-3">
            <div
              *ngFor="let subscription of platformSubscriptions"
              class="rounded-[1.3rem] bg-white/8 p-4"
            >
              <div class="flex items-center justify-between gap-3">
                <strong>{{ subscription.tenant.name }}</strong>
                <span
                  class="status-pill"
                  [ngClass]="subscriptionStatusClass(subscription.status)"
                >
                  {{ formatSubscriptionStatus(subscription.status) }}
                </span>
              </div>
              <p class="mt-2 text-sm text-white/70">
                {{ subscription.plan.name }} ·
                {{ formatBillingInterval(subscription.plan.billingInterval) }}
              </p>
            </div>
          </div>
          <form class="mt-5 grid gap-4" (ngSubmit)="saveSubscription.emit()">
            <label class="field">
              <span>Piano da assegnare all'attività selezionata</span>
              <barber-custom-select
                [value]="platformSubscriptionForm.planId"
                (valueChange)="platformSubscriptionForm.planId = $event"
                [options]="platformPlanSelectOptions"
                label="Piano"
              ></barber-custom-select>
            </label>
            <label class="field">
              <span>Stato</span>
              <barber-custom-select
                [value]="platformSubscriptionForm.status"
                (valueChange)="platformSubscriptionForm.status = $event"
                [options]="subscriptionStatusSelectOptions"
                label="Stato"
              ></barber-custom-select>
            </label>
            <button
              type="submit"
              class="primary-btn"
              [disabled]="loading || !selectedPlatformTenant"
            >
              Assegna piano
            </button>
          </form>
        </article>
      </div>
    </section>
  `,
})
export class AdminPlatformPageComponent {
  formatBillingInterval = billingIntervalLabel;
  @Input() platformTenants: any[] = [];
  @Input() selectedPlatformTenant: any = null;
  @Input() platformTenantForm: any = {};
  @Input() bookingModeOptions: Array<{ value: string; label: string }> = [];
  @Input() platformExportJson = "";
  @Input() platformImportJson = "";
  @Input() platformExportCsv = "";
  @Input() platformImportCsv = "";
  @Input() platformHealthCheck: any = null;
  @Input() platformPlans: any[] = [];
  @Input() platformPlanForm: any = {};
  @Input() billingIntervalOptions: Array<{ value: string; label: string }> = [];
  @Input() platformSubscriptions: any[] = [];
  @Input() platformSubscriptionForm: any = {};
  @Input() platformPlanSelectOptions: Array<{ value: string; label: string }> =
    [];
  @Input() subscriptionStatusSelectOptions: Array<{
    value: string;
    label: string;
  }> = [];
  @Input() loading = false;

  @Output() selectTenant = new EventEmitter<any>();
  @Output() saveTenant = new EventEmitter<void>();
  @Output() suspendTenant = new EventEmitter<void>();
  @Output() reactivateTenant = new EventEmitter<void>();
  @Output() resetTenantData = new EventEmitter<void>();
  @Output() deleteTenant = new EventEmitter<void>();
  @Output() exportTenant = new EventEmitter<void>();
  @Output() exportTenantCsv = new EventEmitter<void>();
  @Output() importTenant = new EventEmitter<void>();
  @Output() importTenantCsv = new EventEmitter<void>();
  @Output() platformImportJsonChange = new EventEmitter<string>();
  @Output() platformImportCsvChange = new EventEmitter<string>();
  @Output() resetPlan = new EventEmitter<void>();
  @Output() editPlan = new EventEmitter<any>();
  @Output() savePlan = new EventEmitter<void>();
  @Output() saveSubscription = new EventEmitter<void>();

  get tenantFormValid(): boolean {
    return Boolean(
      typeof this.platformTenantForm.name === "string" &&
        this.platformTenantForm.name.trim() &&
        typeof this.platformTenantForm.slug === "string" &&
        this.platformTenantForm.slug.trim(),
    );
  }

  get planFormValid(): boolean {
    return Boolean(
      typeof this.platformPlanForm.code === "string" &&
        this.platformPlanForm.code.trim() &&
        typeof this.platformPlanForm.name === "string" &&
        this.platformPlanForm.name.trim(),
    );
  }

  formatPlatformTenantStatus(tenant: {
    isSuspended?: boolean;
    isActive?: boolean;
  }): string {
    if (tenant.isSuspended) {
      return "Sospesa";
    }
    return tenant.isActive ? "Attiva" : "Non attiva";
  }

  platformTenantStatusClass(tenant: {
    isSuspended?: boolean;
    isActive?: boolean;
  }): string {
    if (tenant.isSuspended) {
      return "status-pill-red";
    }
    return tenant.isActive ? "status-pill-green" : "status-pill-neutral";
  }

  formatSubscriptionStatus(status: string): string {
    return subscriptionStatusLabel(status);
  }

  subscriptionStatusClass(status: string): string {
    switch (status) {
      case "active":
        return "status-pill-green";
      case "trialing":
      case "past_due":
        return "status-pill-amber";
      case "cancelled":
      case "unpaid":
        return "status-pill-red";
      default:
        return "status-pill-neutral";
    }
  }
}
