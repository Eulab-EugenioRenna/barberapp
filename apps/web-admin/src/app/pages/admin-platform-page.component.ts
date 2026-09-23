import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CustomSelectComponent } from "../custom-select.component";

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
              <p class="eyebrow text-[var(--accent)]">Platform tenants</p>
              <h3 class="font-display text-3xl">Tenant management</h3>
            </div>
            <span class="status-pill status-pill-neutral"
              >{{ platformTenants.length }} tenants</span
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
                  {{ platformTenant.users?.[0]?.email || "owner mancante" }}
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
          <p class="eyebrow text-white/45">Tenant selezionato</p>
          <h3 class="font-display text-3xl">
            {{
              selectedPlatformTenant
                ? selectedPlatformTenant.name
                : "Seleziona un tenant"
            }}
          </h3>
          <p class="mt-2 text-sm text-white/65">
            {{
              selectedPlatformTenant
                ? selectedPlatformTenant.slug +
                  " · " +
                  (selectedPlatformTenant.users?.[0]?.email || "owner mancante")
                : "Prima seleziona un tenant dalla lista: tutte le operazioni qui sotto agiranno solo su quel tenant."
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
                ><span>Slug</span
                ><input
                  [(ngModel)]="platformTenantForm.slug"
                  name="platformTenantSlug"
              /></label>
              <label class="field"
                ><span>Public domain</span
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
                <span>Public enabled</span>
              </label>
              <label class="field">
                <span>Booking mode</span>
                <barber-custom-select
                  [value]="platformTenantForm.bookingMode"
                  (valueChange)="platformTenantForm.bookingMode = $event"
                  [options]="bookingModeOptions"
                  label="Booking mode"
                ></barber-custom-select>
              </label>
            </div>
            <div class="flex flex-wrap gap-3">
              <button
                type="submit"
                class="primary-btn"
                [disabled]="loading || !tenantFormValid"
              >
                Salva tenant
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
                Reset dati
              </button>
              <button
                type="button"
                class="pill-btn"
                (click)="deleteTenant.emit()"
              >
                Elimina tenant
              </button>
            </div>
          </form>
        </article>
      </div>

      <article *ngIf="!selectedPlatformTenant" class="panel rounded-[2rem] p-5">
        <p class="eyebrow text-[var(--accent)]">Workflow</p>
        <h3 class="font-display text-3xl">Seleziona prima il tenant</h3>
        <p class="mt-3 max-w-2xl text-sm text-[var(--muted)]">
          Export, import, reset dati, sospensione, riattivazione, eliminazione e
          assegnazione subscription vengono sempre eseguiti sul tenant
          selezionato nella lista.
        </p>
      </article>

      <div class="grid gap-4 xl:grid-cols-3">
        <article class="panel rounded-[2rem] p-5 xl:col-span-2">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="eyebrow text-[var(--accent)]">Export / import</p>
              <h3 class="font-display text-3xl">Snapshot tenant JSON</h3>
            </div>
            <div class="flex gap-3">
              <button
                type="button"
                class="pill-btn"
                [disabled]="!selectedPlatformTenant"
                (click)="exportTenant.emit()"
              >
                Export
              </button>
              <button
                type="button"
                class="pill-btn"
                [disabled]="!selectedPlatformTenant"
                (click)="exportTenantCsv.emit()"
              >
                Export CSV
              </button>
              <button
                type="button"
                class="primary-btn"
                [disabled]="!selectedPlatformTenant || !platformImportJson"
                (click)="importTenant.emit()"
              >
                Import replace
              </button>
              <button
                type="button"
                class="primary-btn"
                [disabled]="!selectedPlatformTenant || !platformImportCsv"
                (click)="importTenantCsv.emit()"
              >
                Import CSV
              </button>
            </div>
          </div>
          <div class="mt-5 grid gap-4 lg:grid-cols-2">
            <label class="field">
              <span>Export JSON</span>
              <textarea
                [ngModel]="platformExportJson"
                name="platformExportJson"
                rows="16"
                readonly
              ></textarea>
            </label>
            <label class="field">
              <span>Import JSON</span>
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
              <span>Export CSV bundle</span>
              <textarea
                [ngModel]="platformExportCsv"
                name="platformExportCsv"
                rows="16"
                readonly
              ></textarea>
            </label>
            <label class="field">
              <span>Import CSV bundle</span>
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
          <p class="eyebrow text-white/45">Health check</p>
          <h3 class="font-display text-3xl">Tenant status</h3>
          <div
            *ngIf="platformHealthCheck"
            class="mt-5 grid gap-3 text-sm text-white/75"
          >
            <div class="rounded-[1.3rem] bg-white/8 p-4">
              Users: {{ platformHealthCheck.counts.users }}
            </div>
            <div class="rounded-[1.3rem] bg-white/8 p-4">
              Collaborators: {{ platformHealthCheck.counts.collaborators }}
            </div>
            <div class="rounded-[1.3rem] bg-white/8 p-4">
              Customers: {{ platformHealthCheck.counts.customers }}
            </div>
            <div class="rounded-[1.3rem] bg-white/8 p-4">
              Appointments: {{ platformHealthCheck.counts.appointments }}
            </div>
            <div class="rounded-[1.3rem] bg-white/8 p-4">
              Sales: {{ platformHealthCheck.counts.sales }}
            </div>
          </div>
        </article>
      </div>

      <div class="grid gap-4 xl:grid-cols-2">
        <article class="panel rounded-[2rem] p-5">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="eyebrow text-[var(--accent)]">Plans</p>
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
                  {{ plan.code }} · {{ plan.billingInterval }}
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
                ><span>Code</span
                ><input
                  [(ngModel)]="platformPlanForm.code"
                  name="platformPlanCode"
              /></label>
              <label class="field"
                ><span>Name</span
                ><input
                  [(ngModel)]="platformPlanForm.name"
                  name="platformPlanName"
              /></label>
            </div>
            <div class="grid gap-4 md:grid-cols-2">
              <label class="field"
                ><span>Price</span
                ><input
                  [(ngModel)]="platformPlanForm.price"
                  name="platformPlanPrice"
                  type="number"
              /></label>
              <label class="field">
                <span>Interval</span>
                <barber-custom-select
                  [value]="platformPlanForm.billingInterval"
                  (valueChange)="platformPlanForm.billingInterval = $event"
                  [options]="billingIntervalOptions"
                  label="Interval"
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
              <p class="eyebrow text-white/45">Subscriptions</p>
              <h3 class="font-display text-3xl">Assegnazioni</h3>
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
                {{ subscription.plan.billingInterval }}
              </p>
            </div>
          </div>
          <form class="mt-5 grid gap-4" (ngSubmit)="saveSubscription.emit()">
            <label class="field">
              <span>Piano da assegnare al tenant selezionato</span>
              <barber-custom-select
                [value]="platformSubscriptionForm.planId"
                (valueChange)="platformSubscriptionForm.planId = $event"
                [options]="platformPlanSelectOptions"
                label="Piano"
              ></barber-custom-select>
            </label>
            <label class="field">
              <span>Status</span>
              <barber-custom-select
                [value]="platformSubscriptionForm.status"
                (valueChange)="platformSubscriptionForm.status = $event"
                [options]="subscriptionStatusSelectOptions"
                label="Status"
              ></barber-custom-select>
            </label>
            <button
              type="submit"
              class="primary-btn"
              [disabled]="loading || !selectedPlatformTenant"
            >
              Assegna subscription
            </button>
          </form>
        </article>
      </div>
    </section>
  `,
})
export class AdminPlatformPageComponent {
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
      return "suspended";
    }
    return tenant.isActive ? "active" : "inactive";
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
    return status.replace(/_/g, " ");
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
