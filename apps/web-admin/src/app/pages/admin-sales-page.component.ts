import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CustomSelectComponent } from "../custom-select.component";

@Component({
  selector: "barber-admin-sales-page",
  standalone: true,
  imports: [CommonModule, FormsModule, CustomSelectComponent],
  template: `
    <section class="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
      <article class="panel rounded-[2rem] p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="eyebrow text-[var(--accent)]">Cassa</p>
            <h3 class="font-display text-3xl">Vendite</h3>
          </div>
          <span class="status-pill status-pill-neutral"
            >{{ sales.length }} records</span
          >
        </div>
        <div class="mt-5 grid gap-3">
          <article
            *ngFor="let sale of displayedSales; trackBy: trackById"
            class="list-card text-left"
          >
            <div>
              <strong>
                {{ sale.customer?.firstName || "Vendita" }}
                {{ sale.customer?.lastName || "senza cliente" }}
              </strong>
              <p class="text-sm text-[var(--muted)]">
                {{ formatDateTime(sale.soldAt) }} ·
                {{ sale.items?.length || 0 }} articoli
              </p>
            </div>
            <div class="text-right">
              <strong>€{{ Number(sale.total || 0).toFixed(2) }}</strong>
              <p class="text-sm text-[var(--muted)]">
                {{ sale.paymentMethod || "-" }}
              </p>
            </div>
          </article>
          <article
            *ngIf="!sales.length"
            class="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]"
          >
            Nessun ordine registrato. Usa “Ordine rapido” dalla dashboard o il
            modulo di cassa.
          </article>
          <button
            *ngIf="displayedSales.length < sales.length"
            type="button"
            class="secondary-btn justify-self-start"
            (click)="salesLimit = salesLimit + 100"
          >
            Mostra altri ordini
          </button>
        </div>
      </article>

      <article class="dark-panel rounded-[2rem] p-5 text-white">
        <p class="eyebrow text-white/45">Nuova vendita</p>
        <h3 class="font-display text-3xl">Registra vendita</h3>
        <form class="mt-5 grid gap-4" (ngSubmit)="save.emit()">
          <div class="grid gap-4 md:grid-cols-2">
            <label class="field">
              <span>Cliente</span>
              <barber-custom-select
                [value]="saleForm.customerId"
                (valueChange)="saleForm.customerId = $event"
                [options]="customerSelectOptions"
                label="Cliente"
                placeholder="Cliente opzionale"
              ></barber-custom-select>
            </label>
            <label class="field">
              <span>Collaboratore</span>
              <barber-custom-select
                [value]="saleForm.collaboratorId"
                (valueChange)="saleForm.collaboratorId = $event"
                [options]="collaboratorSelectOptions"
                label="Collaboratore"
                placeholder="Collaboratore opzionale"
              ></barber-custom-select>
            </label>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <label class="field">
              <span>Appuntamento</span>
              <barber-custom-select
                [value]="saleForm.appointmentId"
                (valueChange)="saleForm.appointmentId = $event"
                [options]="appointmentSelectOptions"
                label="Appuntamento"
                placeholder="Appuntamento opzionale"
              ></barber-custom-select>
            </label>
            <label class="field">
              <span>Data vendita</span>
              <input
                [(ngModel)]="saleForm.soldAt"
                name="saleSoldAt"
                type="datetime-local"
              />
            </label>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <label class="field">
              <span>Stato pagamento</span>
              <barber-custom-select
                [value]="saleForm.paymentStatus"
                (valueChange)="saleForm.paymentStatus = $event"
                [options]="paymentStatusOptions"
                label="Stato pagamento"
              ></barber-custom-select>
            </label>
            <label class="field">
              <span>Metodo pagamento</span>
              <barber-custom-select
                [value]="saleForm.paymentMethod"
                (valueChange)="saleForm.paymentMethod = $event"
                [options]="paymentMethodOptions"
                label="Metodo pagamento"
              ></barber-custom-select>
            </label>
          </div>
          <div class="grid gap-3">
            <div
              *ngFor="let item of saleForm.items; let i = index"
              class="rounded-2xl border border-white/10 p-4"
            >
              <div class="grid gap-4 md:grid-cols-2">
                <label class="field md:col-span-2">
                  <span>Prodotto</span>
                  <barber-custom-select
                    [value]="item.productId"
                    (valueChange)="
                      item.productId = $event; handleProductChange.emit(i)
                    "
                    [options]="productSelectOptions"
                    label="Prodotto"
                    placeholder="Seleziona prodotto"
                  ></barber-custom-select>
                </label>
                <label class="field">
                  <span>Quantita</span>
                  <input
                    [(ngModel)]="item.quantity"
                    [name]="'saleQty' + i"
                    type="number"
                    min="1"
                    step="1"
                  />
                </label>
                <label class="field">
                  <span>Prezzo unitario</span>
                  <input
                    [(ngModel)]="item.unitPrice"
                    [name]="'salePrice' + i"
                    type="number"
                    min="0"
                    step="0.01"
                  />
                </label>
                <label class="field">
                  <span>Sconto</span>
                  <input
                    [(ngModel)]="item.discount"
                    [name]="'saleDiscount' + i"
                    type="number"
                    min="0"
                    step="0.01"
                  />
                </label>
                <label class="field">
                  <span>Tasse</span>
                  <input
                    [(ngModel)]="item.taxTotal"
                    [name]="'saleTax' + i"
                    type="number"
                    min="0"
                    step="0.01"
                  />
                </label>
              </div>
              <div class="mt-3 flex justify-between text-sm text-white/70">
                <span>Riga {{ i + 1 }}</span>
                <button
                  *ngIf="saleForm.items.length > 1"
                  type="button"
                  class="pill-btn"
                  (click)="removeItem.emit(i)"
                >
                  Rimuovi riga
                </button>
              </div>
            </div>
          </div>
          <div
            class="flex items-center justify-between rounded-2xl border border-white/10 px-4 py-3"
          >
            <button type="button" class="pill-btn" (click)="addItem.emit()">
              Aggiungi prodotto
            </button>
            <strong>Totale: €{{ saleFormTotal.toFixed(2) }}</strong>
          </div>
          <div class="flex flex-wrap gap-3">
            <button
              type="submit"
              class="primary-btn"
              [disabled]="loading || !formValid"
            >
              Registra vendita
            </button>
            <button type="button" class="secondary-btn" (click)="reset.emit()">
              Nuovo ordine
            </button>
          </div>
        </form>
      </article>
    </section>
  `,
})
export class AdminSalesPageComponent {
  @Input() sales: any[] = [];
  @Input() saleForm: any = { items: [] };
  @Input() saleFormTotal = 0;
  @Input() customerSelectOptions: Array<{ value: string; label: string }> = [];
  @Input() collaboratorSelectOptions: Array<{ value: string; label: string }> =
    [];
  @Input() appointmentSelectOptions: Array<{ value: string; label: string }> =
    [];
  @Input() productSelectOptions: Array<{ value: string; label: string }> = [];
  @Input() paymentStatusOptions: Array<{ value: string; label: string }> = [];
  @Input() paymentMethodOptions: Array<{ value: string; label: string }> = [];
  @Input() loading = false;

  @Output() save = new EventEmitter<void>();
  @Output() reset = new EventEmitter<void>();
  @Output() addItem = new EventEmitter<void>();
  @Output() removeItem = new EventEmitter<number>();
  @Output() handleProductChange = new EventEmitter<number>();

  protected readonly Number = Number;
  salesLimit = 100;

  get displayedSales(): any[] {
    return this.sales.slice(0, this.salesLimit);
  }

  trackById(_index: number, item: any): string {
    return item.id;
  }

  get formValid(): boolean {
    return this.saleForm.items?.some(
      (item: any) =>
        item.productId &&
        item.unitPrice !== "" &&
        item.unitPrice !== null &&
        Number(item.unitPrice) >= 0,
    );
  }

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}
