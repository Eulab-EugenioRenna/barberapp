import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable, forkJoin } from "rxjs";
import { ADMIN_API_URL } from "./api-config";

@Injectable({ providedIn: "root" })
export class AdminApiService {
  private readonly http = inject(HttpClient);

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
      sales: this.http.get(`${ADMIN_API_URL}/sales`),
      services: this.http.get(`${ADMIN_API_URL}/services`),
      products: this.http.get(`${ADMIN_API_URL}/products`),
      collaborators: this.http.get(`${ADMIN_API_URL}/collaborators`),
      customers: this.http.get(`${ADMIN_API_URL}/customers`),
    });
  }

  loadAdminCoreData(): Observable<Record<string, unknown>> {
    return forkJoin({
      tenant: this.http.get(`${ADMIN_API_URL}/tenant/settings`),
      appointments: this.http.get(`${ADMIN_API_URL}/appointments`),
      services: this.http.get(`${ADMIN_API_URL}/services`),
      collaborators: this.http.get(`${ADMIN_API_URL}/collaborators`),
      customers: this.http.get(`${ADMIN_API_URL}/customers`),
    });
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
      services: this.http.get(`${ADMIN_API_URL}/services`),
      collaborators: this.http.get(`${ADMIN_API_URL}/collaborators`),
      customers: this.http.get(`${ADMIN_API_URL}/customers`),
    });
  }

  loadAdminStatsData(): Observable<Record<string, unknown>> {
    return forkJoin({
      revenue: this.http.get(`${ADMIN_API_URL}/dashboard/revenue`),
      appointmentStats: this.http.get(
        `${ADMIN_API_URL}/dashboard/appointments`,
      ),
      collaboratorStats: this.http.get(
        `${ADMIN_API_URL}/dashboard/collaborators`,
      ),
      serviceStats: this.http.get(`${ADMIN_API_URL}/dashboard/services`),
      sales: this.http.get(`${ADMIN_API_URL}/sales`),
      products: this.http.get(`${ADMIN_API_URL}/products`),
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
