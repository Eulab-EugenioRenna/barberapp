import { Component, LOCALE_ID, OnInit, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { UiSelectComponent, uiOptions, type UiOption } from "@alora/ui";
import { CommonModule, formatDate } from "@angular/common";
import { FormsModule } from "@angular/forms";
import type {
  AppointmentAutomationPolicyView,
  AppointmentAutomationGrantView,
  AppointmentAutomationSettings,
  AppointmentReminderPlan,
} from "@barber/shared/automations";
import { AppointmentAutomationAccessApiService } from "../core/appointment-automation-access-api.service";
import { AppointmentAutomationPolicyApiService } from "../core/appointment-automation-policy-api.service";
import { WhatsAppApiService } from "../core/whatsapp-api.service";
import { SessionStore } from "../core/session.store";
import type { AppointmentAutomationWebhookView } from "@barber/shared/automations";
import type { WhatsAppConnection } from "@barber/shared/whatsapp";
import { SetupStepComponent } from "./setup-step.component";
import { DurationFieldComponent, splitMinutes } from "./duration-field.component";

@Component({
  selector: "app-appointment-automation-policy",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, UiSelectComponent, SetupStepComponent, DurationFieldComponent],
  template: ` <section class="policy" aria-label="Promemoria automatici">
    <header>
      <div>
        <p class="eyebrow">Promemoria automatici</p>
        <h2>Ricorda gli appuntamenti ai clienti su WhatsApp</h2>
        <p class="muted">Segui i passi in ordine: ognuno si apre quando il precedente è fatto.</p>
      </div>
      <span class="status" [class.on]="active" data-tour="notifications-status">
        {{ active ? "Attivi" : "Non attivi" }}
      </span>
    </header>
    <p *ngIf="feedback" class="feedback" role="status">{{ feedback }}</p>
    <p *ngIf="loading" class="muted" role="status">Carico la configurazione…</p>

    <div *ngIf="!loading && draft && policy" class="steps">
      <!-- 1. Numero -->
      <alora-setup-step
        [index]="1" title="Collega il numero WhatsApp del salone" data-tour="notifications-step-number"
        [state]="!canWhatsApp ? 'locked' : connection ? 'done' : 'todo'"
        lockedReason="il permesso WhatsApp sul tuo account (chiedilo al titolare in Squadra › Accessi)."
        [summary]="connection ? 'Numero ' + (connection.number || 'collegato') + ': i promemoria partono da qui.' : 'I promemoria partono dal tuo numero WhatsApp collegato ad ALORA.'"
      >
        <p *ngIf="!connection" class="muted">Nessun numero connesso. Collegalo inquadrando il QR con il telefono, poi torna qui.</p>
        <a *ngIf="!connection" routerLink="/whatsapp" class="primary-btn">Collega il numero</a>
      </alora-setup-step>

      <!-- 2. Permesso di invio -->
      <alora-setup-step
        [index]="2" title="Consenti ad ALORA di scrivere ai clienti" data-tour="notifications-step-permission"
        [state]="!connection ? 'locked' : grantFor('whatsapp') ? 'done' : 'todo'"
        lockedReason="il numero WhatsApp collegato (passo 1)."
        [summary]="grantFor('whatsapp') ? 'Consentito fino al ' + (grantFor('whatsapp')!.expiresAt | date: 'dd/MM/yyyy') + '.' : 'Un permesso che puoi revocare quando vuoi in «Permessi».'"
      >
        <ng-container *ngIf="!grantFor('whatsapp')">
          <p class="muted">ALORA invierà i messaggi automatici dal tuo numero solo ai clienti che hanno dato il consenso WhatsApp. Il permesso vale un anno.</p>
          <button type="button" class="primary-btn" [disabled]="busy" (click)="authorize('whatsapp')">Consenti l’invio</button>
          <button *ngIf="preparing('whatsapp')" type="button" class="secondary-btn" [disabled]="busy" (click)="verify('whatsapp')">Controlla di nuovo</button>
        </ng-container>
      </alora-setup-step>

      <!-- 3. Cosa inviare -->
      <alora-setup-step
        [index]="3" title="Scegli quali messaggi inviare" data-tour="notifications-options"
        [state]="!grantFor('whatsapp') ? 'locked' : sendsSomething ? 'done' : 'todo'"
        lockedReason="il permesso di invio (passo 2)."
        [summary]="whatSummary"
      >
        <div class="choice">
          <label class="toggle"><input type="checkbox" name="initial" [(ngModel)]="draft.initialConfirmation" (ngModelChange)="edited()" />
            <span><strong>Messaggio subito dopo la prenotazione</strong><small>Il cliente riceve il riepilogo con giorno, ora e servizio.</small></span></label>
          <label *ngIf="draft.initialConfirmation" class="field wide">Testo del messaggio<textarea name="initial-text" rows="3" maxlength="3500" [(ngModel)]="texts.initial" (ngModelChange)="edited()"></textarea></label>
        </div>

        <div class="choice" data-tour="notifications-timing">
          <label class="field">Promemoria prima dell’appuntamento
            <select name="count" [ngModel]="draft.maxReminders" (ngModelChange)="draft.maxReminders = +$event; edited()">
              <option [ngValue]="0">Nessun promemoria</option>
              <option [ngValue]="1">1 promemoria</option>
              <option *ngFor="let n of [2, 3, 4, 5]" [ngValue]="n">{{ n }} promemoria</option>
            </select>
          </label>
          <ng-container *ngIf="draft.maxReminders > 0">
            <label class="field">Quanto prima inviare il primo
              <alora-duration-field label="Anticipo del primo promemoria" [minutes]="draft.leadMinutes" (minutesChange)="draft.leadMinutes = $event; edited()"></alora-duration-field>
              <small>Ad esempio 1 giorno, oppure 30 minuti (minimo 2 minuti).</small>
            </label>
            <label *ngIf="draft.maxReminders > 1" class="field">Ogni quanto ripeterlo
              <alora-duration-field label="Intervallo tra i promemoria" [minutes]="draft.repeatIntervalMinutes" (minutesChange)="draft.repeatIntervalMinutes = $event; edited()"></alora-duration-field>
              <small>Si ripete solo se il cliente non ha ancora risposto (minimo 15 minuti).</small>
            </label>
            <label class="field wide">Testo del promemoria<textarea name="reminder-text" rows="3" maxlength="3500" [(ngModel)]="texts.reminder" (ngModelChange)="edited()"></textarea></label>
          </ng-container>
        </div>

        <div class="choice" role="group" aria-label="Avvisi quando l’appuntamento cambia">
          <p class="group-title">Avvisa il cliente quando l’appuntamento…</p>
          <label class="toggle"><input type="checkbox" name="notify-confirmed" [ngModel]="notice('confirmation')" (ngModelChange)="setEvent('confirmation', $event)" /><span><strong>viene confermato</strong></span></label>
          <label *ngIf="notice('confirmation')" class="field wide">Testo<textarea name="confirmed-text" rows="2" maxlength="3500" [(ngModel)]="texts.confirmed" (ngModelChange)="edited()"></textarea></label>
          <label class="toggle"><input type="checkbox" name="notify-cancelled" [ngModel]="notice('cancellation')" (ngModelChange)="setEvent('cancellation', $event)" /><span><strong>viene annullato</strong></span></label>
          <label *ngIf="notice('cancellation')" class="field wide">Testo<textarea name="cancelled-text" rows="2" maxlength="3500" [(ngModel)]="texts.cancelled" (ngModelChange)="edited()"></textarea></label>
          <label class="toggle"><input type="checkbox" name="notify-rescheduled" [ngModel]="notice('rescheduling')" (ngModelChange)="setEvent('rescheduling', $event)" /><span><strong>viene spostato</strong></span></label>
          <label *ngIf="notice('rescheduling')" class="field wide">Testo<textarea name="rescheduled-text" rows="2" maxlength="3500" [(ngModel)]="texts.rescheduled" (ngModelChange)="edited()"></textarea></label>
        </div>
        <details class="placeholders" data-tour="notifications-texts">
          <summary>Cosa posso scrivere nei testi?</summary>
          <p class="muted" ngNonBindable>
            Puoi inserire questi campi, ALORA li sostituisce con i dati veri: {{ customer.firstName }} (nome del cliente),
            {{ service.name }} (servizio), {{ appointment.startsAt }} (giorno e ora), {{ collaborator.firstName }} (chi lo esegue),
            {{ tenant.name }} (nome del salone). Non scrivere dati sensibili.
          </p>
        </details>
      </alora-setup-step>

      <!-- 4. Risposte -->
      <alora-setup-step
        [index]="4" title="Fai confermare l’appuntamento al cliente" data-tour="notifications-step-replies"
        [state]="!grantFor('whatsapp') || !sendsReminderOrInitial ? 'locked' : repliesReady ? 'done' : 'todo'"
        [lockedReason]="!grantFor('whatsapp') ? 'il permesso di invio (passo 2).' : 'almeno il messaggio dopo la prenotazione o un promemoria (passo 3).'"
        [summary]="draft.requestResponse ? 'Il messaggio ha i pulsanti Confermo · Richiedi modifica · Annulla.' : 'Facoltativo: senza, i messaggi sono solo un avviso.'"
      >
        <label class="toggle"><input type="checkbox" name="response" [(ngModel)]="draft.requestResponse" (ngModelChange)="edited()" />
          <span><strong>Chiedi al cliente di confermare con un tocco</strong>
          <small>Se conferma, l’appuntamento diventa «Confermato». Se annulla più di 24 ore prima, il posto si libera da solo; più tardi, o se chiede una modifica, ricevi una richiesta da gestire.</small></span></label>

        <ol *ngIf="draft.requestResponse" class="checklist">
          <li [class.ok]="hook?.status === 'ready'">
            <div><strong>Ricevi le risposte dei clienti</strong>
              <small>{{ hook?.status === "ready" ? "Attivo: ALORA riceve i tocchi sui pulsanti." : hook?.status === "disabled" ? "Disattivato dal servizio messaggi: scrivi all’assistenza EULAB." : "Da attivare una volta sola." }}</small></div>
            <button *ngIf="hook?.status !== 'ready' && hook?.status !== 'disabled'" type="button" class="secondary-btn" [disabled]="busy" (click)="enableReplies()">Attiva</button>
          </li>
          <li [class.ok]="!!grantFor('customer_commands')">
            <div><strong>Lascia che la risposta aggiorni l’agenda</strong>
              <small *ngIf="grantFor('customer_commands')">Consentito: conferme e annullamenti arrivano da soli in agenda.</small>
              <small *ngIf="!grantFor('customer_commands') && canCommands">Senza questo permesso ALORA non può cambiare lo stato dell’appuntamento quando il cliente risponde.</small>
              <small *ngIf="!grantFor('customer_commands') && !canCommands">Per attivarlo serve prima un account con il permesso «Modificare tutti gli appuntamenti» e accesso a tutte le sedi: chiedilo al titolare.</small></div>
            <button *ngIf="!grantFor('customer_commands') && canCommands" type="button" class="secondary-btn" [disabled]="busy" (click)="authorize('customer_commands')">Consenti</button>
          </li>
          <li>
            <div class="grow"><strong>Entro quando deve rispondere</strong>
              <alora-duration-field label="Tempo per rispondere prima dell’appuntamento" [minutes]="draft.responseDeadlineMinutes" (minutesChange)="draft.responseDeadlineMinutes = $event; edited()"></alora-duration-field>
              <small [class.error]="deadlineInvalid">{{ deadlineInvalid
                ? "Deve essere più vicino all’appuntamento del primo promemoria (" + leadLabel + "), altrimenti il cliente non ha tempo di rispondere."
                : "Prima dell’appuntamento. Dopo, i pulsanti non valgono più." }}</small></div>
          </li>
          <li>
            <div class="grow"><strong>Se non risponde</strong>
              <ui-select name="noResponse" label="Se il cliente non risponde" [options]="noResponseOptions" [filterable]="false" [(ngModel)]="draft.noResponseAction" (ngModelChange)="edited()"></ui-select></div>
          </li>
          <li *ngIf="draft.noResponseAction === 'notify_staff'" [class.ok]="!!grantFor('application_notification')">
            <div><strong>Avvisi allo staff nell’app</strong>
              <small>{{ grantFor("application_notification") ? "Consentito: lo staff vede chi non ha risposto." : "Serve per avvisarti quando un cliente non risponde." }}</small></div>
            <button *ngIf="!grantFor('application_notification')" type="button" class="secondary-btn" [disabled]="busy" (click)="authorize('application_notification')">Consenti</button>
          </li>
        </ol>
      </alora-setup-step>

      <!-- 5. Quando -->
      <alora-setup-step
        [index]="5" title="Scegli in che orari scrivere" data-tour="notifications-step-hours"
        [state]="!grantFor('whatsapp') || !sendsSomething ? 'locked' : windowInvalid ? 'todo' : 'done'"
        [lockedReason]="!grantFor('whatsapp') ? 'il permesso di invio (passo 2).' : 'almeno un messaggio scelto (passo 3).'"
        [summary]="'Dalle ' + draft.deliveryStart + ' alle ' + draft.deliveryEnd + ', solo quando la sede è aperta.'"
      >
        <div class="fields">
          <label class="field">Dalle<input type="time" name="from" [(ngModel)]="draft.deliveryStart" (ngModelChange)="edited()" required /></label>
          <label class="field">Alle<input type="time" name="until" [(ngModel)]="draft.deliveryEnd" (ngModelChange)="edited()" required /></label>
        </div>
        <p *ngIf="windowInvalid" class="error">L’orario di fine deve essere dopo quello di inizio.</p>
        <p class="muted">ALORA non scrive mai fuori da questi orari né quando la sede è chiusa o festiva: in quel caso anticipa il messaggio all’ultimo orario utile. Gli orari della sede si cambiano in <a routerLink="/locations">Sedi</a>.</p>
        <details class="simulation" data-tour="notifications-simulate">
          <summary>Prova con un appuntamento di esempio</summary>
          <p class="muted">Nessun messaggio viene inviato. Fuso orario: {{ policy.timezone }}.</p>
          <div class="fields">
            <div class="select-field"><span>Sede e attività</span>
              <ui-select label="Sede e attività" placeholder="Scegli" [options]="sectorOptions" [(ngModel)]="sectorId" [disabled]="busy" (ngModelChange)="preview = null"></ui-select></div>
            <label class="field">Giorno e ora dell’appuntamento<input type="datetime-local" [(ngModel)]="localStartsAt" [disabled]="busy" (ngModelChange)="preview = null" /></label>
          </div>
          <button type="button" class="secondary-btn" [disabled]="busy || !sectorId || !localStartsAt" (click)="simulate()">Calcola quando partono</button>
          <div *ngIf="preview" class="plan" aria-live="polite">
            <p *ngIf="!preview.reminders.length">Con queste impostazioni non parte nessun promemoria per questo appuntamento.</p>
            <ol>
              <li *ngFor="let item of preview.reminders">Promemoria {{ item.sequence }}: <strong>{{ format(item.dueAt, preview.timezone) }}</strong><span *ngIf="item.shifted"> · anticipato perché la sede era chiusa</span></li>
            </ol>
            <p *ngIf="preview.responseExpiresAt">Il cliente può rispondere fino a {{ format(preview.responseExpiresAt, preview.timezone) }}.</p>
            <p *ngIf="preview.omitted.length" class="muted">{{ preview.omitted.length }} invii saltati: orario già passato o troppo vicino al precedente.</p>
            <p class="message-preview" *ngIf="draft.maxReminders > 0"><strong>Così lo legge il cliente</strong><br />{{ preview.messagePreview.reminder }}</p>
          </div>
        </details>
      </alora-setup-step>

      <!-- 6. Attiva -->
      <alora-setup-step
        [index]="6" title="Attiva i promemoria" data-tour="notifications-activate"
        [state]="missing.length ? 'locked' : active && !dirty ? 'done' : 'todo'"
        [lockedReason]="missing.join('; ') + '.'"
        [summary]="active && !dirty ? 'Attivi per le nuove prenotazioni e per quelle che vengono modificate.' : 'Valgono per le prenotazioni nuove o modificate da ora in poi.'"
      >
        <p *ngIf="active && dirty" class="notice">Hai cambiato le impostazioni: premi «Salva e attiva» per applicarle. I promemoria già programmati con le vecchie impostazioni vengono fermati.</p>
        <p *ngIf="!active" class="muted">Le prenotazioni già presenti non ricevono messaggi arretrati.</p>
        <div class="actions">
          <button type="button" class="primary-btn" data-tour="notifications-save" [disabled]="busy || (active && !dirty)" (click)="saveAndActivate()">
            {{ active && !dirty ? "Promemoria attivi" : "Salva e attiva" }}
          </button>
          <button *ngIf="dirty" type="button" class="secondary-btn" [disabled]="busy" (click)="save()">Salva senza attivare</button>
          <button *ngIf="active" type="button" class="secondary-btn" [disabled]="busy" (click)="stop()">Ferma i promemoria</button>
        </div>
        <details *ngIf="grantOptions('email').length > 1" class="placeholders">
          <summary>Avanzate</summary>
          <div class="select-field"><span>Avvisi via email allo staff</span>
            <ui-select label="Avvisi via email" [options]="grantOptions('email')" [(ngModel)]="selected.email" [disabled]="busy"></ui-select></div>
        </details>
      </alora-setup-step>
    </div>
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
      .steps { display: grid; gap: 14px; margin-top: 20px; }
      .status {
        flex: none; font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 999px;
        background: #f1efe8; color: #5a4925;
      }
      .status.on { background: #e3efe6; color: #1e3425; }
      .choice { display: grid; gap: 12px; padding: 14px 0; border-top: 1px solid var(--line, #e6e9e2); }
      .choice:first-child { border-top: 0; padding-top: 0; }
      .group-title { margin: 0; font-size: 13px; font-weight: 600; }
      .toggle { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; }
      .toggle input { margin-top: 3px; }
      .toggle span, .field { display: grid; gap: 4px; }
      small { font-size: 12px; font-weight: 400; color: var(--muted, #68746d); line-height: 1.5; }
      .field { gap: 8px; font-size: 12px; font-weight: 600; min-width: 0; max-width: 32rem; }
      .field.wide { max-width: none; }
      .field textarea, .field input, .field select {
        font: inherit; font-weight: 400; color: inherit; border: 1px solid var(--line, #ccd6ce); border-radius: 12px;
        padding: 12px; background: #fffefb; box-sizing: border-box; width: 100%; min-width: 0;
      }
      .checklist { list-style: none; padding: 0; margin: 14px 0 0; display: grid; gap: 10px; }
      .checklist li {
        display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
        border: 1px solid var(--line, #e1e5de); border-radius: 14px; padding: 12px 14px;
      }
      .checklist li > div { display: grid; gap: 6px; min-width: 0; }
      .checklist li .grow { flex: 1; }
      .checklist li.ok { border-color: #b8d4c0; background: #f4f9f5; }
      .checklist li.ok strong::before { content: "✓ "; color: #2f6b46; }
      .error, small.error { color: #9b2c1f; font-size: 12px; }
      .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
      .placeholders { margin-top: 12px; font-size: 13px; }
      .placeholders summary, .simulation summary { cursor: pointer; font-weight: 600; font-size: 13px; }
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
      .fields label,
      .fields .select-field {
        display: grid;
        gap: 8px;
        font-size: 12px;
        font-weight: 600;
        min-width: 0;
      }
      .fields textarea,
      .fields input {
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
export class AppointmentAutomationPolicyComponent implements OnInit {
  private readonly api = inject(AppointmentAutomationPolicyApiService);
  private readonly access = inject(AppointmentAutomationAccessApiService);
  private readonly whatsapp = inject(WhatsAppApiService);
  private readonly session = inject(SessionStore);
  grants: AppointmentAutomationGrantView[] = [];
  connection: WhatsAppConnection | null = null;
  hook: AppointmentAutomationWebhookView | null = null;
  loading = true;
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
  get active() { return this.policy?.status === "active"; }
  get canWhatsApp() {
    return ["whatsapp.read", "whatsapp.manage", "whatsapp.send"].every((key) => this.session.can(key));
  }
  get canCommands() { return this.session.can("appointments.update.all"); }
  notice(key: "confirmation" | "cancellation" | "rescheduling") {
    const notices = this.draft?.eventNotices;
    return key === "rescheduling" ? notices?.rescheduling !== false : !!notices?.[key];
  }
  get sendsReminderOrInitial() { return !!this.draft && (this.draft.initialConfirmation || this.draft.maxReminders > 0); }
  get sendsSomething() {
    return this.sendsReminderOrInitial || this.notice("confirmation") || this.notice("cancellation") || this.notice("rescheduling");
  }
  get whatSummary() {
    if (!this.draft) return "";
    const parts = [
      this.draft.initialConfirmation ? "messaggio dopo la prenotazione" : "",
      this.draft.maxReminders ? `${this.draft.maxReminders} promemoria, il primo ${this.leadLabel} prima` : "",
      ["confirmation", "cancellation", "rescheduling"].some((k) => this.notice(k as "confirmation")) ? "avvisi sui cambi" : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Scegli almeno un messaggio.";
  }
  get leadLabel() {
    const { amount, unit } = splitMinutes(this.draft?.leadMinutes ?? 0);
    const names: Record<number, [string, string]> = { 1: ["minuto", "minuti"], 60: ["ora", "ore"], 1440: ["giorno", "giorni"] };
    return `${amount} ${names[unit][amount === 1 ? 0 : 1]}`;
  }
  get deadlineInvalid() {
    const d = this.draft;
    return !!d && d.requestResponse && d.maxReminders > 0 && d.responseDeadlineMinutes >= d.leadMinutes;
  }
  get windowInvalid() { return !!this.draft && !(this.draft.deliveryStart < this.draft.deliveryEnd); }
  get repliesReady() {
    const d = this.draft;
    if (!d || !d.requestResponse) return true;
    return this.hook?.status === "ready" && !!this.grantFor("customer_commands") && !this.deadlineInvalid &&
      (d.noResponseAction !== "notify_staff" || !!this.grantFor("application_notification"));
  }
  /** What still blocks activation, in the order of the steps. */
  get missing(): string[] {
    const out: string[] = [];
    if (!this.connection) out.push("collegare il numero WhatsApp (passo 1)");
    else if (!this.grantFor("whatsapp")) out.push("consentire l’invio (passo 2)");
    if (!this.sendsSomething) out.push("scegliere almeno un messaggio (passo 3)");
    if (this.draft?.maxReminders && this.draft.leadMinutes < 2) out.push("un anticipo di almeno 2 minuti (passo 3)");
    if (!this.repliesReady) out.push("completare la conferma del cliente (passo 4)");
    if (this.windowInvalid) out.push("orari di invio validi (passo 5)");
    return out;
  }
  private readonly locale = inject(LOCALE_ID);
  readonly noResponseOptions: UiOption[] = [
    { value: "notify_staff", label: "Avvisa lo staff e tieni l’appuntamento" },
    { value: "keep_booking", label: "Tieni l’appuntamento, senza avvisi" },
  ];
  private readonly grantOptionsCache = new Map<string, { key: string; options: UiOption[] }>();
  /** Optional email authorization (advanced). */
  grantOptions(kind: string): UiOption[] {
    const choices = this.choices(kind);
    const key = choices.map((g) => `${g.id}|${g.expiresAt}`).join(",");
    const cached = this.grantOptionsCache.get(kind);
    if (cached && cached.key === key) return cached.options;
    const options: UiOption[] = [
      { value: "", label: "Nessun avviso email" },
      ...uiOptions(choices, (g) => g.id, (g) => `Email · fino al ${formatDate(g.expiresAt, "dd/MM/yyyy", this.locale)}`),
    ];
    this.grantOptionsCache.set(kind, { key, options });
    return options;
  }
  private sectorOptionsSource: Array<{ id: string; label: string }> | null = null;
  private sectorOptionsCache: UiOption[] = [];
  get sectorOptions(): UiOption[] {
    if (this.sectorOptionsSource !== this.sectors) {
      this.sectorOptionsSource = this.sectors;
      this.sectorOptionsCache = uiOptions(this.sectors, (sector) => sector.id, (sector) => sector.label);
    }
    return this.sectorOptionsCache;
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
  /** The usable permission of a kind: the one the policy already uses, else the one lasting longest. */
  grantFor(kind: "whatsapp" | "customer_commands" | "application_notification" | "email") {
    const list = this.choices(kind);
    const saved = { whatsapp: this.policy?.grants.whatsapp, customer_commands: this.policy?.grants.customerCommands,
      application_notification: this.policy?.grants.staff, email: this.policy?.grants.email }[kind];
    return list.find((g) => g.id === saved) ?? [...list].sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))[0] ?? null;
  }
  preparing(kind: "whatsapp" | "customer_commands" | "application_notification") {
    return this.grants.some((g) => g.status === "preparing" &&
      (kind === "customer_commands" ? g.useCase === "customer_commands" : g.channel === kind && g.useCase !== "customer_commands"));
  }
  policy: AppointmentAutomationPolicyView | null = null;
  draft: AppointmentAutomationSettings | null = null;
  preview: (AppointmentReminderPlan & { messagePreview: AppointmentAutomationPolicyView["texts"] }) | null = null;
  sectors: Array<{ id: string; label: string }> = [];
  sectorId = "";
  localStartsAt = "";
  feedback = "";
  busy = false;
  private error(e: any) {
    return e?.error?.message || e?.message || "Impostazioni non disponibili. Riprova.";
  }
  ngOnInit() { void this.load(); }
  edited() {
    this.preview = null;
    this.feedback = "";
  }
  setEvent(key: "confirmation" | "cancellation" | "rescheduling", value: boolean) {
    if (!this.draft) return;
    this.draft = {
      ...this.draft,
      eventNotices: { confirmation: false, cancellation: false, rescheduling: true, ...this.draft.eventNotices, [key]: value },
    };
    this.edited();
  }
  private async loadAccess() {
    const [grants, sessions, hook] = await Promise.all([
      this.access.list(),
      this.canWhatsApp ? this.whatsapp.sessions().catch(() => []) : Promise.resolve([]),
      this.canWhatsApp ? this.access.webhook().catch(() => null) : Promise.resolve(null),
    ]);
    this.grants = grants;
    this.connection = sessions.find((c) => !c.closedAt && c.state === "connected" && c.runnerOnline && !!c.archiveId) ?? null;
    this.hook = hook;
  }
  async load() {
    if (this.busy) return;
    this.busy = true;
    this.edited();
    try {
      const [policy, locations] = await Promise.all([this.api.get(), this.api.locations(), this.loadAccess()]);
      this.policy = policy;
      this.texts = { ...policy.texts };
      this.selected = { whatsapp: policy.grants.whatsapp || "", customerCommands: policy.grants.customerCommands || "",
        staff: policy.grants.staff || "", email: policy.grants.email || "" };
      this.draft = { ...policy.settings };
      this.sectors = locations
        .filter((l) => l.isActive)
        .flatMap((l) => l.sectors.filter((s) => s.isActive).map((s) => ({ id: s.id, label: `${l.name} · ${s.name}` })));
      if (!this.sectors.some((s) => s.id === this.sectorId)) this.sectorId = this.sectors[0]?.id || "";
      if (!this.localStartsAt) {
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat("en-CA", { timeZone: policy.timezone, year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
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
      this.loading = false;
    }
  }
  /** Creates the permission in place; a request interrupted earlier is resumed, never duplicated. */
  async authorize(kind: "whatsapp" | "customer_commands" | "application_notification") {
    if (this.busy) return;
    this.busy = true;
    this.feedback = "";
    try {
      if (this.access.pending("grants").kind === "pending") await this.access.resume("grants");
      else if (kind === "whatsapp") await this.access.prepare("whatsapp", 365, this.connection?.archiveId ?? undefined);
      else await this.access.prepare("application_notification", 365, undefined, kind === "customer_commands" ? "customer_commands" : "notifications");
      await this.loadAccess();
      if (this.preparing(kind)) this.feedback = "Permesso in preparazione: premi «Controlla di nuovo» tra qualche secondo.";
    } catch (e) {
      this.feedback = this.error(e);
    } finally {
      this.busy = false;
    }
  }
  async verify(kind: "whatsapp" | "customer_commands" | "application_notification") {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const grant of this.grants.filter((g) => g.status === "preparing")) await this.access.action(grant.id, "recover");
      await this.loadAccess();
      if (this.preparing(kind)) this.feedback = "Ancora in preparazione. Riprova tra poco.";
    } catch (e) {
      this.feedback = this.error(e);
    } finally {
      this.busy = false;
    }
  }
  async enableReplies() {
    if (this.busy) return;
    this.busy = true;
    this.feedback = "";
    try {
      this.hook = this.access.pending("webhooks").kind === "pending"
        ? ((await this.access.resume("webhooks")) as AppointmentAutomationWebhookView)
        : await this.access.prepareWebhook();
    } catch (e) {
      this.feedback = this.error(e);
    } finally {
      this.busy = false;
    }
  }
  async save(): Promise<boolean> {
    if (this.busy || !this.draft || !this.policy) return false;
    this.busy = true;
    this.feedback = "";
    try {
      this.policy = await this.api.save({ ...this.draft }, this.policy.revision, { ...this.texts });
      this.draft = { ...this.policy.settings };
      this.texts = { ...this.policy.texts };
      this.feedback = "Impostazioni salvate. I promemoria non partono finché non li attivi.";
      return true;
    } catch (e) {
      this.feedback = this.error(e);
      return false;
    } finally {
      this.busy = false;
    }
  }
  async saveAndActivate() {
    if (this.busy || !this.policy || this.missing.length) return;
    if (this.dirty && !(await this.save())) return;
    this.busy = true;
    try {
      const requestResponse = !!this.draft?.requestResponse;
      this.selected = {
        whatsapp: this.grantFor("whatsapp")?.id ?? "",
        customerCommands: requestResponse ? this.grantFor("customer_commands")?.id ?? "" : "",
        staff: this.grantFor("application_notification")?.id ?? "",
        email: this.selected.email,
      };
      this.policy = await this.api.activate(this.policy.revision, this.selected);
      this.feedback = "Promemoria attivi per le nuove prenotazioni dei clienti con consenso WhatsApp.";
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
      this.feedback = "Promemoria fermati: non parte più nessun messaggio automatico.";
    } catch (e) {
      this.feedback = this.error(e);
    } finally {
      this.busy = false;
    }
  }
  async simulate() {
    if (this.busy || !this.draft) return;
    this.busy = true;
    this.preview = null;
    try {
      this.preview = await this.api.preview({ ...this.draft }, this.sectorId, this.localStartsAt, { ...this.texts });
    } catch (e) {
      this.feedback = this.error(e);
    } finally {
      this.busy = false;
    }
  }
  format(value: string, timezone: string) {
    return new Intl.DateTimeFormat("it-IT", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }
}
