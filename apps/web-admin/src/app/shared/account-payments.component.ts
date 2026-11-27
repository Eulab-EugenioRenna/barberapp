import { humanError } from "../core/human-error";
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  LOCALE_ID,
  Output,
  inject,
} from "@angular/core";
import { CommonModule, formatDate } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { UiSelectComponent, type UiOption } from "@alora/ui";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { ADMIN_API_URL } from "../core/api-config";
import { SessionStore } from "../core/session.store";
import { selectedOperationalScope } from "../core/operational-context.service";

type Line = { amount: string; method?: string; refundOfId?: string };
type Attempt = {
  kind: string;
  revision: number;
  entries: Line[];
  reason?: string;
  idempotencyKey: string;
  headers: Record<string, string>;
};
@Component({
  selector: "alora-account-payments",
  standalone: true,
  imports: [CommonModule, FormsModule, UiSelectComponent],
  template: `<details class="account-payments" (toggle)="onToggle($event)">
    <summary>Incassi del conto</summary>
    <p class="hint">
      Registra denaro già ricevuto o restituito. Carta e bonifico sono
      dichiarazioni manuali dell’operatore.
    </p>
    <p *ngIf="loading" role="status">Caricamento incassi…</p>
    <p *ngIf="feedback" role="status" class="feedback">{{ feedback }}</p>
    <ng-container *ngIf="data">
      <p *ngIf="data.orderStatus === 'cancelled'" class="feedback">
        Prenotazione annullata. Il valore originario e gli incassi restano nello
        storico; un rimborso richiede una registrazione esplicita.
      </p>
      <p class="saved-total">
        Totale del conto salvato <strong>€ {{ data.summary.total }}</strong>
      </p>
      <p *ngIf="data.summary.basis === 'legacy_unknown'" class="feedback">
        Importo storico incassato da riconciliare. Lo stato precedente da solo
        non documenta quanto è stato ricevuto.
      </p>
      <dl *ngIf="data.summary.basis === 'ledger'" class="balance">
        <div>
          <dt>Incassi registrati</dt>
          <dd>€ {{ data.summary.receipts }}</dd>
        </div>
        <div>
          <dt>Saldo storico dichiarato</dt>
          <dd>€ {{ data.summary.opening }}</dd>
        </div>
        <div>
          <dt>Rimborsi</dt>
          <dd>€ {{ data.summary.refunds }}</dd>
        </div>
        <div>
          <dt>
            {{
              data.orderStatus === "cancelled"
                ? "Differenza rispetto al valore originario"
                : "Residuo"
            }}
          </dt>
          <dd>€ {{ data.summary.remaining }}</dd>
        </div>
      </dl>
      <div *ngIf="session.can('sales.manage')" class="payment-form">
        <fieldset [disabled]="busy || !!attempt">
          <div *ngIf="data.summary.basis === 'ledger'" class="select-field"
            >Operazione<ui-select
              ariaLabel="Operazione incasso"
              label="Operazione"
              [(ngModel)]="kind"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="resetLines()"
              [options]="kindOptions"
              [filterable]="false"
            ></ui-select></div
          >
          <p *ngIf="data.summary.basis === 'legacy_unknown'" class="hint">
            Indica il totale già incassato prima di iniziare il registro, anche
            zero. Non sarà conteggiato come incasso di oggi.
          </p>
          <div
            *ngFor="let line of lines; let index = index"
            class="payment-line"
          >
            <label
              >{{
                data.summary.basis === "legacy_unknown"
                  ? "Saldo storico effettivo"
                  : "Importo"
              }}<input
                [attr.aria-label]="'Importo incasso ' + (index + 1)"
                inputmode="decimal"
                type="text"
                [(ngModel)]="line.amount"
                [ngModelOptions]="{ standalone: true }"
                placeholder="0.00"
            /></label>
            <div *ngIf="data.summary.basis === 'ledger'" class="select-field"
              >Metodo<ui-select
                [ariaLabel]="'Metodo incasso ' + (index + 1)"
                label="Metodo"
                [(ngModel)]="line.method"
                [ngModelOptions]="{ standalone: true }"
                [options]="methodOptions"
                [filterable]="false"
              ></ui-select></div
            >
            <div
              *ngIf="kind === 'refund' && data.summary.basis === 'ledger'"
              class="select-field full"
              >Incasso originale<ui-select
                [ariaLabel]="'Incasso originale ' + (index + 1)"
                label="Incasso originale"
                [(ngModel)]="line.refundOfId"
                [ngModelOptions]="{ standalone: true }"
                [options]="refundOptions"
                placeholder="Seleziona il movimento"
              ></ui-select></div
            >
            <button
              *ngIf="lines.length > 1"
              type="button"
              class="text-button"
              (click)="lines.splice(index, 1)"
            >
              Rimuovi metodo {{ index + 1 }}
            </button>
          </div>
          <button
            *ngIf="data.summary.basis === 'ledger' && lines.length < 10"
            type="button"
            class="text-button"
            (click)="lines.push({ amount: '', method: 'cash' })"
          >
            Aggiungi metodo per pagamento misto
          </button>
          <label
            >Motivazione
            <span *ngIf="kind === 'receive' && data.summary.basis === 'ledger'"
              >(facoltativa)</span
            ><input
              aria-label="Motivazione incasso"
              maxlength="500"
              [(ngModel)]="reason"
              [ngModelOptions]="{ standalone: true }"
          /></label>
        </fieldset>
        <p *ngIf="attempt" class="feedback">
          Operazione in verifica. Ripeti la stessa richiesta per recuperarne
          l’esito.
        </p>
        <button
          type="button"
          class="record-button"
          [disabled]="busy || loading"
          (click)="record()"
        >
          {{
            busy
              ? "Registrazione…"
              : attempt
                ? "Verifica e riprova"
                : data.summary.basis === "legacy_unknown"
                  ? "Riconcilia saldo storico"
                  : kind === "refund"
                    ? "Registra rimborso effettuato"
                    : "Registra importi ricevuti"
          }}
        </button>
      </div>
      <ol class="payment-history">
        <li *ngFor="let row of data.items">
          <strong>{{ label(row.kind) }} · € {{ row.amount }}</strong
          ><span
            >{{
              row.kind === "opening"
                ? "Data di incasso storico non attribuita"
                : (row.receivedAt | date: "dd/MM/yyyy HH:mm")
            }}
            {{ row.method ? "· " + methodLabel(row.method) : "" }}</span
          ><small
            >Registrato {{ row.createdAt | date: "dd/MM/yyyy HH:mm" }} ·
            {{
              row.operation.reason || "Autore registrato nel movimento"
            }}</small
          >
        </li>
      </ol>
      <button
        *ngIf="data.hasMore"
        type="button"
        class="text-button"
        [disabled]="loading || busy"
        (click)="loadMore()"
      >
        Movimenti precedenti
      </button>
      <button
        type="button"
        class="text-button"
        [disabled]="loading || busy"
        (click)="load()"
      >
        Aggiorna incassi
      </button>
    </ng-container>
  </details>`,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .account-payments {
        border: 1px solid #d5dfca;
        background: #f4f8ec;
        color: #203b2a;
        border-radius: 1.1rem;
        padding: 1rem;
        max-height: 36rem;
        overflow: auto;
      }
      summary {
        cursor: pointer;
        font-size: 1rem;
        font-weight: 750;
      }
      .hint,
      .saved-total {
        font-size: 0.8rem;
        line-height: 1.5;
        margin: 0.7rem 0;
      }
      .saved-total {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .feedback {
        font-size: 0.8rem;
        line-height: 1.5;
        background: #e6eddc;
        border-radius: 0.6rem;
        padding: 0.7rem;
        margin: 0.6rem 0;
        overflow-wrap: anywhere;
      }
      .balance {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.6rem;
        margin: 1rem 0;
      }
      .balance div {
        border-bottom: 1px solid #d5dfca;
        padding-bottom: 0.5rem;
      }
      dt {
        font-size: 0.7rem;
      }
      dd {
        font-size: 1rem;
        font-weight: 750;
        margin: 0;
      }
      fieldset {
        border: 0;
        padding: 0;
        margin: 0;
        min-width: 0;
        display: grid;
        gap: 0.75rem;
      }
      fieldset:disabled {
        opacity: 0.65;
      }
      label,
      .select-field {
        display: grid;
        font-size: 0.75rem;
        gap: 0.35rem;
        min-width: 0;
      }
      input,
      select {
        width: 100%;
        min-width: 0;
        background: white;
        color: #203b2a;
        border: 1px solid #b8c7ad;
        border-radius: 0.6rem;
        min-height: 42px;
        padding: 0.55rem;
        font: inherit;
        box-sizing: border-box;
      }
      .payment-line {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 0.5rem;
        padding: 0.6rem 0;
        border-bottom: 1px solid #d5dfca;
      }
      .full {
        grid-column: 1/-1;
      }
      button {
        font: inherit;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.55;
        cursor: wait;
      }
      .text-button {
        border: 0;
        background: transparent;
        color: #294e35;
        text-align: left;
        text-decoration: underline;
        min-height: 40px;
        padding: 0.4rem 0;
        font-size: 0.75rem;
      }
      .record-button {
        width: 100%;
        background: #294e35;
        color: white;
        border: 0;
        border-radius: 0.7rem;
        padding: 0.75rem;
        margin-top: 0.8rem;
        font-size: 0.8rem;
        font-weight: 700;
        min-height: 44px;
      }
      .payment-history {
        list-style: none;
        margin: 0.8rem 0 0;
        padding: 0;
        display: grid;
        gap: 0.7rem;
        font-size: 0.75rem;
      }
      .payment-history li {
        display: grid;
        gap: 0.2rem;
        padding: 0.5rem 0;
        border-bottom: 1px solid #d5dfca;
        overflow-wrap: anywhere;
      }
      small {
        color: #53624c;
        font-size: 0.7rem;
      }
      @media (max-width: 400px) {
        .balance {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class AccountPaymentsComponent implements OnInit {
  @Input({ required: true }) saleId = "";
  @Output() updated = new EventEmitter<any>();
  @Output() pending = new EventEmitter<boolean>();
  readonly session = inject(SessionStore);
  private readonly http = inject(HttpClient);
  data: any = null;
  loading = false;
  busy = false;
  feedback = "";
  kind = "receive";
  reason = "";
  lines: Line[] = [{ amount: "", method: "cash" }];
  attempt: Attempt | null = null;
  private initialized = false;
  private get storageKey() {
    const user = this.session.currentUser();
    return `alora.payment.attempt:${user?.tenantId || ""}:${user?.id || ""}:${this.saleId}`;
  }
  ngOnInit() {
    try {
      const stored = JSON.parse(
        sessionStorage.getItem(this.storageKey) || "null",
      );
      if (stored?.idempotencyKey && stored?.entries && stored?.headers) {
        this.attempt = stored;
        this.lines = stored.entries.map((row: Line) => ({ ...row }));
        this.reason = stored.reason || "";
        this.kind = stored.kind;
        this.pending.emit(true);
      }
    } catch {
      this.feedback =
        "Richiesta salvata non leggibile. Verifica gli incassi prima di una nuova registrazione.";
    }
  }
  async onToggle(event: Event) {
    if ((event.target as HTMLDetailsElement).open && !this.initialized)
      await this.load();
  }
  async load() {
    this.loading = true;
    try {
      this.data = await firstValueFrom(
        this.http.get(`${ADMIN_API_URL}/sales/${this.saleId}/payments`),
      );
      this.initialized = true;
      if (
        this.data.orderStatus === "cancelled" &&
        this.kind === "receive" &&
        !this.attempt
      )
        this.kind = "refund";
      this.updated.emit({
        revision: this.data.revision,
        summary: this.data.summary,
      });
    } catch (error) {
      this.feedback = this.message(error);
    } finally {
      this.loading = false;
    }
  }
  async loadMore() {
    this.loading = true;
    try {
      const page: any = await firstValueFrom(
        this.http.get(
          `${ADMIN_API_URL}/sales/${this.saleId}/payments?page=${this.data.page + 1}`,
        ),
      );
      const ids = new Set(this.data.items.map((row: any) => row.id));
      this.data = {
        ...page,
        items: [
          ...this.data.items,
          ...page.items.filter((row: any) => !ids.has(row.id)),
        ],
      };
      this.updated.emit({ revision: page.revision, summary: page.summary });
    } catch (error) {
      this.feedback = this.message(error);
    } finally {
      this.loading = false;
    }
  }
  readonly methodOptions: UiOption[] = [
    { value: "cash", label: "Contanti" },
    { value: "card", label: "Carta ricevuta" },
    { value: "bank", label: "Bonifico ricevuto" },
    { value: "other", label: "Altro" },
  ];
  private readonly locale = inject(LOCALE_ID);
  private optionsSource: unknown;
  private kindOptionsCache: UiOption[] = [];
  private refundOptionsCache: UiOption[] = [];
  /** Options follow `data`, which is replaced on every load. */
  private syncOptions() {
    if (this.optionsSource === this.data) return;
    this.optionsSource = this.data;
    this.kindOptionsCache = [
      ...(this.data?.orderStatus !== "cancelled"
        ? [{ value: "receive", label: "Registra acconto o saldo" }]
        : []),
      { value: "refund", label: "Registra rimborso" },
    ];
    this.refundOptionsCache = [
      { value: "", label: "Seleziona il movimento" },
      ...this.refundable.map((row: any) => ({
        value: row.id,
        label: `${this.label(row.kind)} · ${formatDate(row.createdAt, "dd/MM/yy HH:mm", this.locale)} · € ${row.refundableAmount}`,
      })),
    ];
  }
  get kindOptions(): UiOption[] {
    this.syncOptions();
    return this.kindOptionsCache;
  }
  get refundOptions(): UiOption[] {
    this.syncOptions();
    return this.refundOptionsCache;
  }
  get refundable() {
    return (this.data?.items || []).filter(
      (row: any) => row.kind !== "refund" && Number(row.refundableAmount) > 0,
    );
  }
  resetLines() {
    this.lines = [{ amount: "", method: "cash" }];
  }
  label(kind: string) {
    return (
      (
        {
          receipt: "Incasso",
          refund: "Rimborso",
          opening: "Saldo storico",
        } as Record<string, string>
      )[kind] || kind
    );
  }
  methodLabel(method: string) {
    return (
      (
        {
          cash: "Contanti",
          card: "Carta",
          bank: "Bonifico",
          other: "Altro",
        } as Record<string, string>
      )[method] || method
    );
  }
  private message(error: unknown) {
    return humanError(error, "Esito non disponibile. Verifica e riprova la stessa richiesta.");
  }
  async record() {
    if (this.busy || !this.data) return;
    this.feedback = "";
    if (!this.attempt) {
      const kind =
        this.data.summary.basis === "legacy_unknown" ? "reconcile" : this.kind;
      const entries = this.lines.map((row) => ({
        amount: row.amount.trim().replace(",", "."),
        ...(kind === "reconcile" ? {} : { method: row.method }),
        ...(kind === "refund" ? { refundOfId: row.refundOfId } : {}),
      }));
      if (
        entries.some(
          (row) =>
            !/^\d{1,8}(\.\d{1,2})?$/.test(row.amount) ||
            (kind !== "reconcile" && Number(row.amount) <= 0),
        )
      ) {
        this.feedback = "Indica importi validi con al massimo due decimali.";
        return;
      }
      if (kind !== "receive" && this.reason.trim().length < 3) {
        this.feedback = "Indica la motivazione.";
        return;
      }
      if (kind === "refund" && entries.some((row) => !row.refundOfId)) {
        this.feedback = "Seleziona ogni incasso originale.";
        return;
      }
      const scope = selectedOperationalScope(
        this.session.currentUser()?.id || "",
      );
      const attempt = {
        kind,
        entries,
        revision: this.data.revision,
        reason: this.reason.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
        headers: {
          "X-Alora-Location": scope.locationId,
          "X-Alora-Sector": scope.sectorId,
        },
      };
      // Persist before sending. Closing/reloading cannot turn an uncertain outcome into a new key.
      try {
        sessionStorage.setItem(this.storageKey, JSON.stringify(attempt));
      } catch {
        this.feedback =
          "Impossibile conservare la richiesta in questa scheda. Abilita lo spazio di sessione prima di registrare.";
        return;
      }
      this.attempt = attempt;
      this.pending.emit(true);
    }
    this.busy = true;
    try {
      const { headers, ...body } = this.attempt;
      const result = await firstValueFrom(
        this.http.post<any>(
          `${ADMIN_API_URL}/sales/${this.saleId}/payments`,
          body,
          { headers },
        ),
      );
      this.attempt = null;
      sessionStorage.removeItem(this.storageKey);
      this.pending.emit(false);
      this.updated.emit(result);
      this.resetLines();
      this.reason = "";
      this.kind = "receive";
      await this.load();
      this.feedback = "Operazione registrata. Gli incassi sono aggiornati.";
    } catch (error) {
      // 400/409 are definitive precondition/validation failures; an unknown outcome keeps its key.
      if (
        error instanceof HttpErrorResponse &&
        [400, 409].includes(error.status)
      ) {
        this.attempt = null;
        sessionStorage.removeItem(this.storageKey);
        this.pending.emit(false);
        await this.load();
      }
      this.feedback = this.message(error);
    } finally {
      this.busy = false;
    }
  }
}
