import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";

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
  imports: [CommonModule],
  template: `
    <section class="grid gap-4" aria-label="Valori registrati e materiali">
      <div class="grid gap-4 lg:grid-cols-2">
        <article
          *ngIf="tax as values"
          class="panel min-w-0 rounded-[2rem] p-4 sm:p-5"
          data-testid="sales-tax-report"
        >
          <p class="eyebrow text-[var(--accent)]">Righe del venduto</p>
          <h3 class="font-display text-2xl">Imponibile e IVA registrata</h3>
          <p class="mt-2 text-sm text-[var(--muted)]">
            Importi delle righe con modalità IVA esplicita, dopo gli sconti
            registrati.
          </p>
          <dl class="mt-4 grid gap-2">
            <div class="value-row">
              <dt>Imponibile documentato</dt>
              <dd>{{ amount(values.knownNet) }}</dd>
            </div>
            <div class="value-row">
              <dt>IVA vendita registrata</dt>
              <dd>{{ amount(values.knownTax) }}</dd>
            </div>
            <div class="value-row font-semibold">
              <dt>Lordo documentato</dt>
              <dd>{{ amount(values.knownGross) }}</dd>
            </div>
          </dl>
          <div
            class="mt-4 grid gap-2"
            aria-label="Aliquote di vendita registrate"
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
            {{ values.unknownLineCount }} righe storiche per
            {{ amount(values.unknownLinesGross) }} hanno una modalità IVA non
            documentata e sono escluse da questa scomposizione.
          </p>
        </article>
        <article
          *ngIf="materials as values"
          class="panel min-w-0 rounded-[2rem] p-4 sm:p-5"
          data-testid="materials-report"
        >
          <p class="eyebrow text-[var(--accent)]">
            Conti del periodo, situazione attuale
          </p>
          <h3 class="font-display text-2xl">Materiali tracciati e margine</h3>
          <p class="mt-2 text-sm text-[var(--muted)]">
            Costo degli scarichi delle righe, al netto dei resi registrati,
            conservato a sei decimali.
          </p>
          <dl class="mt-4 grid gap-3">
            <div class="value-row">
              <dt>Costo materiali documentato</dt>
              <dd>{{ amount(values.knownCost) }}</dd>
            </div>
            <div
              class="value-row border-t border-[var(--line)] pt-3 font-semibold"
            >
              <dt>Margine sui materiali tracciati</dt>
              <dd>{{ amount(values.margin) }}</dd>
            </div>
          </dl>
          <p class="mt-3 text-sm text-[var(--muted)]">
            Il margine usa l'imponibile e i materiali configurati al momento
            della registrazione. Esclude lavoro, affitto e altre spese.
          </p>
          <p
            *ngIf="values.margin === null"
            class="mt-3 text-sm text-[var(--muted)]"
          >
            Il margine richiede costi e IVA documentati per tutte le righe e
            importi interamente attribuiti.
          </p>
          <p
            *ngIf="values.unknownLineCount"
            class="mt-2 text-sm text-[var(--muted)]"
          >
            {{ values.unknownLineCount }} righe con costo dei materiali da
            riconciliare.
          </p>
          <p
            *ngIf="values.unattributedMovementGroups"
            class="mt-2 text-sm text-[var(--muted)]"
          >
            Movimenti non attribuiti alle righe correnti: verificare il
            registro.
          </p>
        </article>
      </div>
      <article
        *ngIf="inventory as values"
        class="panel min-w-0 rounded-[2rem] p-4 sm:p-5"
        data-testid="inventory-value-report"
      >
        <p class="eyebrow text-[var(--accent)]">Sedi interamente autorizzate</p>
        <h3 class="font-display text-2xl">Magazzino e acquisti registrati</h3>
        <div class="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <h4 class="font-semibold">Movimenti del periodo</h4>
            <p class="mt-1 text-sm text-[var(--muted)]">
              Data di registrazione del movimento. Aperture e trasferimenti non
              sono nuovi acquisti.
            </p>
            <dl class="mt-3 grid gap-2">
              <div class="value-row">
                <dt>Carichi, valore netto</dt>
                <dd>{{ amount(values.receiptsNet) }}</dd>
              </div>
              <div class="value-row">
                <dt>IVA acquisto registrata</dt>
                <dd>{{ amount(values.receiptsTax) }}</dd>
              </div>
              <div class="value-row">
                <dt>Carichi, lordo documentato</dt>
                <dd>{{ amount(values.receiptsGross) }}</dd>
              </div>
              <div class="value-row">
                <dt>Aperture di inventario</dt>
                <dd>{{ amount(values.openingValue) }}</dd>
              </div>
              <div class="value-row">
                <dt>Costo degli scarichi</dt>
                <dd>{{ amount(values.issuedCost) }}</dd>
              </div>
              <div class="value-row">
                <dt>Reintegri e resi</dt>
                <dd>{{ amount(values.returnedCost) }}</dd>
              </div>
              <div class="value-row">
                <dt>Trasferimenti, variazione netta</dt>
                <dd>{{ amount(values.transferDelta) }}</dd>
              </div>
              <div class="value-row">
                <dt>Rettifiche, variazione netta</dt>
                <dd>{{ amount(values.adjustmentDelta) }}</dd>
              </div>
              <div class="value-row font-semibold">
                <dt>Variazione di valore del periodo</dt>
                <dd>{{ amount(values.movementDelta) }}</dd>
              </div>
            </dl>
            <p
              *ngIf="values.receiptsUnknownTaxCount"
              class="mt-2 text-sm text-[var(--muted)]"
            >
              {{ values.receiptsUnknownTaxCount }} carichi con IVA di acquisto
              da riconciliare.
            </p>
          </div>
          <div>
            <h4 class="font-semibold">Giacenze attuali note</h4>
            <p class="mt-1 text-sm text-[var(--muted)]">
              Situazione attuale, inclusi i movimenti di altri periodi.
            </p>
            <dl class="mt-3 grid gap-2">
              <div class="value-row">
                <dt>Valore delle giacenze inizializzate</dt>
                <dd>{{ amount(values.currentValue) }}</dd>
              </div>
              <div class="value-row">
                <dt>Valore cumulato del registro</dt>
                <dd>{{ amount(values.currentLedgerValue) }}</dd>
              </div>
              <div class="value-row font-semibold">
                <dt>Differenza da verificare</dt>
                <dd>{{ amount(values.currentDifference) }}</dd>
              </div>
            </dl>
            <p
              *ngIf="values.unknownProductLocations"
              class="mt-3 text-sm text-[var(--muted)]"
            >
              {{ values.unknownProductLocations }} giacenze prodotto/sede non
              inizializzate, escluse dal valore noto.
            </p>
          </div>
        </div>
      </article>
      <p
        *ngIf="materials && !inventory"
        class="px-1 text-sm text-[var(--muted)]"
      >
        Il riepilogo di magazzino richiede la vista completa delle sedi, senza
        filtri per settore, professionista o cliente.
      </p>
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
    `,
  ],
})
export class FinancialValuesPanelComponent {
  @Input() tax: SalesTaxValues | null = null;
  @Input() materials: MaterialValues | null = null;
  @Input() inventory: InventoryValues | null = null;
  @Input() currency = "EUR";
  @Input() masked = false;
  amount(value: string | null): string {
    if (value === null) return "Non disponibile";
    if (this.masked) return "**,**";
    return `${this.currency} ${value}`;
  }
}
