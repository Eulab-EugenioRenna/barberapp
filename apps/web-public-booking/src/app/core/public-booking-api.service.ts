import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { Observable, forkJoin } from "rxjs";
import { PUBLIC_API_URL } from "./public-api-config";

@Injectable({ providedIn: "root" })
export class PublicBookingApiService {
  private readonly http = inject(HttpClient);

  loadInitialData(basePath: string): Observable<Record<string, unknown>> {
    return forkJoin({
      settings: this.http.get(`${basePath}/settings`),
      services: this.http.get(`${basePath}/services`),
    });
  }

  availability(
    basePath: string,
    params: { serviceId: string; date: string; collaboratorId: string },
  ): Observable<any> {
    return this.http.get(`${basePath}/availability`, { params });
  }

  createBooking(
    basePath: string,
    payload: Record<string, unknown>,
  ): Observable<any> {
    return this.http.post(`${basePath}/bookings`, payload);
  }

  absoluteAssetUrl(path: string): string {
    if (!path) {
      return "";
    }
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    return `${PUBLIC_API_URL}${path}`;
  }

  resolveBasePath(tenantSlug: string): string {
    const hostname = window.location.hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1"
      ? `${PUBLIC_API_URL}/public/${tenantSlug}`
      : `${PUBLIC_API_URL}/public`;
  }
}
