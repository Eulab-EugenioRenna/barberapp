import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { InfiniteScrollDirective } from "../shared/infinite-scroll.directive";

@Component({
  selector: "barber-admin-sales-page",
  standalone: true,
  imports: [CommonModule, FormsModule, InfiniteScrollDirective],
  template: `
    <section class="grid gap-4">
      <article class="panel rounded-[2rem] p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="eyebrow text-[var(--accent)]">Cassa</p>
            <h3 class="font-display text-3xl">Vendite</h3>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="primary-btn"
              (click)="openQuickOrder.emit()"
            >
              + Nuovo ordine
            </button>
            <span class="status-pill status-pill-neutral"
              >{{ sales.length }} records</span
            >
          </div>
        </div>
        <label class="field mt-5">
          <span>Cerca ordine</span>
          <input
            [(ngModel)]="saleQuery"
            name="saleSearch"
            type="search"
            autocomplete="off"
            placeholder="Cliente, articolo, pagamento"
          />
        </label>
        <div class="mt-5 grid gap-3">
          <button
            *ngFor="let sale of filteredSales; trackBy: trackById"
            type="button"
            class="list-card text-left"
            (click)="openSaleDetail(sale)"
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
              <p class="mt-1 text-xs text-[var(--muted)]">
                {{ saleItemLabels(sale) }}
              </p>
            </div>
            <div class="text-right">
              <strong>€{{ Number(sale.total || 0).toFixed(2) }}</strong>
              <p class="text-sm text-[var(--muted)]">
                {{ sale.paymentMethod || "-" }}
              </p>
            </div>
          </button>
          <article
            *ngIf="!filteredSales.length && !loading"
            class="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]"
          >
            Nessun ordine trovato. Usa “+ Nuovo ordine” per registrare il
            primo ordine.
          </article>
          <p
            *ngIf="hasMore"
            class="text-center text-xs uppercase tracking-wider text-[var(--muted)]"
          >
            Scorri per caricare altri ordini
          </p>
          <div
            *ngIf="hasMore"
            class="h-px w-full"
            barberInfiniteScroll
            (loadMore)="loadMore.emit()"
          ></div>
        </div>
      </article>
    </section>

    <div *ngIf="selectedSale" class="confirm-overlay">
      <button
        type="button"
        class="confirm-backdrop"
        (click)="closeSaleDetail()"
        aria-label="Chiudi dettaglio ordine"
      ></button>
      <article
        class="confirm-dialog panel max-h-[85vh] overflow-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-detail-title"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="eyebrow text-[var(--accent)]">Ordine</p>
            <h2 id="sale-detail-title" class="mt-2 font-display text-3xl">
              {{ selectedSale.customer?.firstName || "Vendita" }}
              {{ selectedSale.customer?.lastName || "senza cliente" }}
            </h2>
            <p class="mt-1 text-sm text-[var(--muted)]">
              {{ formatDateTime(selectedSale.soldAt) }} ·
              {{ selectedSale.paymentMethod || "-" }}
            </p>
          </div>
          <button type="button" class="pill-btn" (click)="closeSaleDetail()">
            Chiudi
          </button>
        </div>

        <article
          *ngIf="selectedSale.appointment"
          class="mt-5 rounded-2xl border border-[var(--line)] p-4"
        >
          <p class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Appuntamento collegato
          </p>
          <strong class="mt-2 block">
            {{ selectedSale.appointment.service?.name || "Servizio" }}
          </strong>
          <p class="mt-1 text-sm text-[var(--muted)]">
            {{ formatDateTime(selectedSale.appointment.startsAt) }}
            <span *ngIf="selectedSale.appointment.collaborator">
              ·
              {{ selectedSale.appointment.collaborator?.firstName || "Staff" }}
              {{ selectedSale.appointment.collaborator?.lastName || "" }}
            </span>
          </p>
        </article>

        <div class="mt-5 grid gap-3">
          <article
            *ngFor="let item of selectedSale.items || []"
            class="rounded-2xl border border-[var(--line)] p-4"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <strong>{{ saleItemLabel(item) }}</strong>
                <p class="mt-1 text-sm text-[var(--muted)]">
                  {{ item.quantity }} × €{{
                    Number(item.unitPrice || 0).toFixed(2)
                  }}
                  <span *ngIf="Number(item.discount || 0) > 0">
                    · sconto €{{ Number(item.discount).toFixed(2) }}
                  </span>
                </p>
              </div>
              <strong>€{{ Number(item.lineTotal || 0).toFixed(2) }}</strong>
            </div>
          </article>
        </div>

        <div
          class="mt-5 grid gap-2 rounded-2xl border border-[var(--line)] p-4 text-sm"
        >
          <div class="flex justify-between">
            <span class="text-[var(--muted)]">Subtotale</span>
            <span>€{{ Number(selectedSale.subtotal || 0).toFixed(2) }}</span>
          </div>
          <div
            *ngIf="Number(selectedSale.discountTotal || 0) > 0"
            class="flex justify-between"
          >
            <span class="text-[var(--muted)]">Sconti</span>
            <span>-€{{ Number(selectedSale.discountTotal).toFixed(2) }}</span>
          </div>
          <div
            *ngIf="Number(selectedSale.taxTotal || 0) > 0"
            class="flex justify-between"
          >
            <span class="text-[var(--muted)]">Tasse</span>
            <span>€{{ Number(selectedSale.taxTotal).toFixed(2) }}</span>
          </div>
          <div
            class="flex justify-between border-t border-[var(--line)] pt-2"
          >
            <strong>Totale</strong>
            <strong>€{{ Number(selectedSale.total || 0).toFixed(2) }}</strong>
          </div>
          <div class="flex justify-between">
            <span class="text-[var(--muted)]">Stato pagamento</span>
            <span>{{ selectedSale.paymentStatus }}</span>
          </div>
        </div>
      </article>
    </div>
  `,
})
export class AdminSalesPageComponent {
  @Input() sales: any[] = [];
  @Input() loading = false;
  @Input() hasMore = false;

  @Output() loadMore = new EventEmitter<void>();
  @Output() openQuickOrder = new EventEmitter<void>();

  protected readonly Number = Number;
  selectedSale: any = null;
  saleQuery = "";

  get filteredSales(): any[] {
    const query = this.saleQuery.trim().toLowerCase();
    if (!query) {
      return this.sales;
    }
    return this.sales.filter((sale) => {
      const haystack = [
        sale.customer?.firstName,
        sale.customer?.lastName,
        sale.paymentMethod,
        sale.paymentStatus,
        ...(sale.items || []).map(
          (item: any) =>
            item.service?.name || item.product?.name || item.label,
        ),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  trackById(_index: number, item: any): string {
    return item.id;
  }

  openSaleDetail(sale: any): void {
    this.selectedSale = sale;
  }

  closeSaleDetail(): void {
    this.selectedSale = null;
  }

  saleItemLabel(item: any): string {
    return item.service?.name || item.product?.name || item.label;
  }

  saleItemLabels(sale: any): string {
    return (sale.items || []).map((item: any) => this.saleItemLabel(item)).join(" · ");
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