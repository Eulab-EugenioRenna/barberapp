import { PriceSettingsComponent } from "../shared/price-settings.component";
import { ActivityPickerComponent } from "../shared/activity-picker.component";
import { ActivitiesService } from "../core/activities.service";
import { FunctionAccessDirective } from "../shared/function-access.directive";
import { CommonModule } from "@angular/common";
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  inject,
} from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { AdminApiService } from "../core/admin-api.service";
import { BarcodeScannerService } from "../core/barcode-scanner.service";
import { SessionStore } from "../core/session.store";
import { FormsModule } from "@angular/forms";
import { UiSelectComponent } from "@alora/ui";
import { InfiniteScrollDirective } from "../shared/infinite-scroll.directive";
import { AutofocusFirstDirective } from "../shared/autofocus-first.directive";
import { UiIconComponent } from "../shared/ui-icon.component";
import { serviceProductModeLabel } from "../shared/presentation-copy";

import { ProductBrandsService } from "../core/product-brands.service";
@Component({
  selector: "barber-admin-services-page",
  standalone: true,
  imports: [
    PriceSettingsComponent,
    ActivityPickerComponent,
    FunctionAccessDirective,
    CommonModule,
    FormsModule,
    UiSelectComponent,
    InfiniteScrollDirective,
    AutofocusFirstDirective,
    UiIconComponent,
  ],
  template: `
    <section class="grid gap-4 xl:grid-cols-2">
      <article
        aloraFunction="services.read"
        data-tour="services-services"
        class="panel rounded-[2rem] p-4 sm:p-5"
      >
        <div class="page-head">
          <div class="min-w-0">
            <p class="eyebrow text-[var(--accent)]">Listino</p>
            <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 class="font-display text-2xl sm:text-3xl">
                Servizi e trattamenti
              </h3>
              <span class="status-pill status-pill-neutral"
                >{{ filteredServices.length }} servizi</span
              >
            </div>
          </div>
          <button
            aloraFunction="services.manage"
            data-tour="services-new-service"
            type="button"
            class="primary-btn"
            (click)="openNewService()"
          >
            <barber-ui-icon name="plus"></barber-ui-icon> Nuovo servizio
          </button>
        </div>
        <div class="catalog-filters mt-4">
          <label class="field" data-tour="services-search-service">
            <span>Cerca servizio</span>
            <input
              [(ngModel)]="serviceQuery"
              name="serviceSearch"
              type="search"
              autocomplete="off"
              placeholder="Nome o descrizione"
            />
          </label>
          <label class="field" data-tour="services-activity-filter" *ngIf="activityFilterOptions.length > 2">
            <span>Attività</span>
            <select [(ngModel)]="serviceActivity" name="serviceActivity">
              <option *ngFor="let option of activityFilterOptions" [value]="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>
        <div class="mt-4 grid gap-2.5 sm:gap-3" data-tour="services-service-list">
          <button
            *ngFor="let service of filteredServices"
            type="button"
            class="list-card text-left"
            (click)="openEditService(service)"
          >
            <div>
              <strong>{{ service.name }}</strong><span *ngIf="service.isActive===false" class="status-pill">Disattivato</span>
              <span *ngIf="activityName(service.activityId)" class="status-pill status-pill-neutral ml-1">{{ activityName(service.activityId) }}</span>
              <p class="mt-1 text-sm text-[var(--muted)]">
                {{
                  service.publicDescription || "Descrizione non ancora inserita"
                }}
              </p>
            </div>
            <div class="text-right">
              <strong>€{{ service.basePrice }}</strong>
              <p class="text-sm text-[var(--muted)]">
                {{ service.durationMinutes }} min
              </p>
            </div>
          </button>
          <article
            *ngIf="!filteredServices.length"
            class="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]"
          >
            Nessun servizio. Usa “+ Nuovo servizio” per crearlo.
          </article>
          <div
            *ngIf="servicesHasMore"
            class="h-px w-full"
            barberInfiniteScroll
            (loadMore)="loadMoreServices.emit()"
          ></div>
        </div>
      </article>

      <article
        aloraFunction="services.read"
        data-tour="services-products"
        class="panel rounded-[2rem] p-4 sm:p-5"
      >
        <div class="page-head">
          <div class="min-w-0">
            <p class="eyebrow text-[var(--accent)]">Vendita in salone</p>
            <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 class="font-display text-2xl sm:text-3xl">Prodotti</h3>
              <span class="status-pill status-pill-neutral"
                >{{ products.length }} prodotti</span
              >
            </div>
          </div>
          <button
            aloraFunction="services.manage"
            data-tour="services-new-product"
            type="button"
            class="primary-btn"
            (click)="openNewProduct()"
          >
            <barber-ui-icon name="plus"></barber-ui-icon> Nuovo prodotto
          </button>
        </div>
        <div class="catalog-filters mt-4">
          <label class="field" data-tour="services-search-product">
            <span>Cerca prodotto</span>
            <input
              [(ngModel)]="productQuery"
              name="productSearch"
              type="search"
              autocomplete="off"
              placeholder="Nome, descrizione o barcode"
              (keydown.enter)="$event.preventDefault(); findByBarcode(productQuery)"
            />
          </label>
          <label class="field" *ngIf="brands.brands().length">
            <span>Brand</span>
            <select [(ngModel)]="productBrand" name="productBrand">
              <option *ngFor="let option of brandFilterOptions" [value]="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label class="field" *ngIf="activityFilterOptions.length > 2">
            <span>Attività</span>
            <select [(ngModel)]="productActivity" name="productActivity">
              <option *ngFor="let option of activityFilterOptions" [value]="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>
        <p
          *ngIf="scanFeedback"
          role="status"
          class="mt-2 text-sm"
          [class.text-[var(--danger)]]="scanFeedbackKind === 'error'"
          data-tour="services-scan-feedback"
        >
          {{ scanFeedback }}
        </p>
        <div class="mt-4 grid gap-2 sm:grid-cols-2" data-tour="services-product-list">
          <button
            *ngFor="let product of filteredProducts"
            type="button"
            class="list-card text-left"
            (click)="openEditProduct(product)"
          >
            <strong>{{ product.name }}</strong><span *ngIf="product.isActive===false" class="status-pill">Disattivato</span>
            <span *ngIf="brands.name(product.brandId)" class="text-xs font-semibold text-[var(--accent)]">{{ brands.name(product.brandId) }}</span>
            <span *ngIf="product.barcode" class="text-xs text-[var(--muted)]">{{ product.barcode }}</span>
            <span *ngIf="activityName(product.activityId)" class="text-xs text-[var(--muted)]">{{ activityName(product.activityId) }}</span>
            <span class="text-sm text-[var(--muted)]">
              {{
                product.price === null || product.price === undefined
                  ? "Prezzo libero"
                  : "€" + Number(product.price).toFixed(2)
              }}
            </span>
          </button>
          <article
            *ngIf="!filteredProducts.length"
            class="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)] sm:col-span-2"
          >
            Nessun prodotto nel catalogo.
          </article>
          <div
            *ngIf="productsHasMore"
            class="h-px w-full sm:col-span-2"
            barberInfiniteScroll
            (loadMore)="loadMoreProducts.emit()"
          ></div>
        </div>
        <details *ngIf="brands.brands().length" class="mt-4" aloraFunction="services.manage">
          <summary class="cursor-pointer text-sm font-semibold">Brand ({{ brands.brands().length }})</summary>
          <ul class="mt-3 grid gap-2">
            <li *ngFor="let brand of brands.brands()" class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] py-2">
              <ng-container *ngIf="renamingBrandId === brand.id; else brandRow">
                <input class="min-w-0 flex-1" [(ngModel)]="renamingBrandName" [name]="'brand-' + brand.id" maxlength="80" (keydown.enter)="$event.preventDefault(); saveBrandName()" />
                <span class="flex gap-2">
                  <button type="button" class="secondary-btn" (click)="saveBrandName()">Salva</button>
                  <button type="button" class="pill-btn" (click)="renamingBrandId = ''">Annulla</button>
                </span>
              </ng-container>
              <ng-template #brandRow>
                <span><strong>{{ brand.name }}</strong> <small class="text-[var(--muted)]">· {{ brand.products }} prodotti</small></span>
                <span class="flex gap-2">
                  <button type="button" class="pill-btn" (click)="renamingBrandId = brand.id; renamingBrandName = brand.name">Rinomina</button>
                  <button type="button" class="pill-btn" (click)="removeBrand(brand)">Elimina</button>
                </span>
              </ng-template>
            </li>
          </ul>
        </details>
      </article>
    </section>

    <div *ngIf="serviceFormOpen" class="confirm-overlay">
      <button
        type="button"
        class="confirm-backdrop"
        (click)="serviceFormOpen = false"
        aria-label="Chiudi modulo servizio"
      ></button>
      <article
        barberAutofocusFirst
        class="confirm-dialog panel max-h-[85vh] overflow-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-form-title"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="eyebrow text-[var(--accent)]">Servizio</p>
            <h2
              id="service-form-title"
              class="mt-2 font-display text-2xl sm:text-3xl"
            >
              {{ serviceForm.id ? "Modifica servizio" : "Nuovo servizio" }}
            </h2>
          </div>
          <button
            type="button"
            class="pill-btn"
            (click)="serviceFormOpen = false"
          >
            Chiudi
          </button>
        </div>

        <form class="mt-4 grid gap-4" (ngSubmit)="submitService()">
          <label class="field">
            <span
              >Nome <em class="required-mark" aria-hidden="true">*</em></span
            >
            <input [(ngModel)]="serviceForm.name" name="serviceName" required />
          </label>
          <alora-activity-picker
            kind="service"
            [value]="serviceForm.activityId"
            (valueChange)="serviceForm.activityId = $event"
          ></alora-activity-picker>
          <label class="field">
            <span>Risorse richieste</span>
            <span
              ><input
                type="checkbox"
                [(ngModel)]="serviceForm.requiresRoom"
                name="requiresRoom"
              />
              Richiede una stanza o postazione della sede</span
            >
          </label>
          <label class="field">
            <span>Descrizione pubblica</span>
            <input
              [(ngModel)]="serviceForm.publicDescription"
              name="servicePublicDescription"
            />
          </label>
          <div class="grid gap-3 sm:gap-4 md:grid-cols-2">
            <label class="field">
              <span>Durata minuti</span>
              <input
                [(ngModel)]="serviceForm.durationMinutes"
                name="serviceDurationMinutes"
                type="number"
                min="15"
                step="15"
              />
            </label>
            <label class="field">
              <span>Prezzo</span>
              <input
                [(ngModel)]="serviceForm.basePrice"
                name="serviceBasePrice"
                type="number"
                min="0"
                step="1"
              />
            </label>
          </div>
          <details class="field" [open]="serviceForm.priceMode && serviceForm.priceMode !== 'legacy'">
            <summary class="cursor-pointer text-sm font-semibold">IVA e tipo di prezzo</summary>
            <alora-price-settings kind="service" [value]="serviceForm"></alora-price-settings>
          </details>
          <div class="grid gap-3 sm:gap-4 md:grid-cols-2">
            <label class="field">
              <span>Colore</span>
              <input
                [(ngModel)]="serviceForm.color"
                name="serviceColor"
                type="color"
              />
            </label>
            <div class="grid gap-3 pt-6">
              <label class="field checkbox-field">
                <input
                  [(ngModel)]="serviceForm.isPublic"
                  name="serviceIsPublic"
                  type="checkbox"
                />
                <span>Mostra sulla pagina di prenotazione</span>
              </label>
              <label *ngIf="serviceForm.isPublic" class="field checkbox-field">
                <input
                  [(ngModel)]="serviceForm.isBookableOnline"
                  name="serviceIsBookableOnline"
                  type="checkbox"
                />
                <span>I clienti possono prenotarlo da soli</span>
              </label>
            </div>
          </div>
          <p *ngIf="!serviceForm.id" class="field-hint">Prodotti collegati: salva prima il servizio, poi potrai collegare i prodotti che usa o che consigli.</p>
          <p *ngIf="serviceForm.id && !products.length" class="field-hint">Prodotti collegati: per collegarli serve prima creare i prodotti nella scheda «Prodotti».</p>
          <div *ngIf="serviceForm.id && products.length" class="field">
            <span>Prodotti consigliati con il servizio</span>
            <div
              class="mt-3 grid gap-3"
              *ngIf="
                serviceForm.serviceProducts?.length;
                else noServiceProducts
              "
            >
              <article
                *ngFor="let serviceProduct of serviceForm.serviceProducts"
                class="rounded-2xl border border-[var(--line)] px-4 py-3"
              >
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <strong>{{ serviceProduct.product?.name }}</strong>
                    <p class="text-sm text-[var(--muted)]">
                      {{ formatServiceProductMode(serviceProduct.mode) }} ·
                      quantità
                      {{ serviceProduct.quantity }}
                      <span *ngIf="serviceProduct.priceLocked"
                        >· prezzo bloccato</span
                      >
                    </p>
                  </div>
                  <button
                    aloraFunction="services.manage"
                    type="button"
                    class="pill-btn"
                    (click)="detachProduct.emit(serviceProduct.productId)"
                  >
                    Rimuovi
                  </button>
                </div>
              </article>
            </div>
            <ng-template #noServiceProducts>
              <p class="mt-3 text-sm text-[var(--muted)]">
                Nessun prodotto associato a questo servizio.
              </p>
            </ng-template>
            <div class="mt-4 grid gap-3 sm:gap-4 md:grid-cols-2">
              <div class="field md:col-span-2">
                <span>Prodotto</span>
                <ui-select
                  [value]="serviceProductForm.productId"
                  (valueChange)="selectServiceProduct($event)"
                  [options]="productSelectOptions"
                  label="Prodotto"
                  placeholder="Seleziona prodotto"
                ></ui-select>
              </div>
              <div class="field">
                <span>Modalità</span>
                <ui-select
                  [value]="serviceProductForm.mode"
                  (valueChange)="serviceProductForm.mode = $event"
                  [options]="serviceProductModeOptions"
                  label="Modalità"
                ></ui-select>
              </div>
              <label class="field">
                <span>Quantità</span>
                <input
                  [(ngModel)]="serviceProductForm.quantity"
                  name="serviceProductQuantity"
                  type="number"
                  min="1"
                  step="1"
                />
              </label>
              <label *ngIf="selectedProductTracked" class="field md:col-span-2" aloraFunction="inventory.manage"><span>Quantità scaricata dal magazzino a ogni servizio (facoltativo)</span><input type="number" min="0.001" step="0.001" [(ngModel)]="serviceProductForm.consumptionUnits" name="consumptionUnits" placeholder="Vuoto: nessuno scarico automatico"></label>
              <label class="field checkbox-field md:col-span-2">
                <input
                  [(ngModel)]="serviceProductForm.priceLocked"
                  name="serviceProductPriceLocked"
                  type="checkbox"
                />
                <span>Blocca prezzo prodotto nel servizio</span>
              </label>
            </div>
            <div class="mt-3">
              <button
                aloraFunction="services.manage"
                type="button"
                class="pill-btn"
                [disabled]="
                  !serviceForm.id || !serviceProductForm.productId || loading
                "
                (click)="attachProduct.emit()"
              >
                Collega prodotto
              </button>
            </div>
          </div>
          <div class="flex flex-wrap gap-3">
            <button
              aloraFunction="services.manage"
              type="submit"
              class="primary-btn"
              [disabled]="loading || !serviceFormValid"
            >
              <barber-ui-icon name="save"></barber-ui-icon>
              {{ serviceForm.id ? "Salva servizio" : "Crea servizio" }}
            </button>
            <button
              aloraFunction="services.manage"
              *ngIf="serviceForm.id"
              type="button"
              class="pill-btn"
              (click)="removeService()"
            >
              <barber-ui-icon name="trash"></barber-ui-icon> Elimina
            </button>
            <button
              aloraFunction="services.manage"
              type="button"
              class="secondary-btn"
              (click)="openNewService()"
            >
              <barber-ui-icon name="plus"></barber-ui-icon> Nuovo servizio
            </button>
          </div>
        </form>
      </article>
    </div>

    <div *ngIf="productFormOpen" class="confirm-overlay">
      <button
        type="button"
        class="confirm-backdrop"
        (click)="productFormOpen = false"
        aria-label="Chiudi modulo prodotto"
      ></button>
      <article
        barberAutofocusFirst
        class="confirm-dialog panel max-h-[85vh] overflow-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-form-title"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="eyebrow text-[var(--accent)]">Prodotto</p>
            <h2
              id="product-form-title"
              class="mt-2 font-display text-2xl sm:text-3xl"
            >
              {{ productForm.id ? "Modifica prodotto" : "Nuovo prodotto" }}
            </h2>
          </div>
          <button
            type="button"
            class="pill-btn"
            (click)="productFormOpen = false"
          >
            Chiudi
          </button>
        </div>

        <form class="mt-4 grid gap-3" (ngSubmit)="submitProduct()">
          <alora-price-settings kind="product" [value]="productForm"></alora-price-settings>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="field"
              ><span
                >Nome <em class="required-mark" aria-hidden="true">*</em></span
              ><input
                [(ngModel)]="productForm.name"
                name="productName"
                required
            /></label>
            <label class="field"
              ><span>Prezzo di vendita</span
              ><input
                [(ngModel)]="productForm.price"
                name="productPrice"
                type="number"
                min="0"
                step="0.01"
                placeholder="Puoi definirlo anche al momento della vendita"
            /></label>
          </div>
          <div class="field" data-tour="services-product-brand">
            <span>Brand (facoltativo)</span>
            <select [(ngModel)]="productForm.brandId" name="productBrandId" *ngIf="brands.brands().length">
              <option *ngFor="let option of brandSelectOptions" [value]="option.value">{{ option.label }}</option>
            </select>
            <div class="flex flex-wrap gap-2">
              <input
                class="min-w-0 flex-1"
                [(ngModel)]="newBrandName"
                name="productNewBrand"
                maxlength="80"
                [placeholder]="brands.brands().length ? 'Oppure scrivi un nuovo brand' : 'Es. Davines, Proraso'"
                (keydown.enter)="$event.preventDefault(); addBrand()"
              />
              <button type="button" class="secondary-btn" [disabled]="!newBrandName.trim()" (click)="addBrand()">Aggiungi brand</button>
            </div>
            <small class="field-hint">Raggruppa i prodotti: in Panoramica › Prodotti vedi il venduto per brand.</small>
            <small *ngIf="brandFeedback" role="status">{{ brandFeedback }}</small>
          </div>
          <alora-activity-picker
            kind="product"
            [value]="productForm.activityId"
            (valueChange)="productForm.activityId = $event"
          ></alora-activity-picker>
          <label class="field" data-tour="services-product-barcode"
            ><span>Barcode (EAN/UPC o codice interno)</span
            ><input
              [(ngModel)]="productForm.barcode"
              name="productBarcode"
              autocomplete="off"
              inputmode="numeric"
              placeholder="Scansiona il prodotto o scrivi il codice"
              (keydown.enter)="$event.preventDefault()"
          /></label>
          <label class="field"
            ><span>Descrizione</span
            ><input
              [(ngModel)]="productForm.description"
              name="productDescription"
          /></label>
          <div class="flex flex-wrap gap-2">
            <button
              aloraFunction="services.manage"
              type="submit"
              class="primary-btn"
              [disabled]="loading || !productFormValid"
            >
              <barber-ui-icon name="save"></barber-ui-icon>
              {{ productForm.id ? "Salva prodotto" : "Crea prodotto" }}
            </button>
            <button
              aloraFunction="services.manage"
              *ngIf="productForm.id"
              type="button"
              class="pill-btn"
              (click)="removeProductItem()"
            >
              <barber-ui-icon name="trash"></barber-ui-icon> Elimina prodotto
            </button>
            <button
              aloraFunction="services.manage"
              type="button"
              class="secondary-btn"
              (click)="openNewProduct()"
            >
              <barber-ui-icon name="plus"></barber-ui-icon> Nuovo prodotto
            </button>
          </div>
        </form>
      </article>
    </div>
  `,
})
export class AdminServicesPageComponent implements OnInit, OnDestroy, OnChanges {
  protected readonly Number = Number;
  formatServiceProductMode = serviceProductModeLabel;
  @Input() services: any[] = [];
  @Input() products: any[] = [];
  /** Stock is unloaded per service only for products whose stock is tracked. */
  get selectedProductTracked(): boolean {
    const id = this.serviceProductForm?.productId;
    return !!id && !!this.products.find((product) => product.id === id)?.stockTracked;
  }
  @Input() serviceForm: any = {};
  @Input() productForm: any = {};
  @Input() serviceProductForm: any = {};
  @Input() serviceProductModeOptions: Array<{ value: string; label: string }> =
    [];
  @Input() productSelectOptions: Array<{ value: string; label: string }> = [];
  @Input() loading = false;
  @Input() servicesHasMore = false;
  @Input() productsHasMore = false;

  @Output() edit = new EventEmitter<any>();
  @Output() detachProduct = new EventEmitter<string>();
  @Output() attachProduct = new EventEmitter<void>();
  @Output() save = new EventEmitter<void>();
  @Output() remove = new EventEmitter<void>();
  @Output() reset = new EventEmitter<void>();
  @Output() editProduct = new EventEmitter<any>();
  @Output() saveProduct = new EventEmitter<void>();
  @Output() removeProduct = new EventEmitter<void>();
  /** Optional prefill, e.g. the barcode just scanned. */
  @Output() resetProduct = new EventEmitter<{ barcode?: string } | void>();
  @Output() loadMoreServices = new EventEmitter<void>();
  @Output() loadMoreProducts = new EventEmitter<void>();
  /** Products changed outside the form (e.g. a brand removed). */
  @Output() reloadProducts = new EventEmitter<void>();

  private readonly scanner = inject(BarcodeScannerService);
  private readonly adminApi = inject(AdminApiService);
  private readonly session = inject(SessionStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private scannerDetach: (() => void) | null = null;
  scanFeedback = "";
  scanFeedbackKind: "ok" | "error" | "info" = "ok";

  serviceFormOpen = false;
  productFormOpen = false;
  serviceQuery = "";
  productQuery = "";

  readonly activities = inject(ActivitiesService);
  readonly brands = inject(ProductBrandsService);
  serviceActivity = "";
  productActivity = "";
  productBrand = "";
  newBrandName = "";
  brandFeedback = "";
  renamingBrandId = "";
  renamingBrandName = "";

  get brandFilterOptions(): Array<{ value: string; label: string }> {
    return [
      { value: "", label: "Tutti i brand" },
      ...this.brands.brands().map((row) => ({ value: row.id, label: row.name })),
      { value: "none", label: "Senza brand" },
    ];
  }
  get brandSelectOptions(): Array<{ value: string; label: string }> {
    return [{ value: "", label: "Nessun brand" }, ...this.brands.brands().map((row) => ({ value: row.id, label: row.name }))];
  }
  /** Typed in the product form: creates the brand (or reuses one with that name) and selects it. */
  async addBrand(): Promise<void> {
    const name = this.newBrandName.trim();
    if (!name) return;
    try {
      const brand = await this.brands.create(name);
      this.productForm.brandId = brand.id;
      this.newBrandName = "";
      this.brandFeedback = "";
    } catch (error: any) {
      this.brandFeedback = error?.error?.message || "Brand non creato";
    }
  }
  async saveBrandName(): Promise<void> {
    const name = this.renamingBrandName.trim();
    if (!this.renamingBrandId || !name) return;
    try {
      await this.brands.rename(this.renamingBrandId, name);
      this.renamingBrandId = "";
      this.brandFeedback = "Brand rinominato";
    } catch (error: any) {
      this.brandFeedback = error?.error?.message || "Brand non rinominato";
    }
  }
  async removeBrand(brand: { id: string; name: string; products: number }): Promise<void> {
    const note = brand.products ? ` I suoi ${brand.products} prodotti restano, senza brand.` : "";
    if (!window.confirm(`Eliminare il brand «${brand.name}»?${note}`)) return;
    try {
      await this.brands.remove(brand.id);
      if (this.productBrand === brand.id) this.productBrand = "";
      this.brandFeedback = "Brand eliminato";
      this.reloadProducts.emit();
    } catch (error: any) {
      this.brandFeedback = error?.error?.message || "Brand non eliminato";
    }
  }

  get activityFilterOptions(): Array<{ value: string; label: string }> {
    return [
      { value: "", label: "Tutte le attività" },
      ...this.activities.activities().map((row) => ({ value: row.id, label: row.name })),
    ];
  }

  activityName(id: string | null | undefined): string {
    return this.activities.byId(id)?.name ?? "";
  }

  get filteredServices(): any[] {
    return filterByText(
      this.services.filter((service) => !this.serviceActivity || service.activityId === this.serviceActivity),
      this.serviceQuery,
      (service) => [
      service.name,
      service.publicDescription,
      service.category,
    ]);
  }

  get filteredProducts(): any[] {
    return filterByText(
      this.products.filter(
        (product) =>
          (!this.productActivity || product.activityId === this.productActivity) &&
          (!this.productBrand ||
            (this.productBrand === "none" ? !product.brandId : product.brandId === this.productBrand)),
      ),
      this.productQuery,
      (product) => [
      product.name,
      product.brand?.name,
      product.description,
      product.category,
      product.barcode,
      product.sku,
    ]);
  }

  ngOnInit(): void {
    void this.activities.load().catch(() => undefined);
    void this.brands.load();
    // A scan anywhere on the catalogue (outside text fields) finds or creates the product.
    this.scannerDetach = this.scanner.attach((event) => this.findByBarcode(event.barcode, true));
    // Coming from the warehouse with an unknown code: start the new product with it.
    const barcode = this.route.snapshot.queryParamMap.get("barcode")?.trim();
    if (barcode) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { barcode: null },
        queryParamsHandling: "merge",
        replaceUrl: true,
      });
      if (this.session.can("services.manage")) this.openNewProduct(barcode);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Product counts per brand follow the saved products.
    if (changes["products"] && !changes["products"].firstChange) void this.brands.load();
  }

  ngOnDestroy(): void {
    this.scannerDetach?.();
    this.scannerDetach = null;
  }

  /**
   * Scanned (or typed + Enter in the search) code: an open product form takes
   * it as its barcode; otherwise the product opens, or a new one starts with it.
   */
  async findByBarcode(value: string, fromScanner = false): Promise<void> {
    const barcode = String(value || "").trim().replace(/\s+/g, "");
    if (!barcode) return;
    if (this.productFormOpen) {
      this.productForm.barcode = barcode;
      this.showScanFeedback("ok", `Barcode ${barcode} inserito nella scheda`);
      return;
    }
    if (this.serviceFormOpen) return;
    try {
      const product = await firstValueFrom(this.adminApi.findProductByBarcode(barcode));
      if (product?.id) {
        this.productQuery = "";
        this.showScanFeedback("ok", `Trovato: ${product.name}`);
        this.openEditProduct(product);
        return;
      }
      this.unknownBarcode(barcode, fromScanner);
    } catch (error: any) {
      if (error?.status === 404) return this.unknownBarcode(barcode, fromScanner);
      this.showScanFeedback(
        "error",
        error?.status === 0
          ? "Rete assente. Riprova quando la connessione è disponibile."
          : error?.error?.message || "Ricerca del barcode non riuscita",
      );
    }
  }

  private unknownBarcode(barcode: string, fromScanner: boolean): void {
    // Enter in the search box with a name is a normal search, not a code.
    if (!fromScanner && this.filteredProducts.length) return;
    if (!this.session.can("services.manage")) {
      this.showScanFeedback("info", "Nessun prodotto con questo barcode");
      return;
    }
    this.productQuery = "";
    this.showScanFeedback("info", `Nuovo prodotto con barcode ${barcode}: completa la scheda`);
    this.openNewProduct(barcode);
  }

  private showScanFeedback(kind: "ok" | "error" | "info", message: string): void {
    this.scanFeedback = message;
    this.scanFeedbackKind = kind;
  }

  openEditService(service: any): void {
    this.edit.emit(service);
    this.serviceFormOpen = true;
  }

  openNewService(): void {
    this.reset.emit();
    this.serviceFormOpen = true;
  }

  submitService(): void {
    this.save.emit();
    this.serviceFormOpen = false;
  }

  removeService(): void {
    this.serviceFormOpen = false;
    this.remove.emit();
  }

  openEditProduct(product: any): void {
    this.editProduct.emit(product);
    this.productFormOpen = true;
  }

  openNewProduct(barcode?: string): void {
    this.resetProduct.emit(barcode ? { barcode } : undefined);
    this.productFormOpen = true;
  }

  submitProduct(): void {
    this.saveProduct.emit();
    this.productFormOpen = false;
  }

  removeProductItem(): void {
    this.productFormOpen = false;
    this.removeProduct.emit();
  }

  get serviceFormValid(): boolean {
    return (
      Boolean(textValue(this.serviceForm.name)) &&
      Number(this.serviceForm.durationMinutes) > 0
    );
  }

  selectServiceProduct(id:string){const old=this.serviceForm.serviceProducts?.find((row:any)=>row.productId===id);Object.assign(this.serviceProductForm,{productId:id,mode:old?.mode||"optional",quantity:old?.quantity??1,priceLocked:old?.priceLocked??false,consumptionUnits:old?.consumptionUnits??""});}
  get productFormValid(): boolean {
    return Boolean(textValue(this.productForm.name));
  }
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function filterByText<T>(
  items: T[],
  query: string,
  fields: (item: T) => Array<unknown>,
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return items;
  }
  return items.filter((item) =>
    fields(item)
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}
