import { FunctionAccessDirective } from "../shared/function-access.directive";
import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { InfiniteScrollDirective } from "../shared/infinite-scroll.directive";
import { AutofocusFirstDirective } from "../shared/autofocus-first.directive";
import { UiIconComponent } from "../shared/ui-icon.component";
import { UiSheetComponent } from "@alora/ui";
import {
  WhatsAppSendDialogComponent,
  type WhatsAppRecipient,
} from "../shared/whatsapp-send-dialog.component";
import {
  appointmentStatusLabel,
  paymentMethodLabel,
  paymentStatusLabel,
} from "../shared/presentation-copy";
import {
  buildHistoryRows,
  filterHistoryRows,
  summarizeHistory,
  type HistoryKindFilter,
  type HistoryPeriod,
  type HistoryRow,
  type HistorySummary,
} from "./customer-history";

@Component({
  selector: "barber-admin-customers-page",
  standalone: true,
  imports: [
    FunctionAccessDirective,
    CommonModule,
    FormsModule,
    InfiniteScrollDirective,
    AutofocusFirstDirective,
    UiIconComponent,
    WhatsAppSendDialogComponent,
    UiSheetComponent,
  ],
  styles: [
    `
      .customer-col-title {
        margin: 0;
        color: var(--muted);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      .customer-profile-fields {
        display: grid;
        align-content: start;
        gap: 0.9rem;
      }
      .customer-name-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.9rem;
      }
      .customer-history {
        display: grid;
        align-content: start;
        gap: 1rem;
      }
      .history-summary-line {
        color: var(--muted);
        font-size: 0.85rem;
        font-weight: 500;
      }
      .history-kpis {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 0.6rem;
      }
      .history-kpis div {
        display: grid;
        gap: 0.2rem;
        min-width: 0;
        border: 0.0625rem solid var(--line);
        border-radius: 1rem;
        padding: 0.7rem 0.85rem;
      }
      .history-kpis span {
        color: var(--muted);
        font-size: 0.75rem;
      }
      .history-kpis strong {
        overflow: hidden;
        font-size: 1.05rem;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .history-tools {
        display: grid;
        gap: 0.7rem;
      }
      .history-search input {
        width: 100%;
      }
      .history-filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.6rem;
      }
      .history-pills {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 0.35rem;
      }
      .history-pill {
        border: 0.0625rem solid var(--line);
        border-radius: 999rem;
        background: transparent;
        color: inherit;
        padding: 0.4rem 0.8rem;
        font-size: 0.82rem;
        font-weight: 700;
        white-space: nowrap;
        cursor: pointer;
      }
      .history-pill em {
        margin-left: 0.2rem;
        color: var(--muted);
        font-style: normal;
      }
      .history-pill.on {
        border-color: var(--alora-forest, #1e3425);
        background: var(--alora-forest, #1e3425);
        color: #fff;
      }
      .history-pill.on em {
        color: rgba(255, 255, 255, 0.75);
      }
      .history-list {
        display: grid;
        align-content: start;
        gap: 0.5rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .history-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 0.8rem;
        width: 100%;
        border: 0.0625rem solid var(--line);
        border-radius: 1rem;
        background: var(--panel, #fff);
        color: inherit;
        padding: 0.7rem 0.85rem;
        text-align: left;
        cursor: pointer;
      }
      .history-row:hover {
        border-color: rgba(30, 52, 37, 0.35);
      }
      .history-row-future {
        border-style: dashed;
      }
      .history-icon {
        display: inline-grid;
        place-items: center;
        width: 2.2rem;
        height: 2.2rem;
        border-radius: 0.8rem;
        background: rgba(30, 52, 37, 0.07);
      }
      .history-icon.sale {
        background: rgba(200, 241, 105, 0.45);
      }
      .history-main {
        display: grid;
        gap: 0.1rem;
        min-width: 0;
      }
      .history-meta {
        color: var(--muted);
        font-size: 0.82rem;
      }
      .history-side {
        display: grid;
        justify-items: end;
        gap: 0.25rem;
      }
      .history-detail {
        display: grid;
        gap: 0.4rem;
        margin: 0.3rem 0.4rem 0.5rem 3.8rem;
        color: var(--muted);
        font-size: 0.88rem;
      }
      .history-detail p {
        margin: 0;
      }
      .history-empty {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
        border: 0.0625rem dashed var(--line);
        border-radius: 1rem;
        padding: 1rem;
        color: var(--muted);
        font-size: 0.9rem;
      }
      .link-btn {
        border: 0;
        background: none;
        color: inherit;
        font-weight: 700;
        text-decoration: underline;
        cursor: pointer;
      }
      .history-more {
        justify-self: center;
      }

      @media (max-width: 1100px) {
        .history-kpis {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 640px) {
        .customer-name-row {
          grid-template-columns: minmax(0, 1fr);
        }
        .history-filters {
          flex-direction: column;
          align-items: stretch;
        }
        .history-pills {
          flex-wrap: nowrap;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .history-row {
          grid-template-columns: auto minmax(0, 1fr);
        }
        .history-side {
          grid-column: 2;
          grid-auto-flow: column;
          justify-content: start;
          align-items: center;
          gap: 0.5rem;
        }
        .history-detail {
          margin-left: 0.4rem;
        }
      }
    `,
  ],
  template: `
    <section class="grid gap-4">
      <article class="panel rounded-[2rem] p-4 sm:p-5">
        <div class="page-head">
          <div class="min-w-0">
            <p class="eyebrow text-[var(--accent)]">Relazioni</p>
            <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 class="font-display text-2xl sm:text-3xl">Clienti</h3>
              <span class="status-pill status-pill-neutral"
                >{{ customers.length }} contatti</span
              >
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              aloraFunction="whatsapp.send"
              data-tour="customers-whatsapp-all"
              type="button"
              class="secondary-btn"
              (click)="whatsappTo = null"
            >
              Messaggio a tutti
            </button>
            <button
              aloraFunction="clients.manage"
              data-tour="customers-new"
              type="button"
              class="primary-btn"
              (click)="openNew()"
            >
              <barber-ui-icon name="plus"></barber-ui-icon> Nuovo cliente
            </button>
          </div>
        </div>
        <label class="field mt-4" data-tour="customers-search">
          <span>Cerca cliente</span>
          <input
            [(ngModel)]="customerQuery"
            (ngModelChange)="searchChange.emit($event)"
            name="customerSearch"
            type="search"
            autocomplete="off"
            placeholder="Nome, email o telefono"
          />
        </label>
        <div class="mt-4 grid gap-2.5 sm:gap-3" data-tour="customers-list">
          <button
            *ngFor="let customer of customers; trackBy: trackById"
            type="button"
            class="list-card text-left"
            (click)="openEdit(customer)"
          >
            <div>
              <strong>{{ customer.firstName }} {{ customer.lastName }}</strong>
              <p class="mt-1 text-sm text-[var(--muted)]">
                {{ customer.email || "Email non inserita" }}
              </p>
              <p class="text-sm text-[var(--muted)]">
                {{ customer.phone || "Telefono non inserito" }}
              </p>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <span
                *ngFor="let tag of customer.autoTags || []"
                class="status-pill status-pill-blue"
                >{{ tag }}</span
              >
              <span
                *ngFor="let tag of customer.tags"
                class="status-pill status-pill-neutral"
                >{{ tag }}</span
              >
            </div>
          </button>
          <article
            *ngIf="!customers.length && !loading"
            class="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]"
          >
            Nessun cliente trovato. Usa “+ Nuovo cliente” per creare il primo
            contatto.
          </article>
          <p
            *ngIf="hasMore"
            class="text-center text-xs uppercase tracking-wider text-[var(--muted)]"
          >
            Scorri per caricare altri clienti
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

    <ui-sheet
      *ngIf="formOpen"
      [size]="customerForm.id ? 'lg' : 'md'"
      [split]="!!customerForm.id"
      [eyebrow]="customerForm.id ? 'Scheda cliente' : 'Nuovo cliente'"
      [title]="displayName || 'Nuovo cliente'"
      [subtitle]="customerForm.id ? 'Anagrafica a sinistra, storico di visite e conti a destra.' : 'Nome e cognome sono obbligatori, il resto puoi aggiungerlo dopo.'"
      closeLabel="Chiudi scheda cliente"
      (close)="formOpen = false"
    >
      <button
        uiSheetHead
        *ngIf="customerForm.id"
        aloraFunction="whatsapp.send"
        data-tour="customer-whatsapp"
        type="button"
        class="secondary-btn"
        (click)="whatsappTo = customerForm"
      >
        Invia messaggio
      </button>

      <form
        barberAutofocusFirst
        id="customer-form"
        [class.ui-sheet-col]="!!customerForm.id"
        class="customer-profile-fields"
        data-tour="customer-profile"
        (ngSubmit)="submit()"
      >
        <p class="ui-step">1 · Anagrafica</p>
        <div class="customer-name-row">
          <label class="field">
            <span>Nome <em class="required-mark" aria-hidden="true">*</em></span>
            <input
              [(ngModel)]="customerForm.firstName"
              name="customerFirstName"
              autocomplete="given-name"
              required
            />
          </label>
          <label class="field">
            <span>Cognome <em class="required-mark" aria-hidden="true">*</em></span>
            <input
              [(ngModel)]="customerForm.lastName"
              name="customerLastName"
              autocomplete="family-name"
              required
            />
          </label>
        </div>
        <label class="field">
          <span>Telefono</span>
          <input
            [(ngModel)]="customerForm.phone"
            name="customerPhone"
            type="tel"
            autocomplete="tel"
          />
        </label>
        <label class="field">
          <span>Email</span>
          <input
            [(ngModel)]="customerForm.email"
            name="customerEmail"
            type="email"
            autocomplete="email"
          />
        </label>
        <div *ngIf="customerForm.autoTags?.length" class="flex flex-wrap gap-2">
          <span *ngFor="let tag of customerForm.autoTags" class="status-pill status-pill-blue">{{ tag }}</span>
        </div>
        <label class="field">
          <span>Tag</span>
          <input
            [(ngModel)]="customerForm.tagsText"
            name="customerTagsText"
            placeholder="vip, richiamo, preferenze"
          />
        </label>
        <label class="field">
          <span>Note</span>
          <textarea
            [(ngModel)]="customerForm.notes"
            name="customerNotes"
            rows="4"
            placeholder="Preferenze, allergie, cose da ricordare"
          ></textarea>
        </label>
      </form>

      <section
        *ngIf="customerForm.id"
        class="ui-sheet-col customer-history"
        data-tour="customer-history"
        aria-labelledby="customer-history-title"
      >
        <p id="customer-history-title" class="ui-step">2 · Storico</p>
        <label class="field history-search">
            <span class="sr-only">Cerca nello storico</span>
            <input
              [(ngModel)]="historyQuery"
              name="historyQuery"
              type="search"
              autocomplete="off"
              placeholder="Cerca servizio, prodotto, professionista, note"
            />
          </label>
        <details class="ui-advanced" data-tour="customer-history-filters">
          <summary>
            <span>Riepilogo e filtri</span>
            <small class="history-summary-line" *ngIf="!historyLoading && customerHistory">
              €{{ summary.spent | number: "1.2-2" }} · {{ summary.visits }} visite<ng-container *ngIf="filtersActive"> · filtri attivi</ng-container>
            </small>
          </summary>
          <div class="ui-advanced-body">
            <div class="history-kpis" *ngIf="!historyLoading && customerHistory">
              <div><span>Speso</span><strong>€{{ summary.spent | number: "1.2-2" }}</strong></div>
              <div><span>Visite</span><strong>{{ summary.visits }}</strong></div>
              <div>
                <span>Ultima visita</span
                ><strong>{{ summary.lastVisit ? formatShortDate(summary.lastVisit) : "—" }}</strong>
              </div>
              <div>
                <span>Prossimo</span
                ><strong>{{ summary.nextAppointment ? formatShortDate(summary.nextAppointment) : "—" }}</strong>
              </div>
            </div>

            <div class="history-filters">
              <div class="history-pills" role="group" aria-label="Tipo">
                <button
                  *ngFor="let option of kindOptions"
                  type="button"
                  class="history-pill"
                  [class.on]="historyKind === option.value"
                  [attr.aria-pressed]="historyKind === option.value"
                  (click)="historyKind = option.value"
                >
                  {{ option.label }} <em>{{ kindCount(option.value) }}</em>
                </button>
              </div>
              <div class="history-pills" role="group" aria-label="Periodo">
                <button
                  *ngFor="let option of periodOptions"
                  type="button"
                  class="history-pill"
                  [class.on]="historyPeriod === option.value"
                  [attr.aria-pressed]="historyPeriod === option.value"
                  (click)="historyPeriod = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
          </div>
        </details>
        <p *ngIf="historyLoading" class="text-sm text-[var(--muted)]" role="status">
          Caricamento storico…
        </p>
        <ul *ngIf="!historyLoading" class="history-list" aria-live="polite">
          <li *ngFor="let row of visibleRows; trackBy: trackByRow">
            <button
              type="button"
              class="history-row"
              [class.history-row-future]="row.future"
              [attr.aria-expanded]="expanded === row.id"
              (click)="expanded = expanded === row.id ? null : row.id"
            >
              <span class="history-icon" [class.sale]="row.kind === 'sale'" aria-hidden="true">
                <barber-ui-icon [name]="row.kind === 'sale' ? 'receipt' : 'calendar'"></barber-ui-icon>
              </span>
              <span class="history-main">
                <strong class="truncate">{{ row.title }}</strong>
                <span class="history-meta">
                  {{ formatDateTime(row.at) }}
                  <ng-container *ngIf="row.subtitle"> · {{ row.subtitle }}</ng-container>
                </span>
              </span>
              <span class="history-side">
                <strong *ngIf="row.amount !== null">€{{ row.amount | number: "1.2-2" }}</strong>
                <span
                  class="status-pill"
                  [class.status-pill-blue]="row.future"
                  [class.status-pill-neutral]="!row.future"
                  >{{ row.future ? "In programma" : statusLabel(row) }}</span
                >
              </span>
            </button>
            <div *ngIf="expanded === row.id" class="history-detail">
              <ul *ngIf="row.lines.length" class="grid gap-1">
                <li *ngFor="let line of row.lines" class="flex justify-between gap-3">
                  <span>{{ line.quantity }} × {{ line.label }}</span>
                  <span>€{{ line.total | number: "1.2-2" }}</span>
                </li>
              </ul>
              <p *ngIf="row.paymentMethod">Pagamento: {{ formatPaymentMethod(row.paymentMethod) }}</p>
              <p *ngIf="row.kind === 'appointment'">
                {{ row.settled ? "Conto registrato in cassa." : row.future ? "Appuntamento futuro." : "Nessun conto collegato." }}
              </p>
              <p *ngIf="row.notes">Note: {{ row.notes }}</p>
            </div>
          </li>
          <li *ngIf="!filteredRows.length" class="history-empty">
            {{ historyRows.length ? "Nessuna voce con questi filtri." : "Nessuna attività registrata." }}
            <button
              *ngIf="historyRows.length"
              type="button"
              class="link-btn"
              (click)="resetHistoryFilters()"
            >
              Azzera filtri
            </button>
          </li>
        </ul>
        <button
          *ngIf="!historyLoading && filteredRows.length > visibleRows.length"
          type="button"
          class="pill-btn history-more"
          (click)="historyLimit = historyLimit + 30"
        >
          Mostra altre {{ filteredRows.length - visibleRows.length }}
        </button>
      </section>

      <ng-container ngProjectAs="[uiSheetBar]">
        <button
          aloraFunction="clients.manage"
          *ngIf="customerForm.id"
          type="button"
          class="danger-btn ui-bar-start"
          [disabled]="loading"
          (click)="removeCustomer()"
        >
          <barber-ui-icon name="trash"></barber-ui-icon> Elimina
        </button>
        <button
          aloraFunction="clients.manage"
          type="submit"
          form="customer-form"
          class="primary-btn"
          [disabled]="loading || !formValid"
        >
          <barber-ui-icon name="save"></barber-ui-icon>
          {{ customerForm.id ? "Salva" : "Crea cliente" }}
        </button>
      </ng-container>
    </ui-sheet>

    <alora-whatsapp-send-dialog
      *ngIf="whatsappTo !== undefined"
      [customer]="whatsappTo"
      (closed)="whatsappTo = undefined"
    ></alora-whatsapp-send-dialog>
  `,
})
export class AdminCustomersPageComponent {
  formatAppointmentStatus = appointmentStatusLabel;
  formatPaymentMethod = paymentMethodLabel;
  formatPaymentStatus = paymentStatusLabel;
  @Input() customers: any[] = [];
  /** WhatsApp dialog: a customer, null for everyone, undefined when closed. */
  whatsappTo: WhatsAppRecipient | null | undefined = undefined;
  @Input() customerForm: any = {};
  @Input() loading = false;
  @Input() hasMore = false;
  @Input() historyLoading = false;
  @Input() set customerHistory(value: any) {
    this.history = value;
    this.historyRows = buildHistoryRows(value);
    this.summary = summarizeHistory(value);
  }
  get customerHistory(): any {
    return this.history;
  }

  @Output() edit = new EventEmitter<any>();
  @Output() save = new EventEmitter<void>();
  @Output() remove = new EventEmitter<any>();
  @Output() reset = new EventEmitter<void>();
  @Output() loadMore = new EventEmitter<void>();
  @Output() searchChange = new EventEmitter<string>();

  readonly kindOptions: Array<{ value: HistoryKindFilter; label: string }> = [
    { value: "all", label: "Tutto" },
    { value: "appointment", label: "Appuntamenti" },
    { value: "sale", label: "Conti" },
  ];
  readonly periodOptions: Array<{ value: HistoryPeriod; label: string }> = [
    { value: "all", label: "Sempre" },
    { value: "30d", label: "30 giorni" },
    { value: "6m", label: "6 mesi" },
    { value: "12m", label: "12 mesi" },
  ];

  customerQuery = "";
  formOpen = false;
  private history: any = null;
  historyRows: HistoryRow[] = [];
  summary: HistorySummary = summarizeHistory(null);
  historyQuery = "";
  historyKind: HistoryKindFilter = "all";
  historyPeriod: HistoryPeriod = "all";
  historyLimit = 30;
  expanded: string | null = null;

  get displayName(): string {
    return `${this.customerForm.firstName ?? ""} ${this.customerForm.lastName ?? ""}`.trim();
  }

  get filteredRows(): HistoryRow[] {
    return filterHistoryRows(this.historyRows, {
      kind: this.historyKind,
      period: this.historyPeriod,
      query: this.historyQuery,
    });
  }

  get visibleRows(): HistoryRow[] {
    return this.filteredRows.slice(0, this.historyLimit);
  }

  kindCount(kind: HistoryKindFilter): number {
    return filterHistoryRows(this.historyRows, {
      kind,
      period: this.historyPeriod,
      query: this.historyQuery,
    }).length;
  }

  statusLabel(row: HistoryRow): string {
    return row.kind === "sale"
      ? this.formatPaymentStatus(row.status)
      : this.formatAppointmentStatus(row.status);
  }

  get filtersActive(): boolean {
    return this.historyKind !== "all" || this.historyPeriod !== "all";
  }

  resetHistoryFilters(): void {
    this.historyQuery = "";
    this.historyKind = "all";
    this.historyPeriod = "all";
  }

  openEdit(customer: any): void {
    this.resetHistoryView();
    this.edit.emit(customer);
    this.formOpen = true;
  }

  openNew(): void {
    this.resetHistoryView();
    this.reset.emit();
    this.formOpen = true;
  }

  submit(): void {
    this.save.emit();
    this.formOpen = false;
  }

  removeCustomer(): void {
    this.formOpen = false;
    this.remove.emit(this.customerForm);
  }

  private resetHistoryView(): void {
    this.resetHistoryFilters();
    this.historyLimit = 30;
    this.expanded = null;
  }

  trackByRow(_index: number, row: HistoryRow): string {
    return row.id;
  }

  trackById(_index: number, item: any): string {
    return item.id;
  }

  get formValid(): boolean {
    return Boolean(
      customerText(this.customerForm.firstName) &&
      customerText(this.customerForm.lastName),
    );
  }

  formatShortDate(value: string): string {
    return new Date(value).toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    });
  }

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString("it-IT", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  formatTime(value: string): string {
    return new Date(value).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  saleItemLabels(sale: any): string {
    return (sale.items || [])
      .map(
        (item: any) => item.service?.name || item.product?.name || item.label,
      )
      .join(" · ");
  }
}

function customerText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
