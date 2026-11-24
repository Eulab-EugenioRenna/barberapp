import { Component, Input, inject, OnChanges } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { SessionStore } from "../core/session.store";
import { ADMIN_API_URL } from "../core/api-config";
import { UiSelectComponent, type UiOption } from "@alora/ui";

@Component({
  selector: "alora-price-settings",
  standalone: true,
  imports: [CommonModule, FormsModule, UiSelectComponent],
  template: ` <fieldset class="price-settings">
    <legend>Prezzi e imposte</legend>
    <label class="tracking"
      ><input
        type="checkbox"
        [(ngModel)]="value.isActive"
        [ngModelOptions]="{ standalone: true }"
      />
      Attivo per nuove operazioni</label
    >
    <div class="price-grid">
      <div class="select-field">
        <span>Modalità prezzo</span
        ><ui-select
          label="Modalità prezzo"
          [options]="priceModeOptions"
          [filterable]="false"
          [(ngModel)]="value.priceMode"
          [ngModelOptions]="{ standalone: true }"
        ></ui-select>
      </div>
      <label
        >IVA vendita (%)<input
          type="number"
          min="0"
          max="100"
          step="0.01"
          [(ngModel)]="value.vatRate"
          [ngModelOptions]="{ standalone: true }"
          [required]="value.priceMode !== 'legacy'"
          placeholder="Non definita"
      /></label>
      <ng-container *ngIf="kind === 'product'">
        <label
          >Costo di acquisto<input
            type="number"
            min="0"
            step="0.01"
            [(ngModel)]="value.cost"
            [ngModelOptions]="{ standalone: true }"
            placeholder="Non registrato"
        /></label>
        <div *ngIf="hasCost" class="select-field">
          <span>Il costo include l’IVA?</span
          ><ui-select
            label="Modalità costo"
            [options]="costModeOptions"
            [filterable]="false"
            [(ngModel)]="value.costMode"
            [ngModelOptions]="{ standalone: true }"
          ></ui-select>
        </div>
        <label *ngIf="hasCost"
          >IVA acquisto (%)<input
            type="number"
            min="0"
            max="100"
            step="0.01"
            [(ngModel)]="value.purchaseVatRate"
            [ngModelOptions]="{ standalone: true }"
            placeholder="Indipendente dalla vendita"
        /></label>
        <label class="tracking" *ngIf="session.can('inventory.manage')"
          ><input
            type="checkbox"
            [(ngModel)]="value.stockTracked"
            [ngModelOptions]="{ standalone: true }"
          />
          Traccia le giacenze per sede</label
        >
      </ng-container>
    </div>
    <label *ngIf="value.id"
      >Perché cambi il prezzo (facoltativo)<input
        maxlength="500"
        [(ngModel)]="value.priceChangeReason"
        [ngModelOptions]="{ standalone: true }"
        placeholder="Es. nuovo listino"
    /></label>
    <p *ngIf="value.id">
      Le variazioni del listino non cambiano i prezzi già registrati nei conti.
    </p>
    <button
      *ngIf="
        value.id &&
        session.can(kind === 'product' ? 'services.read' : 'services.read')
      "
      type="button"
      class="pill-btn"
      (click)="loadHistory()"
    >
      Storico prezzi
    </button>
    <p *ngIf="feedback" role="status">{{ feedback }}</p>
    <ol *ngIf="history.length" class="history">
      <li *ngFor="let row of history">
        <strong>{{ row.createdAt | date: "dd/MM/yyyy HH:mm" }}</strong
        ><span>{{ row.reason }}</span
        ><span
          >{{ row.snapshot.price ?? "Prezzo libero" }} ·
          {{ modeLabel(row.snapshot.priceMode) }} · IVA
          {{ row.snapshot.vatRate ?? "non definita"
          }}<ng-container *ngIf="row.snapshot.vatRate !== null"
            >%</ng-container
          ></span
        ><small>{{
          row.source === "migration_observation"
            ? "Valori osservati alla migrazione"
            : row.actorUserId
              ? "Aggiornamento con autore registrato"
              : "Valori osservati nel database"
        }}</small>
      </li>
    </ol>
    <button *ngIf="hasMore" class="pill-btn" type="button" (click)="loadMore()">
      Variazioni precedenti
    </button>
  </fieldset>`,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .price-settings {
        border: 1px solid var(--line);
        padding: 1rem;
        border-radius: 1rem;
        display: grid;
        gap: 0.8rem;
        min-width: 0;
      }
      .price-settings legend {
        font-weight: 700;
        padding: 0 0.4rem;
      }
      .price-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.8rem;
      }
      label,
      .select-field {
        display: grid;
        gap: 0.35rem;
        font-size: 0.82rem;
        font-weight: 650;
      }
      ui-select {
        font-weight: 400;
      }
      input {
        width: 100%;
        min-width: 0;
        border: 1px solid var(--line);
        background: var(--surface, #fff);
        border-radius: 0.75rem;
        padding: 0.7rem;
        font-weight: 400;
        color: var(--ink);
      }
      .tracking {
        display: flex;
        align-items: center;
        gap: 0.6rem;
      }
      .tracking input {
        width: 1rem;
      }
      p,
      small {
        font-size: 0.76rem;
        color: var(--muted);
      }
      .history {
        display: grid;
        gap: 0.7rem;
        max-height: 18rem;
        overflow: auto;
      }
      .history li {
        display: grid;
        gap: 0.2rem;
        border-top: 1px solid var(--line);
        padding-top: 0.6rem;
        font-size: 0.8rem;
      }
      @media (max-width: 540px) {
        .price-grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class PriceSettingsComponent implements OnChanges {
  @Input() value: any = {};
  @Input() kind: "product" | "service" = "product";
  readonly session = inject(SessionStore);
  readonly priceModeOptions: UiOption[] = [
    { value: "legacy", label: "Valore storico · IVA non definita" },
    { value: "net", label: "Prezzo IVA esclusa" },
    { value: "gross", label: "Prezzo IVA inclusa" },
  ];
  /** Cost mode and purchase VAT only matter once a cost is entered. */
  get hasCost(): boolean {
    const cost = this.value?.cost;
    return (cost !== null && cost !== undefined && cost !== "") || !!this.value?.purchaseVatRate;
  }
  readonly costModeOptions: UiOption[] = [
    { value: "legacy", label: "Valore storico · IVA non definita" },
    { value: "net", label: "Costo IVA esclusa" },
    { value: "gross", label: "Costo IVA inclusa" },
  ];
  private readonly http = inject(HttpClient);
  history: any[] = [];
  feedback = "";
  historyPage = 1;
  hasMore = false;
  ngOnChanges() {
    this.history = [];
    this.hasMore = false;
    this.historyPage = 1;
    this.feedback = "";
  }
  modeLabel(mode: string) {
    return mode === "net"
      ? "IVA esclusa"
      : mode === "gross"
        ? "IVA inclusa"
        : "IVA non definita";
  }
  async loadHistory(append = false) {
    this.feedback = "";
    if (!append) this.historyPage = 1;
    try {
      const result = await firstValueFrom(
        this.http.get<any>(
          `${ADMIN_API_URL}/${this.kind === "product" ? "products" : "services"}/${this.value.id}/prices`,
          { params: { page: String(this.historyPage) } },
        ),
      );
      this.history = append ? [...this.history, ...result.items] : result.items;
      this.hasMore = result.hasMore;
      if (!this.history.length) this.feedback = "Nessuna variazione registrata";
    } catch (error: any) {
      this.feedback = error?.error?.message || "Storico non disponibile";
    }
  }
  loadMore() {
    this.historyPage++;
    return this.loadHistory(true);
  }
}
