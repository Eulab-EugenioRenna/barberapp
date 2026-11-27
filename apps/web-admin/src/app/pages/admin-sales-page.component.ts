import { FunctionAccessDirective } from "../shared/function-access.directive";
import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { InfiniteScrollDirective } from "../shared/infinite-scroll.directive";
import { UiIconComponent } from "../shared/ui-icon.component";
import {
  UiMoreMenuComponent,
  UiSelectComponent,
  UiSheetComponent,
  uiOptions,
  type UiOption,
} from "@alora/ui";
import { SessionStore } from "../core/session.store";
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
      .account-line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.75rem;
      }
      .account-line > .account-main {
        flex: 1 1 18rem;
        min-width: 0;
      }
      .account-sub {
        margin-top: 0.25rem;
        overflow: hidden;
        color: var(--muted);
        font-size: 0.875rem;
        text-overflow: ellipsis;
        white-space: nowrap;
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
        flex: 0 0 auto;
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
    UiSheetComponent,
    UiMoreMenuComponent,
  ],
  template: `
    <section class="grid gap-4">
      <article class="panel rounded-[2rem] p-4 sm:p-5">
        <div class="page-head">
          <div class="min-w-0">
            <p class="eyebrow text-[var(--accent)]">Cassa</p>
            <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 class="font-display text-2xl sm:text-3xl">Vendite e conti</h3>
              <span class="status-pill status-pill-neutral"
                >{{ rows.length }} conti</span
              >
            </div>
          </div>
          <button
            aloraFunction="sales.manage"
            type="button"
            class="primary-btn"
            data-tour="sales-new"
            (click)="openQuickOrder.emit()"
          >
            <barber-ui-icon name="receipt"></barber-ui-icon> Nuova vendita
          </button>
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
            <div class="account-line">
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
                  </div>
                  <p class="account-sub">
                    {{ formatDateTime(row.when) }}
                    <ng-container *ngIf="row.who"> · {{ row.who }}</ng-container>
                    <ng-container *ngIf="row.lines"> · {{ row.lines }}</ng-container>
                  </p>
                </div>
                <div class="text-right">
                  <strong *ngIf="row.total !== null">€{{ row.total.toFixed(2) }}</strong>
                  <p
                    *ngIf="row.kind === 'registered'"
                    class="text-sm text-[var(--muted)]"
                  >
                    {{ formatPaymentStatus(row.sale?.paymentStatus) }}
                  </p>
                </div>
              </button>

              <div *ngIf="row.kind !== 'registered'" class="account-actions">
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
                <ui-more-menu
                  *ngIf="hasMoreActions(row)"
                  [label]="'Altre azioni per il conto di ' + row.customer"
                  [attr.data-tour]="first ? 'sales-more' : null"
                >
                  <button
                    *ngIf="row.appointment && unlinkedSales.length && can('sales.manage')"
                    type="button"
                    role="menuitem"
                    (click)="toggleLink(row.key)"
                  >
                    <barber-ui-icon name="link"></barber-ui-icon>
                    {{ linkOpenFor === row.key ? "Chiudi collegamento" : "Collega una vendita già fatta" }}
                  </button>
                  <button
                    *ngIf="row.appointment && can('appointments.update.all')"
                    type="button"
                    role="menuitem"
                    class="ui-more-danger"
                    [disabled]="loading"
                    (click)="cancelAppointment.emit(row.appointment)"
                  >
                    <barber-ui-icon name="ban"></barber-ui-icon> Annulla appuntamento
                  </button>
                </ui-more-menu>
              </div>
            </div>

            <div
              aloraFunction="sales.manage"
              *ngIf="linkOpenFor === row.key"
              class="flex flex-wrap items-center gap-2 rounded-2xl bg-black/5 p-3"
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

    <ui-sheet
      *ngIf="selectedSale"
      size="md"
      eyebrow="Vendita registrata"
      [title]="saleCustomerName(selectedSale)"
      [subtitle]="formatDateTime(selectedSale.soldAt) + ' · ' + formatPaymentMethod(selectedSale.paymentMethod) + ' · Riferimento ' + selectedSale.id"
      closeLabel="Chiudi dettaglio vendita"
      (close)="closeSaleDetail()"
    >
        <div class="grid gap-3 sm:grid-cols-2">
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
          class="rounded-2xl border border-[var(--line)] p-4"
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

        <div class="grid gap-3">
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
          class="grid gap-2 rounded-2xl border border-[var(--line)] p-4 text-sm"
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
        <ng-container ngProjectAs="[uiSheetBar]">
          <button
            aloraFunction="sales.manage"
            type="button"
            class="danger-btn ui-bar-start"
            (click)="deleteSelectedSale()"
          >
            <barber-ui-icon name="trash"></barber-ui-icon> Elimina vendita
          </button>
          <button
            *ngIf="selectedSale.orderStatus !== 'cancelled'"
            aloraFunction="sales.manage"
            type="button"
            class="pill-btn"
            (click)="cancelSelectedSale()"
          >
            <barber-ui-icon name="close"></barber-ui-icon> Annulla vendita
          </button>
          <div class="ui-bar-info">
            <span>Totale</span>
            <strong>€{{ Number(selectedSale.total || 0).toFixed(2) }}</strong>
          </div>
          <button
            aloraFunction="sales.manage"
            type="button"
            class="primary-btn"
            (click)="editSelectedSale()"
          >
            <barber-ui-icon name="edit"></barber-ui-icon> Modifica vendita
          </button>
        </ng-container>
    </ui-sheet>
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
  /** «Annulla vendita»: refunds, stock back, bookings cancelled. */
  @Output() cancelOrder = new EventEmitter<any>();
  /** Settle an account to close or open: opens the till on that account. */
  @Output() closeAccount = new EventEmitter<{ appointment: any; sale: any }>();
  @Output() linkOrder = new EventEmitter<{ appointment: any; saleId: string }>();
  @Output() cancelAppointment = new EventEmitter<any>();
  /** «Nuova vendita»: opens the till empty. */
  @Output() openQuickOrder = new EventEmitter<void>();

  private readonly session = inject(SessionStore);

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

  can(permission: string): boolean {
    return this.session.can(permission);
  }

  /** Secondary actions of a row to close, kept in its «…» menu. */
  hasMoreActions(row: AccountRow): boolean {
    if (!row.appointment) return false;
    return (
      (this.unlinkedSales.length > 0 && this.can("sales.manage")) ||
      this.can("appointments.update.all")
    );
  }

  saleCustomerName(sale: any): string {
    return personName(sale?.customer) || "Vendita senza cliente";
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

  cancelSelectedSale(): void {
    if (!this.selectedSale) return;
    const sale = this.selectedSale;
    this.closeSaleDetail();
    this.cancelOrder.emit(sale);
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
