import { FunctionAccessDirective } from "../shared/function-access.directive";
import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { InfiniteScrollDirective } from "../shared/infinite-scroll.directive";
import { UiIconComponent } from "../shared/ui-icon.component";
import { UiSelectComponent, uiOptions, type UiOption } from "@alora/ui";
import {
  buildAccountRows,
  KIND_LABELS,
  personName,
  type AccountKind,
  type AccountRow,
} from "./cash-accounts";
import {
  appointmentStatusLabel,
  paymentMethodLabel,
  paymentStatusLabel,
} from "../shared/presentation-copy";

@Component({
  selector: "barber-admin-sales-page",
  standalone: true,
  styles: [
    `
      .account-row {
        display: grid;
        gap: 0.75rem;
      }
      .account-row-alert {
        border-color: #f2c46d;
      }
      .account-main {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        width: 100%;
        border: 0;
        background: transparent;
        padding: 0;
        color: inherit;
        cursor: pointer;
      }
      .account-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
      }
      .label-filter {
        cursor: pointer;
        border: 0.0625rem solid transparent;
      }
      .label-filter-on {
        border-color: currentColor;
        font-weight: 800;
      }
    `,
  ],
  imports: [
    FunctionAccessDirective,
    CommonModule,
    FormsModule,
    InfiniteScrollDirective,
    UiIconComponent,
    UiSelectComponent,
  ],
  template: `
    <section class="grid gap-4">
      <article class="panel rounded-[2rem] p-4 sm:p-5">
        <div class="min-w-0">
          <p class="eyebrow text-[var(--accent)]">Conti</p>
          <h3 class="mt-1 font-display text-2xl sm:text-3xl">
            Tutti i conti
          </h3>
          <p class="mt-1 text-sm text-[var(--muted)]">
            Da chiudere, aperti e registrati in un'unica lista: ogni conto
            mostra la sua etichetta.
          </p>
        </div>

        <div
          class="mt-4 flex flex-wrap gap-2"
          role="group"
          aria-label="Mostra conti per etichetta"
          data-tour="sales-labels"
        >
          <button
            *ngFor="let label of labelFilters"
            type="button"
            class="status-pill label-filter"
            [ngClass]="label.key === 'all' ? 'status-pill-neutral' : pillClass(label.key)"
            [class.label-filter-on]="labelFilter === label.key"
            [attr.aria-pressed]="labelFilter === label.key"
            (click)="labelFilter = label.key"
          >
            {{ label.text }} · {{ count(label.key) }}
          </button>
        </div>

        <label class="field mt-4" data-tour="sales-search">
          <span>Cerca conto</span>
          <input
            [(ngModel)]="saleQuery"
            name="saleSearch"
            type="search"
            autocomplete="off"
            placeholder="Cliente, servizio, prodotto"
          />
        </label>

        <div class="mt-4 grid gap-2.5 sm:gap-3" data-tour="sales-list">
          <article
            *ngFor="let row of visibleRows; trackBy: trackRow; let first = first"
            class="list-card account-row"
            [class.account-row-alert]="row.kind === 'toClose'"
            [attr.data-sale-id]="row.sale?.id || null"
            [attr.data-tour]="first ? 'sales-row' : null"
          >
            <button
              type="button"
              class="account-main text-left"
              (click)="openRow(row)"
              [attr.aria-label]="'Apri il conto di ' + row.customer"
            >
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <strong>{{ row.customer }}</strong>
                  <span
                    class="status-pill"
                    [ngClass]="pillClass(row.kind)"
                    [attr.data-tour]="first ? 'sales-row-label' : null"
                    >{{ kindLabel(row.kind) }}</span
                  >
                  <span
                    *ngIf="row.kind === 'registered' && row.sale?.paymentStatus"
                    class="status-pill"
                    [ngClass]="row.sale.paymentStatus === 'paid' ? 'status-pill-green' : 'status-pill-neutral'"
                    >{{ formatPaymentStatus(row.sale.paymentStatus) }}</span
                  >
                </div>
                <p class="mt-1 text-sm text-[var(--muted)]">
                  {{ formatDateTime(row.when) }}
                  <ng-container *ngIf="row.who"> · {{ row.who }}</ng-container>
                </p>
                <p class="mt-1 text-xs text-[var(--muted)]">{{ row.lines }}</p>
              </div>
              <div class="text-right">
                <strong *ngIf="row.total !== null">€{{ row.total.toFixed(2) }}</strong>
                <p
                  *ngIf="row.kind === 'registered'"
                  class="text-sm text-[var(--muted)]"
                >
                  {{ formatPaymentMethod(row.sale?.paymentMethod) }}
                </p>
              </div>
            </button>

            <div
              *ngIf="row.kind !== 'registered'"
              class="account-actions"
            >
              <button
                aloraFunction="sales.manage"
                type="button"
                class="primary-btn"
                [attr.data-tour]="first ? 'sales-close' : null"
                [disabled]="loading"
                (click)="closeAccount.emit({ appointment: row.appointment, sale: row.sale })"
              >
                <barber-ui-icon name="receipt"></barber-ui-icon> Chiudi il conto
              </button>
              <button
                aloraFunction="sales.manage"
                type="button"
                class="secondary-btn"
                *ngIf="row.appointment && unlinkedSales.length"
                [attr.data-tour]="first ? 'sales-link' : null"
                (click)="toggleLink(row.key)"
              >
                <barber-ui-icon name="link"></barber-ui-icon>
                {{ linkOpenFor === row.key ? "Chiudi collegamento" : "Collega vendita" }}
              </button>
              <button
                aloraFunction="appointments.update.all"
                type="button"
                class="ghost-btn text-red-700"
                *ngIf="row.appointment"
                [attr.data-tour]="first ? 'sales-cancel' : null"
                [disabled]="loading"
                (click)="cancelAppointment.emit(row.appointment)"
              >
                <barber-ui-icon name="ban"></barber-ui-icon> Annulla appuntamento
              </button>
            </div>

            <div
              aloraFunction="sales.manage"
              *ngIf="linkOpenFor === row.key"
              class="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-black/5 p-3"
            >
              <ui-select
                class="min-w-[min(14rem,100%)] flex-1 text-sm"
                [(ngModel)]="selectedSaleId"
                [ngModelOptions]="{ standalone: true }"
                [options]="saleOptions"
                label="Vendita da collegare"
                placeholder="Seleziona una vendita senza appuntamento"
                filterPlaceholder="Cerca cliente"
              ></ui-select>
              <button
                type="button"
                class="primary-btn"
                [disabled]="!selectedSaleId || loading"
                (click)="linkOrder.emit({ appointment: row.appointment, saleId: selectedSaleId })"
              >
                Collega
              </button>
            </div>
          </article>

          <article
            *ngIf="!visibleRows.length && !loading"
            class="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]"
          >
            {{ emptyText }}
          </article>
          <p
            *ngIf="hasMore && labelFilter !== 'toClose' && labelFilter !== 'open'"
            class="text-center text-xs uppercase tracking-wider text-[var(--muted)]"
          >
            Scorri per caricare altri conti registrati
          </p>
          <div
            *ngIf="hasMore && labelFilter !== 'toClose' && labelFilter !== 'open'"
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
        aria-label="Chiudi dettaglio vendita"
      ></button>
      <article
        class="confirm-dialog panel max-h-[85vh] overflow-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-detail-title"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="eyebrow text-[var(--accent)]">Vendita</p>
            <h2
              id="sale-detail-title"
              class="mt-2 font-display text-2xl sm:text-3xl"
            >
              {{ selectedSale.customer?.firstName || "Vendita" }}
              {{ selectedSale.customer?.lastName || "senza cliente" }}
            </h2>
            <p class="mt-1 text-sm text-[var(--muted)]">
              {{ formatDateTime(selectedSale.soldAt) }} ·
              {{ formatPaymentMethod(selectedSale.paymentMethod) }}
            </p>
            <p class="mt-1 text-xs text-[var(--muted)]">
              Riferimento {{ selectedSale.id }}
            </p>
          </div>
          <button type="button" class="pill-btn" (click)="closeSaleDetail()">
            Chiudi
          </button>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <article class="rounded-2xl border border-[var(--line)] p-4">
            <p class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Cliente
            </p>
            <strong class="mt-2 block">
              {{ selectedSale.customer?.firstName || "Vendita" }}
              {{ selectedSale.customer?.lastName || "senza cliente" }}
            </strong>
            <p class="mt-1 text-sm text-[var(--muted)]">
              {{ selectedSale.customer?.email || "Email non disponibile" }}
              <span *ngIf="selectedSale.customer?.phone">
                · {{ selectedSale.customer.phone }}</span
              >
            </p>
          </article>
          <article class="rounded-2xl border border-[var(--line)] p-4">
            <p class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Pagamento
            </p>
            <strong class="mt-2 block">{{
              formatPaymentStatus(selectedSale.paymentStatus)
            }}</strong>
            <p class="mt-1 text-sm text-[var(--muted)]">
              Metodo: {{ formatPaymentMethod(selectedSale.paymentMethod) }}
            </p>
          </article>
        </div>

        <article
          *ngIf="selectedSale.appointment"
          class="mt-4 rounded-2xl border border-[var(--line)] p-4"
        >
          <p class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Appuntamento collegato
          </p>
          <strong class="mt-2 block">
            {{ selectedSale.appointment.service?.name || "Servizio" }}
          </strong>
          <p class="mt-1 text-sm text-[var(--muted)]">
            {{ formatDateTime(selectedSale.appointment.startsAt) }}
            <span *ngIf="selectedSale.appointment.endsAt">
              → {{ formatDateTime(selectedSale.appointment.endsAt) }}
            </span>
            <span *ngIf="selectedSale.appointment.collaborator">
              ·
              {{
                selectedSale.appointment.collaborator?.firstName ||
                  "Da assegnare"
              }}
              {{ selectedSale.appointment.collaborator?.lastName || "" }}
            </span>
          </p>
          <p class="mt-2 text-xs text-[var(--muted)]">
            {{ formatAppointmentStatus(selectedSale.appointment.status) }}
          </p>
        </article>

        <div class="mt-4 grid gap-3">
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
                <p
                  *ngIf="item.collaborator"
                  class="mt-1 text-xs text-[var(--muted)]"
                >
                  Professionista: {{ item.collaborator.firstName }}
                  {{ item.collaborator.lastName }}
                </p>
              </div>
              <strong>€{{ Number(item.lineTotal || 0).toFixed(2) }}</strong>
            </div>
          </article>
        </div>

        <div
          class="mt-4 grid gap-2 rounded-2xl border border-[var(--line)] p-4 text-sm"
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
          <div class="flex justify-between border-t border-[var(--line)] pt-2">
            <strong>Totale</strong>
            <strong>€{{ Number(selectedSale.total || 0).toFixed(2) }}</strong>
          </div>
          <div class="flex justify-between">
            <span class="text-[var(--muted)]">Stato pagamento</span>
            <span>{{ formatPaymentStatus(selectedSale.paymentStatus) }}</span>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap gap-3">
          <button
            aloraFunction="sales.manage"
            type="button"
            class="primary-btn"
            (click)="editSelectedSale()"
          >
            <barber-ui-icon name="edit"></barber-ui-icon> Modifica vendita
          </button>
          <button
            aloraFunction="sales.manage"
            type="button"
            class="pill-btn"
            (click)="deleteSelectedSale()"
          >
            <barber-ui-icon name="trash"></barber-ui-icon> Elimina vendita
          </button>
        </div>
      </article>
    </div>
  `,
})
export class AdminSalesPageComponent {
  @Input() sales: any[] = [];
  /** Appointments whose time is reached and whose account is not settled. */
  @Input() toClose: any[] = [];
  @Input() openSales: any[] = [];
  @Input() unlinkedSales: any[] = [];
  @Input() loading = false;
  @Input() hasMore = false;

  @Output() loadMore = new EventEmitter<void>();
  @Output() editOrder = new EventEmitter<any>();
  @Output() deleteOrder = new EventEmitter<any>();
  /** Settle an account to close or open: opens the till on that account. */
  @Output() closeAccount = new EventEmitter<{ appointment: any; sale: any }>();
  @Output() linkOrder = new EventEmitter<{ appointment: any; saleId: string }>();
  @Output() cancelAppointment = new EventEmitter<any>();

  protected readonly Number = Number;
  selectedSale: any = null;
  saleQuery = "";
  labelFilter: "all" | AccountKind = "all";
  linkOpenFor = "";
  selectedSaleId = "";

  readonly labelFilters: Array<{ key: "all" | AccountKind; text: string }> = [
    { key: "all", text: "Tutti" },
    { key: "toClose", text: "Da chiudere" },
    { key: "open", text: "Aperti" },
    { key: "registered", text: "Registrati" },
  ];

  formatAppointmentStatus = appointmentStatusLabel;
  formatPaymentMethod = paymentMethodLabel;
  formatPaymentStatus = paymentStatusLabel;

  private rowsSource: unknown[] = [];
  private rowsCache: AccountRow[] = [];
  get rows(): AccountRow[] {
    const source = [this.toClose, this.openSales, this.sales];
    if (source.some((value, index) => value !== this.rowsSource[index])) {
      this.rowsSource = source;
      this.rowsCache = buildAccountRows(this.toClose, this.openSales, this.sales);
    }
    return this.rowsCache;
  }

  get visibleRows(): AccountRow[] {
    const query = this.saleQuery.trim().toLowerCase();
    return this.rows.filter((row) => {
      if (this.labelFilter !== "all" && row.kind !== this.labelFilter) return false;
      if (!query) return true;
      return [row.customer, row.who, row.lines, KIND_LABELS[row.kind]]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }

  count(key: "all" | AccountKind): number {
    return key === "all"
      ? this.rows.length
      : this.rows.filter((row) => row.kind === key).length;
  }

  get emptyText(): string {
    if (this.saleQuery.trim()) return "Nessun conto corrisponde alla ricerca.";
    if (this.labelFilter === "toClose") return "Tutti i conti sono chiusi.";
    if (this.labelFilter === "open") return "Nessun conto aperto oggi.";
    return "Nessun conto. Usa «Nuovo» per vendere adesso o prenotare.";
  }

  kindLabel(kind: AccountKind): string {
    return KIND_LABELS[kind];
  }

  pillClass(kind: "all" | AccountKind): string {
    return kind === "toClose"
      ? "status-pill-amber"
      : kind === "open"
        ? "status-pill-blue"
        : kind === "registered"
          ? "status-pill-green"
          : "status-pill-neutral";
  }

  trackRow(_index: number, row: AccountRow): string {
    return row.key;
  }

  openRow(row: AccountRow): void {
    if (row.kind === "registered") {
      this.openSaleDetail(row.sale);
      return;
    }
    this.closeAccount.emit({ appointment: row.appointment, sale: row.sale });
  }

  toggleLink(key: string): void {
    this.linkOpenFor = this.linkOpenFor === key ? "" : key;
    this.selectedSaleId = "";
  }

  private saleOptionsSource: unknown;
  private saleOptionsCache: UiOption[] = [];
  get saleOptions(): UiOption[] {
    if (this.saleOptionsSource !== this.unlinkedSales) {
      this.saleOptionsSource = this.unlinkedSales;
      this.saleOptionsCache = [
        { value: "", label: "Seleziona una vendita senza appuntamento" },
        ...uiOptions(
          this.unlinkedSales,
          (sale: any) => sale.id as string,
          (sale: any) =>
            `${personName(sale.customer) || "Vendita senza cliente"} · EUR ${Number(sale.total || 0).toFixed(2)}`,
        ),
      ];
    }
    return this.saleOptionsCache;
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

  editSelectedSale(): void {
    if (!this.selectedSale) return;
    const sale = this.selectedSale;
    this.closeSaleDetail();
    this.editOrder.emit(sale);
  }

  deleteSelectedSale(): void {
    if (!this.selectedSale) return;
    const sale = this.selectedSale;
    this.closeSaleDetail();
    this.deleteOrder.emit(sale);
  }

  saleItemLabel(item: any): string {
    return item.service?.name || item.product?.name || item.label;
  }

  saleItemLabels(sale: any): string {
    return (sale.items || [])
      .map((item: any) => this.saleItemLabel(item))
      .join(" · ");
  }

  formatDateTime(value: string): string {
    if (!value) return "";
    return new Date(value).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
}
