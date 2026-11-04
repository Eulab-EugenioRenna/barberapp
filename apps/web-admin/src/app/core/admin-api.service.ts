import type { PersonalDashboard } from "@barber/shared/personal";
import { SessionStore } from "./session.store";
import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable, forkJoin, of, map, throwError } from "rxjs";
import { ADMIN_API_URL } from "./api-config";

@Injectable({ providedIn: "root" })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);

  private allowed<T>(
    key: string,
    load: () => Observable<T>,
    fallback: T,
  ): Observable<T> {
    return this.session.can(key) ? load() : of(fallback);
  }

  private loadTenantContext(): Observable<any> {
    return this.http.get(
      `${ADMIN_API_URL}/tenant/${this.session.can("settings.manage") ? "settings" : "context"}`,
    );
  }

  private loadAgendaContext(): Observable<any> {
    return this.allowed(
      "appointments.read.all",
      () => this.http.get(`${ADMIN_API_URL}/appointments/context`),
      { services: [], collaborators: [] },
    );
  }

  readonly listPageSize = 50;
  readonly catalogPageSize = 200;

  loadAdminData(): Observable<Record<string, unknown>> {
    return forkJoin({
      tenant: this.loadTenantContext(),
      revenue: this.allowed<any>(
        "dashboard.revenue.read",
        () => this.http.get(`${ADMIN_API_URL}/dashboard/revenue`),
        null,
      ),
      appointmentStats: this.allowed<any>(
        "dashboard.revenue.read",
        () => this.http.get(`${ADMIN_API_URL}/dashboard/appointments`),
        null,
      ),
      collaboratorStats: this.allowed<any>(
        "dashboard.revenue.read",
        () => this.http.get(`${ADMIN_API_URL}/dashboard/collaborators`),
        null,
      ),
      serviceStats: this.allowed<any>(
        "dashboard.revenue.read",
        () => this.http.get(`${ADMIN_API_URL}/dashboard/services`),
        null,
      ),
      appointments: this.loadAppointments(),
      sales: this.loadSalesPage(1),
      services: this.loadServicesPage(1),
      products: this.loadProductsPage(1),
      collaborators: this.loadCollaboratorsPage(1),
      customers: this.loadCustomersPage(1),
    });
  }

  loadAdminCoreData(): Observable<Record<string, unknown>> {
    return forkJoin({
      tenant: this.loadTenantContext(),
      appointments: this.loadAppointments(),
      services: this.loadServicesPage(1),
      collaborators: this.loadCollaboratorsPage(1),
      customers: this.loadCustomersPage(1),
    });
  }

  loadPersonalDashboard(period: "day" | "week" | "month", date = "", page = 1, collaboratorId = ""): Observable<PersonalDashboard> {
    if (!(collaboratorId ? this.session.can("appointments.read.all") : this.session.can("appointments.read.own"))) return throwError(() => new Error("Agenda personale non abilitata"));
    const query = new URLSearchParams({ period, page: String(page) });
    if (date) query.set("date", date);
    if (collaboratorId) query.set("collaboratorId", collaboratorId);
    return this.http.get<PersonalDashboard>(`${ADMIN_API_URL}/dashboard/personal?${query}`);
  }

  updatePersonalAppointmentStatus(id: string, status: string): Observable<unknown> {
    return this.http.post(`${ADMIN_API_URL}/appointments/${encodeURIComponent(id)}/status`, { status });
  }

  loadAppointments(): Observable<any[]> {
    return this.allowed<any[]>(
      "appointments.read.all",
      () => this.http.get<any[]>(`${ADMIN_API_URL}/appointments`),
      [],
    );
  }

  loadCustomersPage(
    page: number,
    search = "",
    pageSize = this.listPageSize,
  ): Observable<{ items: any[]; total: number; hasMore: boolean }> {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (search) {
      query.set("search", search);
    }
    return this.allowed<any>(
      "clients.read.full",
      () =>
        this.http.get<any>(`${ADMIN_API_URL}/customers?${query.toString()}`),
      { items: [], total: 0, hasMore: false },
    );
  }

  loadSalesPage(
    page: number,
  ): Observable<{ items: any[]; total: number; hasMore: boolean }> {
    return this.allowed<any>(
      "sales.read",
      () =>
        this.http.get<any>(
          `${ADMIN_API_URL}/sales?page=${page}&pageSize=${this.listPageSize}`,
        ),
      { items: [], total: 0, hasMore: false },
    );
  }

  loadServicesPage(
    page: number,
  ): Observable<{ items: any[]; total: number; hasMore: boolean }> {
    return this.allowed<any>(
      "services.read",
      () =>
        this.http.get<any>(
          `${ADMIN_API_URL}/services?page=${page}&pageSize=${this.catalogPageSize}`,
        ),
      { items: [], total: 0, hasMore: false },
    );
  }

  loadProductsPage(
    page: number,
  ): Observable<{ items: any[]; total: number; hasMore: boolean }> {
    return this.allowed<any>(
      "products.read",
      () =>
        this.http.get<any>(
          `${ADMIN_API_URL}/products?page=${page}&pageSize=${this.catalogPageSize}`,
        ),
      { items: [], total: 0, hasMore: false },
    );
  }

  loadCollaboratorsPage(
    page: number,
  ): Observable<{ items: any[]; total: number; hasMore: boolean }> {
    return this.allowed<any>(
      "collaborators.read",
      () =>
        this.http.get<any>(
          `${ADMIN_API_URL}/collaborators?page=${page}&pageSize=${this.catalogPageSize}`,
        ),
      { items: [], total: 0, hasMore: false },
    );
  }

  loadShellData(): Observable<Record<string, unknown>> {
    return forkJoin({
      tenant: this.loadTenantContext(),
    });
  }

  loadAppointmentsViewData(): Observable<Record<string, unknown>> {
    return forkJoin({
      tenant: this.loadTenantContext(),
      appointments: this.loadAppointments(),
      context: this.loadAgendaContext(),
      customers: this.loadCustomersPage(1),
    }).pipe(
      map(({ context, ...data }) => ({
        ...data,
        services: context.services,
        collaborators: context.collaborators,
      })),
    );
  }

  loadAdminStatsData(
    revenueFilters: Record<string, string> = {},
  ): Observable<Record<string, unknown>> {
    return forkJoin({
      revenue: this.loadRevenueReport(revenueFilters),
      upcomingAppointments: this.allowed<any>(
        "dashboard.revenue.read",
        () => this.http.get(`${ADMIN_API_URL}/dashboard/upcoming-appointments`),
        null,
      ),
      appointmentStats: this.allowed<any>(
        "dashboard.revenue.read",
        () => this.http.get(`${ADMIN_API_URL}/dashboard/appointments`),
        null,
      ),
      collaboratorStats: this.allowed<any>(
        "dashboard.revenue.read",
        () => this.http.get(`${ADMIN_API_URL}/dashboard/collaborators`),
        null,
      ),
      serviceStats: this.allowed<any>(
        "dashboard.revenue.read",
        () => this.http.get(`${ADMIN_API_URL}/dashboard/services`),
        null,
      ),
      sales: this.loadSalesPage(1),
      products: this.loadProductsPage(1),
    });
  }

  loadPlatformData(): Observable<Record<string, unknown>> {
    return forkJoin({
      tenants: this.http.get(`${ADMIN_API_URL}/platform-admin/tenants`),
      plans: this.http.get(`${ADMIN_API_URL}/platform-admin/plans`),
      subscriptions: this.http.get(
        `${ADMIN_API_URL}/platform-admin/subscriptions`,
      ),
    });
  }

  tenantHealthCheck(tenantId: string): Observable<any> {
    return this.http.get(
      `${ADMIN_API_URL}/platform-admin/tenants/${tenantId}/health-check`,
    );
  }

  uploadTenantMedia(kind: "logo" | "cover", file: File): Observable<any> {
    const formData = new FormData();
    formData.append("file", file);
    return this.http.post(`${ADMIN_API_URL}/tenant/${kind}`, formData);
  }

  deleteTenantMedia(kind: "logo" | "cover"): Observable<any> {
    return this.http.delete(`${ADMIN_API_URL}/tenant/${kind}`);
  }

  createAppointment(payload: Record<string, unknown>): Observable<any> {
    return this.http.post(`${ADMIN_API_URL}/appointments`, payload);
  }

  updateAppointment(
    id: string,
    payload: Record<string, unknown>,
  ): Observable<any> {
    return this.http.patch(`${ADMIN_API_URL}/appointments/${id}`, payload);
  }

  cancelAppointment(
    id: string,
    payload: Record<string, unknown>,
  ): Observable<any> {
    return this.http.post(
      `${ADMIN_API_URL}/appointments/${id}/cancel`,
      payload,
    );
  }

  deleteAppointment(id: string): Observable<any> {
    return this.http.delete(`${ADMIN_API_URL}/appointments/${id}`);
  }

  updateTenantSettings(payload: Record<string, unknown>): Observable<any> {
    return this.http.patch(`${ADMIN_API_URL}/tenant/settings`, payload);
  }

  updatePlatformTenant(
    id: string,
    payload: Record<string, unknown>,
  ): Observable<any> {
    return this.http.patch(
      `${ADMIN_API_URL}/platform-admin/tenants/${id}`,
      payload,
    );
  }

  suspendPlatformTenant(
    id: string,
    payload: Record<string, unknown>,
  ): Observable<any> {
    return this.http.post(
      `${ADMIN_API_URL}/platform-admin/tenants/${id}/suspend`,
      payload,
    );
  }

  reactivatePlatformTenant(id: string): Observable<any> {
    return this.http.post(
      `${ADMIN_API_URL}/platform-admin/tenants/${id}/reactivate`,
      {},
    );
  }

  resetPlatformTenantData(id: string): Observable<any> {
    return this.http.post(
      `${ADMIN_API_URL}/platform-admin/tenants/${id}/reset-data`,
      {},
    );
  }

  deletePlatformTenant(id: string): Observable<any> {
    return this.http.delete(`${ADMIN_API_URL}/platform-admin/tenants/${id}`);
  }

  exportPlatformTenant(id: string, format?: "csv"): Observable<any> {
    const query = format ? `?format=${format}` : "";
    return this.http.get(
      `${ADMIN_API_URL}/platform-admin/tenants/${id}/export${query}`,
    );
  }

  importPlatformTenant(
    id: string,
    payload: Record<string, unknown>,
    format?: "csv",
  ): Observable<any> {
    const query = format ? "?mode=replace&format=csv" : "?mode=replace";
    return this.http.post(
      `${ADMIN_API_URL}/platform-admin/tenants/${id}/import${query}`,
      payload,
    );
  }

  createOrUpdatePlatformPlan(
    id: string,
    payload: Record<string, unknown>,
  ): Observable<any> {
    return id
      ? this.http.patch(`${ADMIN_API_URL}/platform-admin/plans/${id}`, payload)
      : this.http.post(`${ADMIN_API_URL}/platform-admin/plans`, payload);
  }

  createPlatformSubscription(
    payload: Record<string, unknown>,
  ): Observable<any> {
    return this.http.post(
      `${ADMIN_API_URL}/platform-admin/subscriptions`,
      payload,
    );
  }

  attachProductToService(
    serviceId: string,
    payload: Record<string, unknown>,
  ): Observable<any> {
    return this.http.post(
      `${ADMIN_API_URL}/services/${serviceId}/products`,
      payload,
    );
  }

  detachProductFromService(
    serviceId: string,
    productId: string,
  ): Observable<any> {
    return this.http.delete(
      `${ADMIN_API_URL}/services/${serviceId}/products/${productId}`,
    );
  }

  createSale(payload: Record<string, unknown>): Observable<any> {
    return this.http.post(`${ADMIN_API_URL}/sales`, payload);
  }

  updateSale(id: string, payload: Record<string, unknown>): Observable<any> {
    return this.http.patch(`${ADMIN_API_URL}/sales/${id}`, payload);
  }

  deleteSale(id: string): Observable<any> {
    return this.http.delete(`${ADMIN_API_URL}/sales/${id}`);
  }

  linkSaleToAppointment(
    saleId: string,
    appointmentId: string,
  ): Observable<any> {
    return this.http.patch(
      `${ADMIN_API_URL}/sales/${saleId}/link-appointment`,
      {
        appointmentId,
      },
    );
  }

  createOrUpdateProduct(
    id: string,
    payload: Record<string, unknown>,
  ): Observable<any> {
    return id
      ? this.http.patch(`${ADMIN_API_URL}/products/${id}`, payload)
      : this.http.post(`${ADMIN_API_URL}/products`, payload);
  }

  deleteProduct(id: string): Observable<any> {
    return this.http.delete(`${ADMIN_API_URL}/products/${id}`);
  }

  loadRevenueReport(filters: Record<string, string>): Observable<any> {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => Boolean(value)),
    ).toString();
    return this.allowed<any>(
      "dashboard.revenue.read",
      () =>
        this.http.get(
          `${ADMIN_API_URL}/dashboard/revenue${query ? `?${query}` : ""}`,
        ),
      null,
    );
  }

  loadDashboardActivity(
    filters: Record<string, string>,
    page: number,
    pageSize = 20,
  ): Observable<{ items: any[]; hasMore: boolean; page: number }> {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => Boolean(value)),
    );
    query.set("page", String(page));
    query.set("pageSize", String(pageSize));
    return this.allowed<any>(
      "dashboard.revenue.read",
      () =>
        this.http.get(
          `${ADMIN_API_URL}/dashboard/activity?${query.toString()}`,
        ),
      null,
    );
  }

  loadCustomerHistory(customerId: string): Observable<any> {
    return this.http.get(`${ADMIN_API_URL}/customers/${customerId}/history`);
  }

  createOrUpdateService(
    id: string,
    payload: Record<string, unknown>,
  ): Observable<any> {
    return id
      ? this.http.patch(`${ADMIN_API_URL}/services/${id}`, payload)
      : this.http.post(`${ADMIN_API_URL}/services`, payload);
  }

  deleteService(id: string): Observable<any> {
    return this.http.delete(`${ADMIN_API_URL}/services/${id}`);
  }

  createOrUpdateCollaborator(
    id: string,
    payload: Record<string, unknown>,
  ): Observable<any> {
    return id
      ? this.http.patch(`${ADMIN_API_URL}/collaborators/${id}`, payload)
      : this.http.post(`${ADMIN_API_URL}/collaborators`, payload);
  }

  setDefaultCollaborator(payload: Record<string, unknown>): Observable<any> {
    return this.http.patch(`${ADMIN_API_URL}/tenant/settings`, payload);
  }

  deleteCollaborator(id: string): Observable<any> {
    return this.http.delete(`${ADMIN_API_URL}/collaborators/${id}`);
  }

  createOrUpdateCustomer(
    id: string,
    payload: Record<string, unknown>,
  ): Observable<any> {
    return id
      ? this.http.patch(`${ADMIN_API_URL}/customers/${id}`, payload)
      : this.http.post(`${ADMIN_API_URL}/customers`, payload);
  }

  deleteCustomer(id: string): Observable<any> {
    return this.http.delete(`${ADMIN_API_URL}/customers/${id}`);
  }
}
