import {
  Component,
  OnInit,
  inject,
  OnDestroy,
  ElementRef,
  ViewChild,
  ChangeDetectorRef,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import {
  UiPageComponent,
  UiSelectComponent,
  UiSheetComponent,
  type UiOption,
} from "@alora/ui";
import { AdminPageHeaderComponent } from "../shell/admin-page-header.component";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { SessionStore } from "../core/session.store";
import { OperationalContextService } from "../core/operational-context.service";
import { ADMIN_API_URL } from "../core/api-config";
import { BarcodeScannerService } from "../core/barcode-scanner.service";
import { AdminApiService } from "../core/admin-api.service";
import { KIND_REASON, movementReason } from "./inventory-movement";

@Component({
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    UiPageComponent,
    UiSelectComponent,
    UiSheetComponent,
    AdminPageHeaderComponent,
  ],
  template: ` <ui-page class="inventory-shell">
    <alora-page-header navKey="inventory" [refreshing]="loading" (refresh)="load()">
      <a
        uiPageActions
        *ngIf="session.can('services.read')"
        routerLink="/services"
        data-tour="inventory-catalog-link"
        class="secondary-btn"
        >Anagrafica prodotti nel Listino</a
      >
    </alora-page-header>
    <label
      *ngIf="session.can('inventory.read')"
      class="field"
      data-tour="inventory-barcode"
    >
      <span>Scansiona o inserisci un barcode e premi Invio</span>
      <input
        #barcodeInput
        type="text"
        autocomplete="off"
        (keydown.enter)="
          $event.preventDefault();
          $event.stopPropagation();
          scanner.inject(barcodeInput.value);
          barcodeInput.value = ''
        "
      />
    </label>
    <p *ngIf="scanFeedback" role="status" [class]="scanFeedbackKind">
      {{ scanFeedback }}
      <a
        *ngIf="unknownBarcode && session.can('services.manage')"
        routerLink="/services"
        [queryParams]="{ barcode: unknownBarcode }"
        class="scan-create"
        >Crea il prodotto con questo barcode</a
      >
    </p>
    <p *ngIf="!session.can('inventory.read')" class="notice">
      La consultazione del magazzino non è abilitata.
    </p>
    <ng-container *ngIf="session.can('inventory.read')">
      <section class="panel context-panel">
        <div class="select-field" data-tour="inventory-location">
          Sede<ui-select
            label="Sede"
            placeholder="Scegli una sede"
            [options]="locationOptions"
            [(ngModel)]="locationId"
            (ngModelChange)="changeLocation()"
            [disabled]="busy || attempted"
          ></ui-select>
        </div>
        <div>
          <strong>{{ rows.length }}</strong
          ><span>prodotti tracciati</span>
        </div>
        <div>
          <strong>{{ initializedCount }}</strong
          ><span>giacenze aperte</span>
        </div>
        <button
          class="pill-btn"
          data-tour="inventory-refresh"
          (click)="load()"
          [disabled]="busy || !locationId"
        >
          Aggiorna
        </button>
      </section>
      <p *ngIf="feedback" role="status" class="notice">{{ feedback }}</p>
      <p *ngIf="loading" role="status">Caricamento magazzino…</p>
      <div class="inventory-layout" *ngIf="locationId">
        <section class="panel balances">
          <div class="section-heading">
            <h2>Giacenze</h2>
            <label class="search" data-tour="inventory-search"
              >Cerca prodotto<input
                [(ngModel)]="query"
                type="search"
                placeholder="Nome o codice"
            /></label>
          </div>
          <p *ngIf="!rows.length" class="empty">
            Nessun prodotto tracciato. Abilita il tracciamento dal listino; poi
            registra l'inventario iniziale.
          </p>
          <div class="stock-list" #stockList data-tour="inventory-stock-list">
            <button
              *ngFor="let row of filteredRows"
              type="button"
              class="stock-card"
              [class.selected]="productId === row.id"
              (click)="openProduct(row.id)"
              [disabled]="busy || attempted"
            >
              <div>
                <strong>{{ row.name }}</strong
                ><span
                  >{{ row.barcode || row.sku || "Senza codice" }}
                  <em *ngIf="!row.isActive">· disattivato</em></span
                >
              </div>
              <div class="stock-numbers">
                <strong>{{
                  row.initialized ? number(row.quantity, 3) : "Da inventariare"
                }}</strong
                ><span>{{
                  row.initialized
                    ? "Valore netto € " + number(row.value, 2)
                    : "Quantità iniziale non registrata"
                }}</span>
              </div>
            </button>
          </div>
        </section>
      </div>
      <ui-sheet
        *ngIf="movementOpen && session.can('inventory.manage') && selectedProduct"
        size="lg"
        eyebrow="Nuovo movimento"
        [title]="selectedProduct.name"
        [subtitle]="movementSubtitle"
        [busy]="busy"
        closeLabel="Chiudi nuovo movimento"
        (close)="movementOpen = false"
      >
        <form
          id="inventory-movement-form"
          class="movement-form"
          (ngSubmit)="submit()"
        >
          <fieldset [disabled]="busy || attempted">
            <p class="ui-step">1 · Che movimento è</p>
            <div class="touch-grid" role="radiogroup" aria-label="Tipo di movimento">
              <button
                *ngFor="let kind of kindCards"
                type="button"
                class="touch-card"
                role="radio"
                [attr.aria-checked]="form.kind === kind.value"
                [disabled]="kind.disabled"
                (click)="chooseKind(kind.value)"
              >
                <span class="touch-card-kind">{{ kind.tag }}</span>
                <strong>{{ kind.label }}</strong>
                <span class="touch-card-text">{{ kind.text }}</span>
              </button>
            </div>

            <p class="ui-step">
              2 · {{ form.kind === "adjust" || form.kind === "opening" ? "Quanti ne hai contati" : "Quanti" }}
            </p>
            <div class="movement-fields">
              <label
                >{{ form.kind === "adjust" || form.kind === "opening" ? "Quantità contata" : "Quantità" }}<input
                  type="number"
                  min="0"
                  step="0.001"
                  inputmode="decimal"
                  #movementQuantity
                  name="quantity"
                  [(ngModel)]="form.quantity"
                  required
              /></label>
              <label *ngIf="showsCost"
                ><span
                  >{{
                    form.kind === "receipt"
                      ? "Costo unitario di acquisto"
                      : "Costo netto unitario"
                  }}<span *ngIf="!costRequired" class="field-note">facoltativo</span></span
                ><input
                  type="number"
                  min="0"
                  step="0.000001"
                  inputmode="decimal"
                  name="unitCost"
                  [(ngModel)]="form.unitCost"
                  [required]="costRequired"
              /></label>
              <label *ngIf="form.kind === 'receipt'"
                >IVA acquisto (%)<input
                  name="purchaseVatRate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  inputmode="decimal"
                  [(ngModel)]="form.purchaseVatRate"
                  required
              /></label>
              <div *ngIf="form.kind === 'transfer'" class="select-field">
                <span>Sede di destinazione</span
                ><ui-select
                  label="Sede di destinazione"
                  placeholder="Scegli la sede"
                  name="toLocation"
                  [options]="destinationOptions"
                  [(ngModel)]="form.toLocationId"
                  required
                ></ui-select>
              </div>
              <div *ngIf="form.kind === 'return'" class="select-field">
                <span>Scarico da restituire</span
                ><ui-select
                  label="Scarico da restituire"
                  placeholder="Scegli il movimento"
                  name="returnOf"
                  [options]="returnableOptions"
                  [(ngModel)]="form.returnOfId"
                  required
                ></ui-select>
              </div>
            </div>
            <p class="hint" *ngIf="form.kind === 'opening'">
              Inserisci la quantità che hai in sede e il costo unitario netto.
              Non vengono ricostruiti acquisti o IVA passati.
            </p>
            <p class="hint" *ngIf="form.kind === 'adjust'">
              Sarà registrata la differenza con la giacenza attuale; il costo
              serve solo se ne hai contati di più.
            </p>
            <details *ngIf="form.kind === 'receipt'" class="ui-advanced">
              <summary>
                Avanzate
                <small>costo {{ form.costMode === "gross" ? "IVA inclusa" : "IVA esclusa" }}</small>
              </summary>
              <div class="ui-advanced-body">
                <div class="select-field">
                  <span>Modalità costo</span
                  ><ui-select
                    label="Modalità costo"
                    name="costMode"
                    [options]="costModeOptions"
                    [filterable]="false"
                    [(ngModel)]="form.costMode"
                  ></ui-select>
                </div>
              </div>
            </details>

            <p class="ui-step">
              3 · Motivo <span class="ui-step-hint">facoltativo</span>
            </p>
            <label
              ><span class="sr-only">Motivo</span
              ><textarea
                [(ngModel)]="form.reason"
                name="reason"
                maxlength="500"
                rows="2"
                [placeholder]="'Documento, conteggio o nota. Se vuoto: «' + kindLabel(form.kind) + '»'"
              ></textarea>
            </label>
          </fieldset>
          <p *ngIf="feedback" role="status" [class]="attempted ? 'ui-error' : 'ui-warn'">
            {{ feedback }}
          </p>
        </form>
        <ng-container ngProjectAs="[uiSheetBar]">
          <button
            *ngIf="attempted"
            type="button"
            class="pill-btn ui-bar-start"
            [disabled]="busy"
            (click)="newOperation()"
          >
            Nuova operazione
          </button>
          <span *ngIf="!attempted" class="ui-bar-info ui-bar-start">
            <span>{{ kindLabel(form.kind) }}</span>
            <strong>{{
              form.quantity === "" ? "Quantità da inserire" : number(form.quantity, 3)
            }}</strong>
          </span>
          <button
            type="submit"
            form="inventory-movement-form"
            class="primary-btn"
            [disabled]="busy || !canSubmit"
          >
            {{
              busy
                ? "Registrazione…"
                : attempted
                  ? "Ripeti la stessa operazione"
                  : "Registra movimento"
            }}
          </button>
        </ng-container>
      </ui-sheet>
      <section
        class="panel movements"
        *ngIf="selectedProduct"
        data-tour="inventory-movements"
      >
        <div class="section-heading">
          <div>
            <p class="eyebrow">Registro movimenti</p>
            <h2>{{ selectedProduct.name }}</h2>
          </div>
          <button
            *ngIf="session.can('inventory.manage')"
            type="button"
            class="primary-btn"
            data-tour="inventory-operation"
            [disabled]="busy"
            (click)="movementOpen = true"
          >
            Nuovo movimento
          </button>
          <p class="average-cost">
            Costo medio netto:
            {{
              selectedProduct.initialized
                ? "€ " + number(selectedProduct.averageCost, 6)
                : "da definire"
            }}
          </p>
        </div>
        <p class="hint">
          La giacenza è dell’intera sede. Il registro mostra i movimenti
          generali e quelli delle attività autorizzate nel contesto scelto.
        </p>
        <p *ngIf="!movements.length" class="empty">
          Nessun movimento registrato per questo prodotto nella sede.
        </p>
        <div class="table-scroll" #tableScroll *ngIf="movements.length">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Operazione</th>
                <th>Quantità</th>
                <th>Valore netto</th>
                <th>Giacenza dopo</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of movements">
                <td>{{ row.createdAt | date: "dd/MM/yy HH:mm" }}</td>
                <td>{{ label(row.kind) }}</td>
                <td [class.negative]="Number(row.quantityDelta) < 0">
                  {{ number(row.quantityDelta, 3) }}
                </td>
                <td>€ {{ number(row.valueDelta, 6) }}</td>
                <td>{{ number(row.quantityAfter, 3) }}</td>
                <td>{{ row.operation.reason }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <button
          *ngIf="hasMore"
          class="pill-btn"
          (click)="loadMore()"
          [disabled]="loading"
        >
          Carica altri movimenti
        </button>
      </section>
    </ng-container>
  </ui-page>`,
  styles: [
    `
      :host {
        display: block;
      }
      .inventory-shell {
        color: var(--ink);
      }
      h2 {
        font-size: 1.2rem;
        font-weight: 750;
      }
      p {
        color: var(--muted);
        font-size: 0.9rem;
      }
      .section-heading,
      nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-md);
        flex-wrap: wrap;
      }
      nav {
        justify-content: flex-end;
      }
      .panel {
        border: 1px solid var(--line);
        border-radius: 1.5rem;
        padding: var(--space-lg);
        min-width: 0;
      }
      .context-panel {
        display: flex;
        align-items: center;
        gap: var(--space-xl);
        flex-wrap: wrap;
        margin-bottom: var(--space-md);
      }
      .context-panel .select-field {
        min-width: 16rem;
      }
      .context-panel > div {
        display: grid;
      }
      .context-panel > div strong {
        font-size: 1.8rem;
      }
      .context-panel span {
        font-size: 0.75rem;
        color: var(--muted);
      }
      /* Stock list uses the full width; a product opens the movement sheet. */
      .inventory-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-lg);
        align-items: start;
      }
      .inventory-layout .stock-list {
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
      }
      .section-heading {
        margin-bottom: var(--space-md);
      }
      .search {
        max-width: 17rem;
      }
      .stock-list {
        display: grid;
        gap: var(--space-sm);
        max-height: 40rem;
        overflow: auto;
      }
      .stock-card {
        border: 1px solid var(--line);
        background: var(--surface, #fff);
        border-radius: 1rem;
        padding: var(--space-md);
        display: flex;
        text-align: left;
        justify-content: space-between;
        gap: var(--space-md);
        color: var(--ink);
        width: 100%;
      }
      .stock-card > div {
        display: grid;
        gap: var(--space-2xs);
        min-width: 0;
      }
      .stock-card span {
        font-size: 0.74rem;
        color: var(--muted);
      }
      .stock-card.selected {
        border-color: var(--accent);
        box-shadow: inset 3px 0 var(--accent);
      }
      .stock-card:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
      .stock-numbers {
        text-align: right;
      }
      .stock-numbers strong {
        font-variant-numeric: tabular-nums;
      }
      form,
      fieldset {
        display: grid;
        gap: var(--space-xs);
      }
      fieldset {
        border: 0;
        min-width: 0;
      }
      label,
      .select-field {
        display: grid;
        gap: var(--space-2xs);
        font-size: 0.8rem;
        font-weight: 650;
      }
      ui-select {
        font-weight: 400;
      }
      input,
      textarea {
        min-width: 0;
        width: 100%;
        border: 1px solid var(--line);
        background: var(--surface, #fff);
        padding: var(--space-xs);
        border-radius: 0.8rem;
        font-weight: 400;
      }
      textarea {
        min-height: 5rem;
        resize: vertical;
      }
      .movement-form fieldset {
        gap: 1.25rem;
      }
      .movement-fields {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
        gap: 0.9rem;
      }
      .movement-form label,
      .movement-form .select-field {
        font-size: 0.92rem;
        font-weight: 700;
      }
      .movement-form input,
      .movement-form textarea {
        min-height: 3.375rem;
        padding: 0.85rem 1rem;
        border-radius: 1.2rem;
        font-size: 1.05rem;
      }
      .movement-form textarea {
        min-height: 4.5rem;
      }
      .movement-form .touch-grid {
        margin-top: -0.5rem;
      }
      .field-note {
        margin-left: 0.35rem;
        color: var(--muted);
        font-weight: 500;
      }
      .average-cost {
        flex-basis: 100%;
      }
      .hint,
      .empty {
        font-size: 0.8rem;
        line-height: 1.6;
      }
      .notice {
        padding: var(--space-md);
        border: 1px solid var(--line);
        border-radius: 1rem;
        background: #fff8e7;
        margin-bottom: var(--space-md);
      }
      .ok {
        color: #2f6b3a;
        background: #f0f7ee;
        border: 1px solid #c0dc7c;
        padding: var(--space-xs) var(--space-md);
        border-radius: 0.8rem;
        font-weight: 600;
        margin-bottom: var(--space-md);
      }
      .error {
        color: #a04731;
        background: #fdeeea;
        border: 1px solid #d48a7f;
        padding: var(--space-xs) var(--space-md);
        border-radius: 0.8rem;
        font-weight: 600;
        margin-bottom: var(--space-md);
      }
      .info {
        color: #1d4e89;
        background: #eef4fb;
        border: 1px solid #a9c9e8;
        padding: var(--space-xs) var(--space-md);
        border-radius: 0.8rem;
        font-weight: 600;
        margin-bottom: var(--space-md);
      }
      .scan-create {
        margin-left: 0.5rem;
        font-weight: 700;
        text-decoration: underline;
      }
      .movements {
        margin-top: var(--space-lg);
      }
      .table-scroll {
        overflow: auto;
        overscroll-behavior: contain;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        min-width: 700px;
        font-size: 0.8rem;
      }
      th {
        text-align: left;
        color: var(--muted);
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      td,
      th {
        padding: var(--space-sm) var(--space-2xs);
        border-bottom: 1px solid var(--line);
        vertical-align: top;
      }
      td:nth-child(3),
      td:nth-child(4),
      td:nth-child(5) {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .negative {
        color: #a04731;
      }
      @media (max-width: 599px) {
        .page-heading,
        .section-heading {
          flex-direction: column;
          align-items: flex-start;
          gap: var(--space-xs);
        }
        .inventory-shell {
          padding: var(--space-xs);
        }
        .panel {
          padding: var(--space-md);
        }
      }
      @media (max-width: 850px) {
        .inventory-layout {
          grid-template-columns: 1fr;
        }
        .context-panel {
          gap: 1rem;
        }
        .context-panel .select-field {
          min-width: 0;
          width: 100%;
        }
        .stock-card {
          padding: 0.8rem;
        }
        .stock-numbers {
          max-width: 50%;
        }
      }
      @media (max-width: 420px) {
        .inventory-shell {
          padding: 0.8rem;
        }
        .panel {
          padding: 1rem;
        }
        .stock-card strong {
          overflow-wrap: anywhere;
        }
      }
    `,
  ],
})
export class InventoryComponent implements OnInit, OnDestroy {
  @ViewChild("stockList") stockList?: ElementRef<HTMLElement>;
  @ViewChild("tableScroll") tableScroll?: ElementRef<HTMLElement>;
  readonly session = inject(SessionStore);
  readonly context = inject(OperationalContextService);
  readonly scanner = inject(BarcodeScannerService);
  readonly adminApi = inject(AdminApiService);
  private readonly http = inject(HttpClient);
  readonly Number = Number;
  rows: any[] = [];
  movements: any[] = [];
  locationId = "";
  productId = "";
  query = "";
  feedback = "";
  loading = false;
  busy = false;
  attempted = false;
  hasMore = false;
  scanFeedback = "";
  scanFeedbackKind: "ok" | "error" | "info" = "ok";
  /** Last scanned code with no product: offered for creation in the catalogue. */
  unknownBarcode = "";
  private page = 1;
  private generation = 0;
  private snapshot: any = null;
  private key = crypto.randomUUID();
  @ViewChild("movementQuantity")
  private movementQuantity?: ElementRef<HTMLInputElement>;
  private readonly changeDetector = inject(ChangeDetectorRef);
  private destroyed = false;
  private scannerDetach: (() => void) | null = null;
  form = {
    kind: "opening",
    quantity: "",
    unitCost: "",
    costMode: "net",
    purchaseVatRate: "",
    toLocationId: "",
    returnOfId: "",
    reason: "",
  };
  get filteredRows() {
    const q = this.query.trim().toLowerCase();
    return this.rows.filter(
      (row) =>
        !q || `${row.name} ${row.sku ?? ""} ${row.barcode ?? ""}`.toLowerCase().includes(q),
    );
  }
  get selectedProduct() {
    return this.rows.find((row) => row.id === this.productId);
  }
  get initializedCount() {
    return this.rows.filter((row) => row.initialized).length;
  }
  get destinations() {
    return this.context
      .locations()
      .filter((loc) => loc.isActive && loc.id !== this.locationId);
  }
  get returnable() {
    return this.movements.filter(
      (row) =>
        Number(row.returnableQuantity) > 0 && row.kind !== "transfer_out",
    );
  }
  readonly costModeOptions: UiOption[] = [
    { value: "net", label: "IVA esclusa" },
    { value: "gross", label: "IVA inclusa" },
  ];
  private readonly optionCache = new Map<
    string,
    { deps: unknown[]; options: UiOption[] }
  >();
  /** Rebuilds an option list only when one of its inputs changes identity. */
  private cachedOptions(
    slot: string,
    deps: unknown[],
    build: () => UiOption[],
  ): UiOption[] {
    const cached = this.optionCache.get(slot);
    if (
      cached &&
      cached.deps.length === deps.length &&
      cached.deps.every((dep, index) => dep === deps[index])
    )
      return cached.options;
    const options = build();
    this.optionCache.set(slot, { deps, options });
    return options;
  }
  get locationOptions(): UiOption[] {
    const locations = this.context.locations();
    return this.cachedOptions("locations", [locations], () =>
      locations.map((loc) => ({ value: loc.id, label: loc.name })),
    );
  }
  /** «Nuovo movimento» sheet. */
  movementOpen = false;
  /** Movement types as touch cards; inventory first only when not counted yet. */
  get kindCards(): Array<{
    value: string;
    tag: string;
    label: string;
    text: string;
    disabled: boolean;
  }> {
    const initialized = !!this.selectedProduct?.initialized;
    const canTransfer = this.destinations.length > 0;
    const key = `${initialized}|${canTransfer}`;
    if (key !== this.kindCardsKey) {
      this.kindCardsKey = key;
      this.kindCardsCache = [
        { value: "opening", tag: "Prima volta", label: "Inventario iniziale", text: "Quanti ne hai in sede adesso", disabled: false },
        { value: "receipt", tag: "Entrata", label: "Carico", text: "Merce acquistata o arrivata", disabled: false },
        { value: "issue", tag: "Uscita", label: "Scarico", text: "Uso interno, rotture, omaggi", disabled: false },
        { value: "adjust", tag: "Conteggio", label: "Rettifica", text: "Correggi con la quantità contata", disabled: false },
        { value: "transfer", tag: "Sedi", label: "Trasferimento", text: "Sposta verso un'altra sede", disabled: !canTransfer },
        { value: "return", tag: "Rientro", label: "Reso", text: "Annulla uno scarico registrato", disabled: false },
      ].filter((card) => !(initialized && card.value === "opening"));
    }
    return this.kindCardsCache;
  }
  private kindCardsKey = "";
  private kindCardsCache: Array<{
    value: string;
    tag: string;
    label: string;
    text: string;
    disabled: boolean;
  }> = [];
  kindLabel(kind: string): string {
    return KIND_REASON[kind] || kind;
  }
  get movementSubtitle(): string {
    const product = this.selectedProduct;
    if (!product) return "";
    return product.initialized
      ? `Giacenza attuale ${this.number(product.quantity, 3)}: scegli il movimento e la quantità.`
      : "Prima volta: registra la quantità che hai in sede.";
  }
  get showsCost(): boolean {
    return ["opening", "receipt", "adjust"].includes(this.form.kind);
  }
  /** Cost and VAT are optional: the server uses the last known cost (or 0). */
  get costRequired(): boolean {
    return false;
  }
  get canSubmit(): boolean {
    if (this.attempted) return true;
    if (this.form.quantity === "" || this.form.quantity === null) return false;
    if (this.costRequired && `${this.form.unitCost ?? ""}` === "") return false;
    if (this.form.kind === "transfer" && !this.form.toLocationId) return false;
    if (this.form.kind === "return" && !this.form.returnOfId) return false;
    return true;
  }
  chooseKind(kind: string): void {
    this.form.kind = kind;
  }
  /** Tap on a product: select it and open the movement sheet. */
  async openProduct(id: string): Promise<void> {
    await this.selectProduct(id);
    if (this.productId === id && this.session.can("inventory.manage"))
      this.movementOpen = true;
  }
  get destinationOptions(): UiOption[] {
    return this.cachedOptions(
      "destinations",
      [this.context.locations(), this.locationId],
      () =>
        this.destinations.map((loc) => ({ value: loc.id, label: loc.name })),
    );
  }
  get returnableOptions(): UiOption[] {
    return this.cachedOptions("returnable", [this.movements], () =>
      this.returnable.map((row) => ({
        value: row.id,
        label: `${this.dateTime(row.createdAt)} · ${this.label(row.kind)} · ${this.number(row.returnableQuantity, 3)}`,
      })),
    );
  }
  /** Same output as the `date: "dd/MM/yyyy HH:mm"` pipe (local time). */
  private dateTime(value: string | Date | null | undefined): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  number(value: unknown, digits: number) {
    return Number(value).toLocaleString("it-IT", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }
  label(kind: string) {
    return (
      (
        {
          opening: "Inventario iniziale",
          receipt: "Carico acquisto",
          issue: "Scarico interno",
          adjust_in: "Rettifica in aumento",
          adjust_out: "Rettifica in diminuzione",
          transfer_in: "Trasferimento in entrata",
          transfer_out: "Trasferimento in uscita",
          return: "Reso",
          sale: "Vendita",
          consumption: "Consumo servizio",
          order_adjust_in: "Rettifica conto",
          order_adjust_out: "Rettifica conto",
        } as Record<string, string>
      )[kind] || kind
    );
  }
  async ngOnInit() {
    if (!this.session.can("inventory.read")) return;
    this.attachScanner();
    try {
      await this.context.load();
      this.locationId =
        this.context.selected.locationId ||
        (this.context.locations().length === 1
          ? this.context.locations()[0].id
          : "");
      if (this.locationId) await this.changeLocation();
    } catch (error: any) {
      this.feedback = error?.error?.message || "Caricamento non riuscito";
    }
  }
  ngOnDestroy() {
    this.destroyed = true;
    if (this.scannerDetach) this.scannerDetach();
    this.scannerDetach = null;
  }
  async changeLocation() {
    this.saveInventoryScroll();
    this.context.select(this.locationId, "", false);
    this.productId = "";
    this.movementOpen = false;
    this.rows = [];
    this.movements = [];
    this.newOperation();
    await this.load();
  }
  async selectProduct(id: string) {
    this.saveInventoryScroll();
    this.productId = id;
    this.movements = [];
    this.page = 1;
    this.newOperation();
    this.form.kind = this.selectedProduct?.initialized ? "receipt" : "opening";
    await this.loadMovements();
  }

  private attachScanner(): void {
    this.scanner.setOptions({
      scanThresholdMs: 120,
      terminatorKey: "Enter",
      soundEnabled: false,
      vibrationEnabled: false,
    });
    this.scannerDetach = this.scanner.attach((event) =>
      this.handleScannedBarcode(event.barcode),
    );
  }

  private async handleScannedBarcode(barcode: string): Promise<void> {
    if (this.destroyed || this.busy || this.attempted || this.loading) return;
    this.scanFeedback = "";
    this.unknownBarcode = "";
    if (!this.locationId) {
      this.showScanFeedback("error", "Seleziona una sede prima di scansionare");
      return;
    }
    const locationId = this.locationId;
    try {
      const product = await firstValueFrom(
        this.adminApi.findProductByBarcode(barcode),
      );
      if (
        this.destroyed ||
        this.busy ||
        this.attempted ||
        locationId !== this.locationId
      )
        return;
      if (!product?.id) {
        this.unknownBarcode = barcode;
        this.showScanFeedback(
          "info",
          "Prodotto non trovato per questo barcode.",
        );
        return;
      }
      if (!this.rows.some((row) => row.id === product.id)) {
        this.showScanFeedback(
          "info",
          product.stockTracked === false
            ? `${product.name} non è tracciato a magazzino: attiva «Traccia le giacenze per sede» nella sua scheda del Listino.`
            : "Prodotto non disponibile nel magazzino della sede selezionata",
        );
        return;
      }
      // Loading goods: scanning the same item again counts one more piece.
      if (
        this.productId === product.id &&
        this.form.kind !== "adjust" &&
        this.form.quantity !== ""
      ) {
        const next = Number(this.form.quantity || 0) + 1;
        this.form.quantity = String(next);
        this.showScanFeedback("ok", `${product.name}: quantità ${next}`);
        this.changeDetector.detectChanges();
        return;
      }
      await this.selectProduct(product.id);
      if (this.form.kind !== "adjust") this.form.quantity = "1";
      if (
        this.destroyed ||
        locationId !== this.locationId ||
        this.productId !== product.id
      )
        return;
      this.showScanFeedback("ok", `Selezionato: ${product.name}`);
      if (this.session.can("inventory.manage")) this.movementOpen = true;
      this.changeDetector.detectChanges();
      this.movementQuantity?.nativeElement.focus();
    } catch (error: any) {
      if (this.destroyed || locationId !== this.locationId) return;
      if (error?.status === 404) this.unknownBarcode = barcode;
      this.showScanFeedback(
        error?.status === 404 ? "info" : "error",
        error?.status === 404
          ? "Prodotto non trovato per questo barcode."
          : error?.status === 0
            ? "Rete assente. Riprova la scansione quando la connessione è disponibile."
            : error?.error?.message || "Scansione non riuscita. Riprova.",
      );
    }
  }

  private showScanFeedback(
    kind: "ok" | "error" | "info",
    message: string,
  ): void {
    this.scanFeedback = message;
    this.scanFeedbackKind = kind;
  }
  async load() {
    const token = ++this.generation;
    if (!this.locationId) return;
    this.loading = true;
    try {
      const rows = await firstValueFrom(
        this.http.get<any[]>(`${ADMIN_API_URL}/inventory/balances`, {
          params: { locationId: this.locationId },
        }),
      );
      if (token !== this.generation) return;
      this.rows = rows;
      if (!this.rows.some((row) => row.id === this.productId))
        this.productId = "";
      if (this.productId) await this.loadMovements();
      setTimeout(() => this.restoreInventoryScroll(), 0);
    } catch (error: any) {
      if (token === this.generation)
        this.feedback = error?.error?.message || "Giacenze non disponibili";
    } finally {
      if (token === this.generation) this.loading = false;
    }
  }
  async loadMovements(append = false) {
    const token = this.generation,
      id = this.productId,
      location = this.locationId;
    if (!id) return;
    try {
      const result: any = await firstValueFrom(
        this.http.get(`${ADMIN_API_URL}/inventory/movements`, {
          params: {
            locationId: location,
            productId: id,
            page: String(this.page),
          },
        }),
      );
      if (
        token !== this.generation ||
        id !== this.productId ||
        location !== this.locationId
      )
        return;
      this.movements = append
        ? [...this.movements, ...result.items]
        : result.items;
      this.hasMore = result.hasMore;
      if (!append) setTimeout(() => this.restoreInventoryScroll(), 0);
    } catch (error: any) {
      this.feedback = error?.error?.message || "Registro non disponibile";
    }
  }
  async loadMore() {
    this.page++;
    await this.loadMovements(true);
  }
  newOperation() {
    this.key = crypto.randomUUID();
    this.attempted = false;
    this.snapshot = null;
    this.feedback = "";
    this.form.reason = "";
  }
  async submit() {
    if (this.busy || !this.selectedProduct) return;
    this.busy = true;
    this.feedback = "";
    if (!this.snapshot)
      this.snapshot = {
        kind: this.form.kind,
        locationId: this.locationId,
        productId: this.productId,
        quantity: String(this.form.quantity),
        idempotencyKey: this.key,
        reason: movementReason(this.form.reason, this.form.kind),
        ...(["opening", "receipt", "adjust"].includes(this.form.kind) &&
        this.form.unitCost !== ""
          ? { unitCost: String(this.form.unitCost) }
          : {}),
        ...(this.form.kind === "receipt"
          ? {
              costMode: this.form.costMode,
              ...(`${this.form.purchaseVatRate ?? ""}` === ""
                ? {}
                : { purchaseVatRate: String(this.form.purchaseVatRate) }),
            }
          : {}),
        ...(this.form.kind === "transfer"
          ? { toLocationId: this.form.toLocationId }
          : {}),
        ...(this.form.kind === "return"
          ? { returnOfId: this.form.returnOfId }
          : {}),
      };
    this.attempted = true;
    try {
      await firstValueFrom(
        this.http.post(`${ADMIN_API_URL}/inventory/operations`, this.snapshot),
      );
      this.newOperation();
      this.movementOpen = false;
      this.feedback = "Movimento registrato e giacenza riconciliata";
      this.page = 1;
      await this.load();
    } catch (error: any) {
      this.feedback =
        (error?.error?.message || "Esito non disponibile") +
        ". Puoi ripetere la stessa operazione; per modificarla controlla il registro e scegli Nuova operazione.";
    } finally {
      this.busy = false;
    }
  }

  private saveInventoryScroll(): void {
    try {
      const key = this.locationId ? `barber.inventory.scroll.${this.locationId}` : "barber.inventory.scroll";
      const stock = this.stockList?.nativeElement;
      const table = this.tableScroll?.nativeElement;
      if (stock) sessionStorage.setItem(`${key}.stock`, String(stock.scrollTop));
      if (table) sessionStorage.setItem(`${key}.table`, String(table.scrollTop));
    } catch {
      /* sessionStorage non disponibile: ignora */
    }
  }

  private restoreInventoryScroll(): void {
    try {
      const key = this.locationId ? `barber.inventory.scroll.${this.locationId}` : "barber.inventory.scroll";
      const stockRaw = sessionStorage.getItem(`${key}.stock`);
      const tableRaw = sessionStorage.getItem(`${key}.table`);
      const stock = this.stockList?.nativeElement;
      const table = this.tableScroll?.nativeElement;
      if (stockRaw && stock) stock.scrollTop = Number(stockRaw);
      if (tableRaw && table) table.scrollTop = Number(tableRaw);
    } catch {
      /* scroll restore non disponibile: ignora */
    }
  }
}

