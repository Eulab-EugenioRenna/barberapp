import { FunctionAccessDirective } from "../shared/function-access.directive";
import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { InfiniteScrollDirective } from "../shared/infinite-scroll.directive";
import { AutofocusFirstDirective } from "../shared/autofocus-first.directive";
import { UiIconComponent } from "../shared/ui-icon.component";
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
  ],
  styles: [
    `
      /* Spacing scale of the card: one value per level, used everywhere. */
      :host {
        --cd-pad: 1.5rem;
        --cd-gap: 1.1rem;
        --cd-field-gap: 0.9rem;
      }
      .customer-dialog {
        display: flex;
        flex-direction: column;
        width: min(34rem, 100%);
        max-height: min(92dvh, 60rem);
        padding: 0;
        overflow: hidden;
      }
      .customer-dialog-wide {
        width: min(78rem, 100%);
        height: min(92dvh, 60rem);
      }
      .customer-dialog-head {
        display: flex;
        flex: none;
        align-items: center;
        justify-content: space-between;
        gap: var(--cd-gap);
        padding: calc(var(--cd-pad) * 0.8) var(--cd-pad);
        border-bottom: 0.0625rem solid var(--line);
      }
      .customer-dialog-body {
        display: grid;
        flex: 1;
        min-height: 0;
        grid-template-rows: minmax(0, 1fr);
      }
      .customer-dialog-wide .customer-dialog-body {
        grid-template-columns: minmax(20rem, 25rem) minmax(0, 1fr);
      }
      .customer-col {
        display: flex;
        flex-direction: column;
        min-height: 0;
        height: 100%;
      }
      .customer-col-title {
        margin: 0;
        color: var(--muted);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      /* Left: full height, fields scroll, actions always at the bottom. */
      .customer-profile {
        background: rgba(30, 52, 37, 0.025);
      }
      .customer-dialog-wide .customer-profile {
        border-right: 0.0625rem solid var(--line);
      }
      .customer-profile-fields {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: var(--cd-field-gap);
        min-height: 0;
        overflow: auto;
        padding: var(--cd-pad);
      }
      .customer-profile-fields textarea {
        min-height: 7rem;
        resize: vertical;
      }
      .customer-name-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--cd-field-gap);
      }
      .customer-profile-actions {
        display: flex;
        flex: none;
        flex-wrap: wrap;
        gap: 0.6rem;
        padding: calc(var(--cd-pad) * 0.75) var(--cd-pad);
        border-top: 0.0625rem solid var(--line);
        background: var(--panel, #fff);
      }
      /* Right: summary and filters stay, the list scrolls. */
      .customer-history {
        gap: var(--cd-gap);
        padding: var(--cd-pad);
      }
      .customer-history > * {
        flex: none;
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
      .customer-history > .history-list {
        flex: 1;
      }
      .history-list {
        display: grid;
        align-content: start;
        gap: 0.5rem;
        min-height: 0;
        margin: 0 calc(var(--cd-pad) * -0.25) 0 0;
        padding: 0 calc(var(--cd-pad) * 0.25) 0 0;
        list-style: none;
        overflow: auto;
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
        align-self: center;
      }

      /* Tablet: narrower profile column, KPIs on two rows. */
      @media (max-width: 1100px) {
        :host {
          --cd-pad: 1.25rem;
        }
        .customer-dialog-wide .customer-dialog-body {
          grid-template-columns: minmax(17rem, 21rem) minmax(0, 1fr);
        }
        .history-kpis {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      /* Stacked: one scroll for the whole card, profile first. */
      @media (max-width: 860px) {
        .customer-dialog-wide {
          height: min(94dvh, 60rem);
        }
        .customer-dialog-body,
        .customer-dialog-wide .customer-dialog-body {
          grid-template-columns: minmax(0, 1fr);
          grid-template-rows: none;
          overflow: auto;
        }
        .customer-col {
          height: auto;
        }
        .customer-dialog-wide .customer-profile {
          border-right: 0;
          border-bottom: 0.0625rem solid var(--line);
        }
        .customer-profile-fields,
        .history-list {
          overflow: visible;
        }
        .history-list {
          margin: 0;
          padding: 0;
        }
      }

      /* Phone: full screen sheet, tighter spacing, stacked filters. */
      @media (max-width: 640px) {
        :host {
          --cd-pad: 1rem;
          --cd-gap: 0.9rem;
          --cd-field-gap: 0.75rem;
        }
        .customer-dialog,
        .customer-dialog-wide {
          position: fixed;
          inset: 0;
          width: 100%;
          height: 100dvh;
          max-height: none;
          border-radius: 0;
        }
        .customer-dialog-head {
          padding-top: calc(var(--cd-pad) * 0.8 + env(safe-area-inset-top));
        }
        .customer-name-row {
          grid-template-columns: minmax(0, 1fr);
        }
        .customer-profile-actions {
          position: sticky;
          bottom: 0;
          z-index: 1;
          padding-bottom: calc(var(--cd-pad) * 0.75 + env(safe-area-inset-bottom));
        }
        .customer-profile-actions > * {
          flex: 1;
          justify-content: center;
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

    <div *ngIf="formOpen" class="confirm-overlay">
      <button
        type="button"
        class="confirm-backdrop"
        (click)="formOpen = false"
        aria-label="Chiudi scheda cliente"
      ></button>
      <article
        barberAutofocusFirst
        class="confirm-dialog panel customer-dialog"
        [class.customer-dialog-wide]="customerForm.id"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-form-title"
      >
        <header class="customer-dialog-head">
          <div class="min-w-0">
            <p class="eyebrow text-[var(--accent)]">
              {{ customerForm.id ? "Scheda cliente" : "Nuovo cliente" }}
            </p>
            <h2 id="customer-form-title" class="mt-1 truncate font-display text-2xl sm:text-3xl">
              {{ displayName || "Nuovo cliente" }}
            </h2>
          </div>
          <div class="flex flex-none flex-wrap justify-end gap-2">
            <button
              *ngIf="customerForm.id"
              aloraFunction="whatsapp.send"
              data-tour="customer-whatsapp"
              type="button"
              class="secondary-btn"
              (click)="whatsappTo = customerForm"
            >
              Invia messaggio
            </button>
            <button type="button" class="pill-btn" (click)="formOpen = false">
              <barber-ui-icon name="close"></barber-ui-icon> Chiudi
            </button>
          </div>
        </header>

        <div class="customer-dialog-body">
          <!-- Left: personal data -->
          <form class="customer-col customer-profile" data-tour="customer-profile" (ngSubmit)="submit()">
            <div class="customer-profile-fields">
            <p class="customer-col-title">Anagrafica</p>
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
            </div>
            <div class="customer-profile-actions">
              <button
                aloraFunction="clients.manage"
                type="submit"
                class="primary-btn"
                [disabled]="loading || !formValid"
              >
                <barber-ui-icon name="save"></barber-ui-icon>
                {{ customerForm.id ? "Salva" : "Crea cliente" }}
              </button>
              <button
                aloraFunction="clients.manage"
                *ngIf="customerForm.id"
                type="button"
                class="pill-btn"
                [disabled]="loading"
                (click)="removeCustomer()"
              >
                <barber-ui-icon name="trash"></barber-ui-icon> Elimina
              </button>
            </div>
          </form>

          <!-- Right: history with search and filters -->
          <section
            *ngIf="customerForm.id"
            class="customer-col customer-history"
            data-tour="customer-history"
            aria-labelledby="customer-history-title"
          >
            <p id="customer-history-title" class="customer-col-title">Storico</p>
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

            <div class="history-tools" data-tour="customer-history-filters">
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
        </div>
      </article>
    </div>

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
