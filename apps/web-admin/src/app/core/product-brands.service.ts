import { HttpClient } from "@angular/common/http";
import { Injectable, inject, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { ADMIN_API_URL } from "./api-config";

export interface ProductBrand {
  id: string;
  name: string;
  products: number;
}

/** Brands group products: Listino uses them, Panoramica sums the sales by brand. */
@Injectable({ providedIn: "root" })
export class ProductBrandsService {
  private readonly http = inject(HttpClient);
  readonly brands = signal<ProductBrand[]>([]);
  private readonly root = `${ADMIN_API_URL}/product-brands`;

  async load(): Promise<void> {
    try {
      this.brands.set(await firstValueFrom(this.http.get<ProductBrand[]>(this.root)));
    } catch {
      this.brands.set([]);
    }
  }
  async create(name: string): Promise<ProductBrand> {
    const brand = await firstValueFrom(this.http.post<ProductBrand>(this.root, { name }));
    if (!this.brands().some((row) => row.id === brand.id))
      this.brands.update((rows) => [...rows, brand].sort((a, b) => a.name.localeCompare(b.name, "it")));
    return brand;
  }
  async rename(id: string, name: string): Promise<void> {
    const brand = await firstValueFrom(this.http.patch<{ id: string; name: string }>(`${this.root}/${encodeURIComponent(id)}`, { name }));
    this.brands.update((rows) => rows.map((row) => (row.id === id ? { ...row, name: brand.name } : row)));
  }
  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.root}/${encodeURIComponent(id)}`));
    this.brands.update((rows) => rows.filter((row) => row.id !== id));
  }
  name(id: string | null | undefined): string {
    return (id && this.brands().find((row) => row.id === id)?.name) || "";
  }
}
