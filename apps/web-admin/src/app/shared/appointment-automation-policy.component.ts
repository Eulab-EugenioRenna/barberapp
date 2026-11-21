import { Component, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import type {
  AppointmentAutomationPolicyView,
  AppointmentAutomationGrantView,
  AppointmentAutomationSettings,
  AppointmentReminderPlan,
} from "@barber/shared/automations";
import { AppointmentAutomationAccessApiService } from "../core/appointment-automation-access-api.service";
import { AppointmentAutomationPolicyApiService } from "../core/appointment-automation-policy-api.service";

@Component({
  selector: "app-appointment-automation-policy",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: ` <section class="policy" aria-label="Policy dei promemoria">
    <header>
      <div>
        <p class="eyebrow">Automazioni dell’agenda</p>
        <h2>Promemoria e conferme</h2>
      </div>
      <button
        type="button"
        class="secondary-btn"
        [disabled]="busy"
        (click)="load()"
      >
        {{ policy ? "Ricarica policy salvata" : "Configura promemoria" }}
      </button>
    </header>
    <p class="notice">
      <strong
        >{{
          policy?.status === "active"
            ? "Promemoria attivi"
            : "Bozza · invii non attivi"
        }}.</strong
      >
      L’attivazione riguarda le nuove prenotazioni con consenso WhatsApp e le
      successive modifiche. Le prenotazioni già presenti non ricevono invii
      retroattivi.
    </p>
    <p *ngIf="feedback" class="feedback" role="status">{{ feedback }}</p>
    <ng-container *ngIf="draft && policy">
      <form (ngSubmit)="save()">
        <fieldset [disabled]="busy">
          <div class="options">
            <label
              ><input
                type="checkbox"
                name="initial"
                [(ngModel)]="draft.initialConfirmation"
                (ngModelChange)="edited()"
              />Includi conferma iniziale</label
            ><label
              ><input
                type="checkbox"
                name="response"
                [(ngModel)]="draft.requestResponse"
                (ngModelChange)="edited()"
              />Richiedi risposta al cliente</label
            >
          </div>
          <div
            class="options"
            role="group"
            aria-label="Eventi WhatsApp da notificare"
          >
            <label
              ><input
                type="checkbox"
                name="notify-confirmed"
                [ngModel]="draft.eventNotices?.confirmation || false"
                (ngModelChange)="setEvent('confirmation', $event)"
              />Avvisa quando l’appuntamento viene confermato</label
            >
            <label
              ><input
                type="checkbox"
                name="notify-cancelled"
                [ngModel]="draft.eventNotices?.cancellation || false"
                (ngModelChange)="setEvent('cancellation', $event)"
              />Avvisa quando l’appuntamento viene annullato</label
            >
            <label
              ><input
                type="checkbox"
                name="notify-rescheduled"
                [ngModel]="draft.eventNotices?.rescheduling !== false"
                (ngModelChange)="setEvent('rescheduling', $event)"
              />Avvisa subito dopo una riprogrammazione</label
            >
          </div>
          <div class="fields">
            <label
              >Anticipo del primo promemoria (minuti)<input
                type="number"
                name="lead"
                [(ngModel)]="draft.leadMinutes"
                (ngModelChange)="edited()"
                min="2"
                max="43200"
                step="1"
                required
            /></label>
            <label
              >Numero massimo di promemoria<input
                type="number"
                name="count"
                [(ngModel)]="draft.maxReminders"
                (ngModelChange)="edited()"
                min="0"
                max="5"
                step="1"
                required
            /></label>
            <label
              >Intervallo tra promemoria (minuti)<input
                type="number"
                name="interval"
                [(ngModel)]="draft.repeatIntervalMinutes"
                (ngModelChange)="edited()"
                min="15"
                max="10080"
                step="1"
                required
            /></label>
            <label
              >Scadenza risposta prima dell’appuntamento (minuti)<input
                type="number"
                name="deadline"
                [(ngModel)]="draft.responseDeadlineMinutes"
                (ngModelChange)="edited()"
                min="1"
                max="10080"
                step="1"
                [disabled]="!draft.requestResponse"
                required
            /></label>
            <label
              >Invii consentiti dalle<input
                type="time"
                name="from"
                [(ngModel)]="draft.deliveryStart"
                (ngModelChange)="edited()"
                required
            /></label>
            <label
              >Invii consentiti fino alle<input
                type="time"
                name="until"
                [(ngModel)]="draft.deliveryEnd"
                (ngModelChange)="edited()"
                required
            /></label>
            <label class="wide"
              >In caso di mancata risposta<select
                name="noResponse"
                aria-label="In caso di mancata risposta"
                [(ngModel)]="draft.noResponseAction"
                (ngModelChange)="edited()"
                [disabled]="!draft.requestResponse"
              >
                <option value="notify_staff">
                  Segnala allo staff, mantenendo la prenotazione
                </option>
                <option value="keep_booking">Mantieni la prenotazione</option>
              </select></label
            >
          </div>
          <p class="muted">
            Imposta 0 per disattivare i promemoria e mantenere solo gli eventi
            selezionati. 1440 minuti corrispondono a 24 ore effettive, anche al
            cambio dell’ora. La fascia scelta si interseca con le aperture di
            sede e settore e con le festività. Fuori apertura si anticipa al
            minuto utile precedente; gli invii già passati vengono omessi.
          </p>
          <div class="fields">
            <label class="wide"
              >Messaggio iniziale<textarea
                name="initial-text"
                rows="4"
                maxlength="3500"
                [(ngModel)]="texts.initial"
                (ngModelChange)="edited()"
                required
              ></textarea>
            </label>
            <label class="wide"
              >Testo del promemoria<textarea
                name="reminder-text"
                rows="4"
                maxlength="3500"
                [(ngModel)]="texts.reminder"
                (ngModelChange)="edited()"
                required
              ></textarea>
            </label>
          </div>
          <div class="fields">
            <label class="wide"
              >Avviso di conferma<textarea
                name="confirmed-text"
                rows="3"
                maxlength="3500"
                [(ngModel)]="texts.confirmed"
                (ngModelChange)="edited()"
                required
              ></textarea>
            </label>
            <label class="wide"
              >Avviso di annullamento<textarea
                name="cancelled-text"
                rows="3"
                maxlength="3500"
                [(ngModel)]="texts.cancelled"
                (ngModelChange)="edited()"
                required
              ></textarea>
            </label>
            <label class="wide"
              >Avviso di riprogrammazione<textarea
                name="rescheduled-text"
                rows="3"
                maxlength="3500"
                [(ngModel)]="texts.rescheduled"
                (ngModelChange)="edited()"
                required
              ></textarea>
            </label>
          </div>
          <p class="muted" ngNonBindable>
            Segnaposto: {{ customer.firstName }}, {{ customer.lastName }},
            {{ service.name }}, {{ appointment.startsAt }},
            {{ appointment.endsAt }}, {{ appointment.status }},
            {{ collaborator.firstName }}, {{ collaborator.lastName }},
            {{ tenant.name }}. Non inserire dati sensibili nel testo.
          </p>
          <p *ngIf="policy.status === 'active'" class="notice">
            Salvare una nuova bozza ferma i promemoria di questa policy ancora
            da inviare. Dovrai riattivarla per le prenotazioni future.
          </p>
          <button type="submit" class="primary-btn">
            Salva bozza della policy
          </button>
        </fieldset>
      </form>
      <div class="simulation" aria-label="Attivazione promemoria">
        <h3>Attiva per le nuove prenotazioni</h3>
        <p class="muted">
          Configura prima le autorizzazioni qui sotto, poi ricarica la policy.
          Le azioni cliente richiedono un’autorizzazione all’agenda distinta da
          WhatsApp. Annullamento automatico fino a 24 ore prima; oltre il limite
          arriva una richiesta allo staff. La mancata risposta mantiene la
          prenotazione.
        </p>
        <div class="fields">
          <label
            >Invio WhatsApp<select
              aria-label="Autorizzazione WhatsApp"
              [(ngModel)]="selected.whatsapp"
              [disabled]="busy"
            >
              <option value="">Seleziona autorizzazione</option>
              <option *ngFor="let g of choices('whatsapp')" [value]="g.id">
                WhatsApp · scade {{ g.expiresAt | date: "dd/MM/yyyy HH:mm" }}
              </option>
            </select></label
          >
          <label *ngIf="draft.requestResponse"
            >Azioni cliente sull’agenda<select
              aria-label="Autorizzazione azioni cliente"
              [(ngModel)]="selected.customerCommands"
              [disabled]="busy"
            >
              <option value="">Seleziona autorizzazione</option>
              <option
                *ngFor="let g of choices('customer_commands')"
                [value]="g.id"
              >
                Azioni cliente · scade
                {{ g.expiresAt | date: "dd/MM/yyyy HH:mm" }}
              </option>
            </select></label
          >
          <label
            >Avvisi nell’app allo staff<select
              aria-label="Autorizzazione avvisi staff"
              [(ngModel)]="selected.staff"
              [disabled]="busy"
            >
              <option value="">Nessun avviso nell’app</option>
              <option
                *ngFor="let g of choices('application_notification')"
                [value]="g.id"
              >
                Notifiche · scade {{ g.expiresAt | date: "dd/MM/yyyy HH:mm" }}
              </option>
            </select></label
          >
          <label
            >Notifiche email derivanti dalle risposte<select
              aria-label="Autorizzazione email"
              [(ngModel)]="selected.email"
              [disabled]="busy"
            >
              <option value="">Email non autorizzate</option>
              <option *ngFor="let g of choices('email')" [value]="g.id">
                Email · scade {{ g.expiresAt | date: "dd/MM/yyyy HH:mm" }}
              </option>
            </select></label
          >
        </div>
        <p *ngIf="dirty" class="notice">
          Salva le modifiche prima di attivare.
        </p>
        <button
          type="button"
          class="primary-btn"
          [disabled]="
            busy ||
            dirty ||
            !selected.whatsapp ||
            (draft.requestResponse && !selected.customerCommands) ||
            (draft.requestResponse &&
              draft.noResponseAction === 'notify_staff' &&
              !selected.staff)
          "
          (click)="activate()"
        >
          Attiva per le nuove prenotazioni
        </button>
        <button
          *ngIf="policy.status === 'active'"
          type="button"
          class="secondary-btn"
          [disabled]="busy"
          (click)="stop()"
        >
          Ferma i promemoria da inviare
        </button>
      </div>
      <div class="simulation">
        <h3>Prova gli orari</h3>
        <p class="muted">
          Esempio senza clienti, prenotazioni o invii. Fuso dell’attività:
          {{ policy.timezone }}.
        </p>
        <div class="fields">
          <label
            >Settore dell’esempio<select
              aria-label="Settore dell’esempio"
              [(ngModel)]="sectorId"
              [disabled]="busy"
              (ngModelChange)="edited()"
            >
              <option value="">Seleziona un settore attivo</option>
              <option *ngFor="let sector of sectors" [value]="sector.id">
                {{ sector.label }}
              </option>
            </select></label
          ><label
            >Data e ora dell’appuntamento di esempio<input
              type="datetime-local"
              [(ngModel)]="localStartsAt"
              [disabled]="busy"
              (ngModelChange)="edited()"
          /></label>
        </div>
        <button
          type="button"
          class="secondary-btn"
          [disabled]="busy || !sectorId || !localStartsAt"
          (click)="simulate()"
        >
          Calcola gli orari di esempio
        </button>
        <div
          *ngIf="preview"
          class="plan"
          aria-label="Piano di esempio"
          aria-live="polite"
        >
          <h3>Anteprima messaggi · dati di esempio</h3>
          <p class="message-preview">
            <strong>Messaggio iniziale</strong><br />{{
              preview.messagePreview.initial
            }}
          </p>
          <p class="message-preview">
            <strong>Promemoria</strong><br />{{
              preview.messagePreview.reminder
            }}
          </p>
          <p class="message-preview">
            <strong>Conferma</strong><br />{{
              preview.messagePreview.confirmed
            }}
          </p>
          <p class="message-preview">
            <strong>Annullamento</strong><br />{{
              preview.messagePreview.cancelled
            }}
          </p>
          <p class="message-preview">
            <strong>Riprogrammazione</strong><br />{{
              preview.messagePreview.rescheduled
            }}
          </p>
          <p *ngIf="draft.requestResponse" class="muted">
            Pulsanti: Confermo · Richiedi modifica · Annulla o richiedi. Il
            messaggio include la scadenza e la regola delle 24 ore.
          </p>
          <p *ngIf="!preview.reminders.length">
            Nessun promemoria futuro compatibile con questo esempio.
          </p>
          <ol>
            <li *ngFor="let item of preview.reminders">
              Promemoria {{ item.sequence }}:
              <strong>{{ format(item.dueAt, preview.timezone) }}</strong
              ><span *ngIf="item.shifted">
                · anticipato alla precedente apertura</span
              >
            </li>
          </ol>
          <p *ngIf="preview.responseExpiresAt">
            Risposte entro
            {{ format(preview.responseExpiresAt, preview.timezone) }}.
          </p>
          <p *ngIf="preview.omitted.length" class="muted">
            {{ preview.omitted.length }} orari omessi: scadenza, apertura già
            passata o distanza insufficiente fra invii. Nessun recupero
            automatico dei promemoria passati.
          </p>
        </div>
      </div>
    </ng-container>
  </section>`,
  styles: [
    `
      :host {
        display: block;
        margin-top: 24px;
        min-width: 0;
      }
      .policy {
        padding: clamp(22px, 3vw, 36px);
        border: 1px solid var(--line, #d9dfd8);
        border-radius: 24px;
        background: var(--panel, #fffdf8);
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
      }
      h2 {
        font-family: var(--font-display, Georgia, serif);
        font-size: 27px;
        margin: 8px 0 12px;
      }
      .eyebrow {
        font-size: 10px;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: var(--muted, #68746d);
      }
      .notice,
      .feedback {
        font-size: 13px;
        line-height: 1.6;
        padding: 14px 18px;
        background: #faf2df;
        border-radius: 12px;
        color: #5a4925;
        margin: 16px 0;
      }
      .muted {
        font-size: 13px;
        line-height: 1.65;
        color: var(--muted, #68746d);
      }
      .options {
        display: flex;
        flex-wrap: wrap;
        gap: 18px;
        margin: 24px 0;
      }
      .options label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
      }
      .fields {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin: 20px 0;
      }
      .fields label {
        display: grid;
        gap: 8px;
        font-size: 12px;
        font-weight: 600;
        min-width: 0;
      }
      .fields textarea,
      .fields input,
      .fields select {
        font: inherit;
        font-weight: 400;
        color: inherit;
        border: 1px solid var(--line, #ccd6ce);
        border-radius: 12px;
        padding: 12px;
        background: #fffefb;
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
      }
      .wide {
        grid-column: 1/-1;
      }
      fieldset {
        border: 0;
        padding: 0;
        margin: 0;
        min-width: 0;
      }
      .simulation {
        margin-top: 28px;
        padding-top: 24px;
        border-top: 1px solid var(--line, #d9dfd8);
      }
      h3 {
        font-size: 17px;
      }
      .plan {
        margin-top: 18px;
        padding: 18px 22px;
        background: #f1f4ed;
        border-radius: 16px;
        font-size: 13px;
        line-height: 1.7;
        overflow-wrap: anywhere;
      }
      .message-preview {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .plan ol {
        padding-left: 18px;
      }
      @media (max-width: 47.99rem) {
        .fields {
          grid-template-columns: minmax(0, 1fr);
        }
        header button {
          width: 100%;
        }
      }
    `,
  ],
})
export class AppointmentAutomationPolicyComponent {
  private readonly api = inject(AppointmentAutomationPolicyApiService);
  private readonly access = inject(AppointmentAutomationAccessApiService);
  grants: AppointmentAutomationGrantView[] = [];
  texts: AppointmentAutomationPolicyView["texts"] = {
    initial: "",
    reminder: "",
    confirmed: "",
    cancelled: "",
    rescheduled: "",
  };
  selected = { whatsapp: "", customerCommands: "", staff: "", email: "" };
  get dirty() {
    return (
      !!this.policy &&
      (JSON.stringify(this.draft) !== JSON.stringify(this.policy.settings) ||
        JSON.stringify(this.texts) !== JSON.stringify(this.policy.texts))
    );
  }
  choices(kind: string) {
    return this.grants.filter(
      (g) =>
        g.status === "ready" &&
        new Date(g.expiresAt).getTime() > Date.now() &&
        (kind === "customer_commands"
          ? g.useCase === "customer_commands"
          : g.channel === kind && g.useCase !== "customer_commands"),
    );
  }
  policy: AppointmentAutomationPolicyView | null = null;
  draft: AppointmentAutomationSettings | null = null;
  preview:
    | (AppointmentReminderPlan & {
        messagePreview: AppointmentAutomationPolicyView["texts"];
      })
    | null = null;
  sectors: Array<{ id: string; label: string }> = [];
  sectorId = "";
  localStartsAt = "";
  feedback = "";
  busy = false;
  private error(e: any) {
    return e?.error?.message || "Impostazioni non disponibili. Riprova.";
  }
  edited() {
    this.preview = null;
    this.feedback = "";
  }
  setEvent(
    key: "confirmation" | "cancellation" | "rescheduling",
    value: boolean,
  ) {
    if (!this.draft) return;
    this.draft = {
      ...this.draft,
      eventNotices: {
        confirmation: false,
        cancellation: false,
        rescheduling: true,
        ...this.draft.eventNotices,
        [key]: value,
      },
    };
    this.edited();
  }
  async load() {
    if (this.busy) return;
    this.busy = true;
    this.edited();
    try {
      const [policy, locations, grants] = await Promise.all([
        this.api.get(),
        this.api.locations(),
        this.access.list(),
      ]);
      this.policy = policy;
      this.grants = grants;
      this.texts = { ...policy.texts };
      this.selected = {
        whatsapp: policy.grants.whatsapp || "",
        customerCommands: policy.grants.customerCommands || "",
        staff: policy.grants.staff || "",
        email: policy.grants.email || "",
      };
      this.draft = { ...policy.settings };
      this.sectors = locations
        .filter((l) => l.isActive)
        .flatMap((l) =>
          l.sectors
            .filter((s) => s.isActive)
            .map((s) => ({ id: s.id, label: `${l.name} · ${s.name}` })),
        );
      if (!this.sectors.some((s) => s.id === this.sectorId))
        this.sectorId = this.sectors[0]?.id || "";
      if (!this.localStartsAt) {
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat("en-CA", {
            timeZone: policy.timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          })
            .formatToParts(new Date(Date.now() + 3 * 86400000))
            .map((p) => [p.type, p.value]),
        );
        this.localStartsAt = `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}`;
      }
    } catch (e) {
      this.policy = null;
      this.draft = null;
      this.sectors = [];
      this.feedback = this.error(e);
    } finally {
      this.busy = false;
    }
  }
  async save() {
    if (this.busy || !this.draft || !this.policy) return;
    this.busy = true;
    this.feedback = "";
    try {
      this.policy = await this.api.save(
        { ...this.draft },
        this.policy.revision,
        { ...this.texts },
      );
      this.draft = { ...this.policy.settings };
      this.feedback = "Bozza salvata. Gli invii restano non attivi.";
    } catch (e) {
      this.feedback = this.error(e);
    } finally {
      this.busy = false;
    }
  }
  async activate() {
    if (this.busy || !this.policy || this.dirty) return;
    this.busy = true;
    try {
      this.policy = await this.api.activate(
        this.policy.revision,
        this.selected,
      );
      this.feedback =
        "Promemoria attivi per le nuove prenotazioni autorizzate.";
    } catch (e) {
      this.feedback = this.error(e);
    } finally {
      this.busy = false;
    }
  }
  async stop() {
    if (this.busy || !this.policy) return;
    this.busy = true;
    try {
      this.policy = await this.api.deactivate(this.policy.revision);
      this.feedback =
        "Nuovi invii fermati. Gli invii già acquisiti dal provider restano visibili nel monitor.";
    } catch (e) {
      this.feedback = this.error(e);
    } finally {
      this.busy = false;
    }
  }
  async simulate() {
    if (this.busy || !this.draft) return;
    this.busy = true;
    this.edited();
    try {
      this.preview = await this.api.preview(
        { ...this.draft },
        this.sectorId,
        this.localStartsAt,
        { ...this.texts },
      );
    } catch (e) {
      this.feedback = this.error(e);
    } finally {
      this.busy = false;
    }
  }
  format(value: string, timezone: string) {
    return new Intl.DateTimeFormat("it-IT", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }
}
