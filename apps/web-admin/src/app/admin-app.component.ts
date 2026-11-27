import { slotOptions } from "./core/slot-options";
import { OperationalContextService } from "./core/operational-context.service";
import { UiConfirmComponent, UiPageComponent } from "@alora/ui";
import type { AdminNavKey } from "./core/admin-navigation";
import { AdminPageHeaderComponent } from "./shell/admin-page-header.component";
import {
  CommonModule,
  DOCUMENT,
  DatePipe,
  DecimalPipe,
  NgClass,
} from "@angular/common";
import { HttpClient } from "@angular/common/http";
import {
  Component,
  DestroyRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { toLocalDateKey } from "@barber/shared/utils";
import { firstValueFrom } from "rxjs";
import { humanError } from "./core/human-error";
import {
  DASHBOARD_REFRESH_MS,
  QUICK_ORDER_DATASETS,
  VIEW_DATASETS,
  splitChanged,
  type AdminDataset,
} from "./core/admin-data-policy";
import { CalendarInputComponent } from "./calendar-input.component";
import { ADMIN_API_URL } from "./core/api-config";
import { AdminApiService } from "./core/admin-api.service";
import { AdminFacade } from "./core/admin.facade";
import { AppointmentOrderNotificationsService } from "./core/appointment-order-notifications.service";
import { SessionStore } from "./core/session.store";
import { AdminAppointmentsFeaturePageComponent } from "./appointments/admin-appointments-feature-page.component";
import { AdminAppointmentsEditorModalComponent } from "./appointments/admin-appointments-editor-modal.component";
import { AppointmentsFacade } from "./appointments/appointments.facade";
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
import { buildQuickOrderCustomerQuery } from "./quick-order/quick-order-customer-query";
import { AdminAuthPanelComponent } from "./auth/admin-auth-panel.component";
import { UiIconComponent } from "./shared/ui-icon.component";
import {
  appointmentStatusLabel,
  bookingModeLabel,
} from "./shared/presentation-copy";
import type { AdminViewKey } from "./core/admin-data-policy";

type ViewKey = AdminViewKey;

/** A sale touches the till, the reports, stock and possibly a new customer. */
const SALE_CHANGED: readonly AdminDataset[] = ["sales", "stats", "products", "customers", "customerOptions"];

@Component({
  selector: "alora-admin-workspace",
  standalone: true,
  imports: [
    CommonModule,
    UiPageComponent,
    UiConfirmComponent,
    AdminPageHeaderComponent,
    FormsModule,
    NgClass,
    DecimalPipe,
    DatePipe,
    CalendarInputComponent,
    CustomSelectComponent,
    AdminAppointmentsFeaturePageComponent,
    AdminAppointmentsEditorModalComponent,
    AdminDashboardPageComponent,
    AdminAppointmentsPageComponent,
    AdminSalesPageComponent,
    AdminCustomersPageComponent,
    AdminServicesPageComponent,
    AdminCollaboratorsPageComponent,
    AdminPlatformPageComponent,
    AdminSettingsPageComponent,
    QuickOrderModalComponent,
    AdminAuthPanelComponent,
    UiIconComponent,
  ],
  providers: [AppointmentsFacade],
  template: `
    <ui-page>
      <barber-quick-order-modal
        *ngIf="quickOrderOpen || quickOrderClosing"
        [class.quick-order-closing]="quickOrderClosing"
        [customers]="quickOrderCustomers"
        [services]="adminData().services"
        [products]="adminData().products"
        [collaborators]="quickOrderCollaborators"
        [defaultCollaboratorId]="
          adminData().tenant?.defaultCollaboratorId || ''
        "
        [appointment]="quickOrderAppointment"
        [sale]="quickOrderSale"
        [loading]="busy"
        (close)="closeQuickOrder()"
        (submitOrder)="saveQuickOrder($event)"
        (retryCreation)="retryQuickOrderCreation()"
        (retryUpdate)="retryQuickOrderUpdate()"
        (customerSearchChange)="searchQuickOrderCustomers($event)"
        (catalogChanged)="changed(['products', 'services'])"
      ></barber-quick-order-modal>
      <barber-admin-appointments-editor-modal
        *ngIf="appointmentsEditorOpen"
        [appointment]="appointmentsEditorAppointment"
        (close)="closeAppointmentsEditor()"
        (saved)="refreshAfterAppointmentChange()"
        (createOrder)="openQuickOrder($event)"
      ></barber-admin-appointments-editor-modal>
      <ui-confirm
        *ngIf="confirmDialog"
        eyebrow="Conferma eliminazione"
        [title]="confirmDialog.title"
        [body]="confirmDialog.body"
        note="Questa operazione non può essere annullata."
        [confirmLabel]="confirmDialog.confirmLabel"
        runningLabel="Eliminazione..."
        [running]="confirmDialog.running"
        (cancel)="closeConfirmDialog()"
        (confirm)="runConfirmDialog()"
      ></ui-confirm>

      <barber-admin-auth-panel *ngIf="!sessionToken"></barber-admin-auth-panel>

      <ng-container *ngIf="sessionToken">
        <alora-page-header [navKey]="headerNavKey" refreshTour="header-refresh" [refreshing]="refreshing" (refresh)="refreshCurrentView()">
          <div
            uiPageActions
            *ngIf="canCreateSomething && (activeView === 'dashboard' || activeView === 'appointments')"
            class="new-menu"
          >
            <button
              type="button"
              class="primary-btn inline-flex items-center gap-2"
              data-tour="header-new"
              aria-haspopup="menu"
              [attr.aria-expanded]="newMenuOpen"
              (click)="onNewClick()"
            >
              <barber-ui-icon name="plus"></barber-ui-icon>
              Nuovo
            </button>
            <div *ngIf="newMenuOpen" class="new-menu-backdrop" (click)="newMenuOpen = false"></div>
            <div *ngIf="newMenuOpen" class="new-menu-panel panel" role="menu">
              <button
                *ngIf="can('sales.manage')"
                type="button"
                role="menuitem"
                class="new-menu-item"
                (click)="newMenuOpen = false; openQuickOrder()"
              >
                <barber-ui-icon name="receipt"></barber-ui-icon>
                <span>
                  <strong>Vendi adesso</strong>
                  <small>Prodotti, servizi o entrambi. I servizi vanno in agenda come appena fatti.</small>
                </span>
              </button>
              <button
                *ngIf="can('appointments.create')"
                type="button"
                role="menuitem"
                class="new-menu-item"
                (click)="newMenuOpen = false; startAppointmentFlow()"
              >
                <barber-ui-icon name="calendar-plus"></barber-ui-icon>
                <span>
                  <strong>Prenota</strong>
                  <small>Appuntamento futuro: verifica orari e disponibilità. Il conto si chiude in Cassa.</small>
                </span>
              </button>
            </div>
          </div>
        </alora-page-header>
            <article
              *ngIf="
                appointmentOrderAlerts().length &&
                activeView !== 'sales'
              "
              class="panel mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3"
              aria-live="polite"
            >
              <div>
                <p class="eyebrow text-amber-700">Appuntamenti trascorsi</p>
                <p class="text-sm font-semibold text-amber-900">
                  {{ appointmentOrderAlerts().length }} conti da chiudere
                </p>
              </div>
              <button
                type="button"
                class="primary-btn"
                (click)="selectView('sales')"
              >
                Vai ai conti
              </button>
            </article>

            <p
              *ngIf="feedback"
              class="panel mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {{ feedback }}
            </p>

            <p *ngIf="activeView === 'dashboard' && currentUser?.role !== 'owner'" class="panel rounded-xl p-4">Il report comprende solo i conti interamente accessibili negli ambiti autorizzati.</p>
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
              (openEditor)="openAppointmentsEditor($event)"
              (dataChanged)="refreshAfterDataChange($event)"
            ></barber-admin-appointments-feature-page>

            <barber-admin-sales-page
              *ngIf="activeView === 'sales'"
              [sales]="adminData().sales"
              [toClose]="appointmentOrderAlerts()"
              [openSales]="openSales"
              [unlinkedSales]="unlinkedSales"
              [loading]="loading"
              [hasMore]="salesHasMore()"
              (loadMore)="loadMoreSales()"
              (editOrder)="openQuickOrder(null, $event)"
              (deleteOrder)="deleteSale($event)"
              (cancelOrder)="cancelSale($event)"
              (closeAccount)="closeAccount($event)"
              (linkOrder)="linkPendingOrder($event)"
              (cancelAppointment)="cancelPendingAppointment($event)"
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
              (reloadProducts)="changed(['products'])"
              (removeProduct)="removeProduct()"
              (resetProduct)="resetProductForm($event)"
              (loadMoreServices)="loadMoreServices()"
              (loadMoreProducts)="loadMoreProducts()"
            ></barber-admin-services-page>

            <barber-admin-collaborators-page
              *ngIf="activeView === 'collaborators'"
              [collaborators]="adminData().collaborators"
              [collaboratorForm]="collaboratorForm"
              [defaultCollaboratorId]="
                adminData().tenant?.defaultCollaboratorId || ''
              "
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
      </ng-container>
    </ui-page>
  `,
})
export class AdminAppComponent implements OnInit, OnDestroy {
  formatBookingMode = bookingModeLabel;
  @ViewChild(AdminAppointmentsFeaturePageComponent)
  private readonly appointmentsFeaturePage?: AdminAppointmentsFeaturePageComponent;

  readonly operationalContext = inject(OperationalContextService);
  private readonly http = inject(HttpClient);
  private readonly adminFacade = inject(AdminFacade);
  private readonly adminApi = inject(AdminApiService);
  private readonly appointmentOrderNotifications = inject(
    AppointmentOrderNotificationsService,
  );
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
  readonly appointmentOrderAlerts =
    this.appointmentOrderNotifications.appointments;
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

  sessionToken = this.sessionStore.token();
  /** An action the user started (save, delete…): its buttons wait for it. */
  busy = false;
  feedback = "";
  activeView: ViewKey = "dashboard";
  currentUser: any = this.sessionStore.currentUser();
  uiScale = 92;

  /** Background refresh: turns the refresh icon, never disables anything. */
  get refreshing(): boolean {
    return this.adminFacade.refreshing() || this.adminFacade.loading();
  }
  /** Pages disable their actions only during an action or before their data first arrives. */
  get loading(): boolean {
    return this.busy || this.viewDatasets().some((dataset) => !this.adminFacade.hasLoaded(dataset));
  }

  // Everything below reads the facade cache: it survives page changes.
  get tenant(): any { return this.adminFacade.tenant(); }
  get revenueMetrics(): any[] { return this.adminFacade.revenueMetrics(); }
  get revenueReport(): any { return this.adminFacade.revenueReport(); }
  get appointmentStats(): any { return this.adminFacade.appointmentStats(); }
  get collaboratorStats(): any[] { return this.adminFacade.collaboratorStats(); }
  get serviceStats(): any[] { return this.adminFacade.serviceStats(); }
  get appointments(): any[] { return this.adminFacade.appointments(); }
  get sales(): any[] { return this.adminFacade.sales(); }
  get services(): any[] { return this.adminFacade.services(); }
  get products(): any[] { return this.adminFacade.products(); }
  get collaborators(): any[] { return this.adminFacade.collaborators(); }
  get customers(): any[] { return this.adminFacade.customers(); }
  quickOrderOpen = false;
  quickOrderClosing = false;
  quickOrderAppointment: any = null;
  quickOrderSale: any = null;
  quickOrderCustomers: any[] = [];
  get quickOrderCollaborators(): any[] { return this.adminFacade.collaboratorOptions(); }
  private quickOrderCustomerSearchTimer: ReturnType<typeof setTimeout> | null =
    null;
  private quickOrderCustomerRequestId = 0;
  appointmentsEditorOpen = false;
  appointmentsEditorAppointment: any = null;
  customerHistory: any = null;
  customerHistoryLoading = false;
  revenueFilters = {
    period: "day",
    date: toLocalDateKey(new Date()),
    customerId: "",
    collaboratorId: "",
    kind: "all",
  };
  // Tracks the auto-managed reference date so it rolls over at midnight
  // without clobbering a date the user picked on purpose.
  private autoRevenueDate = this.revenueFilters.date;
  dashboardActivity: any[] = [];
  dashboardActivityHasMore = false;
  dashboardActivityLoading = false;
  private dashboardActivityPage = 1;
  private dashboardActivityRequestId = 0;
  private dashboardRefreshInFlight = 0;
  private dashboardRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastDashboardRefresh = 0;
  private readonly destroyRef = inject(DestroyRef);
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
    consumptionUnits:"",
  };
  platformTenantForm = this.emptyPlatformTenantForm();
  platformPlanForm = this.emptyPlatformPlanForm();
  platformSubscriptionForm = this.emptyPlatformSubscriptionForm();

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
  appointmentSelectedDate = toLocalDateKey(new Date());
  appointmentSlots: Array<{ startsAt: string; label: string; outsideHours?: boolean }> = [];

  can(key: string): boolean {
    return this.sessionStore.can(key);
  }

  /** Header entry for the current view; `team` is an alias of the team page. */
  get headerNavKey(): AdminNavKey {
    return this.activeView === "team" ? "collaborators" : this.activeView;
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
          collaborator.id === defaultCollaboratorId ? " · riferimento" : ""
        }`,
      }));
  }

  get customerSelectOptions(): Array<{ value: string; label: string }> {
    return this.adminFacade.customerOptions().map((customer) => ({
      value: customer.id,
      label: `${customer.firstName} ${customer.lastName}`.trim(),
    }));
  }

  get collaboratorSelectOptions(): Array<{ value: string; label: string }> {
    const sectorId = this.adminData().services.find((service) => service.id === this.appointmentForm.serviceId)?.sectorId;
    return this.adminData().collaborators.filter((person) => !sectorId || person.sectors?.some((membership: any) => membership.sectorId === sectorId)).map((collaborator) => ({
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
    return slotOptions(this.appointmentSlots);
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
        { title: "Scegli", caption: "Trova il servizio che desideri" },
        { title: "Prenota", caption: "Scegli professionista, giorno e orario" },
        { title: "Conferma", caption: "Invia la richiesta al salone" },
      ];
    }

    return configured.map((line) => {
      const [title, caption] = line.split("|");

      return {
        title: title?.trim() || "Passaggio",
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
    return this.adminData()
      .services.slice(0, 3)
      .map((service, index) => ({
        name: service.name,
      sectorId: service.sectorId,
      requiresRoom: service.requiresRoom,
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
      return `${defaultCollaborator.firstName} ${defaultCollaborator.lastName} · riferimento`;
    }

    const fallback = this.collaborators[0];
    return fallback
      ? `${fallback.firstName} ${fallback.lastName}`
      : "Scegli il professionista di riferimento";
  }

  isDefaultCollaborator(collaboratorId: string): boolean {
    return this.tenant?.defaultCollaboratorId === collaboratorId;
  }

  readonly bookingModeOptions = [
    { value: "public", label: "Solo prenotazioni online" },
    { value: "hybrid", label: "Online e dal salone" },
    { value: "closed", label: "Solo dal salone" },
  ];

  readonly billingIntervalOptions = [
    { value: "monthly", label: "Mensile" },
    { value: "yearly", label: "Annuale" },
    { value: "one_time", label: "Una tantum" },
  ];

  readonly subscriptionStatusSelectOptions = [
    { value: "trialing", label: "Periodo di prova" },
    { value: "active", label: "Attivo" },
    { value: "past_due", label: "Pagamento scaduto" },
    { value: "suspended", label: "Sospeso" },
    { value: "cancelled", label: "Annullato" },
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

  get unlinkedSales(): any[] {
    return (this.sales || []).filter((sale) => !sale?.appointmentId);
  }

  ngOnInit(): void {
    const storedScale = Number(window.localStorage.getItem("barber.ui-scale"));
    this.setUiScale(Number.isFinite(storedScale) ? storedScale : this.uiScale);
    // The component is reused across its views (AdminRouteReuseStrategy):
    // a view change only swaps the panel and shows what is already cached.
    this.route.data.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((data) => {
      this.enterView((data["view"] as ViewKey | undefined) || "dashboard");
    });
    this.dashboardRefreshTimer = setInterval(() => {
      if (this.canAutoRefreshDashboard()) {
        void this.refreshDashboardQueries();
      }
    }, DASHBOARD_REFRESH_MS);
  }

  @HostListener("document:visibilitychange")
  @HostListener("window:online")
  onDocumentVisibilityChange(): void {
    // Back on the tab: refresh only if the figures are older than a minute.
    if (
      this.canAutoRefreshDashboard() &&
      Date.now() - this.lastDashboardRefresh >= DASHBOARD_REFRESH_MS
    ) {
      void this.refreshDashboardQueries();
    }
  }

  ngOnDestroy(): void {
    if (this.dashboardRefreshTimer) {
      clearInterval(this.dashboardRefreshTimer);
      this.dashboardRefreshTimer = null;
    }
    if (this.quickOrderCustomerSearchTimer) {
      clearTimeout(this.quickOrderCustomerSearchTimer);
    }
    if (this.customerSearchTimer) {
      clearTimeout(this.customerSearchTimer);
    }
    // The live «conti da chiudere» stream belongs to the shell: it stays open.
  }

  private canAutoRefreshDashboard(): boolean {
    return (
      this.activeView === "dashboard" &&
      this.sessionStore.isAuthenticated() &&
      this.currentUser?.role !== "platform_admin" &&
      !this.document.hidden &&
      window.navigator.onLine &&
      !this.busy &&
      !this.dashboardRefreshInFlight &&
      !this.adminFacade.loading() &&
      !this.dashboardActivityLoading
    );
  }

  /** Datasets on screen now (the till's catalog too while it is open). */
  viewDatasets(): readonly AdminDataset[] {
    const own = VIEW_DATASETS[this.activeView] ?? [];
    return this.quickOrderOpen ? [...own, ...QUICK_ORDER_DATASETS] : own;
  }

  private enterView(view: ViewKey): void {
    const previous = this.activeView;
    this.activeView = view;
    this.newMenuOpen = false;
    if (previous !== view) this.feedback = "";
    // The customers page opens with an empty search box: show the whole list again.
    if (view === "customers" && previous !== view && this.adminFacade.customerQuery())
      void this.runLoadMore(() => this.adminFacade.reloadCustomers(""));
    if (this.sessionStore.isAuthenticated()) void this.loadView();
  }

  /**
   * Shows the cached data of the view at once and refreshes what is older
   * than a minute in the background (`force`: the refresh button).
   */
  async loadView(force = false): Promise<void> {
    const view = this.activeView;
    try {
      const mode = await this.adminFacade.resolveMode();
      this.currentUser = this.adminFacade.currentUser();
      if (mode === "unauthenticated") return;
      this.syncRouteWithUser();
      if (mode === "platform") {
        this.activeView = "platform";
        await this.adminFacade.ensurePlatform(force);
        this.platformTenants = this.adminFacade.platformTenants();
        this.platformPlans = this.adminFacade.platformPlans();
        this.platformSubscriptions = this.adminFacade.platformSubscriptions();
        return;
      }
      if (view === "dashboard") this.syncAutoRevenueDate();
      const datasets = this.viewDatasets();
      const options = { revenueFilters: { ...this.revenueFilters } };
      if (view === "sales") void this.loadOpenSales();
      if (view === "dashboard") {
        const statsAge = Date.now() - this.lastDashboardRefresh;
        if (force || statsAge >= DASHBOARD_REFRESH_MS) {
          this.lastDashboardRefresh = Date.now();
          void this.operationalContext.loadTotals().catch(() => undefined);
          if (this.can("dashboard.revenue.read")) void this.loadDashboardActivity(true);
        }
      }
      if (force) await this.adminFacade.reload(datasets, options);
      else await this.adminFacade.ensure(datasets, options);
      if (view === "settings") this.syncSettingsForm();
      if (!this.appointmentForm.serviceId && this.services[0]) {
        this.appointmentForm.serviceId = this.services[0].id;
      }
    } catch (error: any) {
      if (error?.status === 401) {
        this.rememberRequestedUrl();
        this.logout();
        return;
      }
      if (view === this.activeView)
        this.feedback = humanError(error, "Non riusciamo a caricare i dati: usa Aggiorna");
    }
  }

  /**
   * After a save: what is on screen is fetched again now, the rest is only
   * marked stale and refreshed by the next page that shows it.
   */
  async changed(datasets: readonly AdminDataset[]): Promise<void> {
    const { reloadNow, markStale } = splitChanged(datasets, this.viewDatasets());
    this.adminFacade.markStale(markStale);
    if (datasets.includes("sales") && this.activeView === "sales") void this.loadOpenSales();
    if (datasets.includes("stats") && this.activeView === "dashboard" && this.can("dashboard.revenue.read"))
      void this.loadDashboardActivity(true);
    try {
      await this.adminFacade.reload(reloadNow, { revenueFilters: { ...this.revenueFilters } });
      if (reloadNow.includes("tenant")) this.syncSettingsForm(true);
    } catch (error: any) {
      this.feedback = humanError(error, "Salvato. Non riusciamo ad aggiornare l'elenco: usa Aggiorna");
    }
  }

  private settingsSnapshot = "";
  private settingsTenant: any = null;

  /** Copies the tenant into the settings form unless the user is editing it. */
  private syncSettingsForm(force = false): void {
    const tenant = this.tenant;
    if (!tenant) return;
    const dirty = this.settingsSnapshot && JSON.stringify(this.settingsForm) !== this.settingsSnapshot;
    if (!force && (tenant === this.settingsTenant || dirty)) return;
    this.settingsTenant = tenant;
    this.applyTenantToSettingsForm(tenant);
    this.settingsSnapshot = JSON.stringify(this.settingsForm);
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
        humanError(error, "Caricamento non riuscito");
    }
  }

  setUiScale(value: number): void {
    this.uiScale = Math.min(110, Math.max(50, Math.round(Number(value) || 92)));
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
      priceMode:"legacy",vatRate:"",priceChangeReason:"",isActive:true,
      id: "",
      sectorId: "",
      activityId: "",
      requiresRoom: false,
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
      priceMode:"legacy",vatRate:"",isActive:true,cost:null as number|null,costMode:"legacy",purchaseVatRate:"",stockTracked:false,priceChangeReason:"",
      id: "",
      name: "",
      description: "",
      barcode: "",
      activityId: "",
      brandId: "",
      price: null as number | null,
    };
  }

  private emptyCollaboratorForm() {
    return {
      id: "",
      sectorId: "",
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
      autoTags: [] as string[],
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

  private applyTenantToSettingsForm(tenant: any): void {
    this.settingsForm = {
      name: tenant?.name,
      publicDomain: tenant?.publicDomain || "",
      primaryColor: tenant?.primaryColor,
      accentColor: tenant?.accentColor,
      bookingMode: tenant?.bookingMode,
      publicTitle: tenant?.publicTitle ?? tenant?.name ?? "",
      publicDescription:
        tenant?.publicDescription ||
        "Scegli il servizio, trova il momento giusto e invia la tua richiesta al salone.",
      publicStepsText: Array.isArray(tenant?.publicSteps)
        ? tenant.publicSteps.join("\n")
        : "Scegli|Trova il servizio che desideri\nPrenota|Scegli professionista, giorno e orario\nConferma|Invia la richiesta al salone",
      logoUrl: tenant?.logoUrl || "",
      coverUrl: tenant?.coverUrl || "",
      publicEnabled: tenant?.publicEnabled,
      holidays: Array.isArray(tenant?.holidays)
        ? tenant.holidays.map((holiday: any) => ({
            date: new Date(holiday.date).toISOString().slice(0, 10),
            name: holiday.name || "",
          }))
        : [],
    };
  }

  async refreshCurrentView(): Promise<void> {
    if (this.activeView === "appointments") {
      await Promise.all([
        this.loadView(true),
        this.appointmentsFeaturePage?.reloadViewData(),
      ]);
      return;
    }

    // The global refresh is an explicit "go to today": reset the dashboard
    // reference date even if the user had picked another day.
    if (this.activeView === "dashboard") this.goToTodayRevenue();
    await this.loadView(true);
  }

  private goToTodayRevenue(): void {
    const today = toLocalDateKey(new Date());
    this.revenueFilters.date = today;
    this.autoRevenueDate = today;
  }

  startAppointmentFlow(): void {
    this.openAppointmentsEditor(null);
  }

  openAppointmentsEditor(appointment: any = null): void {
    if (
      !this.can(appointment ? "appointments.update.all" : "appointments.create")
    )
      return;
    this.appointmentsEditorAppointment = appointment;
    this.appointmentsEditorOpen = true;
  }

  closeAppointmentsEditor(): void {
    this.appointmentsEditorOpen = false;
    this.appointmentsEditorAppointment = null;
  }

  async refreshAfterAppointmentChange(): Promise<void> {
    await Promise.all([
      this.changed(["stats", "sales"]),
      this.appointmentsFeaturePage?.reloadViewData(),
    ]);
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
    // The route change reaches enterView(), which loads what the view needs.
    void this.router.navigate([view === "platform" ? "/platform" : `/${view}`]);
  }

  prepareNewAppointment(): void {
    this.activeView = "appointments";
    this.appointmentForm = this.emptyAppointmentForm();
    this.appointmentCustomerSearch = "";
    this.filteredAppointmentCustomers = [...this.customers];
    this.appointmentSelectedDate = toLocalDateKey(new Date());
    this.appointmentSlots = [];
    if (this.services[0]) {
      this.appointmentForm.serviceId = this.services[0].id;
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

    this.busy = true;

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

      this.adminFacade.patchTenant({
        logoUrl: updated?.logoUrl ?? this.tenant?.logoUrl,
        coverUrl: updated?.coverUrl ?? this.tenant?.coverUrl,
      });
      this.showUploadFeedback(
        kind,
        "success",
        kind === "logo" ? "Logo caricato" : "Copertina caricata",
      );
    } catch (error: any) {
      this.showUploadFeedback(
        kind,
        "error",
        humanError(error, (kind === "logo"
            ? "Caricamento del logo non riuscito"
            : "Caricamento della copertina non riuscito")),
      );
    } finally {
      this.busy = false;
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
    this.busy = true;

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

      this.adminFacade.patchTenant({
        logoUrl: updated?.logoUrl ?? null,
        coverUrl: updated?.coverUrl ?? null,
      });

      this.showUploadFeedback(
        kind,
        "success",
        kind === "logo" ? "Logo rimosso" : "Copertina rimossa",
      );
    } catch (error: any) {
      this.showUploadFeedback(
        kind,
        "error",
        humanError(error, (kind === "logo"
            ? "Rimozione logo non riuscita"
            : "Rimozione della copertina non riuscita")),
      );
    } finally {
      this.busy = false;
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
        "Scegli il servizio, trova il momento giusto e invia la tua richiesta al salone.",
      publicStepsText:
        "Scegli|Trova il servizio che desideri\nPrenota|Scegli professionista, giorno e orario\nConferma|Invia la richiesta al salone",
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
    this.openAppointmentsEditor(appointment);
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
      priceMode:service.priceMode||"legacy",vatRate:service.vatRate??"",priceChangeReason:"",isActive:service.isActive!==false,
      id: service.id,
      name: service.name,
      sectorId: service.sectorId,
      activityId: service.activityId || "",
      requiresRoom: service.requiresRoom,
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
      consumptionUnits:"",
    };
  }

  editProduct(product: any): void {
    this.productForm = {
      priceMode:product.priceMode||"legacy",vatRate:product.vatRate??"",isActive:product.isActive!==false,cost:product.cost===null||product.cost===undefined?null:Number(product.cost),costMode:product.costMode||"legacy",purchaseVatRate:product.purchaseVatRate??"",stockTracked:Boolean(product.stockTracked),priceChangeReason:"",
      id: product.id,
      name: product.name || "",
      description: product.description || "",
      barcode: product.barcode || "",
      activityId: product.activityId || "",
      brandId: product.brandId || "",
      price:
        product.price === null || product.price === undefined
          ? null
          : Number(product.price),
    };
  }

  editCollaborator(collaborator: any): void {
    this.collaboratorForm = {
      id: collaborator.id,
      sectorId: collaborator.sectors?.[0]?.sectorId || "",
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
      // Read-only: computed by the server (e.g. "fedele"), shown on the card.
      autoTags: Array.isArray(customer.autoTags) ? customer.autoTags : [],
    };
    this.customerHistory = null;
    this.customerHistoryLoading = true;
    try {
      this.customerHistory = await firstValueFrom(
        this.adminApi.loadCustomerHistory(customer.id),
      );
    } catch (error: any) {
      this.feedback =
        humanError(error, "Storico cliente non disponibile");
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
    this.busy = true;
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
        await firstValueFrom(this.adminApi.createAppointment(payload));
      }

      this.feedback = this.appointmentForm.id
        ? "Appuntamento aggiornato"
        : "Appuntamento creato";
      this.prepareNewAppointment();
      await this.changed(["stats", "sales"]);
    } catch (error: any) {
      this.feedback =
        humanError(error, "Salvataggio non riuscito");
    } finally {
      this.busy = false;
    }
  }

  async cancelAppointment(): Promise<void> {
    if (!this.appointmentForm.id) {
      return;
    }

    this.busy = true;

    try {
      await this.http
        .post(
          `${this.apiUrl}/appointments/${this.appointmentForm.id}/cancel`,
          { reason: "Annullato dalla direzione del salone" },
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Appuntamento annullato";
      this.prepareNewAppointment();
      await this.changed(["stats", "sales"]);
    } catch (error: any) {
      this.feedback =
        humanError(error, "Annullamento non riuscito");
    } finally {
      this.busy = false;
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
        this.busy = true;

        try {
          await this.http
            .delete(
              `${this.apiUrl}/appointments/${this.appointmentForm.id}`,
              this.authHeaders(),
            )
            .toPromise();
          this.feedback = "Appuntamento eliminato";
          this.prepareNewAppointment();
          await this.changed(["stats", "sales"]);
        } catch (error: any) {
          this.feedback =
            humanError(error, "Eliminazione appuntamento non riuscita");
          throw error;
        } finally {
          this.busy = false;
        }
      },
    );
  }

  async saveSettings(): Promise<void> {
    this.busy = true;

    try {
      if (this.selectedLogoFile) {
        await this.uploadMedia("logo");
        this.busy = true; // reset to true since uploadMedia sets it to false
      }
      if (this.selectedCoverFile) {
        await this.uploadMedia("cover");
        this.busy = true;
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
      this.feedback = "Impostazioni del salone aggiornate";
      await this.changed(["tenant"]);
    } catch (error: any) {
      this.feedback =
        humanError(error, "Aggiornamento impostazioni non riuscito");
    } finally {
      this.busy = false;
    }
  }

  resetPlatformPlanForm(): void {
    this.platformPlanForm = this.emptyPlatformPlanForm();
  }

  async savePlatformTenant(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.busy = true;
    try {
      await this.http
        .patch(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}`,
          this.platformTenantForm,
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Attività aggiornata";
      await this.loadPlatformAdminData();
    } catch (error: any) {
      this.feedback =
        humanError(error, "Aggiornamento dell'attività non riuscito");
    } finally {
      this.busy = false;
    }
  }

  async suspendSelectedTenant(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.busy = true;
    try {
      await this.http
        .post(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}/suspend`,
          { reason: "Sospeso dalla gestione centrale" },
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Attività sospesa";
      await this.loadPlatformAdminData();
    } catch (error: any) {
      this.feedback =
        humanError(error, "Sospensione dell'attività non riuscita");
    } finally {
      this.busy = false;
    }
  }

  async reactivateSelectedTenant(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.busy = true;
    try {
      await this.http
        .post(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}/reactivate`,
          {},
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Attività riattivata";
      await this.loadPlatformAdminData();
    } catch (error: any) {
      this.feedback =
        humanError(error, "Riattivazione dell'attività non riuscita");
    } finally {
      this.busy = false;
    }
  }

  async resetSelectedTenantData(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.busy = true;
    try {
      this.platformHealthCheck = await this.http
        .post(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}/reset-data`,
          {},
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Dati dell'attività svuotati";
      await this.loadPlatformAdminData();
    } catch (error: any) {
      this.feedback =
        humanError(error, "Non è stato possibile svuotare i dati dell'attività");
    } finally {
      this.busy = false;
    }
  }

  async deleteSelectedTenant(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.openDeleteDialog(
      "Eliminare questa attività?",
      `Stai per eliminare ${this.selectedPlatformTenant.name}.`,
      "Elimina attività",
      async () => {
        this.busy = true;
        try {
          await this.http
            .delete(
              `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}`,
              this.authHeaders(),
            )
            .toPromise();
          this.feedback = "Attività eliminata";
          this.selectedPlatformTenant = null;
          this.platformTenantForm = this.emptyPlatformTenantForm();
          this.platformHealthCheck = null;
          await this.loadPlatformAdminData();
        } catch (error: any) {
          this.feedback =
            humanError(error, "Eliminazione dell'attività non riuscita");
          throw error;
        } finally {
          this.busy = false;
        }
      },
    );
  }

  async exportSelectedTenant(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.busy = true;
    try {
      const exported = await this.http
        .get(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}/export`,
          this.authHeaders(),
        )
        .toPromise();
      this.platformExportJson = JSON.stringify(exported, null, 2);
      this.feedback = "Copia completa pronta";
    } catch (error: any) {
      this.feedback =
        humanError(error, "Preparazione della copia non riuscita");
    } finally {
      this.busy = false;
    }
  }

  async exportSelectedTenantCsv(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.busy = true;
    try {
      const exported = await this.http
        .get(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}/export?format=csv`,
          this.authHeaders(),
        )
        .toPromise();
      this.platformExportCsv = JSON.stringify(exported, null, 2);
      this.feedback = "Copia tabellare pronta";
    } catch (error: any) {
      this.feedback =
        humanError(error, "Preparazione delle tabelle non riuscita");
    } finally {
      this.busy = false;
    }
  }

  async importSelectedTenant(): Promise<void> {
    if (!this.selectedPlatformTenant || !this.platformImportJson.trim()) return;
    this.busy = true;
    try {
      const payload = JSON.parse(this.platformImportJson);
      this.platformHealthCheck = await this.http
        .post(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}/import?mode=replace`,
          payload,
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Dati completi ripristinati";
      await this.loadPlatformAdminData();
    } catch (error: any) {
      this.feedback =
        humanError(error, "Ripristino dei dati non riuscito");
    } finally {
      this.busy = false;
    }
  }

  async importSelectedTenantCsv(): Promise<void> {
    if (!this.selectedPlatformTenant || !this.platformImportCsv.trim()) return;
    this.busy = true;
    try {
      const payload = JSON.parse(this.platformImportCsv);
      this.platformHealthCheck = await this.http
        .post(
          `${this.apiUrl}/platform-admin/tenants/${this.selectedPlatformTenant.id}/import?mode=replace&format=csv`,
          payload,
          this.authHeaders(),
        )
        .toPromise();
      this.feedback = "Tabelle ripristinate";
      await this.loadPlatformAdminData();
    } catch (error: any) {
      this.feedback =
        humanError(error, "Ripristino delle tabelle non riuscito");
    } finally {
      this.busy = false;
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
    this.busy = true;
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
      await this.loadPlatformAdminData();
    } catch (error: any) {
      this.feedback =
        humanError(error, "Salvataggio piano non riuscito");
    } finally {
      this.busy = false;
    }
  }

  async savePlatformSubscription(): Promise<void> {
    if (!this.selectedPlatformTenant) return;
    this.busy = true;
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
      this.feedback = "Piano assegnato";
      await this.loadPlatformAdminData();
    } catch (error: any) {
      this.feedback =
        humanError(error, "Assegnazione del piano non riuscita");
    } finally {
      this.busy = false;
    }
  }

  resetServiceForm(): void {
    this.serviceForm = this.emptyServiceForm();
    this.resetServiceProductForm();
  }

  resetProductForm(prefill?: { barcode?: string } | void): void {
    this.productForm = { ...this.emptyProductForm(), ...(prefill || {}) };
  }

  resetCollaboratorForm(): void {
    this.collaboratorForm = this.emptyCollaboratorForm();
  }

  private revenueReportRequestId = 0;

  async loadRevenueReport(): Promise<void> {
    const requestId = ++this.revenueReportRequestId;
    this.syncAutoRevenueDate();
    this.busy = true;
    try {
      await Promise.all([
        this.adminFacade.refreshRevenueReport({ ...this.revenueFilters }),
        this.loadDashboardActivity(true),
      ]);
      if (requestId !== this.revenueReportRequestId) return;
    } catch (error: any) {
      if (requestId === this.revenueReportRequestId) this.feedback =
        humanError(error, "Caricamento del report non riuscito");
    } finally {
      if (requestId === this.revenueReportRequestId) this.busy = false;
    }
  }

  async loadDashboardActivity(reset = false): Promise<void> {
    if (!reset && this.dashboardActivityLoading) {
      return;
    }

    const requestId = ++this.dashboardActivityRequestId;
    this.dashboardActivityLoading = true;
    if (reset) {
      this.dashboardActivityPage = 1;
    }

    try {
      const response = await firstValueFrom(
        this.adminApi.loadDashboardActivity(
          this.revenueFilters,
          this.dashboardActivityPage,
        ),
      );
      if (requestId !== this.dashboardActivityRequestId) {
        return;
      }
      const items = Array.isArray(response?.items) ? response.items : [];
      this.dashboardActivity = reset
        ? items
        : [...this.dashboardActivity, ...items];
      this.dashboardActivityHasMore = Boolean(response?.hasMore);
    } catch (error: any) {
      if (requestId !== this.dashboardActivityRequestId) {
        return;
      }
      this.feedback =
        humanError(error, "Caricamento movimenti non riuscito");
    } finally {
      if (requestId === this.dashboardActivityRequestId) {
        this.dashboardActivityLoading = false;
      }
    }
  }

  /** Panoramica figures only (timer, back on the tab, return to the page). */
  async refreshDashboardQueries(): Promise<void> {
    this.dashboardRefreshInFlight += 1;
    this.lastDashboardRefresh = Date.now();
    this.syncAutoRevenueDate();
    try {
      await Promise.all([
        this.adminFacade.refreshStatsData({ ...this.revenueFilters }),
        this.can("dashboard.revenue.read") ? this.loadDashboardActivity(true) : Promise.resolve(),
      ]);
    } catch (error: any) {
      // A missed periodic refresh keeps the figures on screen; say so only if there are none.
      if (!this.revenueReport)
        this.feedback = humanError(error, "Aggiornamento della panoramica non riuscito");
    } finally {
      this.dashboardRefreshInFlight -= 1;
    }
  }

  /** The agenda changed something: reports and the till are no longer current. */
  async refreshAfterDataChange(scope: "dashboard" | "all"): Promise<void> {
    await this.changed(
      scope === "all"
        ? ["stats", "sales", "customers", "customerOptions"]
        : ["stats", "sales"],
    );
  }

  async loadMoreDashboardActivity(): Promise<void> {
    if (!this.dashboardActivityHasMore || this.dashboardActivityLoading) {
      return;
    }

    this.dashboardActivityPage += 1;
    await this.loadDashboardActivity();
  }

  resetRevenueFilters(): void {
    // The Tutto / Servizi / Prodotti switch is a view, not a filter: it stays.
    this.revenueFilters = {
      period: "day",
      date: toLocalDateKey(new Date()),
      customerId: "",
      collaboratorId: "",
      kind: this.revenueFilters.kind,
    };
    this.autoRevenueDate = this.revenueFilters.date;
    void this.loadRevenueReport();
  }

  /**
   * Keeps the reference date current across midnight. When the user has not
   * overridden it, the filter follows the new day; a manually chosen date is
   * left untouched.
   */
  private syncAutoRevenueDate(): void {
    const today = toLocalDateKey(new Date());

    if (this.revenueFilters.date === this.autoRevenueDate) {
      this.revenueFilters.date = today;
    }

    this.autoRevenueDate = today;
  }

  async retryQuickOrderCreation():Promise<void> {
    if(!this.can("sales.manage"))return;
    this.busy = true;
    try{await firstValueFrom(this.adminApi.retrySaleCreation());this.closeQuickOrder();this.feedback="Esito della vendita recuperato";await this.changed(SALE_CHANGED);}
    catch(error:any){this.feedback=humanError(error, "Esito non disponibile");}
    finally{this.busy = false;}
  }
  async retryQuickOrderUpdate():Promise<void>{
    if(!this.quickOrderSale?.id || !this.can("sales.manage"))return;
    this.busy = true;
    try{await firstValueFrom(this.adminApi.retrySaleUpdate(this.quickOrderSale.id));this.closeQuickOrder();this.feedback="Modifica del conto recuperata";await this.changed(SALE_CHANGED);}
    catch(error:any){this.feedback=humanError(error, "Esito non disponibile");}
    finally{this.busy = false;}
  }
  async saveQuickOrder(payload: Record<string, unknown>): Promise<void> {
    if (!this.can("sales.manage")) return;
    this.busy = true;
    try {
      const appointmentId = String(payload["appointmentId"] ?? "");
      const isEditing = Boolean(this.quickOrderSale?.id);
      const customerId = String(payload["customerId"] ?? "");
      if (
        this.quickOrderSale?.id &&
        customerId &&
        customerId !== (this.quickOrderSale.customerId || this.quickOrderSale.customer?.id || "")
      ) {
        const changed = await firstValueFrom(
          this.adminApi.changeSaleCustomer(
            this.quickOrderSale.id,
            customerId,
            Number(payload["revision"] ?? this.quickOrderSale.revision ?? 0),
          ),
        );
        this.quickOrderSale = { ...this.quickOrderSale, ...changed };
        payload = { ...payload, revision: changed.revision };
      }
      await firstValueFrom(
        this.quickOrderSale?.id
          ? this.adminApi.updateSale(this.quickOrderSale.id, payload)
          : this.adminApi.createSale(payload),
      );
      if (appointmentId) {
        this.appointmentOrderNotifications.dismiss(appointmentId);
      }
      this.closeQuickOrder();
      this.feedback = payload["orderStatus"] === "open" ? "Conto salvato, incasso ancora aperto" : isEditing ? "Conto aggiornato" : "Vendita registrata";
      await this.changed(SALE_CHANGED);
    } catch (error: any) {
      this.feedback =
        humanError(error, "Registrazione della vendita non riuscita");
    } finally {
      this.busy = false;
    }
  }

  async openQuickOrder(appointment: any = null, sale: any = null): Promise<void> {
    if (!this.can("sales.manage")) return;
    try {
      // Cached catalog opens the till at once; older than a minute it refreshes behind.
      await this.adminFacade.ensure(QUICK_ORDER_DATASETS);
    } catch (error: any) {
      this.feedback = humanError(error, "Caricamento del catalogo per la cassa non riuscito");
      return;
    }
    if (appointment && !sale) {
      try {
        sale = await firstValueFrom(this.adminApi.orderForAppointment(appointment.id));
      } catch (error: any) {
        this.feedback = humanError(error, "Apertura del conto non riuscita");
        return;
      }
    }
    this.quickOrderAppointment = appointment;
    this.quickOrderSale = sale;
    this.quickOrderOpen = true;
    void this.loadQuickOrderCustomers("");
  }

  searchQuickOrderCustomers(search: string): void {
    if (this.quickOrderCustomerSearchTimer) {
      clearTimeout(this.quickOrderCustomerSearchTimer);
    }
    this.quickOrderCustomerSearchTimer = setTimeout(() => {
      void this.loadQuickOrderCustomers(search);
    }, 300);
  }

  private async loadQuickOrderCustomers(search: string): Promise<void> {
    const requestId = ++this.quickOrderCustomerRequestId;
    const query = buildQuickOrderCustomerQuery(search);
    try {
      const response = await firstValueFrom(
        this.adminApi.loadCustomersPage(
          query.page,
          query.search,
          query.pageSize,
        ),
      );
      if (
        this.quickOrderOpen &&
        requestId === this.quickOrderCustomerRequestId
      ) {
        this.quickOrderCustomers = response?.items || [];
      }
    } catch {
      if (
        this.quickOrderOpen &&
        requestId === this.quickOrderCustomerRequestId
      ) {
        this.quickOrderCustomers = [];
      }
    }
  }

  confirmPendingOrder(appointment: any): void {
    this.openQuickOrder(appointment);
  }

  /** Open accounts of the till (saved open, or booked and started). */
  openSales: any[] = [];
  newMenuOpen = false;

  get canCreateSomething(): boolean {
    return this.can("sales.manage") || this.can("appointments.create");
  }

  /** One entry point; with a single permitted choice it opens it directly. */
  onNewClick(): void {
    const sell = this.can("sales.manage");
    const book = this.can("appointments.create");
    if (sell && book) {
      this.newMenuOpen = !this.newMenuOpen;
      return;
    }
    if (sell) void this.openQuickOrder();
    else if (book) this.startAppointmentFlow();
  }

  async loadOpenSales(): Promise<void> {
    if (!this.can("sales.read")) {
      this.openSales = [];
      return;
    }
    try {
      this.openSales = await firstValueFrom(this.adminApi.loadOpenSales());
    } catch {
      this.openSales = [];
    }
  }

  /** "Chiudi il conto": a booked account goes through its appointment. */
  closeAccount(event: { appointment: any; sale: any }): void {
    if (event.appointment?.id) {
      void this.openQuickOrder(event.appointment);
      return;
    }
    if (event.sale) void this.openQuickOrder(null, event.sale);
  }

  cancelPendingAppointment(appointment: any): void {
    if (!this.can("appointments.update.all")) return;
    if (!appointment?.id) return;
    const customer = `${appointment.customer?.firstName || ""} ${
      appointment.customer?.lastName || ""
    }`.trim();
    this.openDeleteDialog(
      "Annulla appuntamento",
      `Vuoi annullare l'appuntamento${
        customer ? ` di ${customer}` : ""
      }? La notifica sparirà dalla coda di conferma.`,
      "Annulla appuntamento",
      async () => {
        this.busy = true;
        try {
          await firstValueFrom(
            this.adminApi.cancelAppointment(appointment.id, {
              reason: "Annullato dalla coda conferme",
            }),
          );
          this.feedback = "Appuntamento annullato";
          this.appointmentOrderNotifications.dismiss(appointment.id);
          await this.changed(["sales", "stats"]);
        } catch (error: any) {
          this.feedback = humanError(error, "Annullamento non riuscito");
          throw error;
        } finally {
          this.busy = false;
        }
      },
    );
  }

  async linkPendingOrder(event: {
    appointment: any;
    saleId: string;
  }): Promise<void> {
    if (!this.can("sales.manage")) return;
    if (!event?.appointment?.id || !event.saleId) return;
    this.busy = true;
    try {
      await firstValueFrom(
        this.adminApi.linkSaleToAppointment(event.saleId, event.appointment.id),
      );
      this.appointmentOrderNotifications.dismiss(event.appointment.id);
      this.feedback = "Vendita collegata all'appuntamento";
      await this.changed(["sales", "stats"]);
    } catch (error: any) {
      this.feedback =
        humanError(error, "Collegamento della vendita non riuscito");
    } finally {
      this.busy = false;
    }
  }

  closeQuickOrder(): void {
    if (this.quickOrderCustomerSearchTimer) {
      clearTimeout(this.quickOrderCustomerSearchTimer);
      this.quickOrderCustomerSearchTimer = null;
    }
    this.quickOrderCustomerRequestId += 1;
    if (!this.quickOrderOpen) return;
    this.quickOrderClosing = true;
    setTimeout(() => {
      this.quickOrderClosing = false;
      this.quickOrderOpen = false;
      this.quickOrderAppointment = null;
      this.quickOrderSale = null;
      this.quickOrderCustomers = [];
    }, 220);
  }

  deleteSale(sale: any): void {
    if (!sale?.id) return;
    this.openDeleteDialog(
      "Elimina vendita",
      "La vendita sparisce con incassi e appuntamenti del conto. Se ha già scaricato prodotti dal magazzino viene annullata: incassi rimborsati e prodotti rientrati. Se hai solo sbagliato cliente, apri il conto e scegli quello giusto.",
      "Elimina vendita",
      async () => {
        this.busy = true;
        try {
          const result: any = await firstValueFrom(
            this.adminApi.deleteSale(sale.id),
          );
          this.feedback = result?.message || "Vendita eliminata";
          await this.changed(["sales", "stats"]);
        } catch (error: any) {
          this.feedback =
            humanError(error, "Eliminazione della vendita non riuscita");
          throw error;
        } finally {
          this.busy = false;
        }
      },
    );
  }

  cancelSale(sale: any): void {
    if (!sale?.id) return;
    this.openDeleteDialog(
      "Annulla vendita",
      "Gli incassi vengono rimborsati, i prodotti rientrano in magazzino e gli appuntamenti ancora da fare vengono annullati. La vendita resta nello storico come annullata.",
      "Annulla vendita",
      async () => {
        this.busy = true;
        try {
          await firstValueFrom(this.adminApi.cancelSale(sale.id));
          this.feedback = "Vendita annullata";
          await this.changed(["sales", "stats"]);
        } catch (error: any) {
          this.feedback = humanError(
            error,
            "Annullamento della vendita non riuscito",
          );
          throw error;
        } finally {
          this.busy = false;
        }
      },
    );
  }

  resetServiceProductForm(): void {
    this.serviceProductForm = {
      productId: "",
      mode: "optional",
      quantity: 1,
      priceLocked: false,
      consumptionUnits:"",
    };
  }

  async attachProductToService(): Promise<void> {
    if (!this.serviceForm.id || !this.serviceProductForm.productId) {
      this.feedback = "Salva prima il servizio e seleziona un prodotto";
      return;
    }

    this.busy = true;

    try {
      await this.http
        .post(
          `${this.apiUrl}/services/${this.serviceForm.id}/products`,
          {
            productId: this.serviceProductForm.productId,
            mode: this.serviceProductForm.mode,
            quantity: Number(this.serviceProductForm.quantity || 1),
            priceLocked: this.serviceProductForm.priceLocked,
            ...(this.can("inventory.manage")?{consumptionUnits:this.serviceProductForm.consumptionUnits||null}:{}),
          },
          this.authHeaders(),
        )
        .toPromise();

      this.feedback = "Prodotto collegato al servizio";
      const serviceId = this.serviceForm.id;
      this.resetServiceProductForm();
      await this.changed(["services"]);
      const updated = this.services.find((service) => service.id === serviceId);
      if (updated) {
        this.editService(updated);
      }
    } catch (error: any) {
      this.feedback =
        humanError(error, "Collegamento prodotto non riuscito");
    } finally {
      this.busy = false;
    }
  }

  async detachProductFromService(productId: string): Promise<void> {
    if (!this.serviceForm.id) {
      return;
    }

    this.busy = true;

    try {
      await this.http
        .delete(
          `${this.apiUrl}/services/${this.serviceForm.id}/products/${productId}`,
          this.authHeaders(),
        )
        .toPromise();

      this.feedback = "Prodotto rimosso dal servizio";
      const serviceId = this.serviceForm.id;
      await this.changed(["services"]);
      const updated = this.services.find((service) => service.id === serviceId);
      if (updated) {
        this.editService(updated);
      }
    } catch (error: any) {
      this.feedback =
        humanError(error, "Rimozione prodotto non riuscita");
    } finally {
      this.busy = false;
    }
  }

  async saveService(): Promise<void> {
    this.busy = true;

    try {
      const payload = {
        name: this.serviceForm.name,
      // The activity decides where the service is offered (every location running it).
      activityId: this.serviceForm.activityId || undefined,
      requiresRoom: this.serviceForm.requiresRoom,
        publicDescription: this.serviceForm.publicDescription,
        durationMinutes: Number(this.serviceForm.durationMinutes),
        basePrice: String(this.serviceForm.basePrice),
        isActive:this.serviceForm.isActive,
        priceMode:this.serviceForm.priceMode,vatRate:this.serviceForm.vatRate===""?null:String(this.serviceForm.vatRate),priceChangeReason:this.serviceForm.priceChangeReason,
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
      await this.changed(["services"]);
    } catch (error: any) {
      this.feedback =
        humanError(error, "Salvataggio servizio non riuscito");
    } finally {
      this.busy = false;
    }
  }

  async saveProduct(): Promise<void> {
    if (!this.productForm.name?.trim()) {
      this.feedback = "Inserisci il nome del prodotto";
      return;
    }
    this.busy = true;
    try {
      await firstValueFrom(
        this.adminApi.createOrUpdateProduct(this.productForm.id, {
          name: this.productForm.name.trim(),
          description: this.productForm.description || undefined,
          // Empty clears the code, so a wrong association can be undone.
          barcode: String(this.productForm.barcode || "").trim() || null,
          // Empty keeps «Rivendita» (default of the account).
          ...(this.productForm.activityId ? { activityId: this.productForm.activityId } : {}),
          brandId: this.productForm.brandId || null,
          isActive:this.productForm.isActive,
          priceMode:this.productForm.priceMode,vatRate:this.productForm.vatRate===""?null:String(this.productForm.vatRate),cost:this.productForm.cost,costMode:this.productForm.costMode,purchaseVatRate:this.productForm.purchaseVatRate===""?null:String(this.productForm.purchaseVatRate),priceChangeReason:this.productForm.priceChangeReason,
          ...(this.can("inventory.manage")?{stockTracked:this.productForm.stockTracked}:{}),
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
      await this.changed(["products"]);
    } catch (error: any) {
      this.feedback =
        humanError(error, "Salvataggio prodotto non riuscito");
    } finally {
      this.busy = false;
    }
  }

  removeProduct(): void {
    if (!this.productForm.id) return;
    this.openDeleteDialog(
      "Disattivare questo prodotto?",
      `Disattiva ${this.productForm.name || "il prodotto selezionato"} conservando prezzi e movimenti storici.`,
      "Disattiva prodotto",
      async () => {
        this.busy = true;
        try {
          await firstValueFrom(
            this.adminApi.deleteProduct(this.productForm.id),
          );
          this.feedback = "Prodotto disattivato; storico conservato";
          this.resetProductForm();
          await this.changed(["products"]);
        } finally {
          this.busy = false;
        }
      },
    );
  }

  async removeService(): Promise<void> {
    if (!this.serviceForm.id) {
      return;
    }

    this.openDeleteDialog(
      "Disattivare questo servizio?",
      `Disattiva il servizio ${this.serviceForm.name || "selezionato"} conservando il suo storico.`,
      "Disattiva servizio",
      async () => {
        this.busy = true;

        try {
          await this.http
            .delete(
              `${this.apiUrl}/services/${this.serviceForm.id}`,
              this.authHeaders(),
            )
            .toPromise();
          this.feedback = "Servizio disattivato; storico conservato";
          this.serviceForm = this.emptyServiceForm();
          await this.changed(["services"]);
        } catch (error: any) {
          this.feedback =
            humanError(error, "Eliminazione servizio non riuscita");
          throw error;
        } finally {
          this.busy = false;
        }
      },
    );
  }

  async saveCollaborator(): Promise<void> {
    this.busy = true;

    try {
      const payload = {
        firstName: this.collaboratorForm.firstName,
      sectorId: this.collaboratorForm.sectorId,
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
        ? "Professionista aggiornato"
        : "Professionista aggiunto";
      this.collaboratorForm = this.emptyCollaboratorForm();
      await this.changed(["collaborators", "collaboratorOptions"]);
    } catch (error: any) {
      this.feedback =
        humanError(error, "Salvataggio del professionista non riuscito");
    } finally {
      this.busy = false;
    }
  }

  async setDefaultCollaborator(collaboratorId: string): Promise<void> {
    this.busy = true;

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

      this.feedback = "Professionista di riferimento aggiornato";
      await this.changed(["tenant", "collaborators", "collaboratorOptions"]);
    } catch (error: any) {
      this.feedback =
        humanError(error, "Aggiornamento del professionista di riferimento non riuscito");
    } finally {
      this.busy = false;
    }
  }

  async removeCollaborator(): Promise<void> {
    if (!this.collaboratorForm.id) {
      return;
    }

    if (this.isDefaultCollaborator(this.collaboratorForm.id)) {
      this.feedback =
        "Questo è il professionista di riferimento. Scegline un altro prima di eliminarlo.";
      return;
    }

    this.openDeleteDialog(
      "Eliminare questo professionista?",
      `Stai per eliminare ${this.collaboratorForm.firstName || "questo"} ${this.collaboratorForm.lastName || "professionista"}.`,
      "Elimina professionista",
      async () => {
        this.busy = true;

        try {
          await this.http
            .delete(
              `${this.apiUrl}/collaborators/${this.collaboratorForm.id}`,
              this.authHeaders(),
            )
            .toPromise();
          this.feedback = "Professionista eliminato";
          this.collaboratorForm = this.emptyCollaboratorForm();
          await this.changed(["collaborators", "collaboratorOptions"]);
        } catch (error: any) {
          this.feedback =
            humanError(error, "Eliminazione del professionista non riuscita");
          throw error;
        } finally {
          this.busy = false;
        }
      },
    );
  }

  async saveCustomer(): Promise<void> {
    this.busy = true;

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
      await this.changed(["customers", "customerOptions"]);
    } catch (error: any) {
      this.feedback =
        humanError(error, "Salvataggio cliente non riuscito");
    } finally {
      this.busy = false;
    }
  }

  removeCustomer(customer: any): void {
    this.openDeleteDialog(
      "Eliminare questo cliente?",
      `Stai per eliminare ${customer.firstName} ${customer.lastName}.`,
      "Elimina cliente",
      async () => {
        this.busy = true;

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
          await this.changed(["customers", "customerOptions"]);
        } catch (error: any) {
          this.feedback =
            humanError(error, "Eliminazione cliente non riuscita");
          throw error;
        } finally {
          this.busy = false;
        }
      },
    );
  }

  logout(): void {
    this.sessionToken = "";
    this.currentUser = null;
    this.adminFacade.clearSession();
    this.appointmentOrderNotifications.stop();
    this.feedback = "";
    void this.router.navigate(["/login"]);
  }

  formatTime(value: string): string {
    return new Date(value).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  formatAppointmentStatus(status: string): string {
    return appointmentStatusLabel(status);
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
