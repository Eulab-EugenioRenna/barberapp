import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CustomSelectComponent } from "../custom-select.component";
import { InfiniteScrollDirective } from "../shared/infinite-scroll.directive";
import { AutofocusFirstDirective } from "../shared/autofocus-first.directive";
import { UiIconComponent } from "../shared/ui-icon.component";
import { serviceProductModeLabel } from "../shared/presentation-copy";

@Component({
  selector: "barber-admin-services-page",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CustomSelectComponent,
    InfiniteScrollDirective,
    AutofocusFirstDirective,
    UiIconComponent,
  ],
  template: `
    <section class="grid gap-4 xl:grid-cols-2">
      <article class="panel rounded-[2rem] p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="eyebrow text-[var(--accent)]">Listino</p>
            <h3 class="font-display text-3xl">Servizi e trattamenti</h3>
          </div>
          <button type="button" class="primary-btn" (click)="openNewService()">
            <barber-ui-icon name="plus"></barber-ui-icon> Nuovo servizio
          </button>
        </div>
        <label class="field mt-5">
          <span>Cerca servizio</span>
          <input
            [(ngModel)]="serviceQuery"
            name="serviceSearch"
            type="search"
            autocomplete="off"
            placeholder="Nome o descrizione"
          />
        </label>
        <div class="mt-5 grid gap-3">
          <button
            *ngFor="let service of filteredServices"
            type="button"
            class="list-card text-left"
            (click)="openEditService(service)"
          >
            <div>
              <strong>{{ service.name }}</strong>
              <p class="mt-1 text-sm text-[var(--muted)]">
                {{
                  service.publicDescription ||
                    "Descrizione non ancora inserita"
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

      <article class="panel rounded-[2rem] p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="eyebrow text-[var(--accent)]">Vendita in salone</p>
            <h3 class="font-display text-3xl">Prodotti</h3>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="primary-btn"
              (click)="openNewProduct()"
            >
              <barber-ui-icon name="plus"></barber-ui-icon> Nuovo prodotto
            </button>
            <span class="status-pill status-pill-neutral">{{
              products.length
            }}</span>
          </div>
        </div>
        <label class="field mt-5">
          <span>Cerca prodotto</span>
          <input
            [(ngModel)]="productQuery"
            name="productSearch"
            type="search"
            autocomplete="off"
            placeholder="Nome o descrizione"
          />
        </label>
        <div class="mt-5 grid gap-2 sm:grid-cols-2">
          <button
            *ngFor="let product of filteredProducts"
            type="button"
            class="list-card text-left"
            (click)="openEditProduct(product)"
          >
            <strong>{{ product.name }}</strong>
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
            <h2 id="service-form-title" class="mt-2 font-display text-3xl">
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

        <form class="mt-5 grid gap-4" (ngSubmit)="submitService()">
          <label class="field">
            <span>Nome <em class="required-mark" aria-hidden="true">*</em></span>
            <input [(ngModel)]="serviceForm.name" name="serviceName" required />
          </label>
          <label class="field">
            <span>Descrizione pubblica</span>
            <input
              [(ngModel)]="serviceForm.publicDescription"
              name="servicePublicDescription"
            />
          </label>
          <div class="grid gap-4 md:grid-cols-2">
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
          <div class="grid gap-4 md:grid-cols-2">
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
                <span>Visibile ai clienti online</span>
              </label>
              <label class="field checkbox-field">
                <input
                  [(ngModel)]="serviceForm.isBookableOnline"
                  name="serviceIsBookableOnline"
                  type="checkbox"
                />
                <span>Prenotabile online</span>
              </label>
            </div>
          </div>
          <div class="field">
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
                      {{ formatServiceProductMode(serviceProduct.mode) }} · quantità
                      {{ serviceProduct.quantity }}
                      <span *ngIf="serviceProduct.priceLocked"
                        >· prezzo bloccato</span
                      >
                    </p>
                  </div>
                  <button
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
            <div class="mt-4 grid gap-4 md:grid-cols-2">
              <label class="field md:col-span-2">
                <span>Prodotto</span>
                <barber-custom-select
                  [value]="serviceProductForm.productId"
                  (valueChange)="serviceProductForm.productId = $event"
                  [options]="productSelectOptions"
                  label="Prodotto"
                  placeholder="Seleziona prodotto"
                ></barber-custom-select>
              </label>
              <label class="field">
                <span>Modalità</span>
                <barber-custom-select
                  [value]="serviceProductForm.mode"
                  (valueChange)="serviceProductForm.mode = $event"
                  [options]="serviceProductModeOptions"
                  label="Modalità"
                ></barber-custom-select>
              </label>
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
              type="submit"
              class="primary-btn"
              [disabled]="loading || !serviceFormValid"
            >
              <barber-ui-icon name="save"></barber-ui-icon>
              {{ serviceForm.id ? "Salva servizio" : "Crea servizio" }}
            </button>
            <button
              *ngIf="serviceForm.id"
              type="button"
              class="pill-btn"
              (click)="removeService()"
            >
              <barber-ui-icon name="trash"></barber-ui-icon> Elimina
            </button>
            <button type="button" class="secondary-btn" (click)="openNewService()">
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
            <h2 id="product-form-title" class="mt-2 font-display text-3xl">
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

        <form class="mt-5 grid gap-3" (ngSubmit)="submitProduct()">
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
          <label class="field"
            ><span>Descrizione</span
            ><input
              [(ngModel)]="productForm.description"
              name="productDescription"
          /></label>
          <div class="flex flex-wrap gap-2">
            <button
              type="submit"
              class="primary-btn"
              [disabled]="loading || !productFormValid"
            >
              <barber-ui-icon name="save"></barber-ui-icon>
              {{ productForm.id ? "Salva prodotto" : "Crea prodotto" }}
            </button>
            <button
              *ngIf="productForm.id"
              type="button"
              class="pill-btn"
              (click)="removeProductItem()"
            >
              <barber-ui-icon name="trash"></barber-ui-icon> Elimina prodotto
            </button>
            <button
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
export class AdminServicesPageComponent {
  protected readonly Number = Number;
  formatServiceProductMode = serviceProductModeLabel;
  @Input() services: any[] = [];
  @Input() products: any[] = [];
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
  @Output() resetProduct = new EventEmitter<void>();
  @Output() loadMoreServices = new EventEmitter<void>();
  @Output() loadMoreProducts = new EventEmitter<void>();

  serviceFormOpen = false;
  productFormOpen = false;
  serviceQuery = "";
  productQuery = "";

  get filteredServices(): any[] {
    return filterByText(this.services, this.serviceQuery, (service) => [
      service.name,
      service.publicDescription,
      service.category,
    ]);
  }

  get filteredProducts(): any[] {
    return filterByText(this.products, this.productQuery, (product) => [
      product.name,
      product.description,
      product.category,
    ]);
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

  openNewProduct(): void {
    this.resetProduct.emit();
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
