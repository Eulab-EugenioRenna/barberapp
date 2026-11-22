import { Injectable, inject, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { ADMIN_API_URL } from "./api-config";
import { SessionStore } from "./session.store";
export interface SectorContext {
  id: string;
  /** Name of the activity run in this location (Barberia, Estetica…). */
  name: string;
  isActive: boolean;
  activityId?: string;
}
export interface LocationContext {
  id: string;
  name: string;
  address?: string | null;
  isActive: boolean;
  sectors: SectorContext[];
}
export function selectedOperationalScope(userId: string): {
  locationId: string;
  sectorId: string;
} {
  try {
    const saved = JSON.parse(
      localStorage.getItem("alora.scope:" + userId) || "{}",
    );
    return {
      locationId: typeof saved.locationId === "string" ? saved.locationId : "",
      sectorId: typeof saved.sectorId === "string" ? saved.sectorId : "",
    };
  } catch {
    return { locationId: "", sectorId: "" };
  }
}
@Injectable({ providedIn: "root" })
export class OperationalContextService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  readonly locations = signal<LocationContext[]>([]);
  readonly sectorTotal = signal<string | null>(null);
  async loadTotals() {
    this.sectorTotal.set(null);
    if (!this.selected.sectorId || !this.session.can("dashboard.revenue.read"))
      return;
    const result = await firstValueFrom(
      this.http.get<{ registeredLineTotal: string }>(
        `${ADMIN_API_URL}/locations/totals`,
        {
          headers: {
            "X-Alora-Location": this.selected.locationId,
            "X-Alora-Sector": this.selected.sectorId,
          },
        },
      ),
    );
    this.sectorTotal.set(result.registeredLineTotal);
  }
  get selected() {
    return selectedOperationalScope(this.session.currentUser()?.id || "");
  }
  get sectors() {
    return this.locations().flatMap((location) =>
      location.sectors.map((sector) => ({
        ...sector,
        locationId: location.id,
        label: `${location.name} · ${sector.name}`,
      })),
    );
  }
  async load() {
    this.locations.set(
      await firstValueFrom(
        this.http.get<LocationContext[]>(`${ADMIN_API_URL}/locations/context`),
      ),
    );
    const saved = this.selected;
    if (
      (saved.locationId &&
        !this.locations().some(
          (location) => location.id === saved.locationId,
        )) ||
      (saved.sectorId &&
        !this.sectors.some(
          (sector) =>
            sector.id === saved.sectorId &&
            (!saved.locationId || sector.locationId === saved.locationId),
        ))
    )
      this.select("", "", true);
  }
  select(locationId: string, sectorId = "", reload = true) {
    localStorage.setItem(
      "alora.scope:" + (this.session.currentUser()?.id || ""),
      JSON.stringify({ locationId, sectorId }),
    );
    // Dispose every pending read and editor together when the operational context changes.
    if (reload) window.location.reload();
  }
}
