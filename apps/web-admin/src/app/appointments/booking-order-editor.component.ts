import {
  localBookingTime,
  parseLocalBookingTime,
  bookingInstant,
} from "./booking-local-time";
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  inject,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import {
  beginPendingCommand,
  clearPendingCommand,
  readPendingCommand,
  type PendingCommand,
} from "@barber/shared/utils";
import { ADMIN_API_URL } from "../core/api-config";
import { SessionStore } from "../core/session.store";
import { CustomSelectComponent } from "../custom-select.component";
import { AppointmentContactComponent } from "../shared/appointment-contact.component";
import { appointmentStatusLabel } from "../shared/presentation-copy";

type Draft = {
  appointmentId?: string;
  orderItemId?: string;
  serviceId: string;
  startsAt: string;
  heldInstant?: string;
  heldLocal?: string;
  collaboratorId: string;
  roomId: string;
  finalPrice: string | number | null;
  priceOverrideReason: string;
};
type Action = "revise" | "cancel_all" | "cancel_line";
@Component({
  selector: "alora-booking-order-editor",
  standalone: true,
  imports: [CommonModule, FormsModule, CustomSelectComponent, AppointmentContactComponent],
  styles: [
    `
      :host {
        display: block;
        min-height: 0;
        overflow: auto;
        padding: 1.25rem;
      }
      .heading,
      .row-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .drafts {
        display: grid;
        gap: 1rem;
        margin: 1rem 0;
      }
      .draft {
        border: 1px solid var(--line);
        border-radius: 1rem;
        padding: 1rem;
        display: grid;
        gap: 0.75rem;
      }
      .fields {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.75rem;
      }
      .field {
        min-width: 0;
      }
      input {
        min-width: 0;
        width: 100%;
        padding: 0.75rem;
        border: 1px solid var(--line);
        border-radius: 0.7rem;
        background: white;
        color: var(--ink);
      }
      .notice {
        border-radius: 0.9rem;
        background: #fffbeb;
        color: #78350f;
        padding: 1rem;
        margin: 0.75rem 0;
      }
      .muted {
        font-size: 0.875rem;
        color: var(--muted);
      }
      .preview {
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        border-radius: 0.9rem;
        padding: 1rem;
        margin: 1rem 0;
      }
      .preview p {
        margin: 0.4rem 0;
      }
      fieldset {
        min-width: 0;
        border: 0;
        padding: 0;
        margin: 0;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 1rem;
      }
      .cancel-area {
        border-top: 1px solid var(--line);
        margin-top: 1.5rem;
        padding-top: 1rem;
        display: grid;
        gap: 0.75rem;
      }
      @media (max-width: 600px) {
        :host {
          padding: 1rem;
        }
        .fields {
          grid-template-columns: minmax(0, 1fr);
        }
        .actions > * {
          width: 100%;
        }
      }
    `,
  ],
  template: `
    <header class="heading">
      <div>
        <p class="eyebrow">Agenda e conto unico</p>
        <h2 id="appointments-editor-title" class="font-display text-2xl">
          Gestisci la prenotazione
        </h2>
      </div>
      <button
        type="button"
        class="pill-btn"
        [disabled]="busy || pendingState().kind !== 'empty'"
        (click)="back.emit()"
      >
        Torna al servizio
      </button>
    </header>
    <p *ngIf="loading" role="status">Caricamento della prenotazione…</p>
    <p *ngIf="feedback" role="status" class="notice">{{ feedback }}</p>
    <button
      *ngIf="!account && !loading"
      type="button"
      class="secondary-btn"
      (click)="load()"
    >
      Riprova caricamento
    </button>
    <ng-container *ngIf="account">
      <button
        *ngIf="session.can('sales.manage')"
        type="button"
        class="secondary-btn mt-3"
        [disabled]="busy || pendingState().kind !== 'empty'"
        (click)="openAccount.emit()"
      >
        {{
          account.orderStatus === "cancelled" ? "Apri conto" : "Chiudi il conto"
        }}
      </button>
      <p class="muted">
        {{ account.customer.firstName }} {{ account.customer.lastName }} · Tutti
        i servizi condividono lo stesso conto.
      </p>
      <p class="muted">
        Orari nel fuso {{ timeZone }}. Ogni orario inserito viene rispettato; la
        disponibilità viene ricontrollata al salvataggio.
      </p>
      <app-appointment-contact *ngIf="session.can('appointments.update.all')" [appointmentId]="appointmentId" [disabled]="busy || loading || pendingState().kind !== 'empty'" (changed)="load()" />
      <div *ngIf="pendingState().kind !== 'empty'" role="status" class="notice">
        <p>
          L’invio precedente è da verificare. Recupera lo stesso esito prima di
          modificare ancora la prenotazione.
        </p>
        <button
          type="button"
          class="primary-btn"
          [disabled]="busy || pendingState().kind !== 'pending'"
          (click)="retry()"
        >
          Verifica modifica precedente
        </button>
      </div>
      <fieldset [disabled]="loading || busy || pendingState().kind !== 'empty'">
        <ng-container
          *ngIf="account.orderStatus === 'open'; else closedAccount"
        >
          <div class="drafts">
            <article
              class="draft"
              *ngFor="let row of rows; let index = index"
              [attr.aria-label]="'Servizio prenotato ' + (index + 1)"
            >
              <strong>{{ index + 1 }}. {{ serviceName(row.serviceId) }}</strong>
              <div class="fields">
                <label class="field"
                  ><span>Servizio</span
                  ><barber-custom-select
                    [value]="row.serviceId"
                    [options]="optionsFor(row)"
                    [label]="'Servizio ' + (index + 1)"
                    (valueChange)="changeService(row, $event)"
                  ></barber-custom-select
                ></label>
                <label class="field"
                  ><span>Inizio</span
                  ><input
                    type="datetime-local"
                    step="0.001"
                    [attr.aria-label]="'Inizio servizio ' + (index + 1)"
                    [(ngModel)]="row.startsAt"
                    (ngModelChange)="changed()"
                /></label>
                <label class="field"
                  ><span>Professionista</span
                  ><barber-custom-select
                    [value]="row.collaboratorId"
                    [options]="peopleFor(row)"
                    [label]="'Professionista servizio ' + (index + 1)"
                    (valueChange)="row.collaboratorId = $event; changed()"
                  ></barber-custom-select
                ></label>
                <label *ngIf="row.roomId" class="field"
                  ><span>Risorsa già assegnata</span
                  ><button
                    type="button"
                    class="secondary-btn"
                    (click)="row.roomId = ''; changed()"
                  >
                    Assegna automaticamente una risorsa
                  </button></label
                >
              </div>
              <details>
                <summary>Prezzo concordato facoltativo</summary>
                <div class="fields mt-3">
                  <label class="field"
                    ><span>Importo lordo concordato</span
                    ><input
                      type="number"
                      min="0"
                      step="0.01"
                      [attr.aria-label]="
                        'Prezzo concordato servizio ' + (index + 1)
                      "
                      [(ngModel)]="row.finalPrice"
                      (ngModelChange)="changed()"
                      placeholder="Mantieni il prezzo registrato" /></label
                  ><label class="field"
                    ><span>Motivo del prezzo concordato</span
                    ><input
                      [attr.aria-label]="
                        'Motivo prezzo servizio ' + (index + 1)
                      "
                      [(ngModel)]="row.priceOverrideReason"
                      (ngModelChange)="changed()"
                      maxlength="500"
                  /></label>
                </div>
              </details>
              <div class="row-actions">
                <button
                  *ngIf="!row.appointmentId"
                  type="button"
                  class="pill-btn"
                  (click)="removeDraft(index)"
                >
                  Rimuovi servizio aggiunto</button
                ><button
                  *ngIf="row.appointmentId"
                  type="button"
                  class="pill-btn"
                  [disabled]="reason.trim().length < 3"
                  (click)="cancel('cancel_line', row.appointmentId)"
                >
                  Annulla solo questo servizio
                </button>
              </div>
            </article>
          </div>
          <barber-custom-select
            *ngIf="rows.length < 20"
            [disabled]="loading || busy || invalidTime"
            value=""
            label="Aggiungi un servizio alla prenotazione"
            placeholder="Scegli un altro servizio della sede"
            [options]="serviceOptions"
            (valueChange)="addService($event)"
          ></barber-custom-select>
          <p *ngIf="invalidTime" role="alert" class="notice">
            Uno degli orari non esiste nel fuso mostrato. Scegli un orario
            valido prima di continuare.
          </p>
          <div class="actions">
            <button
              type="button"
              class="secondary-btn"
              [disabled]="!validRows"
              (click)="sequence()"
            >
              Ricalcola orari in sequenza</button
            ><button
              type="button"
              class="secondary-btn"
              [disabled]="!validRows"
              (click)="preview()"
            >
              Verifica disponibilità</button
            ><button
              type="button"
              class="primary-btn"
              [disabled]="!validRows"
              (click)="save()"
            >
              Salva intera prenotazione
            </button>
          </div>
          <article
            *ngIf="previewRows.length"
            class="preview"
            aria-label="Disponibilità verificata"
          >
            <strong>Orari disponibili per tutti i servizi</strong>
            <p *ngFor="let row of previewRows">
              {{ row.name }} · {{ dateTime(row.startsAt) }} –
              {{ dateTime(row.endsAt) }} · {{ personName(row.collaboratorId) }}
            </p>
            <p class="muted">Gli orari vengono ricontrollati al salvataggio.</p>
            <p *ngIf="!previewEconomics" class="muted">
              Per vedere importi e residuo occorre l'accesso alla cassa.
            </p>
          </article>
          <article
            *ngIf="previewEconomics as economic"
            class="preview"
            aria-label="Anteprima conto"
          >
            <strong>Importi della proposta</strong>
            <p>
              Subtotale €{{ economic.subtotal | number: "1.2-2" }} · Sconti €{{
                economic.discountTotal | number: "1.2-2"
              }}
              · IVA €{{ economic.taxTotal | number: "1.2-2" }}
            </p>
            <p>
              Totale conto €{{ economic.total | number: "1.2-2" }} · Variazione
              €{{ economic.difference | number: "1.2-2" }}
            </p>
            <p
              *ngIf="economic.payment.basis === 'ledger'; else unknownReceipts"
            >
              Incasso netto già registrato €{{
                economic.payment.netReceived | number: "1.2-2"
              }}
              · Residuo della proposta €{{
                economic.payment.remaining | number: "1.2-2"
              }}
            </p>
            <ng-template #unknownReceipts
              ><p>
                Incassi storici non riconciliati. Il residuo è sconosciuto.
              </p></ng-template
            >
            <p class="muted">
              L'anteprima non modifica il conto e non registra incassi. Prezzi e
              saldo vengono ricontrollati al salvataggio.
            </p>
          </article>
        </ng-container>
        <ng-template #closedAccount
          ><p class="notice">
            {{
              account.orderStatus === "cancelled"
                ? "Prenotazione annullata: lo storico è conservato."
                : "Conto già registrato: i servizi eseguiti si conservano nello storico."
            }}
          </p></ng-template
        >
        <article *ngFor="let row of historicalRows" class="draft">
          <strong>{{ row.service.name }}</strong>
          <p>{{ dateTime(row.startsAt) }} · {{ statusLabel(row.status) }}</p>
        </article>
        <section
          *ngIf="hasActive"
          class="cancel-area"
          aria-label="Annullamento prenotazione"
        >
          <label class="field"
            ><span>Motivo dell’annullamento</span
            ><input
              aria-label="Motivo annullamento prenotazione"
              [(ngModel)]="reason"
              maxlength="2000"
          /></label>
          <p class="muted">
            L’annullamento conserva le prestazioni già eseguite, il valore
            originario e gli incassi. Rimborsi e resi si registrano
            separatamente dal conto.
          </p>
          <button
            type="button"
            class="secondary-btn"
            [disabled]="reason.trim().length < 3"
            (click)="cancel('cancel_all')"
          >
            Annulla tutta la prenotazione
          </button>
        </section>
      </fieldset>
    </ng-container>
  `,
})
export class BookingOrderEditorComponent implements OnInit {
  @Input({ required: true }) appointmentId = "";
  @Output() saved = new EventEmitter<void>();
  @Output() openAccount = new EventEmitter<void>();
  @Output() back = new EventEmitter<void>();
  private readonly http = inject(HttpClient);
  readonly session = inject(SessionStore);
  account: any = null;
  catalog: any[] = [];
  people: any[] = [];
  rows: Draft[] = [];
  previewRows: any[] = [];
  previewEconomics: any = null;
  loading = false;
  busy = false;
  feedback = "";
  reason = "";
  readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  private scopeHeaders: Record<string, string> = {};
  private storageKey() {
    const user = this.session.currentUser();
    return `alora.booking.mutation:${user?.tenantId || ""}:${user?.id || ""}:${this.account?.orderId || ""}`;
  }
  pendingState() {
    try {
      return readPendingCommand(sessionStorage, this.storageKey());
    } catch {
      return { kind: "unreadable" as const };
    }
  }
  async ngOnInit() {
    await this.load();
  }
  async load() {
    this.loading = true;
    this.feedback = "";
    try {
      this.account = await firstValueFrom(
        this.http.get(
          `${ADMIN_API_URL}/appointments/${encodeURIComponent(this.appointmentId)}/order`,
        ),
      );
      this.scopeHeaders = {
        "X-Alora-Location": this.account.appointments[0].locationId,
        "X-Alora-Sector": "",
      };
      const context: any = await firstValueFrom(
        this.http.get(`${ADMIN_API_URL}/appointments/context`, {
          headers: this.scopeHeaders,
        }),
      );
      this.catalog = context.services || [];
      this.people = context.collaborators || [];
      this.rows = this.account.appointments
        .filter((row: any) => !this.stopped(row.status))
        .map((row: any) => ({
          appointmentId: row.id,
          orderItemId: row.orderItemId,
          serviceId: row.service.id,
          startsAt: this.localTime(row.startsAt),
          heldInstant: row.startsAt,
          heldLocal: this.localTime(row.startsAt),
          collaboratorId: row.collaboratorId || "",
          roomId: row.roomId || "",
          finalPrice: "",
          priceOverrideReason: "",
        }));
    } catch (error) {
      this.feedback = this.message(error);
    } finally {
      this.loading = false;
    }
  }
  private stopped(status: string) {
    return ["cancelled", "no_show", "completed"].includes(status);
  }
  get historicalRows() {
    return (this.account?.appointments || []).filter((row: any) =>
      this.stopped(row.status),
    );
  }
  get hasActive() {
    return (this.account?.appointments || []).some(
      (row: any) => !this.stopped(row.status),
    );
  }
  get serviceOptions() {
    return this.catalog.map((row) => ({
      value: row.id,
      label: `${row.name} · ${row.durationMinutes} min`,
    }));
  }
  optionsFor(row: Draft) {
    const options = this.serviceOptions;
    if (!options.some((option) => option.value === row.serviceId))
      options.push({
        value: row.serviceId,
        label: this.serviceName(row.serviceId),
      });
    return options;
  }
  serviceName(id: string) {
    return (
      this.catalog.find((row) => row.id === id)?.name ||
      this.account?.appointments.find((row: any) => row.service.id === id)
        ?.service.name ||
      "Servizio"
    );
  }
  private duration(id: string) {
    return (
      this.catalog.find((row) => row.id === id)?.durationMinutes ||
      this.account?.appointments.find((row: any) => row.service.id === id)
        ?.service.durationMinutes ||
      30
    );
  }
  peopleFor(row: Draft) {
    const sectorId =
      this.catalog.find((item) => item.id === row.serviceId)?.sectorId ||
      this.account?.appointments.find(
        (item: any) => item.id === row.appointmentId,
      )?.sectorId;
    const people = this.people.filter((person) =>
      person.sectors?.some(
        (membership: any) => membership.sectorId === sectorId,
      ),
    );
    return [
      { value: "", label: "Nessuna preferenza" },
      ...people.map((person) => ({
        value: person.id,
        label: `${person.firstName} ${person.lastName}`,
      })),
    ];
  }
  personName(id: string | null) {
    const person = this.people.find((row) => row.id === id);
    return person
      ? `${person.firstName} ${person.lastName}`
      : id
        ? "Professionista assegnato"
        : "Nessun professionista richiesto";
  }
  get validRows() {
    return (
      !this.loading &&
      !this.busy &&
      this.rows.length > 0 &&
      this.rows.length <= 20 &&
      this.rows.every(
        (row) =>
          row.serviceId &&
          row.startsAt &&
          !!parseLocalBookingTime(row.startsAt),
      )
    );
  }
  get invalidTime() {
    return this.rows.some(
      (row) => !!row.startsAt && !parseLocalBookingTime(row.startsAt),
    );
  }
  changed() {
    this.previewRows = [];
    this.previewEconomics = null;
    this.feedback = "";
  }
  changeService(row: Draft, id: string) {
    row.serviceId = id;
    row.roomId = "";
    row.finalPrice = "";
    row.priceOverrideReason = "";
    if (
      !this.peopleFor(row).some((person) => person.value === row.collaboratorId)
    )
      row.collaboratorId = "";
    this.changed();
  }
  addService(serviceId: string) {
    if (
      this.rows.length >= 20 ||
      !this.catalog.some((row) => row.id === serviceId)
    )
      return;
    const previous = this.rows.at(-1);
    const start =
      previous && previous.startsAt
        ? new Date(
            Date.parse(this.instant(previous)) +
              this.duration(previous.serviceId) * 60000,
          )
        : new Date();
    this.rows.push({
      serviceId,
      startsAt: this.localTime(start.toISOString()),
      collaboratorId: "",
      roomId: "",
      finalPrice: "",
      priceOverrideReason: "",
    });
    this.changed();
  }
  removeDraft(index: number) {
    if (!this.rows[index]?.appointmentId) this.rows.splice(index, 1);
    this.changed();
  }
  sequence() {
    if (!this.validRows) return;
    let next = Date.parse(this.instant(this.rows[0]));
    for (const row of this.rows) {
      row.heldInstant = new Date(next).toISOString();
      row.startsAt = this.localTime(row.heldInstant);
      row.heldLocal = row.startsAt;
      next += this.duration(row.serviceId) * 60000;
    }
    this.changed();
  }
  private payload() {
    return {
      revision: this.account.revision,
      lines: this.rows.map((row) => ({
        appointmentId: row.appointmentId,
        orderItemId: row.orderItemId,
        serviceId: row.serviceId,
        startsAt: this.instant(row),
        collaboratorId: row.collaboratorId || undefined,
        roomId: row.roomId || undefined,
        ...(row.finalPrice !== "" && row.finalPrice !== null
          ? {
              finalPrice: String(row.finalPrice),
              priceOverrideReason: row.priceOverrideReason,
            }
          : {}),
      })),
    };
  }
  async preview() {
    if (!this.validRows) return;
    this.busy = true;
    this.previewRows = [];
    this.previewEconomics = null;
    this.feedback = "";
    try {
      const result: any = await firstValueFrom(
        this.http.post(
          `${ADMIN_API_URL}/appointments/${encodeURIComponent(this.appointmentId)}/order/preview`,
          { idempotencyKey: crypto.randomUUID(), ...this.payload() },
          { headers: this.scopeHeaders },
        ),
      );
      this.previewRows = result.lines;
      this.previewEconomics = result.economics;
    } catch (error) {
      this.feedback = this.message(error);
    } finally {
      this.busy = false;
    }
  }
  async save() {
    if (!this.validRows) return;
    await this.begin("revise", this.appointmentId, this.payload());
  }
  async cancel(action: "cancel_all" | "cancel_line", id = this.appointmentId) {
    if (this.reason.trim().length < 3) return;
    await this.begin(action, id, {
      revision: this.account.revision,
      reason: this.reason.trim(),
    });
  }
  private async begin(
    action: Action,
    anchorId: string,
    payload: Record<string, unknown>,
  ) {
    if (this.busy || this.pendingState().kind !== "empty") return;
    try {
      const command = beginPendingCommand(
        sessionStorage,
        this.storageKey(),
        { action, anchorId, payload },
        this.scopeHeaders,
      );
      await this.send(command);
    } catch (error) {
      this.feedback = this.message(error);
    }
  }
  async retry() {
    const state = this.pendingState();
    if (state.kind !== "pending" || this.busy) return;
    await this.send(state.command);
  }
  private async send(command: PendingCommand) {
    const action = command.body["action"],
      anchorId = command.body["anchorId"],
      payload = command.body["payload"];
    if (
      !["revise", "cancel_all", "cancel_line"].includes(String(action)) ||
      typeof anchorId !== "string" ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      this.feedback =
        "Invio salvato non leggibile. Verifica la prenotazione prima di riprendere.";
      return;
    }
    this.busy = true;
    this.feedback = "";
    try {
      const root = `${ADMIN_API_URL}/appointments/${encodeURIComponent(anchorId)}`;
      const url =
        action === "revise"
          ? root + "/order"
          : action === "cancel_all"
            ? root + "/order/cancel"
            : root + "/cancel";
      const body = { ...payload, idempotencyKey: command.body.idempotencyKey };
      await firstValueFrom(
        action === "revise"
          ? this.http.patch(url, body, { headers: command.headers })
          : this.http.post(url, body, { headers: command.headers }),
      );
      clearPendingCommand(
        sessionStorage,
        this.storageKey(),
        command.body.idempotencyKey,
      );
      this.saved.emit();
    } catch (error) {
      this.previewRows = [];
      this.previewEconomics = null;
      if (
        error instanceof HttpErrorResponse &&
        [400, 409].includes(error.status)
      )
        clearPendingCommand(
          sessionStorage,
          this.storageKey(),
          command.body.idempotencyKey,
        );
      this.feedback =
        this.pendingState().kind === "pending"
          ? "Esito da verificare. Recupera la stessa modifica senza inviarne una nuova."
          : this.message(error);
    } finally {
      this.busy = false;
    }
  }
  private message(error: unknown) {
    if (
      error instanceof HttpErrorResponse &&
      typeof error.error?.message === "string"
    )
      return error.error.message;
    return error instanceof Error ? error.message : "Operazione non riuscita";
  }
  private localTime(iso: string) {
    return localBookingTime(iso);
  }
  private instant(row: Draft) {
    const instant = bookingInstant(
      row.startsAt,
      row.heldInstant,
      row.heldLocal,
    );
    if (!instant)
      throw new Error(
        "L'orario indicato non esiste nel fuso scelto. Scegli un orario valido.",
      );
    return instant;
  }
  dateTime(iso: string) {
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  statusLabel(status: string) {
    return appointmentStatusLabel(status);
  }
}
