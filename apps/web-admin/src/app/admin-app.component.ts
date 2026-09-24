import { CommonModule, DOCUMENT, DatePipe, DecimalPipe, NgClass } from "@angular/common";
import { HttpClient } from "@angular/common/http";
import { Component, OnInit, ViewChild, computed, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { CalendarInputComponent } from "./calendar-input.component";
import { ADMIN_API_URL } from "./core/api-config";
import { AdminApiService } from "./core/admin-api.service";
import { AdminFacade } from "./core/admin.facade";
import { AuthApiService } from "./core/auth-api.service";
import { SessionStore } from "./core/session.store";
import { AdminAppointmentsFeaturePageComponent } from "./appointments/admin-appointments-feature-page.component";
import { CustomSelectComponent } from "./custom-select.component";
import { AdminAppointmentsPageComponent } from "./pages/admin-appointments-page.component";
import { AdminCollaboratorsPageComponent } from "./pages/admin-collaborators-page.component";
import { AdminCustomersPageComponent } from "./pages/admin-customers-page.component";
import { AdminDashboardPageComponent } from "./pages/admin-dashboard-page.component";
import { AdminPlatformPageComponent } from "./pages/admin-platform-page.component";
import { AdminSalesPageComponent } from "./pages/admin-sales-page.component";
import { AdminServicesPageComponent } from "./pages/admin-services-page.component";
import { AdminSettingsPageComponent } from "./pages/admin-settings-page.component";
import { QuickOrderModalComponent } from "./quick-order/quick-order-modal.component";

type ViewKey =
  | "platform"
  | "dashboard"
  | "appointments"
  | "sales"
  | "customers"
  | "services"
  | "collaborators"
  | "settings";

@Component({
  selector: "barber-admin-root",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgClass,
    DecimalPipe,
    DatePipe,
    CalendarInputComponent,
    CustomSelectComponent,
    AdminAppointmentsFeaturePageComponent,
    AdminDashboardPageComponent,
    AdminAppointmentsPageComponent,
    AdminSalesPageComponent,
    AdminCustomersPageComponent,
    AdminServicesPageComponent,
    AdminCollaboratorsPageComponent,
    AdminPlatformPageComponent,
    AdminSettingsPageComponent,
    QuickOrderModalComponent,
  ],
  template: `
    <main class="admin-shell min-h-screen">
      <barber-quick-order-modal
        *ngIf="quickOrderOpen"
        [customers]="adminData().customers"
        [services]="adminData().services"
        [products]="adminData().products"
        [collaborators]="adminData().collaborators"
        [defaultCollaboratorId]="adminData().tenant?.defaultCollaboratorId || ''"
        [appointment]="quickOrderAppointment"
        [loading]="loading"
        (close)="closeQuickOrder()"
        (submitOrder)="saveQuickOrder($event)"
        (catalogChanged)="refreshAll()"
      ></barber-quick-order-modal>
      <div *ngIf="confirmDialog" class="confirm-overlay">
        <button
          type="button"
          class="confirm-backdrop"
          (click)="closeConfirmDialog()"
        ></button>
        <article
          class="confirm-dialog panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <p class="eyebrow text-[var(--accent)]">Conferma eliminazione</p>
          <h2 id="confirm-dialog-title" class="mt-3 font-display text-3xl">
            {{ confirmDialog.title }}
          </h2>
          <p class="mt-4 text-sm text-[var(--muted)]">
            {{ confirmDialog.body }}
          </p>
          <p class="mt-2 text-sm font-semibold text-red-700">
            Questa operazione non puo essere annullata.
          </p>
          <div class="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              class="pill-btn"
              [disabled]="confirmDialog.running"
              (click)="closeConfirmDialog()"
            >
              Annulla
            </button>
            <button
              type="button"
              class="primary-btn destructive-btn"
              [disabled]="confirmDialog.running"
              (click)="runConfirmDialog()"
            >
              {{
                confirmDialog.running
                  ? "Eliminazione..."
                  : confirmDialog.confirmLabel
              }}
            </button>
          </div>
        </article>
      </div>

      <section
        *ngIf="!sessionToken"
        class="mx-auto grid min-h-screen max-w-7xl items-center gap-6 px-4 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-8"
      >
        <aside class="hero-panel rounded-[2rem] p-6 text-white lg:p-10">
          <p class="eyebrow">Platforma booking</p>
          <h1
            class="mt-4 font-display text-5xl font-semibold leading-none md:text-7xl"
          >
            Un gestionale davvero operativo, non una demo.
          </h1>
          <p class="mt-6 max-w-xl text-base text-white/72 md:text-lg">
            Onboarding tenant, dashboard con valori DB, agenda modificabile,
            white label e booking pubblico in una UI piu moderna e mobile-first.
          </p>
          <div class="mt-8 grid gap-3 md:grid-cols-3">
            <article class="glass-tile rounded-[1.4rem] p-4">
              <p class="text-xs uppercase tracking-[0.3em] text-white/50">
                Dashboard
              </p>
              <strong class="mt-3 block text-3xl">Live</strong>
              <span class="text-sm text-white/70">Metriche dal database</span>
            </article>
            <article class="glass-tile rounded-[1.4rem] p-4">
              <p class="text-xs uppercase tracking-[0.3em] text-white/50">
                Booking
              </p>
              <strong class="mt-3 block text-3xl">CRUD</strong>
              <span class="text-sm text-white/70"
                >Crea e modifica appuntamenti</span
              >
            </article>
            <article class="glass-tile rounded-[1.4rem] p-4">
              <p class="text-xs uppercase tracking-[0.3em] text-white/50">
                White label
              </p>
              <strong class="mt-3 block text-3xl">Hybrid</strong>
              <span class="text-sm text-white/70"
                >Tenant pubblico o chiuso</span
              >
            </article>
          </div>
        </aside>

        <section class="panel rounded-[2rem] p-5 md:p-8">
          <div class="flex items-center justify-between">
            <div>
              <p class="eyebrow text-[var(--accent)]">Accesso</p>
              <h2 class="mt-2 font-display text-4xl">
                {{ authMode === "login" ? "Accedi" : "Crea il tuo tenant" }}
              </h2>
            </div>
            <button
              type="button"
              class="pill-btn"
              (click)="authMode = authMode === 'login' ? 'signup' : 'login'"
            >
              {{ authMode === "login" ? "Signup" : "Login" }}
            </button>
          </div>

          <form class="mt-8 grid gap-4" (ngSubmit)="submitAuth()">
            <div
              *ngIf="authMode === 'signup'"
              class="grid gap-4 md:grid-cols-2"
            >
              <label class="field">
                <span>Nome</span>
                <input
                  [(ngModel)]="signupForm.firstName"
                  name="signupFirstName"
                  placeholder="Giulia"
                />
              </label>
              <label class="field">
                <span>Cognome</span>
                <input
                  [(ngModel)]="signupForm.lastName"
                  name="signupLastName"
                  placeholder="Riva"
                />
              </label>
            </div>

            <label *ngIf="authMode === 'signup'" class="field">
              <span>Nome attivita</span>
              <input
                [(ngModel)]="signupForm.companyName"
                name="companyName"
                placeholder="Atelier Barberia Milano"
              />
            </label>

            <label class="field">
              <span>Email</span>
              <input
                [(ngModel)]="loginForm.email"
                name="loginEmail"
                placeholder="owner@atelier.it"
              />
            </label>

            <label class="field">
              <span>Password</span>
              <input
                [(ngModel)]="loginForm.password"
                name="loginPassword"
                type="password"
                placeholder="••••••••"
              />
            </label>

            <label *ngIf="authMode === 'signup'" class="field">
              <span>Ripeti password</span>
              <input
                [(ngModel)]="signupPasswordConfirm"
                name="signupPasswordConfirm"
                type="password"
                placeholder="••••••••"
              />
            </label>

            <p
              *ngIf="feedback"
              role="status"
              aria-live="polite"
              class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {{ feedback }}
            </p>

            <button type="submit" class="primary-btn" [disabled]="loading">
              {{
                loading
                  ? "Caricamento..."
                  : authMode === "login"
                    ? "Accedi alla dashboard"
                    : "Crea account e tenant"
              }}
            </button>
          </form>
        </section>
      </section>

      <section *ngIf="sessionToken" class="app-frame">
        <button
          *ngIf="sidebarOpen"
          type="button"
          class="mobile-backdrop"
          (click)="sidebarOpen = false"
        ></button>

        <aside
          class="sidebar"
          [ngClass]="{
            'sidebar-open': sidebarOpen,
            'sidebar-collapsed': sidebarCollapsed,
          }"
        >
          <div class="sidebar-header">
            <div class="sidebar-brand">
              <p class="eyebrow text-white/45">Control room</p>
              <div class="mt-3 flex items-center gap-3 sidebar-brand-copy">
                <img
                  *ngIf="
                    tenant?.logoUrl && currentUser?.role !== 'platform_admin'
                  "
                  [src]="absoluteAssetUrl(tenant.logoUrl)"
                  alt="Logo"
                  class="h-auto w-auto max-h-20 max-w-[18rem] object-contain"
                />
                <h1 class="font-display text-3xl text-white">
                  {{
                    currentUser?.role === "platform_admin"
                      ? "Platform Control"
                      : (tenant?.publicTitle ??
                        tenant?.name ??
                        "Barber Control")
                  }}
                </h1>
              </div>
            </div>
            <div class="sidebar-actions">
              <button
                *ngIf="currentUser?.role !== 'platform_admin'"
                type="button"
                class="icon-btn sidebar-toggle desktop-only"
                (click)="toggleSidebarCollapsed()"
                [attr.aria-label]="
                  sidebarCollapsed ? 'Espandi sidebar' : 'Comprimi sidebar'
                "
              >
                {{ sidebarCollapsed ? ">" : "<" }}
              </button>
              <button
                type="button"
                class="icon-btn sidebar-toggle mobile-only"
                (click)="sidebarOpen = false"
              >
                ×
              </button>
            </div>
          </div>

          <div class="sidebar-nav">
            <button
              *ngFor="let item of visibleNavItems"
              type="button"
              class="nav-btn"
              [ngClass]="{ active: activeView === item.key }"
              (click)="selectView(item.key)"
              [attr.aria-label]="item.label"
              [title]="sidebarCollapsed ? item.label : null"
            >
              <span class="nav-icon">{{ item.icon }}</span>
              <span class="nav-copy">
                <span>{{ item.label }}</span>
                <small>{{ item.hint }}</small>
              </span>
            </button>
          </div>

          <article
            class="sidebar-footer rounded-[1.6rem] border border-white/10 bg-white/6 p-4 text-white/78"
          >
            <p class="text-xs uppercase tracking-[0.28em] text-white/40">
              Public booking
            </p>
            <p class="mt-2 text-sm sidebar-footer-copy">
              Tenant slug:
              <strong>{{
                tenant?.slug || currentUser?.role || "default"
              }}</strong>
            </p>
            <p class="mt-1 text-sm sidebar-footer-copy">
              Modalita:
              <strong>{{
                tenant?.bookingMode || currentUser?.role || "hybrid"
              }}</strong>
            </p>
            <button
              type="button"
              class="secondary-btn sidebar-logout mt-4 w-full"
              (click)="logout()"
              [attr.aria-label]="sidebarCollapsed ? 'Logout' : null"
              [title]="sidebarCollapsed ? 'Logout' : null"
            >
              <span class="nav-icon sidebar-footer-icon">L</span>
              <span class="sidebar-footer-copy">Logout</span>
            </button>
          </article>
        </aside>

        <div class="content-shell">
          <header class="topbar panel rounded-[2rem] p-4 md:p-5">
            <div
              class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
            >
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  class="icon-btn lg:hidden"
                  (click)="sidebarOpen = true"
                >
                  ☰
                </button>
                <div>
                  <p class="eyebrow text-[var(--accent)]">
                    {{ activeViewLabel }}
                  </p>
                  <h2 class="font-display text-3xl md:text-5xl">
                    {{
                      currentUser?.role === "platform_admin"
                        ? "Platform Admin"
                        : tenant?.name || "Dashboard"
                    }}
                  </h2>
                </div>
              </div>
              <div class="flex flex-wrap gap-3">
                <button
                  type="button"
                  class="pill-btn"
                  (click)="refreshCurrentView()"
                >
                  Aggiorna
                </button>
                <button
                  *ngIf="currentUser?.role !== 'platform_admin'"
                  type="button"
                  class="pill-btn"
                  (click)="openQuickOrder()"
                >
                  Nuovo ordine
                </button>
                <button
                  *ngIf="currentUser?.role !== 'platform_admin'"
                  type="button"
                  class="primary-btn !px-5 !py-3"
                  (click)="startAppointmentFlow()"
                >
                  Nuova prenotazione
                </button>
              </div>
            </div>
          </header>

          <main class="content-scroll">
            <p
              *ngIf="feedback"
              class="panel mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {{ feedback }}
            </p>

            <barber-admin-dashboard-page
              *ngIf="activeView === 'dashboard'"
              [revenueMetrics]="dashboardData().revenueMetrics"
              [appointmentStats]="dashboardData().appointmentStats"
              [appointments]="dashboardData().appointments"
              [collaboratorStats]="dashboardData().collaboratorStats"
              [revenueReport]="dashboardData().revenueReport"
              [revenueFilters]="revenueFilters"
              [activity]="dashboardActivity"
              [activityHasMore]="dashboardActivityHasMore"
              [activityLoading]="dashboardActivityLoading"
              [customerOptions]="customerSelectOptions"
              [collaboratorOptions]="collaboratorSelectOptions"
              [loading]="loading"
              (editAppointment)="editAppointment($event)"
              (applyRevenueFilters)="loadRevenueReport()"
              (resetRevenueFilters)="resetRevenueFilters()"
              (loadMoreActivity)="loadMoreDashboardActivity()"
              (openQuickOrder)="openQuickOrder()"
            ></barber-admin-dashboard-page>

            <barber-admin-appointments-feature-page
              *ngIf="activeView === 'appointments'"
              (createOrder)="openQuickOrder($event)"
            ></barber-admin-appointments-feature-page>

            <barber-admin-sales-page
              *ngIf="activeView === 'sales'"
              [sales]="adminData().sales"
              [loading]="loading"
              [hasMore]="salesHasMore()"
              (loadMore)="loadMoreSales()"
              (openQuickOrder)="openQuickOrder()"
            ></barber-admin-sales-page>

            <barber-admin-customers-page
              *ngIf="activeView === 'customers'"
              [customers]="adminData().customers"
              [customerForm]="customerForm"
              [customerHistory]="customerHistory"
              [historyLoading]="customerHistoryLoading"
              [loading]="loading"
              [hasMore]="customersHasMore()"
              (edit)="editCustomer($event)"
              (save)="saveCustomer()"
              (remove)="removeCustomer($event)"
              (reset)="resetCustomerForm()"
              (loadMore)="loadMoreCustomers()"
              (searchChange)="searchCustomers($event)"
            ></barber-admin-customers-page>

            <barber-admin-services-page
              *ngIf="activeView === 'services'"
              [services]="adminData().services"
              [products]="adminData().products"
              [serviceForm]="serviceForm"
              [productForm]="productForm"
              [serviceProductForm]="serviceProductForm"
              [serviceProductModeOptions]="serviceProductModeOptions"
              [productSelectOptions]="productSelectOptions"
              [loading]="loading"
              [servicesHasMore]="servicesHasMore()"
              [productsHasMore]="productsHasMore()"
              (edit)="editService($event)"
              (detachProduct)="detachProductFromService($event)"
              (attachProduct)="attachProductToService()"
              (save)="saveService()"
              (remove)="removeService()"
              (reset)="resetServiceForm()"
              (editProduct)="editProduct($event)"
              (saveProduct)="saveProduct()"
              (removeProduct)="removeProduct()"
              (resetProduct)="resetProductForm()"
              (loadMoreServices)="loadMoreServices()"
              (loadMoreProducts)="loadMoreProducts()"
            ></barber-admin-services-page>

            <barber-admin-collaborators-page
              *ngIf="activeView === 'collaborators'"
              [collaborators]="adminData().collaborators"
              [collaboratorForm]="collaboratorForm"
              [defaultCollaboratorId]="adminData().tenant?.defaultCollaboratorId || ''"
              [loading]="loading"
              [hasMore]="collaboratorsHasMore()"
              (edit)="editCollaborator($event)"
              (save)="saveCollaborator()"
              (setDefault)="setDefaultCollaborator($event)"
              (remove)="removeCollaborator()"
              (reset)="resetCollaboratorForm()"
              (loadMore)="loadMoreCollaborators()"
            ></barber-admin-collaborators-page>

            <barber-admin-platform-page
              *ngIf="
                activeView === 'platform' &&
                currentUser?.role === 'platform_admin' &&
                isPlatformRoute
              "
              [platformTenants]="platformTenants"
              [selectedPlatformTenant]="selectedPlatformTenant"
              [platformTenantForm]="platformTenantForm"
              [bookingModeOptions]="bookingModeOptions"
              [platformExportJson]="platformExportJson"
              [platformImportJson]="platformImportJson"
              [platformExportCsv]="platformExportCsv"
              [platformImportCsv]="platformImportCsv"
              [platformHealthCheck]="platformHealthCheck"
              [platformPlans]="platformPlans"
              [platformPlanForm]="platformPlanForm"
              [billingIntervalOptions]="billingIntervalOptions"
              [platformSubscriptions]="platformSubscriptions"
              [platformSubscriptionForm]="platformSubscriptionForm"
              [platformPlanSelectOptions]="platformPlanSelectOptions"
              [subscriptionStatusSelectOptions]="
                subscriptionStatusSelectOptions
              "
              [loading]="loading"
              (selectTenant)="selectPlatformTenant($event)"
              (saveTenant)="savePlatformTenant()"
              (suspendTenant)="suspendSelectedTenant()"
              (reactivateTenant)="reactivateSelectedTenant()"
              (resetTenantData)="resetSelectedTenantData()"
              (deleteTenant)="deleteSelectedTenant()"
              (exportTenant)="exportSelectedTenant()"
              (exportTenantCsv)="exportSelectedTenantCsv()"
              (importTenant)="importSelectedTenant()"
              (importTenantCsv)="importSelectedTenantCsv()"
              (platformImportJsonChange)="platformImportJson = $event"
              (platformImportCsvChange)="platformImportCsv = $event"
              (resetPlan)="resetPlatformPlanForm()"
              (editPlan)="editPlatformPlan($event)"
              (savePlan)="savePlatformPlan()"
              (saveSubscription)="savePlatformSubscription()"
            ></barber-admin-platform-page>

            <barber-admin-settings-page
              *ngIf="activeView === 'settings'"
              [tenant]="adminData().tenant"
              [settingsForm]="settingsForm"
              [bookingModeOptions]="bookingModeOptions"
              [computedPublicUrl]="computedPublicUrl"
              [selectedLogoFile]="selectedLogoFile"
              [selectedCoverFile]="selectedCoverFile"
              [logoPreviewUrl]="logoPreviewUrl"
              [coverPreviewUrl]="coverPreviewUrl"
              [uploadFeedback]="uploadFeedback"
              [publicPreviewHeroBackground]="publicPreviewHeroBackground"
              [publicPreviewSteps]="publicPreviewSteps"
              [publicPreviewServices]="publicPreviewServices"
              [publicPreviewCollaboratorLabel]="publicPreviewCollaboratorLabel"
              [uiScale]="uiScale"
              [loading]="loading"
              [assetUrlResolver]="absoluteAssetUrl.bind(this)"
              (save)="saveSettings()"
              (uiScaleChange)="setUiScale($event)"
              (resetDefaults)="resetSettingsToDefaults()"
              (mediaSelected)="onMediaSelected($event.event, $event.kind)"
              (uploadMedia)="uploadMedia($event)"
              (deleteMedia)="deleteMedia($event)"
            ></barber-admin-settings-page>
          </main>
        </div>
      </section>
    </main>
  `,
})
export class AdminAppComponent implements OnInit {
  @ViewChild(AdminAppointmentsFeaturePageComponent)
  private readonly appointmentsFeaturePage?: AdminAppointmentsFeaturePageComponent;

  private readonly http = inject(HttpClient);
  private readonly adminFacade = inject(AdminFacade);
  private readonly adminApi = inject(AdminApiService);
  private readonly authApi = inject(AuthApiService);
  private readonly sessionStore = inject(SessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly apiUrl = ADMIN_API_URL;
  private readonly document = inject(DOCUMENT);
  readonly dashboardData = this.adminFacade.dashboardData;
  readonly customersHasMore = this.adminFacade.customersHasMore;
  readonly salesHasMore = this.adminFacade.salesHasMore;
  readonly servicesHasMore = this.adminFacade.servicesHasMore;
  readonly productsHasMore = this.adminFacade.productsHasMore;
  readonly collaboratorsHasMore = this.adminFacade.collaboratorsHasMore;
  readonly adminData = computed(() => {
    const tenant = this.adminFacade.tenant();
    return {
      tenant,
      appointments: this.adminFacade.appointments(),
      sales: this.adminFacade.sales(),
      services: this.adminFacade.services(),
      products: this.adminFacade.products(),
      collaborators: this.adminFacade.collaborators(),
      customers: this.adminFacade.customers(),
    };
  });

  authMode: "login" | "signup" = "signup";
  sessionToken = this.sessionStore.token();
  sidebarOpen = false;
  sidebarCollapsed = false;
  loading = false;
  feedback = "";
  activeView: ViewKey = "dashboard";
  currentUser: any = this.sessionStore.currentUser();
  uiScale = 92;

  tenant: any = null;
  revenueMetrics: any[] = [];
  revenueReport: any = null;
  appointmentStats: any = null;
  collaboratorStats: any[] = [];
  serviceStats: any[] = [];
  appointments: any[] = [];
  sales: any[] = [];
  services: any[] = [];
  products: any[] = [];
  collaborators: any[] = [];
  customers: any[] = [];
  quickOrderOpen = false;
  quickOrderAppointment: any = null;
  customerHistory: any = null;
  customerHistoryLoading = false;
  revenueFilters = {
    period: "month",
    date: new Date().toISOString().slice(0, 10),
    customerId: "",
    collaboratorId: "",
  };
  dashboardActivity: any[] = [];
  dashboardActivityHasMore = false;
  dashboardActivityLoading = false;
  private dashboardActivityPage = 1;
  platformTenants: any[] = [];
  selectedPlatformTenant: any = null;
  platformPlans: any[] = [];
  platformSubscriptions: any[] = [];
  platformHealthCheck: any = null;
  platformExportJson = "";
  platformImportJson = "";
  platformExportCsv = "";
  platformImportCsv = "";
  selectedLogoFile: File | null = null;
  selectedCoverFile: File | null = null;
  logoPreviewUrl = "";
  coverPreviewUrl = "";
  uploadFeedback: {
    target: "logo" | "cover";
    kind: "success" | "error";
    message: string;
    pending?: boolean;
  } | null = null;
  private uploadFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
  confirmDialog: {
    title: string;
    body: string;
    confirmLabel: string;
    running: boolean;
    action: (() => Promise<void>) | null;
  } | null = null;
  serviceForm = this.emptyServiceForm();
  productForm = this.emptyProductForm();
  collaboratorForm = this.emptyCollaboratorForm();
  customerForm = this.emptyCustomerForm();
  serviceProductForm = {
    productId: "",
    mode: "optional",
    quantity: 1,
    priceLocked: false,
  };
  platformTenantForm = this.emptyPlatformTenantForm();
  platformPlanForm = this.emptyPlatformPlanForm();
  platformSubscriptionForm = this.emptyPlatformSubscriptionForm();

  loginForm = { email: "", password: "" };
  signupForm = {
    companyName: "",
    firstName: "",
    lastName: "",
    email: "",
    password: "",
  };
  signupPasswordConfirm = "";
  settingsForm = {
    name: "",
    publicDomain: "",
    primaryColor: "#1c7c64",
    accentColor: "#f97316",
    bookingMode: "hybrid",
    publicTitle: "",
    publicDescription: "",
    publicStepsText: "",
    logoUrl: "",
    coverUrl: "",
    publicEnabled: true,
    holidays: [] as Array<{ date: string; name: string }>,
  };
  appointmentStatuses = [
    "requested",
    "confirmed",
    "checked_in",
    "completed",
    "cancelled",
    "no_show",
    "rescheduled",
  ];
  appointmentForm = this.emptyAppointmentForm();
  appointmentCustomerSearch = "";
  filteredAppointmentCustomers: any[] = [];
  appointmentSelectedDate = new Date().toISOString().slice(0, 10);
  appointmentSlots: Array<{ startsAt: string; label: string }> = [];

  navItems: Array<{ key: ViewKey; label: string; hint: string; icon: string }> =
    [
      { key: "dashboard", label: "Dashboard", hint: "metriche", icon: "D" },
      { key: "appointments", label: "Prenotazioni", hint: "agenda", icon: "P" },
      { key: "sales", label: "Sales", hint: "cassa", icon: "V" },
      { key: "customers", label: "Clienti", hint: "crm", icon: "C" },
      { key: "services", label: "Servizi", hint: "catalogo", icon: "S" },
      { key: "collaborators", label: "Collaboratori", hint: "team", icon: "T" },
      { key: "settings", label: "Settings", hint: "white label", icon: "W" },
    ];

  get activeViewLabel(): string {
    if (this.isPlatformRoute) {
      return "Platform";
    }

    return (
      this.visibleNavItems.find((item) => item.key === this.activeView)
        ?.label ?? "Dashboard"
    );
  }

  get visibleNavItems(): Array<{
    key: ViewKey;
    label: string;
    hint: string;
    icon: string;
  }> {
    return this.currentUser?.role === "platform_admin" ? [] : this.navItems;
  }

  get serviceSelectOptions(): Array<{ value: string; label: string }> {
    return this.adminData().services.map((service) => ({
      value: service.id,
      label: service.name,
    }));
  }

  get appointmentCollaboratorOptions(): Array<{
    value: string;
    label: string;
  }> {
    const data = this.adminData();
    const defaultCollaboratorId = data.tenant?.defaultCollaboratorId;

    return [...data.collaborators]
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
  }

  get customerSelectOptions(): Array<{ value: string; label: string }> {
    return this.adminData().customers.map((customer) => ({
      value: customer.id,
      label: `${customer.firstName} ${customer.lastName}`.trim(),
    }));
  }

  get collaboratorSelectOptions(): Array<{ value: string; label: string }> {
    return this.adminData().collaborators.map((collaborator) => ({
      value: collaborator.id,
      label: `${collaborator.firstName} ${collaborator.lastName}`.trim(),
    }));
  }

  get productSelectOptions(): Array<{ value: string; label: string }> {
    return this.adminData().products.map((product) => ({
      value: product.id,
      label:
        product.price === null || product.price === undefined
          ? `${product.name} · prezzo da inserire`
          : `${product.name} · €${Number(product.price).toFixed(2)}`,
    }));
  }

  get serviceProductModeOptions(): Array<{ value: string; label: string }> {
    return [
      { value: "optional", label: "Opzionale" },
      { value: "recommended", label: "Consigliato" },
      { value: "included", label: "Incluso" },
      { value: "required", label: "Obbligatorio" },
    ];
  }

  get appointmentSlotOptions(): Array<{ value: string; label: string }> {
    return this.appointmentSlots.map((slot) => ({
      value: slot.startsAt,
      label: slot.label,
    }));
  }

  get appointmentStatusOptions(): Array<{ value: string; label: string }> {
    return this.appointmentStatuses.map((status) => ({
      value: status,
      label: this.formatAppointmentStatus(status),
    }));
  }

  get platformPlanSelectOptions(): Array<{ value: string; label: string }> {
    return this.platformPlans.map((plan) => ({
      value: plan.id,
      label: plan.name,
    }));
  }

  get publicPreviewSteps(): Array<{ title: string; caption: string }> {
    const configured = this.settingsForm.publicStepsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!configured.length) {
      return [
        { title: "Servizio", caption: "Catalogo reale dal tenant" },
        { title: "Slot", caption: "Disponibilita per data e collaboratore" },
        { title: "Conferma", caption: "Prenotazione persistita su DB" },
      ];
    }

    return configured.map((line) => {
      const [title, caption] = line.split("|");

      return {
        title: title?.trim() || "Step",
        caption: caption?.trim() || "",
      };
    });
  }

  get publicPreviewHeroBackground(): string {
    const coverSource = this.coverPreviewUrl || this.settingsForm.coverUrl;
    const coverLayer = coverSource
      ? `linear-gradient(180deg, rgba(16, 25, 35, 0.72), rgba(13, 20, 28, 0.9)), url(${this.absoluteAssetUrl(coverSource)}) center/cover`
      : "";

    return [
      `radial-gradient(circle at top right, ${this.settingsForm.accentColor}33, transparent 18rem)`,
      coverLayer,
      `linear-gradient(180deg, ${this.settingsForm.primaryColor} 0%, #0d141c 100%)`,
    ]
      .filter(Boolean)
      .join(", ");
  }

  get publicPreviewServices(): Array<{
    name: string;
    description: string;
    price: string;
    duration: number;
    highlighted: boolean;
  }> {
    return this.adminData().services.slice(0, 3).map((service, index) => ({
      name: service.name,
      description:
        service.publicDescription || "Prenotazione online disponibile",
      price: Number(service.basePrice || 0).toFixed(2),
      duration: Number(service.durationMinutes || 30),
      highlighted: index === 0,
    }));
  }

  get publicPreviewCollaboratorLabel(): string {
    const defaultCollaborator = this.adminData().collaborators.find(
      (collaborator) => collaborator.id === this.tenant?.defaultCollaboratorId,
    );

    if (defaultCollaborator) {
      return `${defaultCollaborator.firstName} ${defaultCollaborator.lastName} · default`;
    }

    const fallback = this.collaborators[0];
    return fallback
      ? `${fallback.firstName} ${fallback.lastName}`
      : "Seleziona collaboratore default";
  }

  isDefaultCollaborator(collaboratorId: string): boolean {
    return this.tenant?.defaultCollaboratorId === collaboratorId;
  }

  readonly bookingModeOptions = [
    { value: "public", label: "public" },
    { value: "hybrid", label: "hybrid" },
    { value: "closed", label: "closed" },
  ];

  readonly billingIntervalOptions = [
    { value: "monthly", label: "monthly" },
    { value: "yearly", label: "yearly" },
    { value: "one_time", label: "one_time" },
  ];

  readonly subscriptionStatusSelectOptions = [
    { value: "trialing", label: "trialing" },
    { value: "active", label: "active" },
    { value: "past_due", label: "past_due" },
    { value: "suspended", label: "suspended" },
    { value: "cancelled", label: "cancelled" },
  ];

  get isPlatformRoute(): boolean {
    return window.location.hash === "#/platform";
  }

  get computedPublicUrl(): string {
    const publicDomain = this.settingsForm.publicDomain?.trim();
    const slug = this.tenant?.slug;

    if (publicDomain) {
      if (/^https?:\/\//i.test(publicDomain)) {
        return publicDomain;
      }

      return `http://${publicDomain}`;
    }

    if (!slug) {
      return "";
    }

    return `${window.location.origin}/booking/${slug}`;
  }

  absoluteAssetUrl(path: string): string {
    if (!path) {
      return "";
    }

    if (/^(https?:\/\/|data:|blob:)/i.test(path)) {
      return path;
    }

    return `${this.apiUrl}${path}`;
  }

  ngOnInit(): void {
    const storedScale = Number(window.localStorage.getItem("barber.ui-scale"));
    this.setUiScale(Number.isFinite(storedScale) ? storedScale : this.uiScale);
    this.activeView =
      (this.route.snapshot.data["view"] as ViewKey | undefined) ||
      this.activeView;

    if (this.sessionStore.isAuthenticated()) {
      if (this.activeView === "appointments") {
        void this.refreshShell();
      } else {
        void this.refreshAll();
      }
    }
  }

  async loadMoreCustomers(): Promise<void> {
    await this.runLoadMore(() => this.adminFacade.loadMoreCustomers());
  }

  private customerSearchTimer: ReturnType<typeof setTimeout> | null = null;

  searchCustomers(search: string): void {
    if (this.customerSearchTimer) {
      clearTimeout(this.customerSearchTimer);
    }
    this.customerSearchTimer = setTimeout(() => {
      void this.runLoadMore(() => this.adminFacade.reloadCustomers(search));
    }, 300);
  }

  async loadMoreSales(): Promise<void> {
    await this.runLoadMore(() => this.adminFacade.loadMoreSales());
  }

  async loadMoreServices(): Promise<void> {
    await this.runLoadMore(() => this.adminFacade.loadMoreServices());
  }

  async loadMoreProducts(): Promise<void> {
    await this.runLoadMore(() => this.adminFacade.loadMoreProducts());
  }

  async loadMoreCollaborators(): Promise<void> {
    await this.runLoadMore(() => this.adminFacade.loadMoreCollaborators());
  }

  private async runLoadMore(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error: any) {
      this.feedback =
        error?.error?.message || error?.message || "Caricamento non riuscito";
    }
  }

  setUiScale(value: number): void {
    this.uiScale = Math.min(110, Math.max(85, Math.round(Number(value) || 92)));
    this.document.documentElement.style.setProperty(
      "--ui-scale",
      String(this.uiScale / 100),
    );
    this.document.documentElement.style.fontSize = `${(16 * this.uiScale) / 100}px`;
    window.localStorage.setItem("barber.ui-scale", String(this.uiScale));
  }

  private authHeaders(): Record<string, never> {
    return {};
  }

  private getCurrentAppUrl(): string {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  private rememberRequestedUrl(): void {
    this.sessionStore.rememberRequestedUrl(this.getCurrentAppUrl());
  }

  private consumeRequestedUrl(): string | null {
    return this.sessionStore.consumeRequestedUrl();
  }

  private navigateTo(url: string): void {
    void this.router.navigateByUrl(url || "/dashboard");
  }

  private syncRouteWithUser(): void {
    if (this.currentUser?.role === "platform_admin") {
      this.activeView = "platform";
      if (!this.isPlatformRoute) {
        this.navigateTo("/#/platform");
      }
      return;
    }

    if (this.isPlatformRoute) {
      this.navigateTo("/");
    }
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

  private emptyServiceForm() {
    return {
      id: "",
      name: "",
      publicDescription: "",
      durationMinutes: 30,
      basePrice: 0,
      color: "#1c7c64",
      isPublic: true,
      isBookableOnline: true,
      serviceProducts: [] as any[],
    };
  }

  private emptyProductForm() {
    return {
      id: "",
      name: "",
      description: "",
      price: null as number | null,
    };
  }

  private emptyCollaboratorForm() {
    return {
      id: "",
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      calendarColor: "#1c7c64",
      isPublic: true,
      weeklySchedules: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        isWorkingDay: weekday < 5,
        startTime: "09:00",
        endTime: "19:00",
      })),
      dayOverrides: [] as Array<{
        date: string;
        isWorkingDay: boolean;
        startTime: string;
        endTime: string;
        note: string;
        isHoliday: boolean;
      }>,
    };
  }

  private emptyCustomerForm() {
    return {
      id: "",
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      tagsText: "",
      notes: "",
    };
  }

  private emptyPlatformTenantForm() {
    return {
      id: "",
      name: "",
      slug: "",
      publicDomain: "",
      publicEnabled: true,
      bookingMode: "hybrid",
      notes: "",
    };
  }

  private emptyPlatformPlanForm() {
    return {
      id: "",
      code: "",
      name: "",
      price: 0,
      billingInterval: "monthly",
    };
  }

  private emptyPlatformSubscriptionForm() {
    return {
      planId: "",
      status: "active",
    };
  }

  async submitAuth(): Promise<void> {
    this.loading = true;
    this.feedback = "";

    try {
      if (this.authMode === "signup") {
        if (this.loginForm.password !== this.signupPasswordConfirm) {
          throw new Error("Le password non coincidono");
        }

        const response: any = await firstValueFrom(
          this.authApi.signup({
            companyName: this.signupForm.companyName,
            firstName: this.signupForm.firstName,
            lastName: this.signupForm.lastName,
            email: this.loginForm.email,
            password: this.loginForm.password,
          }),
        );

        this.sessionStore.setToken(response.accessToken);
      } else {
        const response: any = await firstValueFrom(
          this.authApi.login(this.loginForm),
        );
        this.sessionStore.setToken(response.accessToken);
      }

      const requestedUrl = this.consumeRequestedUrl();
      if (requestedUrl) {
        this.navigateTo(requestedUrl);
      }

      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message || error?.message || "Operazione non riuscita";
    } finally {
      this.loading = false;
    }
  }

  async refreshAll(): Promise<void> {
    try {
      const state = await this.adminFacade.refreshAll();
      this.loading = this.adminFacade.loading();
      this.feedback = this.adminFacade.feedback();
      this.currentUser = this.adminFacade.currentUser();

      if (state.mode === "unauthenticated") {
        return;
      }

      this.syncRouteWithUser();

      if (state.mode === "platform") {
        this.activeView = "platform";
        this.platformTenants = this.adminFacade.platformTenants();
        this.platformPlans = this.adminFacade.platformPlans();
        this.platformSubscriptions = this.adminFacade.platformSubscriptions();
        return;
      }

      this.tenant = this.adminFacade.tenant();
      this.revenueMetrics = this.adminFacade.revenueMetrics();
      this.revenueReport = this.adminFacade.revenueReport();
      this.appointmentStats = this.adminFacade.appointmentStats();
      this.collaboratorStats = this.adminFacade.collaboratorStats();
      this.serviceStats = this.adminFacade.serviceStats();
      this.appointments = this.adminFacade.appointments();
      this.sales = this.adminFacade.sales();
      this.services = this.adminFacade.services();
      this.products = this.adminFacade.products();
      this.collaborators = this.adminFacade.collaborators();
      this.customers = this.adminFacade.customers();
      this.filteredAppointmentCustomers = [...this.customers];
      this.settingsForm = {
        name: this.tenant?.name,
        publicDomain: this.tenant?.publicDomain || "",
        primaryColor: this.tenant?.primaryColor,
        accentColor: this.tenant?.accentColor,
        bookingMode: this.tenant?.bookingMode,
        publicTitle: this.tenant?.publicTitle ?? this.tenant?.name ?? "",
        publicDescription:
          this.tenant?.publicDescription ||
          "Esperienza pubblica con palette servizi, catalogo reale e disponibilita dinamica per collaboratore.",
        publicStepsText: Array.isArray(this.tenant?.publicSteps)
          ? this.tenant.publicSteps.join("\n")
          : "Servizio|Palette e catalogo reale dal tenant\nCollaboratore|Disponibilita live del team\nConferma|Prenotazione persistita e notificata",
        logoUrl: this.tenant?.logoUrl || "",
        coverUrl: this.tenant?.coverUrl || "",
        publicEnabled: this.tenant?.publicEnabled,
        holidays: Array.isArray(this.tenant?.holidays)
          ? this.tenant.holidays.map((holiday: any) => ({
              date: new Date(holiday.date).toISOString().slice(0, 10),
              name: holiday.name || "",
            }))
          : [],
      };

      if (!this.appointmentForm.serviceId && this.services[0]) {
        this.appointmentForm.serviceId = this.services[0].id;
      }

      void this.loadDashboardActivity(true);
    } catch (error: any) {
      if (error?.status === 401) {
        this.rememberRequestedUrl();
        this.logout();
        return;
      }
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Errore nel caricamento dashboard";
    }
  }

  async refreshCurrentView(): Promise<void> {
    if (this.activeView === "appointments") {
      await this.refreshShell();
      await this.appointmentsFeaturePage?.reloadViewData();
      return;
    }

    await this.refreshAll();
  }

  startAppointmentFlow(): void {
    if (this.activeView === "appointments") {
      this.appointmentsFeaturePage?.prepareNewAppointment();
      return;
    }

    this.prepareNewAppointment();
  }

  private async refreshShell(): Promise<void> {
    try {
      const state = await this.adminFacade.refreshShell();
      this.loading = this.adminFacade.loading();
      this.feedback = this.adminFacade.feedback();
      this.currentUser = this.adminFacade.currentUser();

      if (state.mode === "unauthenticated") {
        return;
      }

      this.syncRouteWithUser();

      if (state.mode === "platform") {
        this.activeView = "platform";
        this.platformTenants = this.adminFacade.platformTenants();
        this.platformPlans = this.adminFacade.platformPlans();
        this.platformSubscriptions = this.adminFacade.platformSubscriptions();
        return;
      }

      this.tenant = this.adminFacade.tenant();
    } catch (error: any) {
      if (error?.status === 401) {
        this.rememberRequestedUrl();
        this.logout();
        return;
      }

      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Errore nel caricamento contesto admin";
    }
  }

  private async loadPlatformAdminData(): Promise<void> {
    const { tenants, plans, subscriptions }: any = await firstValueFrom(
      this.adminApi.loadPlatformData(),
    );

    this.platformTenants = tenants as any[];
    this.platformPlans = plans as any[];
    this.platformSubscriptions = subscriptions as any[];

    if (
      this.selectedPlatformTenant &&
      !this.platformTenants.some(
        (tenant) => tenant.id === this.selectedPlatformTenant.id,
      )
    ) {
      this.selectedPlatformTenant = null;
      this.platformTenantForm = this.emptyPlatformTenantForm();
      this.platformHealthCheck = null;
      this.platformExportJson = "";
      this.platformImportJson = "";
      this.platformExportCsv = "";
      this.platformImportCsv = "";
    }
  }

  selectView(view: ViewKey): void {
    this.activeView = view;
    if (view === "platform") {
      void this.router.navigate(["/platform"]);
    } else {
      void this.router.navigate([`/${view}`]);
    }
    if (window.innerWidth < 1024) {
      this.sidebarOpen = false;
    }
  }

  toggleSidebarCollapsed(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  prepareNewAppointment(): void {
    this.activeView = "appointments";
    this.appointmentForm = this.emptyAppointmentForm();
    this.appointmentCustomerSearch = "";
    this.filteredAppointmentCustomers = [...this.customers];
    this.appointmentSelectedDate = new Date().toISOString().slice(0, 10);
    this.appointmentSlots = [];
    if (this.services[0]) {
      this.appointmentForm.serviceId = this.services[0].id;
    }
    if (window.innerWidth < 1024) {
      this.sidebarOpen = false;
    }
  }

  onMediaSelected(event: Event, kind: "logo" | "cover"): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] || null;

    if (kind === "logo") {
      this.selectedLogoFile = file;
    } else {
      this.selectedCoverFile = file;
    }

    if (!file) {
      if (kind === "logo") {
        this.logoPreviewUrl = "";
      } else {
        this.coverPreviewUrl = "";
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (kind === "logo") {
        this.logoPreviewUrl = result;
      } else {
        this.coverPreviewUrl = result;
      }
    };
    reader.readAsDataURL(file);
  }

  async uploadMedia(kind: "logo" | "cover"): Promise<void> {
    const file =
      kind === "logo" ? this.selectedLogoFile : this.selectedCoverFile;

    if (!file) {
      return;
    }

    this.loading = true;

    try {
      const formData = new FormData();
      formData.append("file", file);

      const updated: any = await this.http
        .post(`${this.apiUrl}/tenant/${kind}`, formData, this.authHeaders())
        .toPromise();

      if (kind === "logo") {
        this.settingsForm.logoUrl =
          updated?.logoUrl || this.settingsForm.logoUrl;
        this.selectedLogoFile = null;
        this.logoPreviewUrl = "";
      } else {
        this.settingsForm.coverUrl =
          updated?.coverUrl || this.settingsForm.coverUrl;
        this.selectedCoverFile = null;
        this.coverPreviewUrl = "";
      }

      this.tenant = {
        ...(this.tenant || {}),
        logoUrl: updated?.logoUrl ?? this.tenant?.logoUrl,
        coverUrl: updated?.coverUrl ?? this.tenant?.coverUrl,
      };
      this.showUploadFeedback(
        kind,
        "success",
        kind === "logo"
          ? "Logo caricato con successo"
          : "Cover caricata con successo",
      );
    } catch (error: any) {
      this.showUploadFeedback(
        kind,
        "error",
        error?.error?.message ||
          error?.message ||
          (kind === "logo"
            ? "Upload logo non riuscito"
            : "Upload cover non riuscito"),
      );
    } finally {
      this.loading = false;
    }
  }

  private showUploadFeedback(
    target: "logo" | "cover",
    kind: "success" | "error",
    message: string,
  ): void {
    if (this.uploadFeedbackTimer) {
      clearTimeout(this.uploadFeedbackTimer);
    }
    this.uploadFeedback = { target, kind, message };
    this.uploadFeedbackTimer = setTimeout(() => {
      this.uploadFeedback = null;
      this.uploadFeedbackTimer = null;
    }, 4000);
  }

  async deleteMedia(kind: "logo" | "cover"): Promise<void> {
    this.loading = true;

    try {
      const updated: any = await this.http
        .delete(`${this.apiUrl}/tenant/${kind}`, this.authHeaders())
        .toPromise();

      if (kind === "logo") {
        this.settingsForm.logoUrl = "";
        this.selectedLogoFile = null;
        this.logoPreviewUrl = "";
      } else {
        this.settingsForm.coverUrl = "";
        this.selectedCoverFile = null;
        this.coverPreviewUrl = "";
      }

      this.tenant = {
        ...(this.tenant || {}),
        logoUrl: updated?.logoUrl ?? null,
        coverUrl: updated?.coverUrl ?? null,
      };

      this.showUploadFeedback(
        kind,
        "success",
        kind === "logo" ? "Logo rimosso" : "Cover rimossa",
      );
    } catch (error: any) {
      this.showUploadFeedback(
        kind,
        "error",
        error?.error?.message ||
          error?.message ||
          (kind === "logo"
            ? "Rimozione logo non riuscita"
            : "Rimozione cover non riuscita"),
      );
    } finally {
      this.loading = false;
    }
  }

  resetSettingsToDefaults(): void {
    this.settingsForm = {
      ...this.settingsForm,
      primaryColor: "#1c7c64",
      accentColor: "#f97316",
      bookingMode: "hybrid",
      publicTitle:
        this.settingsForm.name || this.tenant?.name || "Prenota online",
      publicDescription:
        "Esperienza pubblica con palette servizi, catalogo reale e disponibilita dinamica per collaboratore.",
      publicStepsText:
        "Servizio|Palette e catalogo reale dal tenant\nCollaboratore|Disponibilita live del team\nConferma|Prenotazione persistita e notificata",
      logoUrl: "",
      coverUrl: "",
      holidays: [],
    };
    this.selectedLogoFile = null;
    this.selectedCoverFile = null;
    this.logoPreviewUrl = "";
    this.coverPreviewUrl = "";
  }

  editAppointment(appointment: any): void {
    const startsAt = new Date(appointment.startsAt);
    this.activeView = "appointments";
    this.appointmentForm = {
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
    };
    this.appointmentCustomerSearch = this.appointmentCustomerOptionLabel(
      appointment.customer,
    );
    this.filteredAppointmentCustomers = [...this.customers];
    this.appointmentSelectedDate = this.toDateInputValue(startsAt);
    this.updateAppointmentSlots();
  }

  filterAppointmentCustomers(): void {
    const query = this.appointmentCustomerSearch.trim().toLowerCase();

    if (!query) {
      this.filteredAppointmentCustomers = [...this.customers];
      return;
    }

    this.filteredAppointmentCustomers = this.customers.filter((customer) => {
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
    });
  }

  handleAppointmentCustomerInput(value: string): void {
    this.appointmentCustomerSearch = value;
    this.filterAppointmentCustomers();

    const customer = this.customers.find(
      (entry) => this.appointmentCustomerOptionLabel(entry) === value,
    );

    if (!customer) {
      this.appointmentForm.customerId = "";
      this.appointmentForm.customerName = "";
      this.appointmentForm.email = "";
      this.appointmentForm.phone = "";
      return;
    }

    this.appointmentForm.customerId = customer.id;

    this.appointmentForm.customerName = `${customer.firstName} ${customer.lastName}`;
    this.appointmentForm.email = customer.email || "";
    this.appointmentForm.phone = customer.phone || "";
    this.appointmentCustomerSearch =
      this.appointmentCustomerOptionLabel(customer);
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

  updateAppointmentSlots(): void {
    if (
      this.appointmentForm.collaboratorId &&
      !this.appointmentCollaboratorOptions.some(
        (option) => option.value === this.appointmentForm.collaboratorId,
      )
    ) {
      this.appointmentForm.collaboratorId = "";
    }

    const service = this.services.find(
      (item) => item.id === this.appointmentForm.serviceId,
    );
    const collaboratorId = this.appointmentForm.collaboratorId;
    const currentAppointmentId = this.appointmentForm.id;
    const currentSelected = this.appointmentForm.startsAt;
    const currentIsOnSelectedDate =
      Boolean(currentSelected) &&
      currentSelected.startsWith(`${this.appointmentSelectedDate}T`);

    // Senza servizio, data o collaboratore non possiamo proporre la griglia
    // degli slot. Se stiamo modificando un appuntamento esistente conserviamo
    // comunque l'orario reale (es. ordine rapido senza collaboratore).
    if (!service || !this.appointmentSelectedDate || !collaboratorId) {
      const preserved = this.preserveCurrentAppointmentSlot(
        [],
        currentAppointmentId,
        currentSelected,
        currentIsOnSelectedDate,
      );
      this.appointmentSlots = preserved;
      if (!preserved.some((slot) => slot.startsAt === currentSelected)) {
        this.appointmentForm.startsAt = "";
      }
      return;
    }

    const durationMinutes = Number(service.durationMinutes || 30);
    const dayStart = new Date(`${this.appointmentSelectedDate}T00:00`);
    const dayEnd = new Date(`${this.appointmentSelectedDate}T23:59:59`);
    const slots: Array<{ startsAt: string; label: string }> = [];

    for (let hour = 9; hour < 19; hour += 1) {
      for (const minute of [0, 30]) {
        const startsAt = new Date(dayStart);
        startsAt.setHours(hour, minute, 0, 0);
        const endsAt = new Date(startsAt.getTime() + durationMinutes * 60000);

        if (endsAt > dayEnd) {
          continue;
        }

        if (
          endsAt.getHours() > 19 ||
          (endsAt.getHours() === 19 && endsAt.getMinutes() > 0)
        ) {
          continue;
        }

        const hasConflict = this.appointments.some((appointment) => {
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
    this.appointmentSlots = slots;

    if (!slots.some((slot) => slot.startsAt === currentSelected)) {
      this.appointmentForm.startsAt = "";
    }
  }

  /**
   * Conserva l'orario reale degli appuntamenti generati dagli ordini rapidi
   * (Now() - durata servizi) anche quando non cade sulla griglia di 30 minuti,
   * cosi modificarli non obbliga a reinserire l'ora.
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

  openDeleteDialog(
    title: string,
    body: string,
    confirmLabel: string,
    action: () => Promise<void>,
  ): void {
    this.confirmDialog = {
      title,
      body,
      confirmLabel,
      running: false,
      action,
    };
  }

  closeConfirmDialog(): void {
    if (this.confirmDialog?.running) {
      return;
    }

    this.confirmDialog = null;
  }

  async runConfirmDialog(): Promise<void> {
    if (!this.confirmDialog?.action || this.confirmDialog.running) {
      return;
    }

    this.confirmDialog.running = true;

    try {
      await this.confirmDialog.action();
      this.confirmDialog = null;
    } catch {
      if (this.confirmDialog) {
        this.confirmDialog.running = false;
      }
    }
  }

  editService(service: any): void {
    this.serviceForm = {
      id: service.id,
      name: service.name,
      publicDescription: service.publicDescription || "",
      durationMinutes: Number(service.durationMinutes || 30),
      basePrice: Number(service.basePrice || 0),
      color: service.color || "#1c7c64",
      isPublic: Boolean(service.isPublic),
      isBookableOnline: Boolean(service.isBookableOnline),
      serviceProducts: Array.isArray(service.serviceProducts)
        ? service.serviceProducts
        : [],
    };
    this.serviceProductForm = {
      productId: "",
      mode: "optional",
      quantity: 1,
      priceLocked: false,
    };
  }

  editProduct(product: any): void {
    this.productForm = {
      id: product.id,
      name: product.name || "",
      description: product.description || "",
      price:
        product.price === null || product.price === undefined
          ? null
          : Number(product.price),
    };
  }

  editCollaborator(collaborator: any): void {
    this.collaboratorForm = {
      id: collaborator.id,
      firstName: collaborator.firstName,
      lastName: collaborator.lastName,
      email: collaborator.email || "",
      phone: collaborator.phone || "",
      calendarColor: collaborator.calendarColor || "#1c7c64",
      isPublic: Boolean(collaborator.isPublic),
      weeklySchedules: Array.from({ length: 7 }, (_, weekday) => {
        const schedule = (collaborator.weeklySchedules || []).find(
          (entry: any) => entry.weekday === weekday,
        );
        return {
          weekday,
          isWorkingDay: schedule ? Boolean(schedule.isWorkingDay) : weekday < 5,
          startTime: schedule?.startTime || "09:00",
          endTime: schedule?.endTime || "19:00",
        };
      }),
      dayOverrides: (collaborator.dayOverrides || []).map((override: any) => ({
        date: new Date(override.date).toISOString().slice(0, 10),
        isWorkingDay: Boolean(override.isWorkingDay),
        startTime: override.startTime || "09:00",
        endTime: override.endTime || "19:00",
        note: override.note || "",
        isHoliday: Boolean(override.isHoliday),
      })),
    };
  }

  async editCustomer(customer: any): Promise<void> {
    this.customerForm = {
      id: customer.id,
      firstName: customer.firstName || "",
      lastName: customer.lastName || "",
      email: customer.email || "",
      phone: customer.phone || "",
      tagsText: Array.isArray(customer.tags) ? customer.tags.join(", ") : "",
      notes: customer.notes || "",
    };
    this.customerHistory = null;
    this.customerHistoryLoading = true;
    try {
      this.customerHistory = await firstValueFrom(
        this.adminApi.loadCustomerHistory(customer.id),
      );
    } catch (error: any) {
      this.feedback =
        error?.error?.message || "Storico cliente non disponibile";
    } finally {
      this.customerHistoryLoading = false;
    }
  }

  resetCustomerForm(): void {
    this.customerForm = this.emptyCustomerForm();
    this.customerHistory = null;
    this.customerHistoryLoading = false;
  }

  async selectPlatformTenant(tenant: any): Promise<void> {
    this.selectedPlatformTenant = tenant;
    this.platformTenantForm = {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      publicDomain: tenant.publicDomain || "",
      publicEnabled: Boolean(tenant.publicEnabled),
      bookingMode: tenant.bookingMode,
      notes: tenant.notes || "",
    };
    this.platformExportJson = "";
    this.platformImportJson = "";
    this.platformExportCsv = "";
    this.platformImportCsv = "";
    this.platformSubscriptionForm.planId = this.platformPlans[0]?.id || "";
    this.platformHealthCheck = await firstValueFrom(
      this.adminApi.tenantHealthCheck(tenant.id),
    );
  }

  async saveAppointment(): Promise<void> {
    this.loading = true;
    this.feedback = "";

    try {
      const payload = {
        customerId: this.appointmentForm.customerId || undefined,
        customerName: this.appointmentForm.customerName,
        email: this.appointmentForm.email,
        phone: this.appointmentForm.phone,
        serviceId: this.appointmentForm.serviceId,
        collaboratorId: this.appointmentForm.collaboratorId || undefined,
        startsAt: new Date(this.appointmentForm.startsAt).toISOString(),
        status: this.appointmentForm.status,
        customerNotes: this.appointmentForm.customerNotes,
      };

      if (this.appointmentForm.id) {
        await this.http
          .patch(
            `${this.apiUrl}/appointments/${this.appointmentForm.id}`,
            payload,
            this.authHeaders(),
          )
          .toPromise();
      } else {
        await this.http
          .post(`${this.apiUrl}/appointments`, payload, this.authHeaders())
          .toPromise();
      }

      this.feedback = this.appointmentForm.id
        ? "Appuntamento aggiornato"
        : "Appuntamento creato";
      this.prepareNewAppointment();
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message || error?.message || "Salvataggio non riuscito";
    } finally {
      this.loading = false;
    }
  }

  async cancelAppointment(): Promise<void> {
    if (!this.appointmentForm.id) {
      return;
    }

    this.loading = true;

    try {
      await this.http
        .post(
          `${this.apiUrl}/appointments/${this.appointmentForm.id}/cancel`,
          { reason: "Annullato da dashboard admin" },
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Appuntamento annullato";
      this.prepareNewAppointment();
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message || error?.message || "Annullamento non riuscito";
    } finally {
      this.loading = false;
    }
  }

  removeAppointment(): void {
    if (!this.appointmentForm.id) {
      return;
    }

    this.openDeleteDialog(
      "Eliminare questo appuntamento?",
      `Stai per eliminare l'appuntamento di ${this.appointmentForm.customerName || "questo cliente"}.`,
      "Elimina appuntamento",
      async () => {
        this.loading = true;

        try {
          await this.http
            .delete(
              `${this.apiUrl}/appointments/${this.appointmentForm.id}`,
              this.authHeaders(),
            )
            .toPromise();
          this.feedback = "Appuntamento eliminato";
          this.prepareNewAppointment();
          await this.refreshAll();
        } catch (error: any) {
          this.feedback =
            error?.error?.message ||
            error?.message ||
            "Eliminazione appuntamento non riuscita";
          throw error;
        } finally {
          this.loading = false;
        }
      },
    );
  }

  async saveSettings(): Promise<void> {
    this.loading = true;

    try {
      if (this.selectedLogoFile) {
        await this.uploadMedia("logo");
        this.loading = true; // reset to true since uploadMedia sets it to false
      }
      if (this.selectedCoverFile) {
        await this.uploadMedia("cover");
        this.loading = true;
      }

      await this.http
        .patch(
          `${this.apiUrl}/tenant/settings`,
          {
            name: this.settingsForm.name,
            publicDomain: this.settingsForm.publicDomain,
            primaryColor: this.settingsForm.primaryColor,
            accentColor: this.settingsForm.accentColor,
            bookingMode: this.settingsForm.bookingMode,
            publicTitle: this.settingsForm.publicTitle,
            publicDescription: this.settingsForm.publicDescription,
            publicSteps: this.settingsForm.publicStepsText
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
            logoUrl: this.settingsForm.logoUrl || null,
            coverUrl: this.settingsForm.coverUrl || null,
            publicEnabled: this.settingsForm.publicEnabled,
            holidays: (this.settingsForm.holidays || [])
              .filter((holiday) => holiday.date && holiday.name)
              .map((holiday) => ({
                date: holiday.date,
                name: holiday.name,
              })),
          },
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Impostazioni tenant aggiornate";
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Aggiornamento impostazioni non riuscito";
    } finally {
      this.loading = false;
    }
  }

  resetPlatformPlanForm(): void {
    this.platformPlanForm = this.emptyPlatformPlanForm();
  }

  async savePlatformTenant(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.loading = true;
    try {
      await this.http
        .patch(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}`,
          this.platformTenantForm,
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Tenant aggiornato";
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Aggiornamento tenant non riuscito";
    } finally {
      this.loading = false;
    }
  }

  async suspendSelectedTenant(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.loading = true;
    try {
      await this.http
        .post(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}/suspend`,
          { reason: "Sospeso da console platform" },
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Tenant sospeso";
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Sospensione tenant non riuscita";
    } finally {
      this.loading = false;
    }
  }

  async reactivateSelectedTenant(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.loading = true;
    try {
      await this.http
        .post(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}/reactivate`,
          {},
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Tenant riattivato";
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Riattivazione tenant non riuscita";
    } finally {
      this.loading = false;
    }
  }

  async resetSelectedTenantData(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.loading = true;
    try {
      this.platformHealthCheck = await this.http
        .post(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}/reset-data`,
          {},
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Dati tenant resettati";
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Reset dati tenant non riuscito";
    } finally {
      this.loading = false;
    }
  }

  async deleteSelectedTenant(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.openDeleteDialog(
      "Eliminare questo tenant?",
      `Stai per eliminare il tenant ${this.selectedPlatformTenant.name}.`,
      "Elimina tenant",
      async () => {
        this.loading = true;
        try {
          await this.http
            .delete(
              `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}`,
              this.authHeaders(),
            )
            .toPromise();
          this.feedback = "Tenant eliminato";
          this.selectedPlatformTenant = null;
          this.platformTenantForm = this.emptyPlatformTenantForm();
          this.platformHealthCheck = null;
          await this.refreshAll();
        } catch (error: any) {
          this.feedback =
            error?.error?.message ||
            error?.message ||
            "Eliminazione tenant non riuscita";
          throw error;
        } finally {
          this.loading = false;
        }
      },
    );
  }

  async exportSelectedTenant(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.loading = true;
    try {
      const exported = await this.http
        .get(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}/export`,
          this.authHeaders(),
        )
        .toPromise();
      this.platformExportJson = JSON.stringify(exported, null, 2);
      this.feedback = "Export JSON generato";
    } catch (error: any) {
      this.feedback =
        error?.error?.message || error?.message || "Export tenant non riuscito";
    } finally {
      this.loading = false;
    }
  }

  async exportSelectedTenantCsv(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.loading = true;
    try {
      const exported = await this.http
        .get(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}/export?format=csv`,
          this.authHeaders(),
        )
        .toPromise();
      this.platformExportCsv = JSON.stringify(exported, null, 2);
      this.feedback = "Export CSV generato";
    } catch (error: any) {
      this.feedback =
        error?.error?.message || error?.message || "Export CSV non riuscito";
    } finally {
      this.loading = false;
    }
  }

  async importSelectedTenant(): Promise<void> {
    if (!this.selectedPlatformTenant || !this.platformImportJson.trim()) return;
    this.loading = true;
    try {
      const payload = JSON.parse(this.platformImportJson);
      this.platformHealthCheck = await this.http
        .post(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}/import?mode=replace`,
          payload,
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Import JSON completato";
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message || error?.message || "Import tenant non riuscito";
    } finally {
      this.loading = false;
    }
  }

  async importSelectedTenantCsv(): Promise<void> {
    if (!this.selectedPlatformTenant || !this.platformImportCsv.trim()) return;
    this.loading = true;
    try {
      const payload = JSON.parse(this.platformImportCsv);
      this.platformHealthCheck = await this.http
        .post(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}/import?mode=replace&format=csv`,
          payload,
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Import CSV completato";
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message || error?.message || "Import CSV non riuscito";
    } finally {
      this.loading = false;
    }
  }

  editPlatformPlan(plan: any): void {
    this.platformPlanForm = {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      price: Number(plan.price || 0),
      billingInterval: plan.billingInterval,
    };
  }

  async savePlatformPlan(): Promise<void> {
    this.loading = true;
    try {
      if (this.platformPlanForm.id) {
        await this.http
          .patch(
            `${this.apiUrl}/platform-admin/plans/${this.platformPlanForm.id}`,
            this.platformPlanForm,
            this.authHeaders(),
          )
          .toPromise();
      } else {
        await this.http
          .post(
            `${this.apiUrl}/platform-admin/plans`,
            this.platformPlanForm,
            this.authHeaders(),
          )
          .toPromise();
      }
      this.feedback = this.platformPlanForm.id
        ? "Piano aggiornato"
        : "Piano creato";
      this.resetPlatformPlanForm();
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Salvataggio piano non riuscito";
    } finally {
      this.loading = false;
    }
  }

  async savePlatformSubscription(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.loading = true;
    try {
      await this.http
        .post(
          `${this.apiUrl}/platform-admin/subscriptions`,
          {
            tenantId: this.selectedPlatformTenant.id,
            planId: this.platformSubscriptionForm.planId,
            status: this.platformSubscriptionForm.status,
          },
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Subscription assegnata";
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Assegnazione subscription non riuscita";
    } finally {
      this.loading = false;
    }
  }

  resetServiceForm(): void {
    this.serviceForm = this.emptyServiceForm();
    this.resetServiceProductForm();
  }

  resetProductForm(): void {
    this.productForm = this.emptyProductForm();
  }

  resetCollaboratorForm(): void {
    this.collaboratorForm = this.emptyCollaboratorForm();
  }

  async loadRevenueReport(): Promise<void> {
    this.loading = true;
    try {
      const [report] = await Promise.all([
        firstValueFrom(this.adminApi.loadRevenueReport(this.revenueFilters)),
        this.loadDashboardActivity(true),
      ]);
      this.revenueReport = report;
      this.revenueMetrics = this.revenueReport?.metrics || [];
      this.adminFacade.setRevenueReport(this.revenueReport);
    } catch (error: any) {
      this.feedback =
        error?.error?.message || "Caricamento fatturato non riuscito";
    } finally {
      this.loading = false;
    }
  }

  async loadDashboardActivity(reset = false): Promise<void> {
    if (this.dashboardActivityLoading) {
      return;
    }

    this.dashboardActivityLoading = true;
    if (reset) {
      this.dashboardActivityPage = 1;
      this.dashboardActivity = [];
    }

    try {
      const response = await firstValueFrom(
        this.adminApi.loadDashboardActivity(
          this.revenueFilters,
          this.dashboardActivityPage,
        ),
      );
      const items = Array.isArray(response?.items) ? response.items : [];
      this.dashboardActivity = reset
        ? items
        : [...this.dashboardActivity, ...items];
      this.dashboardActivityHasMore = Boolean(response?.hasMore);
    } catch (error: any) {
      this.feedback =
        error?.error?.message || "Caricamento movimenti non riuscito";
    } finally {
      this.dashboardActivityLoading = false;
    }
  }

  async loadMoreDashboardActivity(): Promise<void> {
    if (!this.dashboardActivityHasMore || this.dashboardActivityLoading) {
      return;
    }

    this.dashboardActivityPage += 1;
    await this.loadDashboardActivity();
  }

  resetRevenueFilters(): void {
    this.revenueFilters = {
      period: "month",
      date: new Date().toISOString().slice(0, 10),
      customerId: "",
      collaboratorId: "",
    };
    void this.loadRevenueReport();
  }

  async saveQuickOrder(payload: Record<string, unknown>): Promise<void> {
    this.loading = true;
    try {
      await firstValueFrom(this.adminApi.createSale(payload));
      this.closeQuickOrder();
      this.feedback = "Ordine registrato";
      await this.refreshAll();
      await this.loadRevenueReport();
    } catch (error: any) {
      this.feedback =
        error?.error?.message || "Registrazione ordine non riuscita";
    } finally {
      this.loading = false;
    }
  }

  openQuickOrder(appointment: any = null): void {
    this.quickOrderAppointment = appointment;
    this.quickOrderOpen = true;
  }

  closeQuickOrder(): void {
    this.quickOrderOpen = false;
    this.quickOrderAppointment = null;
  }

  resetServiceProductForm(): void {
    this.serviceProductForm = {
      productId: "",
      mode: "optional",
      quantity: 1,
      priceLocked: false,
    };
  }

  async attachProductToService(): Promise<void> {
    if (!this.serviceForm.id || !this.serviceProductForm.productId) {
      this.feedback = "Salva prima il servizio e seleziona un prodotto";
      return;
    }

    this.loading = true;

    try {
      await this.http
        .post(
          `${this.apiUrl}/services/${this.serviceForm.id}/products`,
          {
            productId: this.serviceProductForm.productId,
            mode: this.serviceProductForm.mode,
            quantity: Number(this.serviceProductForm.quantity || 1),
            priceLocked: this.serviceProductForm.priceLocked,
          },
          this.authHeaders(),
        )
        .toPromise();

      this.feedback = "Prodotto collegato al servizio";
      const serviceId = this.serviceForm.id;
      this.resetServiceProductForm();
      await this.refreshAll();
      const updated = this.services.find((service) => service.id === serviceId);
      if (updated) {
        this.editService(updated);
      }
    } catch (error: any) {
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Collegamento prodotto non riuscito";
    } finally {
      this.loading = false;
    }
  }

  async detachProductFromService(productId: string): Promise<void> {
    if (!this.serviceForm.id) {
      return;
    }

    this.loading = true;

    try {
      await this.http
        .delete(
          `${this.apiUrl}/services/${this.serviceForm.id}/products/${productId}`,
          this.authHeaders(),
        )
        .toPromise();

      this.feedback = "Prodotto rimosso dal servizio";
      const serviceId = this.serviceForm.id;
      await this.refreshAll();
      const updated = this.services.find((service) => service.id === serviceId);
      if (updated) {
        this.editService(updated);
      }
    } catch (error: any) {
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Rimozione prodotto non riuscita";
    } finally {
      this.loading = false;
    }
  }

  async saveService(): Promise<void> {
    this.loading = true;

    try {
      const payload = {
        name: this.serviceForm.name,
        publicDescription: this.serviceForm.publicDescription,
        durationMinutes: Number(this.serviceForm.durationMinutes),
        basePrice: Number(this.serviceForm.basePrice),
        color: this.serviceForm.color,
        isPublic: this.serviceForm.isPublic,
        isBookableOnline: this.serviceForm.isBookableOnline,
      };

      if (this.serviceForm.id) {
        await this.http
          .patch(
            `${this.apiUrl}/services/${this.serviceForm.id}`,
            payload,
            this.authHeaders(),
          )
          .toPromise();
      } else {
        await this.http
          .post(`${this.apiUrl}/services`, payload, this.authHeaders())
          .toPromise();
      }

      this.feedback = this.serviceForm.id
        ? "Servizio aggiornato"
        : "Servizio creato";
      this.serviceForm = this.emptyServiceForm();
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Salvataggio servizio non riuscito";
    } finally {
      this.loading = false;
    }
  }

  async saveProduct(): Promise<void> {
    if (!this.productForm.name?.trim()) {
      this.feedback = "Inserisci il nome del prodotto";
      return;
    }
    this.loading = true;
    try {
      await firstValueFrom(
        this.adminApi.createOrUpdateProduct(this.productForm.id, {
          name: this.productForm.name.trim(),
          description: this.productForm.description || undefined,
          price:
            this.productForm.price === null ||
            String(this.productForm.price).trim() === ""
              ? null
              : Number(this.productForm.price),
        }),
      );
      this.feedback = this.productForm.id
        ? "Prodotto aggiornato"
        : "Prodotto creato";
      this.resetProductForm();
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message || "Salvataggio prodotto non riuscito";
    } finally {
      this.loading = false;
    }
  }

  removeProduct(): void {
    if (!this.productForm.id) return;
    this.openDeleteDialog(
      "Eliminare questo prodotto?",
      `Stai per eliminare ${this.productForm.name || "il prodotto selezionato"}.`,
      "Elimina prodotto",
      async () => {
        this.loading = true;
        try {
          await firstValueFrom(
            this.adminApi.deleteProduct(this.productForm.id),
          );
          this.feedback = "Prodotto eliminato";
          this.resetProductForm();
          await this.refreshAll();
        } finally {
          this.loading = false;
        }
      },
    );
  }

  async removeService(): Promise<void> {
    if (!this.serviceForm.id) {
      return;
    }

    this.openDeleteDialog(
      "Eliminare questo servizio?",
      `Stai per eliminare il servizio ${this.serviceForm.name || "selezionato"}.`,
      "Elimina servizio",
      async () => {
        this.loading = true;

        try {
          await this.http
            .delete(
              `${this.apiUrl}/services/${this.serviceForm.id}`,
              this.authHeaders(),
            )
            .toPromise();
          this.feedback = "Servizio eliminato";
          this.serviceForm = this.emptyServiceForm();
          await this.refreshAll();
        } catch (error: any) {
          this.feedback =
            error?.error?.message ||
            error?.message ||
            "Eliminazione servizio non riuscita";
          throw error;
        } finally {
          this.loading = false;
        }
      },
    );
  }

  async saveCollaborator(): Promise<void> {
    this.loading = true;

    try {
      const payload = {
        firstName: this.collaboratorForm.firstName,
        lastName: this.collaboratorForm.lastName,
        email: this.collaboratorForm.email || undefined,
        phone: this.collaboratorForm.phone || undefined,
        calendarColor: this.collaboratorForm.calendarColor,
        isPublic: this.collaboratorForm.isPublic,
        weeklySchedules: (this.collaboratorForm.weeklySchedules || []).map(
          (schedule: any) => ({
            weekday: Number(schedule.weekday),
            isWorkingDay: Boolean(schedule.isWorkingDay),
            startTime: schedule.isWorkingDay ? schedule.startTime : null,
            endTime: schedule.isWorkingDay ? schedule.endTime : null,
          }),
        ),
        dayOverrides: (this.collaboratorForm.dayOverrides || [])
          .filter((override: any) => override.date)
          .map((override: any) => ({
            date: override.date,
            isWorkingDay: Boolean(override.isWorkingDay),
            startTime: override.isWorkingDay ? override.startTime : null,
            endTime: override.isWorkingDay ? override.endTime : null,
            note: override.note || null,
            isHoliday: Boolean(override.isHoliday),
          })),
      };

      if (this.collaboratorForm.id) {
        await this.http
          .patch(
            `${this.apiUrl}/collaborators/${this.collaboratorForm.id}`,
            payload,
            this.authHeaders(),
          )
          .toPromise();
      } else {
        await this.http
          .post(`${this.apiUrl}/collaborators`, payload, this.authHeaders())
          .toPromise();
      }

      this.feedback = this.collaboratorForm.id
        ? "Collaboratore aggiornato"
        : "Collaboratore creato";
      this.collaboratorForm = this.emptyCollaboratorForm();
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Salvataggio collaboratore non riuscito";
    } finally {
      this.loading = false;
    }
  }

  async setDefaultCollaborator(collaboratorId: string): Promise<void> {
    this.loading = true;

    try {
      await this.http
        .patch(
          `${this.apiUrl}/tenant/settings`,
          {
            ...this.settingsForm,
            defaultCollaboratorId: collaboratorId,
          },
          this.authHeaders(),
        )
        .toPromise();

      this.feedback = "Collaboratore default aggiornato";
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Aggiornamento collaboratore default non riuscito";
    } finally {
      this.loading = false;
    }
  }

  async removeCollaborator(): Promise<void> {
    if (!this.collaboratorForm.id) {
      return;
    }

    if (this.isDefaultCollaborator(this.collaboratorForm.id)) {
      this.feedback =
        "Questo collaboratore e il default del tenant. Impostane un altro come default prima di eliminarlo.";
      return;
    }

    this.openDeleteDialog(
      "Eliminare questo collaboratore?",
      `Stai per eliminare ${this.collaboratorForm.firstName || "questo"} ${this.collaboratorForm.lastName || "collaboratore"}.`,
      "Elimina collaboratore",
      async () => {
        this.loading = true;

        try {
          await this.http
            .delete(
              `${this.apiUrl}/collaborators/${this.collaboratorForm.id}`,
              this.authHeaders(),
            )
            .toPromise();
          this.feedback = "Collaboratore eliminato";
          this.collaboratorForm = this.emptyCollaboratorForm();
          await this.refreshAll();
        } catch (error: any) {
          this.feedback =
            error?.error?.message ||
            error?.message ||
            "Eliminazione collaboratore non riuscita";
          throw error;
        } finally {
          this.loading = false;
        }
      },
    );
  }

  async saveCustomer(): Promise<void> {
    this.loading = true;

    try {
      const payload = {
        firstName: this.customerForm.firstName,
        lastName: this.customerForm.lastName,
        email: this.customerForm.email || undefined,
        phone: this.customerForm.phone || undefined,
        notes: this.customerForm.notes || undefined,
        tags: this.customerForm.tagsText
          .split(",")
          .map((tag: string) => tag.trim())
          .filter(Boolean),
      };

      if (this.customerForm.id) {
        await this.http
          .patch(
            `${this.apiUrl}/customers/${this.customerForm.id}`,
            payload,
            this.authHeaders(),
          )
          .toPromise();
      } else {
        await this.http
          .post(`${this.apiUrl}/customers`, payload, this.authHeaders())
          .toPromise();
      }

      this.feedback = this.customerForm.id
        ? "Cliente aggiornato"
        : "Cliente creato";
      this.resetCustomerForm();
      await this.refreshAll();
    } catch (error: any) {
      this.feedback =
        error?.error?.message ||
        error?.message ||
        "Salvataggio cliente non riuscito";
    } finally {
      this.loading = false;
    }
  }

  removeCustomer(customer: any): void {
    this.openDeleteDialog(
      "Eliminare questo cliente?",
      `Stai per eliminare ${customer.firstName} ${customer.lastName}.`,
      "Elimina cliente",
      async () => {
        this.loading = true;

        try {
          await this.http
            .delete(
              `${this.apiUrl}/customers/${customer.id}`,
              this.authHeaders(),
            )
            .toPromise();
          this.feedback = "Cliente eliminato";
          if (this.customerForm.id === customer.id) {
            this.resetCustomerForm();
          }
          await this.refreshAll();
        } catch (error: any) {
          this.feedback =
            error?.error?.message ||
            error?.message ||
            "Eliminazione cliente non riuscita";
          throw error;
        } finally {
          this.loading = false;
        }
      },
    );
  }

  logout(): void {
    this.sessionToken = "";
    this.currentUser = null;
    this.adminFacade.clearSession();
    this.feedback = "";
    this.sidebarOpen = false;
    void this.router.navigate(["/login"]);
  }

  formatTime(value: string): string {
    return new Date(value).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  formatAppointmentStatus(status: string): string {
    return status.replace(/_/g, " ");
  }

  appointmentStatusClass(status: string): string {
    switch (status) {
      case "requested":
      case "rescheduled":
        return "status-pill-amber";
      case "confirmed":
      case "checked_in":
        return "status-pill-blue";
      case "completed":
        return "status-pill-green";
      case "cancelled":
      case "no_show":
        return "status-pill-red";
      default:
        return "status-pill-neutral";
    }
  }

  collaboratorStatusClass(isPublic: boolean): string {
    return isPublic ? "status-pill-green" : "status-pill-neutral";
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

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}
