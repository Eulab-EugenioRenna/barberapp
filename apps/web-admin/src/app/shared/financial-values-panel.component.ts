import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";
import { RouterLink } from "@angular/router";

interface SalesTaxValues {
  knownNet: string;
  knownTax: string;
  knownGross: string;
  unknownLinesGross: string;
  unknownLineCount: number;
  rates: Array<{ rate: string; net: string; tax: string; gross: string }>;
}
interface MaterialValues {
  knownCost: string;
  margin: string | null;
  unknownLineCount: number;
  unattributedMovementGroups: number;
}
interface CatalogUsage {
  salesVat: boolean;
  purchaseVat: boolean;
  trackedProducts: number;
}
interface InventoryValues {
  receiptsNet: string;
  receiptsTax: string;
  receiptsGross: string | null;
  receiptsUnknownTaxCount: number;
  openingValue: string;
  issuedCost: string;
  returnedCost: string;
  transferDelta: string;
  adjustmentDelta: string;
  movementDelta: string;
  currentValue: string;
  currentLedgerValue: string;
  currentDifference: string;
  unknownProductLocations: number;
}
@Component({
  selector: "alora-financial-values-panel",
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="grid gap-4" aria-label="IVA, materiali e giacenze">
      <div
        *ngIf="showTax || showMaterials"
        class="grid gap-4"
        [ngClass]="{ 'lg:grid-cols-2': showTax && showMaterials }"
      >
        <article
          *ngIf="showTax && tax as values"
          class="panel min-w-0 rounded-[2rem] p-4 sm:p-5"
          data-testid="sales-tax-report"
        >
          <p class="eyebrow text-[var(--accent)]">Venduto</p>
          <h3 class="font-display text-2xl">Imponibile e IVA</h3>
          <dl class="mt-4 grid gap-2">
            <div class="value-row">
              <dt>Imponibile</dt>
              <dd>{{ amount(values.knownNet) }}</dd>
            </div>
            <div class="value-row">
              <dt>IVA</dt>
              <dd>{{ amount(values.knownTax) }}</dd>
            </div>
            <div class="value-row font-semibold">
              <dt>Lordo</dt>
              <dd>{{ amount(values.knownGross) }}</dd>
            </div>
          </dl>
          <div
            *ngIf="values.rates.length > 1"
            class="mt-4 grid gap-2"
            aria-label="Aliquote di vendita"
          >
            <div
              *ngFor="let row of values.rates"
              class="rounded-xl bg-[var(--surface)] p-3 text-sm"
            >
              <strong>IVA {{ row.rate }}%</strong>
              <p class="mt-1 break-words text-[var(--muted)]">
                Imponibile {{ amount(row.net) }} · IVA {{ amount(row.tax) }} ·
                Lordo {{ amount(row.gross) }}
              </p>
            </div>
          </div>
          <p
            *ngIf="values.unknownLineCount"
            class="mt-3 text-sm text-[var(--muted)]"
          >
            {{ values.unknownLineCount }} righe storiche senza IVA indicata
            ({{ amount(values.unknownLinesGross) }}) non sono incluse.
          </p>
        </article>
        <article
          *ngIf="showMaterials && materials as values"
          class="panel min-w-0 rounded-[2rem] p-4 sm:p-5"
          data-testid="materials-report"
        >
          <p class="eyebrow text-[var(--accent)]">Conti del periodo</p>
          <h3 class="font-display text-2xl">Materiali e margine</h3>
          <dl class="mt-4 grid gap-3">
            <div class="value-row">
              <dt>Costo materiali usati</dt>
              <dd>{{ amount(values.knownCost) }}</dd>
            </div>
            <div
              class="value-row border-t border-[var(--line)] pt-3 font-semibold"
            >
              <dt>Margine sui materiali</dt>
              <dd>{{ amount(values.margin) }}</dd>
            </div>
          </dl>
          <p
            *ngIf="values.margin === null || values.unknownLineCount"
            class="mt-3 text-sm text-[var(--muted)]"
          >
            {{
              values.unknownLineCount
                ? values.unknownLineCount +
                  " righe hanno un costo materiali da completare."
                : "Il margine si calcola quando tutte le righe hanno costi e IVA."
            }}
          </p>
        </article>
      </div>

      <article
        *ngIf="showInventory && inventory as values"
        class="panel min-w-0 rounded-[2rem] p-4 sm:p-5"
        data-testid="inventory-value-report"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="eyebrow text-[var(--accent)]">Magazzino</p>
            <h3 class="font-display text-2xl">Giacenze</h3>
          </div>
          <a routerLink="/inventory" class="ghost-btn">Apri giacenze</a>
        </div>
        <div class="stock-kpis mt-4">
          <div>
            <span>Valore giacenze</span>
            <strong>{{ amount(values.currentValue) }}</strong>
          </div>
          <div *ngIf="catalog">
            <span>Prodotti tracciati</span>
            <strong>{{ catalog.trackedProducts }}</strong>
          </div>
          <div *ngIf="values.unknownProductLocations">
            <span>Da inventariare</span>
            <strong>{{ values.unknownProductLocations }}</strong>
          </div>
        </div>
        <p
          *ngIf="values.currentDifference !== '0.00' && values.currentDifference !== '0.000000'"
          class="mt-3 text-sm text-[var(--muted)]"
        >
          Differenza fra giacenze e registro da verificare:
          {{ amount(values.currentDifference) }}.
        </p>
        <details class="mt-4">
          <summary class="cursor-pointer text-sm font-semibold">
            Movimenti del periodo · {{ amount(values.movementDelta) }}
          </summary>
          <dl class="mt-3 grid gap-2">
            <div class="value-row">
              <dt>Carichi, netto</dt>
              <dd>{{ amount(values.receiptsNet) }}</dd>
            </div>
            <ng-container *ngIf="showPurchaseVat">
              <div class="value-row">
                <dt>IVA acquisto</dt>
                <dd>{{ amount(values.receiptsTax) }}</dd>
              </div>
              <div class="value-row">
                <dt>Carichi, lordo</dt>
                <dd>{{ amount(values.receiptsGross) }}</dd>
              </div>
            </ng-container>
            <div class="value-row">
              <dt>Inventari iniziali</dt>
              <dd>{{ amount(values.openingValue) }}</dd>
            </div>
            <div class="value-row">
              <dt>Scarichi</dt>
              <dd>{{ amount(values.issuedCost) }}</dd>
            </div>
            <div class="value-row">
              <dt>Resi</dt>
              <dd>{{ amount(values.returnedCost) }}</dd>
            </div>
            <div class="value-row">
              <dt>Trasferimenti</dt>
              <dd>{{ amount(values.transferDelta) }}</dd>
            </div>
            <div class="value-row">
              <dt>Rettifiche</dt>
              <dd>{{ amount(values.adjustmentDelta) }}</dd>
            </div>
          </dl>
          <p
            *ngIf="showPurchaseVat && values.receiptsUnknownTaxCount"
            class="mt-2 text-sm text-[var(--muted)]"
          >
            {{ values.receiptsUnknownTaxCount }} carichi senza IVA di acquisto.
          </p>
        </details>
      </article>
    </section>
  `,
  styles: [
    `
      .value-row {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 0.5rem;
        font-size: 0.9rem;
      }
      dd {
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }
      .stock-kpis {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
        gap: 0.75rem;
      }
      .stock-kpis > div {
        display: grid;
        gap: 0.25rem;
        border-radius: 1rem;
        background: var(--surface);
        padding: 0.9rem 1rem;
        min-width: 0;
      }
      .stock-kpis span {
        font-size: 0.75rem;
        color: var(--muted);
      }
      .stock-kpis strong {
        font-size: 1.35rem;
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }
    `,
  ],
})
export class FinancialValuesPanelComponent {
  @Input() tax: SalesTaxValues | null = null;
  @Input() materials: MaterialValues | null = null;
  @Input() inventory: InventoryValues | null = null;
  @Input() catalog: CatalogUsage | null = null;
  @Input() currency = "EUR";
  @Input() masked = false;
  /** VAT appears only when the catalogue uses it or VAT was really recorded. */
  get showTax(): boolean {
    if (!this.tax) return false;
    if (!this.catalog) return true;
    return this.catalog.salesVat || !isZero(this.tax.knownTax);
  }
  get showPurchaseVat(): boolean {
    if (!this.inventory) return false;
    if (!this.catalog) return true;
    return this.catalog.purchaseVat || !isZero(this.inventory.receiptsTax);
  }
  /** Materials and stock only for businesses that track products. */
  get showMaterials(): boolean {
    if (!this.materials) return false;
    if (!this.catalog) return true;
    return this.catalog.trackedProducts > 0 || !isZero(this.materials.knownCost);
  }
  get showInventory(): boolean {
    if (!this.inventory) return false;
    if (!this.catalog) return true;
    return this.catalog.trackedProducts > 0 || !isZero(this.inventory.currentValue);
  }
  amount(value: string | null): string {
    if (value === null) return "Non disponibile";
    if (this.masked) return "**,**";
    return `${this.currency} ${value}`;
  }
}

function isZero(value: string | null | undefined): boolean {
  return !value || Number(value) === 0;
}
