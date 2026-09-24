import { Injectable, computed, inject, signal } from "@angular/core";
import { catchError, firstValueFrom, forkJoin, of } from "rxjs";
import { AdminApiService } from "./admin-api.service";
import { AuthApiService } from "./auth-api.service";
import { SessionStore } from "./session.store";

@Injectable({ providedIn: "root" })
export class AdminFacade {
  private readonly adminApi = inject(AdminApiService);
  private readonly authApi = inject(AuthApiService);
  private readonly sessionStore = inject(SessionStore);

  readonly loading = signal(false);
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
  readonly customers = signal<any[]>([]);
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
  private statsRequestId = 0;
  readonly dashboardData = computed(() => ({
    revenueMetrics: this.revenueMetrics(),
    revenueReport: this.revenueReport(),
    appointmentStats: this.appointmentStats(),
    appointments: this.dashboardAppointments(),
    collaboratorStats: this.collaboratorStats(),
  }));

  async refreshAll(
    revenueFilters: Record<string, string> = {},
  ): Promise<{
    mode: "platform" | "tenant" | "unauthenticated";
  }> {
    if (!this.sessionStore.isAuthenticated()) {
      return { mode: "unauthenticated" };
    }

    this.loading.set(true);
    this.feedback.set("");

    try {
      const currentUser = await firstValueFrom(this.authApi.me());
      this.sessionStore.setCurrentUser(currentUser);

      if (currentUser?.role === "platform_admin") {
        const { tenants, plans, subscriptions }: any = await firstValueFrom(
          this.adminApi.loadPlatformData(),
        );
        this.platformTenants.set(tenants as any[]);
        this.platformPlans.set(plans as any[]);
        this.platformSubscriptions.set(subscriptions as any[]);
        return { mode: "platform" };
      }

      const statsRequestId = ++this.statsRequestId;
      const { coreResponse, statsResponse }: any = await firstValueFrom(
        forkJoin({
          coreResponse: this.adminApi.loadAdminCoreData(),
          // A failed secondary report must not discard the operational data.
          statsResponse: this.adminApi.loadAdminStatsData(revenueFilters).pipe(
            catchError(() => of(null)),
          ),
        }),
      );
      this.setCoreData(coreResponse);

      if (statsResponse && statsRequestId === this.statsRequestId) {
        this.setStatsData(statsResponse);
      }

      return { mode: "tenant" };
    } finally {
      this.loading.set(false);
    }
  }

  async refreshShell(): Promise<{
    mode: "platform" | "tenant" | "unauthenticated";
  }> {
    if (!this.sessionStore.isAuthenticated()) {
      return { mode: "unauthenticated" };
    }

    this.loading.set(true);
    this.feedback.set("");

    try {
      const currentUser = await firstValueFrom(this.authApi.me());
      this.sessionStore.setCurrentUser(currentUser);

      if (currentUser?.role === "platform_admin") {
        const { tenants, plans, subscriptions }: any = await firstValueFrom(
          this.adminApi.loadPlatformData(),
        );
        this.platformTenants.set(tenants as any[]);
        this.platformPlans.set(plans as any[]);
        this.platformSubscriptions.set(subscriptions as any[]);
        return { mode: "platform" };
      }

      const response: any = await firstValueFrom(this.adminApi.loadShellData());
      this.tenant.set(response.tenant);
      return { mode: "tenant" };
    } finally {
      this.loading.set(false);
    }
  }

  setFeedback(message: string): void {
    this.feedback.set(message);
  }

  setRevenueReport(report: any): void {
    this.revenueReport.set(report || null);
    this.revenueMetrics.set(report?.metrics || []);
  }

  setCoreData(input: Record<string, any>): void {
    this.tenant.set(input["tenant"] || null);
    this.appointments.set(input["appointments"] || []);
    this.dashboardAppointments.set(input["appointments"] || []);

    const services = unwrapPage(input["services"]);
    this.services.set(services.items);
    this.servicesHasMore.set(services.hasMore);
    this.loadedPages.services = 1;

    const collaborators = unwrapPage(input["collaborators"]);
    this.collaborators.set(collaborators.items);
    this.collaboratorsHasMore.set(collaborators.hasMore);
    this.loadedPages.collaborators = 1;

    const customers = unwrapPage(input["customers"]);
    this.customers.set(customers.items);
    this.customersHasMore.set(customers.hasMore);
    this.loadedPages.customers = 1;
  }

  async refreshStatsData(
    revenueFilters: Record<string, string> = {},
  ): Promise<void> {
    const requestId = ++this.statsRequestId;
    const statsResponse: any = await firstValueFrom(
      this.adminApi.loadAdminStatsData(revenueFilters),
    );
    if (requestId === this.statsRequestId) {
      this.setStatsData(statsResponse);
    }
  }

  private setStatsData(statsResponse: any): void {
    this.revenueReport.set(statsResponse.revenue || null);
    this.revenueMetrics.set(statsResponse.revenue?.metrics || []);
    this.appointmentStats.set(statsResponse.appointmentStats);
    this.dashboardAppointments.set(statsResponse.upcomingAppointments || []);
    this.collaboratorStats.set(statsResponse.collaboratorStats || []);
    this.serviceStats.set(statsResponse.serviceStats || []);

    const sales = unwrapPage(statsResponse.sales);
    this.sales.set(sales.items);
    this.salesHasMore.set(sales.hasMore);
    this.loadedPages.sales = 1;

    const products = unwrapPage(statsResponse.products);
    this.products.set(products.items);
    this.productsHasMore.set(products.hasMore);
    this.loadedPages.products = 1;
  }

  async reloadCustomers(search = ""): Promise<void> {
    this.customerSearch = search;
    const response = await firstValueFrom(
      this.adminApi.loadCustomersPage(1, search),
    );
    this.customers.set(response?.items || []);
    this.customersHasMore.set(Boolean(response?.hasMore));
    this.loadedPages.customers = 1;
  }

  async loadMoreCustomers(): Promise<void> {
    if (!this.customersHasMore()) {
      return;
    }
    const nextPage = this.loadedPages.customers + 1;
    const response = await firstValueFrom(
      this.adminApi.loadCustomersPage(nextPage, this.customerSearch),
    );
    this.customers.update((items) => [...items, ...(response?.items || [])]);
    this.customersHasMore.set(Boolean(response?.hasMore));
    this.loadedPages.customers = nextPage;
  }

  async loadMoreSales(): Promise<void> {
    if (!this.salesHasMore()) {
      return;
    }
    const nextPage = this.loadedPages.sales + 1;
    const response = await firstValueFrom(this.adminApi.loadSalesPage(nextPage));
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
    this.collaborators.update((items) => [...items, ...(response?.items || [])]);
    this.collaboratorsHasMore.set(Boolean(response?.hasMore));
    this.loadedPages.collaborators = nextPage;
  }

  clearSession(): void {
    this.sessionStore.clear();
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
