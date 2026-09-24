import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable, forkJoin } from "rxjs";
import { ADMIN_API_URL } from "./api-config";

@Injectable({ providedIn: "root" })
export class AdminApiService {
  private readonly http = inject(HttpClient);

  readonly listPageSize = 50;
  readonly catalogPageSize = 200;

  loadAdminData(): Observable<Record<string, unknown>> {
    return forkJoin({
      tenant: this.http.get(`${ADMIN_API_URL}/tenant/settings`),
      revenue: this.http.get(`${ADMIN_API_URL}/dashboard/revenue`),
      appointmentStats: this.http.get(
        `${ADMIN_API_URL}/dashboard/appointments`,
      ),
      collaboratorStats: this.http.get(
        `${ADMIN_API_URL}/dashboard/collaborators`,
      ),
      serviceStats: this.http.get(`${ADMIN_API_URL}/dashboard/services`),
      appointments: this.http.get(`${ADMIN_API_URL}/appointments`),
      sales: this.loadSalesPage(1),
      services: this.loadServicesPage(1),
      products: this.loadProductsPage(1),
      collaborators: this.loadCollaboratorsPage(1),
      customers: this.loadCustomersPage(1),
    });
  }

  loadAdminCoreData(): Observable<Record<string, unknown>> {
    return forkJoin({
      tenant: this.http.get(`${ADMIN_API_URL}/tenant/settings`),
      appointments: this.loadAppointments(),
      services: this.loadServicesPage(1),
      collaborators: this.loadCollaboratorsPage(1),
      customers: this.loadCustomersPage(1),
    });
  }

  loadAppointments(): Observable<any[]> {
    return this.http.get<any[]>(`${ADMIN_API_URL}/appointments`);
  }

  loadCustomersPage(
    page: number,
    search = "",
  ): Observable<{ items: any[]; total: number; hasMore: boolean }> {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(this.listPageSize),
    });
    if (search) {
      query.set("search", search);
    }
    return this.http.get<any>(`${ADMIN_API_URL}/customers?${query.toString()}`);
  }

  loadSalesPage(
    page: number,
  ): Observable<{ items: any[]; total: number; hasMore: boolean }> {
    return this.http.get<any>(
      `${ADMIN_API_URL}/sales?page=${page}&pageSize=${this.listPageSize}`,
    );
  }

  loadServicesPage(
    page: number,
  ): Observable<{ items: any[]; total: number; hasMore: boolean }> {
    return this.http.get<any>(
      `${ADMIN_API_URL}/services?page=${page}&pageSize=${this.catalogPageSize}`,
    );
  }

  loadProductsPage(
    page: number,
  ): Observable<{ items: any[]; total: number; hasMore: boolean }> {
    return this.http.get<any>(
      `${ADMIN_API_URL}/products?page=${page}&pageSize=${this.catalogPageSize}`,
    );
  }

  loadCollaboratorsPage(
    page: number,
  ): Observable<{ items: any[]; total: number; hasMore: boolean }> {
    return this.http.get<any>(
      `${ADMIN_API_URL}/collaborators?page=${page}&pageSize=${this.catalogPageSize}`,
    );
  }

  loadShellData(): Observable<Record<string, unknown>> {
    return forkJoin({
      tenant: this.http.get(`${ADMIN_API_URL}/tenant/settings`),
    });
  }

  loadAppointmentsViewData(): Observable<Record<string, unknown>> {
    return forkJoin({
      tenant: this.http.get(`${ADMIN_API_URL}/tenant/settings`),
      appointments: this.http.get(`${ADMIN_API_URL}/appointments`),
      services: this.loadServicesPage(1),
      collaborators: this.loadCollaboratorsPage(1),
      customers: this.loadCustomersPage(1),
    });
  }

  loadAdminStatsData(
    revenueFilters: Record<string, string> = {},
  ): Observable<Record<string, unknown>> {
    return forkJoin({
      revenue: this.loadRevenueReport(revenueFilters),
      upcomingAppointments: this.http.get(
        `${ADMIN_API_URL}/dashboard/upcoming-appointments`,
      ),
      appointmentStats: this.http.get(
        `${ADMIN_API_URL}/dashboard/appointments`,
      ),
      collaboratorStats: this.http.get(
        `${ADMIN_API_URL}/dashboard/collaborators`,
      ),
      serviceStats: this.http.get(`${ADMIN_API_URL}/dashboard/services`),
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
    return this.http.patch(`${ADMIN_API_URL}/sales/${saleId}/link-appointment`, {
      appointmentId,
    });
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
    return this.http.get(
      `${ADMIN_API_URL}/dashboard/revenue${query ? `?${query}` : ""}`,
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
    return this.http.get<any>(
      `${ADMIN_API_URL}/dashboard/activity?${query.toString()}`,
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
