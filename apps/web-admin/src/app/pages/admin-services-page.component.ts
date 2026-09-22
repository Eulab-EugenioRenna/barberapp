import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CustomSelectComponent } from "../custom-select.component";

@Component({
  selector: "barber-admin-services-page",
  standalone: true,
  imports: [CommonModule, FormsModule, CustomSelectComponent],
  template: `
    <section class="grid gap-4 xl:grid-cols-2">
      <article class="panel rounded-[2rem] p-5">
        <p class="eyebrow text-[var(--accent)]">Catalogo</p>
        <h3 class="font-display text-3xl">Servizi</h3>
        <div class="mt-5 grid gap-3">
          <button
            *ngFor="let service of services"
            type="button"
            class="list-card text-left"
            (click)="edit.emit(service)"
          >
            <div>
              <strong>{{ service.name }}</strong>
              <p class="mt-1 text-sm text-[var(--muted)]">
                {{
                  service.publicDescription ||
                    "Descrizione interna non impostata"
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
            *ngIf="!services.length"
            class="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]"
          >
            Nessun servizio. Crea il primo servizio dal modulo a destra.
          </article>
        </div>

        <div class="mt-8 border-t border-black/10 pt-6">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="eyebrow text-[var(--accent)]">Retail</p>
              <h3 class="font-display text-2xl">Prodotti</h3>
            </div>
            <span class="status-pill status-pill-neutral">{{
              products.length
            }}</span>
          </div>
          <div class="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              *ngFor="let product of products"
              type="button"
              class="list-card text-left"
              (click)="editProduct.emit(product)"
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
              *ngIf="!products.length"
              class="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)] sm:col-span-2"
            >
              Nessun prodotto nel catalogo.
            </article>
          </div>
          <form
            class="mt-5 grid gap-3 rounded-2xl border border-black/10 p-4"
            (ngSubmit)="saveProduct.emit()"
          >
            <strong>{{
              productForm.id ? "Modifica prodotto" : "Nuovo prodotto"
            }}</strong>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="field"
                ><span>Nome</span
                ><input
                  [(ngModel)]="productForm.name"
                  name="productName"
                  required
              /></label>
              <label class="field"
                ><span>Prezzo opzionale</span
                ><input
                  [(ngModel)]="productForm.price"
                  name="productPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Da inserire in cassa"
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
                {{ productForm.id ? "Salva prodotto" : "Crea prodotto" }}
              </button>
              <button
                *ngIf="productForm.id"
                type="button"
                class="pill-btn"
                (click)="removeProduct.emit()"
              >
                Elimina prodotto
              </button>
              <button
                type="button"
                class="secondary-btn"
                (click)="resetProduct.emit()"
              >
                Nuovo prodotto
              </button>
            </div>
          </form>
        </div>
      </article>

      <article class="dark-panel rounded-[2rem] p-5 text-white">
        <p class="eyebrow text-white/45">CRUD servizi</p>
        <h3 class="font-display text-3xl">
          {{ serviceForm.id ? "Modifica servizio" : "Nuovo servizio" }}
        </h3>
        <form class="mt-5 grid gap-4" (ngSubmit)="save.emit()">
          <label class="field">
            <span>Nome</span>
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
                <span>Visibile nel public</span>
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
            <span>Catalogo prodotti collegato</span>
            <div
              class="mt-3 grid gap-3"
              *ngIf="
                serviceForm.serviceProducts?.length;
                else noServiceProducts
              "
            >
              <article
                *ngFor="let serviceProduct of serviceForm.serviceProducts"
                class="rounded-2xl border border-white/10 px-4 py-3"
              >
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <strong>{{ serviceProduct.product?.name }}</strong>
                    <p class="text-sm text-white/65">
                      {{ serviceProduct.mode }} · qta
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
              <p class="mt-3 text-sm text-white/65">
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
                <span>Modalita</span>
                <barber-custom-select
                  [value]="serviceProductForm.mode"
                  (valueChange)="serviceProductForm.mode = $event"
                  [options]="serviceProductModeOptions"
                  label="Modalita"
                ></barber-custom-select>
              </label>
              <label class="field">
                <span>Quantita</span>
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
                [disabled]="!serviceForm.id"
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
              {{ serviceForm.id ? "Salva servizio" : "Crea servizio" }}
            </button>
            <button
              *ngIf="serviceForm.id"
              type="button"
              class="pill-btn"
              (click)="remove.emit()"
            >
              Elimina
            </button>
            <button type="button" class="secondary-btn" (click)="reset.emit()">
              Nuovo servizio
            </button>
          </div>
        </form>
      </article>
    </section>
  `,
})
export class AdminServicesPageComponent {
  protected readonly Number = Number;
  @Input() services: any[] = [];
  @Input() products: any[] = [];
  @Input() serviceForm: any = {};
  @Input() productForm: any = {};
  @Input() serviceProductForm: any = {};
  @Input() serviceProductModeOptions: Array<{ value: string; label: string }> =
    [];
  @Input() productSelectOptions: Array<{ value: string; label: string }> = [];
  @Input() loading = false;

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
