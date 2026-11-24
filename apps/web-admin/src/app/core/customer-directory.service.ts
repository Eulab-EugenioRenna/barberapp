import { HttpClient } from "@angular/common/http";
import { Injectable, inject, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { PICK_LIST_ACCESS } from "@barber/shared/functions";
import { ADMIN_API_URL } from "./api-config";
import { SessionStore } from "./session.store";

export interface CustomerEntry {
  id: string;
  firstName: string;
  lastName: string;
  hasPhone: boolean;
}

/**
 * Every customer of the salon, for every customer picker in ALORA: the same
 * list everywhere, never just the first page of the customers table.
 */
@Injectable({ providedIn: "root" })
export class CustomerDirectoryService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  readonly customers = signal<CustomerEntry[]>([]);
  readonly loaded = signal(false);
  private pending: Promise<void> | null = null;
  private loadedAt = 0;

  /** Loads once; `force` re-reads after customers were added or edited elsewhere. */
  load(force = false): Promise<void> {
    if (this.pending && !force) return this.pending;
    if (this.loaded() && !force) return Promise.resolve();
    if (!PICK_LIST_ACCESS.customers.some((key) => this.session.can(key))) {
      this.loaded.set(true);
      return Promise.resolve();
    }
    this.pending = firstValueFrom(this.http.get<CustomerEntry[]>(`${ADMIN_API_URL}/customers/options`))
      .then((rows) => {
        this.customers.set(rows || []);
        this.loaded.set(true);
        this.loadedAt = Date.now();
      })
      .catch(() => undefined)
      .finally(() => (this.pending = null));
    return this.pending;
  }

  /** On opening a picker: re-reads when the list is older than a minute. */
  refreshIfStale(): Promise<void> {
    return this.load(this.loaded() && Date.now() - this.loadedAt > 60_000);
  }

  /** A customer just created from a quick form: available at once, everywhere. */
  add(customer: { id: string; firstName?: string; lastName?: string; phone?: string | null; hasPhone?: boolean }): void {
    const entry: CustomerEntry = {
      id: customer.id,
      firstName: customer.firstName ?? "",
      lastName: customer.lastName ?? "",
      hasPhone: customer.hasPhone ?? !!customer.phone?.trim(),
    };
    this.customers.update((rows) => [entry, ...rows.filter((row) => row.id !== entry.id)]);
  }

  find(id: string): CustomerEntry | undefined {
    return this.customers().find((row) => row.id === id);
  }
}

export function customerLabel(customer: { firstName?: string; lastName?: string } | null | undefined): string {
  return `${customer?.firstName ?? ""} ${customer?.lastName ?? ""}`.trim() || "Cliente senza nome";
}
