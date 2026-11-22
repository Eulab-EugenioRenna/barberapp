import { HttpClient } from "@angular/common/http";
import { Injectable, computed, inject, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { ADMIN_API_URL } from "./api-config";

export interface ActivitySector {
  id: string;
  locationId: string;
  isActive: boolean;
  location: { name: string; isActive: boolean };
}

export interface Activity {
  id: string;
  preset: string | null;
  name: string;
  color: string | null;
  isActive: boolean;
  sectors: ActivitySector[];
  servicesCount: number;
  productsCount: number;
}

export interface ActivityPreset {
  preset: string;
  name: string;
  color: string;
}

/** Activities of the account (Barberia, Estetica, Rivendita…) and where they run. */
@Injectable({ providedIn: "root" })
export class ActivitiesService {
  private readonly http = inject(HttpClient);
  readonly activities = signal<Activity[]>([]);
  readonly presets = signal<ActivityPreset[]>([]);
  readonly loaded = signal(false);
  private pending: Promise<void> | null = null;

  readonly active = computed(() => this.activities().filter((row) => row.isActive));

  /** Loads once; pass `force` after a change. */
  load(force = false): Promise<void> {
    if (this.loaded() && !force) return Promise.resolve();
    if (this.pending && !force) return this.pending;
    this.pending = firstValueFrom(
      this.http.get<{ activities: Activity[]; presets: ActivityPreset[] }>(
        `${ADMIN_API_URL}/activities`,
      ),
    )
      .then((response) => {
        this.activities.set(response.activities || []);
        this.presets.set(response.presets || []);
        this.loaded.set(true);
      })
      .finally(() => (this.pending = null));
    return this.pending;
  }

  byId(id: string | null | undefined): Activity | undefined {
    return this.activities().find((row) => row.id === id);
  }

  /** The account's resale activity: default for products. */
  resale(): Activity | undefined {
    return (
      this.activities().find((row) => row.preset === "rivendita") ??
      this.activities().find((row) => row.name.toLowerCase() === "rivendita")
    );
  }

  /** «Centro, Mare» — or empty when the activity runs nowhere yet. */
  locationNames(id: string | null | undefined): string {
    return (this.byId(id)?.sectors || [])
      .filter((sector) => sector.isActive && sector.location.isActive)
      .map((sector) => sector.location.name)
      .join(", ");
  }

  async create(input: { preset?: string; name?: string; color?: string }): Promise<Activity> {
    const created = await firstValueFrom(
      this.http.post<Activity>(`${ADMIN_API_URL}/activities`, input),
    );
    await this.load(true);
    return created;
  }

  async update(
    id: string,
    patch: Partial<Pick<Activity, "name" | "color" | "isActive">>,
  ): Promise<void> {
    await firstValueFrom(this.http.patch(`${ADMIN_API_URL}/activities/${encodeURIComponent(id)}`, patch));
    await this.load(true);
  }
}
