import { SectorPickerComponent } from "./shared/sector-picker.component";
import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { firstValueFrom } from "rxjs";
import { AdminApiService } from "./core/admin-api.service";
import { AutofocusFirstDirective } from "./shared/autofocus-first.directive";

export type QuickCreateKind = "customer" | "service" | "product";

export interface QuickCreatePrefill {
  barcode?: string;
}

@Component({
  selector: "barber-quick-create-dialog",
  standalone: true,
  imports: [
    SectorPickerComponent,
    CommonModule,
    FormsModule,
    AutofocusFirstDirective,
  ],
  template: `
    <div
      barberAutofocusFirst
      class="quick-create-overlay"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
    >
      <button
        type="button"
        class="quick-create-backdrop"
        aria-label="Chiudi"
        [disabled]="saving"
        (click)="cancel.emit()"
      ></button>
      <form class="quick-create-dialog" (ngSubmit)="save()">
        <p class="eyebrow text-[var(--accent)]">Aggiunta veloce</p>
        <h2 [id]="titleId" class="font-display text-2xl sm:text-3xl">
          {{ title }}
        </h2>
        <p class="mt-2 text-sm text-[var(--muted)]">
          Potrai completare i dettagli in seguito.
        </p>
        <label *ngIf="kind === 'product' && barcode" class="field mt-4">
          <span>Associa a un prodotto del catalogo</span>
          <select
            [(ngModel)]="existingProductId"
            name="quickCreateExistingProduct"
          >
            <option value="">Crea un nuovo prodotto</option>
            <option
              *ngFor="let product of associableProducts"
              [value]="product.id"
            >
              {{ product.name }}
            </option>
          </select>
        </label>
        <label *ngIf="!existingProductId" class="field mt-4">
          <span
            >{{ kind === "customer" ? "Nome cliente" : "Nome" }}
            <em class="required-mark" aria-hidden="true">*</em></span
          >
          <input
            [(ngModel)]="name"
            name="quickCreateName"
            required
            autofocus
            [placeholder]="placeholder"
          />
        </label>
        <label
          *ngIf="kind !== 'customer' && !existingProductId"
          class="field mt-4"
        >
          <span
            >Prezzo <em class="required-mark" aria-hidden="true">*</em></span
          >
          <input
            [(ngModel)]="price"
            name="quickCreatePrice"
            type="number"
            min="0"
            step="0.01"
            inputmode="decimal"
            required
            placeholder="0,00"
          />
        </label>
        <label *ngIf="kind === 'product'" class="field mt-4">
          <span>Barcode (EAN/UPC o codice interno)</span>
          <input
            [(ngModel)]="barcode"
            name="quickCreateBarcode"
            placeholder="8051234567890"
          />
        </label>
        <alora-sector-picker
          *ngIf="kind === 'service'"
          [(value)]="sectorId"
        ></alora-sector-picker>
        <p
          *ngIf="error"
          role="alert"
          class="mt-3 text-sm font-semibold text-red-700"
        >
          {{ error }}
        </p>
        <div class="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            class="pill-btn"
            [disabled]="saving"
            (click)="cancel.emit()"
          >
            Annulla
          </button>
          <button
            type="submit"
            class="primary-btn"
            [disabled]="
              saving ||
              (!existingProductId &&
                (!name.trim() || (kind !== 'customer' && price === '')))
            "
          >
            {{ saving ? "Salvataggio..." : "Salva e seleziona" }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [
    `
      .quick-create-overlay {
        position: fixed;
        z-index: 1300;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 1rem;
      }
      .quick-create-backdrop {
        position: absolute;
        inset: 0;
        border: 0;
        background: rgba(30, 52, 37, 0.42);
        backdrop-filter: blur(3px);
      }
      .quick-create-dialog {
        position: relative;
        width: min(100%, 28rem);
        border: 0.0625rem solid var(--line);
        border-radius: 1.75rem;
        background: #fffdf9;
        padding: 1.5rem;
        box-shadow: 0 1.5rem 4rem rgba(15, 23, 32, 0.22);
      }
    `,
  ],
})
export class QuickCreateDialogComponent {
  private readonly adminApi = inject(AdminApiService);
  @Input({ required: true }) kind: QuickCreateKind = "customer";
  @Input() products: any[] = [];
  @Input() set prefill(value: QuickCreatePrefill | null) {
    this.barcode = value?.barcode || "";
  }
  existingProductId = "";
  get associableProducts(): any[] {
    return this.products.filter(
      (product) =>
        product.isActive !== false &&
        (!product.barcode || product.barcode === this.barcode),
    );
  }
  @Output() cancel = new EventEmitter<void>();
  @Output() created = new EventEmitter<{
    kind: QuickCreateKind;
    entity: any;
  }>();
  name = "";
  sectorId = "";
  price: number | "" = "";
  barcode = "";
  saving = false;
  error = "";
  readonly titleId = `quick-create-${Math.random().toString(36).slice(2)}`;
  get title(): string {
    return `Nuovo ${this.kind === "customer" ? "cliente" : this.kind === "service" ? "servizio" : "prodotto"}`;
  }
  get placeholder(): string {
    return this.kind === "customer"
      ? "Es. Mario Rossi"
      : this.kind === "service"
        ? "Es. Taglio classico"
        : "Es. Shampoo";
  }
  async save(): Promise<void> {
    if (
      this.saving ||
      (!this.existingProductId &&
        (!this.name.trim() || (this.kind !== "customer" && this.price === "")))
    )
      return;
    this.saving = true;
    this.error = "";
    try {
      const name = this.name.trim();
      let entity: any;
      if (this.kind === "product" && this.existingProductId) {
        if (!this.barcode.trim()) {
          this.error = "Inserisci il barcode da associare.";
          return;
        }
        entity = await firstValueFrom(
          this.adminApi.createOrUpdateProduct(this.existingProductId, {
            barcode: this.barcode.trim(),
          }),
        );
      } else if (this.kind === "customer") {
        const [firstName, ...lastName] = name.split(/\s+/);
        entity = await firstValueFrom(
          this.adminApi.createOrUpdateCustomer("", {
            firstName,
            lastName: lastName.join(" "),
          }),
        );
      } else if (this.kind === "service") {
        entity = await firstValueFrom(
          this.adminApi.createOrUpdateService("", {
            name,
            sectorId: this.sectorId,
            basePrice: Number(this.price),
            durationMinutes: 30,
            requiresCollaborator: true,
            isPublic: false,
            isBookableOnline: false,
          }),
        );
      } else {
        entity = await firstValueFrom(
          this.adminApi.createOrUpdateProduct("", {
            name,
            price: Number(this.price),
            barcode: this.barcode.trim() || undefined,
          }),
        );
      }
      this.created.emit({ kind: this.kind, entity });
    } catch (error: any) {
      this.error =
        error?.status === 409
          ? "Barcode già associato a un altro prodotto. Verifica il listino."
          : error?.status === 0
            ? "Rete assente. I dati sono conservati: riprova quando torna la connessione."
            : error?.error?.message || "Salvataggio non riuscito. Riprova.";
    } finally {
      this.saving = false;
    }
  }
}
