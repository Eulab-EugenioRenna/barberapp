import { SessionRefreshService } from "./session-refresh.service";
import { Injectable, computed, inject, signal } from "@angular/core";
import { Observable, firstValueFrom } from "rxjs";
import { AdminApiService } from "./admin-api.service";
import { AuthApiService } from "./auth-api.service";
import { SessionStore } from "./session.store";
import {
  DATASET_MAX_AGE_MS,
  planDatasets,
  type AdminDataset,
} from "./admin-data-policy";

type Mode = "platform" | "tenant" | "unauthenticated";

/**
 * Admin data kept in memory across pages (stale-while-revalidate, see
 * admin-data-policy.ts): a page shows what is already here at once and the
 * facade refreshes in the background, each dataset at most once a minute.
 */
@Injectable({ providedIn: "root" })
export class AdminFacade {
  private readonly sessionRefresh = inject(SessionRefreshService);
  private readonly adminApi = inject(AdminApiService);
  private readonly authApi = inject(AuthApiService);
  private readonly sessionStore = inject(SessionStore);

  /** A dataset never loaded is being fetched: the page waits for it. */
  readonly loading = signal(false);
  /** Background revalidation: never blocks buttons, only turns the refresh icon. */
  readonly refreshing = signal(false);
  readonly feedback = signal("");
  readonly currentUser = computed(() => this.sessionStore.currentUser());
  readonly tenant = signal<any>(null);
  readonly revenueMetrics = signal<any[]>([]);
  readonly revenueReport = signal<any>(null);
  readonly appointmentStats = signal<any>(null);
  readonly dashboardAppointments = signal<any[]>([]);
  readonly collaboratorStats = signal<any[]>([]);
  readonly serviceStats = signal<any[]>([]);
  readonly appointments = signal<any[]>([]);
  readonly sales = signal<any[]>([]);
  readonly services = signal<any[]>([]);
  readonly products = signal<any[]>([]);
  readonly collaborators = signal<any[]>([]);
  readonly collaboratorOptions = signal<any[]>([]);
  readonly customers = signal<any[]>([]);
  readonly customerOptions = signal<any[]>([]);
  readonly platformTenants = signal<any[]>([]);
  readonly platformPlans = signal<any[]>([]);
  readonly platformSubscriptions = signal<any[]>([]);
  readonly customersHasMore = signal(false);
  readonly salesHasMore = signal(false);
  readonly servicesHasMore = signal(false);
  readonly productsHasMore = signal(false);
  readonly collaboratorsHasMore = signal(false);
  private readonly loadedPages = {
    customers: 1,
    sales: 1,
    services: 1,
    products: 1,
    collaborators: 1,
  };
  private customerSearch = "";
  private customerRequestId = 0;
  private loadingMoreCustomers = false;
  private statsRequestId = 0;
  /** When each dataset was last loaded (ms). Missing = never loaded. */
  private readonly loadedAt = new Map<AdminDataset, number>();
  private readonly inFlight = new Map<AdminDataset, Promise<void>>();
  private waiting = 0;
  private revalidating = 0;
  private platformLoadedAt = 0;
  private cacheOwner = "";
  private readonly now = () => Date.now();
  readonly dashboardData = computed(() => ({
    revenueMetrics: this.revenueMetrics(),
    revenueReport: this.revenueReport(),
    appointmentStats: this.appointmentStats(),
    appointments: this.dashboardAppointments(),
    collaboratorStats: this.collaboratorStats(),
  }));

  /** Who is signed in; the profile comes from the session when still fresh. */
  async resolveMode(): Promise<Mode> {
    if (!this.sessionStore.isAuthenticated()) return "unauthenticated";
    let currentUser = this.sessionStore.freshUser();
    if (!currentUser) {
      currentUser = await firstValueFrom(this.authApi.me());
      this.sessionStore.setCurrentUser(currentUser);
    }
    return currentUser?.role === "platform_admin" ? "platform" : "tenant";
  }

  hasLoaded(dataset: AdminDataset): boolean {
    return this.loadedAt.has(dataset);
  }

  /**
   * Stale-while-revalidate: resolves once every dataset is in memory. Those
   * already loaded but older than a minute are refreshed in the background.
   */
  async ensure(
    datasets: readonly AdminDataset[],
    options: { revenueFilters?: Record<string, string>; maxAgeMs?: number } = {},
  ): Promise<void> {
    this.checkOwner();
    const plan = planDatasets(datasets, this.loadedAt, this.now(), {
      maxAgeMs: options.maxAgeMs ?? DATASET_MAX_AGE_MS,
      inFlight: new Set(this.inFlight.keys()),
    });
    for (const dataset of plan.revalidate)
      void this.track(dataset, options.revenueFilters, false).catch(() => undefined);
    const pending = datasets
      .filter((dataset) => !plan.wait.includes(dataset))
      .map((dataset) => (this.loadedAt.has(dataset) ? undefined : this.inFlight.get(dataset)))
      .filter((promise): promise is Promise<void> => !!promise);
    await Promise.all([
      ...plan.wait.map((dataset) => this.track(dataset, options.revenueFilters, true)),
      ...pending,
    ]);
  }

  /** Fetches the datasets now (explicit refresh, or data changed on screen). */
  async reload(
    datasets: readonly AdminDataset[],
    options: { revenueFilters?: Record<string, string> } = {},
  ): Promise<void> {
    this.checkOwner();
    await Promise.all(
      [...new Set(datasets)].map(async (dataset) => {
        // A request already running may predate the change: wait, then fetch again.
        await this.inFlight.get(dataset)?.catch(() => undefined);
        await this.track(dataset, options.revenueFilters, !this.loadedAt.has(dataset));
      }),
    );
  }

  /** Another account signed in on this tab: nothing cached may be shown to it. */
  private checkOwner(): void {
    const owner = String(this.sessionStore.currentUser()?.id ?? "");
    if (owner === this.cacheOwner) return;
    if (this.cacheOwner) this.clearCache();
    this.cacheOwner = owner;
  }

  /** Data changed elsewhere: the next page that needs it refreshes it quietly. */
  markStale(datasets: readonly AdminDataset[]): void {
    for (const dataset of datasets) if (this.loadedAt.has(dataset)) this.loadedAt.set(dataset, 0);
  }

  private track(
    dataset: AdminDataset,
    revenueFilters: Record<string, string> | undefined,
    blocking: boolean,
  ): Promise<void> {
    const counter = blocking ? "waiting" : "revalidating";
    this[counter]++;
    this.syncBusy();
    const run = this.fetch(dataset, revenueFilters ?? {}, !blocking).finally(() => {
      this[counter]--;
      this.syncBusy();
      if (this.inFlight.get(dataset) === run) this.inFlight.delete(dataset);
    });
    this.inFlight.set(dataset, run);
    return run;
  }

  private syncBusy(): void {
    this.loading.set(this.waiting > 0);
    this.refreshing.set(this.revalidating > 0);
  }

  private async fetch(
    dataset: AdminDataset,
    revenueFilters: Record<string, string>,
    background: boolean,
  ): Promise<void> {
    const startedAt = this.now();
    const get = <T>(source: Observable<T>) => firstValueFrom(source);
    switch (dataset) {
      case "tenant":
        this.tenant.set((await get(this.adminApi.loadTenantContext())) || null);
        break;
      case "services": {
        // A list scrolled past page one is not cut back by a background refresh.
        if (background && this.loadedPages.services > 1) break;
        const page = unwrapPage(await get(this.adminApi.loadServicesPage(1)));
        this.services.set(page.items);
        this.servicesHasMore.set(page.hasMore);
        this.loadedPages.services = 1;
        break;
      }
      case "products": {
        if (background && this.loadedPages.products > 1) break;
        const page = unwrapPage(await get(this.adminApi.loadProductsPage(1)));
        this.products.set(page.items);
        this.productsHasMore.set(page.hasMore);
        this.loadedPages.products = 1;
        break;
      }
      case "collaborators": {
        if (background && this.loadedPages.collaborators > 1) break;
        const page = unwrapPage(await get(this.adminApi.loadCollaboratorsPage(1)));
        this.collaborators.set(page.items);
        this.collaboratorsHasMore.set(page.hasMore);
        this.loadedPages.collaborators = 1;
        break;
      }
      case "collaboratorOptions":
        this.collaboratorOptions.set((await get(this.adminApi.loadCollaboratorOptions())) || []);
        break;
      case "customers": {
        if (background && this.loadedPages.customers > 1) break;
        const requestId = ++this.customerRequestId;
        const search = this.customerSearch;
        const page = unwrapPage(await get(this.adminApi.loadCustomersPage(1, search)));
        if (requestId !== this.customerRequestId) break;
        this.customers.set(page.items);
        this.customersHasMore.set(page.hasMore);
        this.loadedPages.customers = 1;
        break;
      }
      case "customerOptions":
        this.customerOptions.set((await get(this.adminApi.loadCustomerOptions())) || []);
        break;
      case "sales": {
        if (background && this.loadedPages.sales > 1) break;
        const page = unwrapPage(await get(this.adminApi.loadSalesPage(1)));
        this.sales.set(page.items);
        this.salesHasMore.set(page.hasMore);
        this.loadedPages.sales = 1;
        break;
      }
      case "stats": {
        const requestId = ++this.statsRequestId;
        const response: any = await get(this.adminApi.loadAdminStatsData(revenueFilters, false));
        if (requestId === this.statsRequestId) this.setStatsData(response);
        break;
      }
    }
    this.loadedAt.set(dataset, startedAt);
  }

  /** Platform console data (platform administrators only). */
  async ensurePlatform(force = false): Promise<void> {
    if (!force && this.platformLoadedAt && this.now() - this.platformLoadedAt < DATASET_MAX_AGE_MS) return;
    const { tenants, plans, subscriptions }: any = await firstValueFrom(
      this.adminApi.loadPlatformData(),
    );
    this.platformTenants.set(tenants as any[]);
    this.platformPlans.set(plans as any[]);
    this.platformSubscriptions.set(subscriptions as any[]);
    this.platformLoadedAt = this.now();
  }

  /** Tenant only, for pages outside the main workspace (cached like the rest). */
  async refreshShell(): Promise<{ mode: Mode }> {
    const mode = await this.resolveMode();
    if (mode === "platform") await this.ensurePlatform();
    if (mode === "tenant") await this.ensure(["tenant"]);
    return { mode };
  }

  setFeedback(message: string): void {
    this.feedback.set(message);
  }

  patchTenant(patch: Record<string, unknown>): void {
    this.tenant.update((tenant) => ({ ...(tenant || {}), ...patch }));
  }

  setRevenueReport(report: any): void {
    this.revenueReport.set(report || null);
    this.revenueMetrics.set(report?.metrics || []);
  }

  /**
   * Data loaded by another screen (the agenda). Only what is present is
   * replaced, and it is marked stale: its source may be a reduced pick list.
   */
  setCoreData(input: Record<string, any>): void {
    if ("tenant" in input) this.tenant.set(input["tenant"] || null);
    if ("appointments" in input) this.appointments.set(input["appointments"] || []);
    if ("services" in input) {
      const services = unwrapPage(input["services"]);
      this.services.set(services.items);
      this.servicesHasMore.set(services.hasMore);
      this.loadedPages.services = 1;
    }
    if ("collaborators" in input) {
      const collaborators = unwrapPage(input["collaborators"]);
      this.collaborators.set(collaborators.items);
      this.collaboratorsHasMore.set(collaborators.hasMore);
      this.loadedPages.collaborators = 1;
    }
    if ("customers" in input) {
      ++this.customerRequestId;
      this.customerSearch = "";
      const customers = unwrapPage(input["customers"]);
      this.customers.set(customers.items);
      this.customersHasMore.set(customers.hasMore);
      this.loadedPages.customers = 1;
    }
    if ("customerOptions" in input) this.customerOptions.set(input["customerOptions"] || []);
    if ("tenant" in input) this.loadedAt.set("tenant", this.now());
    this.markStale(["services", "collaborators", "customers"]);
  }

  async refreshRevenueReport(filters: Record<string, string>): Promise<void> {
    const requestId = ++this.statsRequestId;
    this.setRevenueReport(null);
    const report = await firstValueFrom(this.adminApi.loadRevenueReport({ ...filters }));
    if (requestId === this.statsRequestId) this.setRevenueReport(report);
  }

  /** Panoramica figures (timer, explicit refresh, changed filters). */
  async refreshStatsData(revenueFilters: Record<string, string> = {}): Promise<void> {
    await this.reload(["stats"], { revenueFilters });
  }

  private setStatsData(statsResponse: any): void {
    this.revenueReport.set(statsResponse.revenue || null);
    this.revenueMetrics.set(statsResponse.revenue?.metrics || []);
    this.appointmentStats.set(statsResponse.appointmentStats);
    this.dashboardAppointments.set(statsResponse.upcomingAppointments || []);
    this.collaboratorStats.set((statsResponse.revenue?.byCollaborator || []).map((row: any) => ({ collaboratorName: row.label, revenue: row.revenue })));
    this.serviceStats.set((statsResponse.revenue?.byService || []).map((row: any) => ({ serviceName: row.label, revenue: row.revenue, quantity: row.quantity })));
  }

  async reloadCustomers(search = ""): Promise<void> {
    this.customerSearch = search;
    const requestId = ++this.customerRequestId;
    const response = await firstValueFrom(
      this.adminApi.loadCustomersPage(1, search),
    );
    if (requestId !== this.customerRequestId) {
      return;
    }
    this.customers.set(response?.items || []);
    this.customersHasMore.set(Boolean(response?.hasMore));
    this.loadedPages.customers = 1;
    this.loadedAt.set("customers", this.now());
  }

  async reloadProducts(): Promise<void> {
    await this.reload(["products"]);
  }

  async loadMoreCustomers(): Promise<void> {
    if (!this.customersHasMore() || this.loadingMoreCustomers) {
      return;
    }
    this.loadingMoreCustomers = true;
    const requestId = this.customerRequestId;
    const nextPage = this.loadedPages.customers + 1;
    try {
      const response = await firstValueFrom(
        this.adminApi.loadCustomersPage(nextPage, this.customerSearch),
      );
      if (requestId !== this.customerRequestId) {
        return;
      }
      this.customers.update((items) => [...items, ...(response?.items || [])]);
      this.customersHasMore.set(Boolean(response?.hasMore));
      this.loadedPages.customers = nextPage;
    } finally {
      this.loadingMoreCustomers = false;
    }
  }

  async loadMoreSales(): Promise<void> {
    if (!this.salesHasMore()) {
      return;
    }
    const nextPage = this.loadedPages.sales + 1;
    const response = await firstValueFrom(
      this.adminApi.loadSalesPage(nextPage),
    );
    this.sales.update((items) => [...items, ...(response?.items || [])]);
    this.salesHasMore.set(Boolean(response?.hasMore));
    this.loadedPages.sales = nextPage;
  }

  async loadMoreProducts(): Promise<void> {
    if (!this.productsHasMore()) {
      return;
    }
    const nextPage = this.loadedPages.products + 1;
    const response = await firstValueFrom(
      this.adminApi.loadProductsPage(nextPage),
    );
    this.products.update((items) => [...items, ...(response?.items || [])]);
    this.productsHasMore.set(Boolean(response?.hasMore));
    this.loadedPages.products = nextPage;
  }

  async loadMoreServices(): Promise<void> {
    if (!this.servicesHasMore()) {
      return;
    }
    const nextPage = this.loadedPages.services + 1;
    const response = await firstValueFrom(
      this.adminApi.loadServicesPage(nextPage),
    );
    this.services.update((items) => [...items, ...(response?.items || [])]);
    this.servicesHasMore.set(Boolean(response?.hasMore));
    this.loadedPages.services = nextPage;
  }

  async loadMoreCollaborators(): Promise<void> {
    if (!this.collaboratorsHasMore()) {
      return;
    }
    const nextPage = this.loadedPages.collaborators + 1;
    const response = await firstValueFrom(
      this.adminApi.loadCollaboratorsPage(nextPage),
    );
    this.collaborators.update((items) => [
      ...items,
      ...(response?.items || []),
    ]);
    this.collaboratorsHasMore.set(Boolean(response?.hasMore));
    this.loadedPages.collaborators = nextPage;
  }

  /** Forget every cached dataset (logout, other account). */
  clearCache(): void {
    this.loadedAt.clear();
    this.inFlight.clear();
    this.platformLoadedAt = 0;
    this.tenant.set(null);
    for (const list of [this.sales, this.services, this.products, this.collaborators, this.collaboratorOptions, this.customers, this.customerOptions, this.appointments, this.dashboardAppointments])
      list.set([]);
  }

  clearSession(): void {
    this.clearCache();
    this.sessionRefresh.logout();
  }
}

function unwrapPage(input: any): {
  items: any[];
  hasMore: boolean;
  total: number;
} {
  if (Array.isArray(input)) {
    return { items: input, hasMore: false, total: input.length };
  }

  return {
    items: Array.isArray(input?.items) ? input.items : [],
    hasMore: Boolean(input?.hasMore),
    total: Number(input?.total ?? 0),
  };
}
