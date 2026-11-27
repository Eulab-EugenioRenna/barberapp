import { humanError } from "../core/human-error";
import { Component, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { HttpErrorResponse } from "@angular/common/http";
import type {
  AppointmentAutomationChannel,
  AppointmentAutomationGrantView,
  AppointmentAutomationWebhookView,
} from "@barber/shared/automations";
import type { WhatsAppArchiveView } from "@barber/shared/whatsapp";
import { AppointmentAutomationAccessApiService } from "../core/appointment-automation-access-api.service";
import { WhatsAppApiService } from "../core/whatsapp-api.service";
import { SessionStore } from "../core/session.store";
import { UiSelectComponent, uiOptions, type UiOption } from "@alora/ui";

@Component({
  selector: "app-appointment-automation-access",
  standalone: true,
  imports: [CommonModule, FormsModule, UiSelectComponent],
  template: ` <section
    class="access"
    aria-label="Autorizzazioni delle automazioni"
  >
    <header>
      <div>
        <p class="eyebrow">Permessi</p>
        <h2>Cosa può fare ALORA da solo</h2>
      </div>
      <button
        type="button"
        class="secondary-btn"
        [disabled]="busy"
        (click)="load()"
      >
        {{ loaded ? "Aggiorna" : "Mostra i permessi" }}
      </button>
    </header>
    <p class="notice">
      I permessi si creano da soli quando configuri «Promemoria automatici».
      Qui li vedi, ne controlli la scadenza e puoi revocarli: un permesso
      revocato ferma subito i messaggi che lo usano.
    </p>
    <p *ngIf="feedback" role="status" class="feedback">{{ feedback }}</p>
    <ng-container *ngIf="loaded">
      <div
        *ngIf="api.pending('grants').kind !== 'empty'"
        class="pending"
        role="status"
      >
        <p>
          Una richiesta precedente è da verificare. Recuperala prima di
          registrarne un’altra.
        </p>
        <button
          *ngIf="api.pending('grants').kind === 'pending'"
          type="button"
          class="secondary-btn"
          [disabled]="busy"
          (click)="resume('grants')"
        >
          Recupera la stessa autorizzazione
        </button>
        <p *ngIf="api.pending('grants').kind === 'unreadable'">
          Dati della richiesta non leggibili. Premi «Aggiorna» per vedere lo
          stato attuale dei permessi.
        </p>
      </div>
      <form (ngSubmit)="prepare()">
        <fieldset [disabled]="busy || api.pending('grants').kind !== 'empty'">
          <div class="fields">
            <div class="select-field">
              <span>Canale da autorizzare</span
              ><ui-select
                label="Canale da autorizzare"
                name="automation-channel"
                [options]="channelOptions"
                [filterable]="false"
                [(ngModel)]="channel"
              ></ui-select>
            </div
            ><div
              *ngIf="channel === 'application_notification'"
              class="select-field"
            >
              <span>A cosa serve</span
              ><ui-select
                label="Finalità"
                name="automation-purpose"
                [options]="purposeOptions"
                [filterable]="false"
                [(ngModel)]="useCase"
              ></ui-select>
            </div
            ><label
              >Per quanti giorni vale<input
                type="number"
                name="automation-days"
                [(ngModel)]="validDays"
                min="1"
                max="365"
                step="1"
                required /></label
            ><div *ngIf="channel === 'whatsapp'" class="select-field">
              <span>Numero WhatsApp</span
              ><ui-select
                label="Archivio del numero"
                name="automation-archive"
                placeholder="Seleziona il numero"
                [options]="archiveOptions"
                [(ngModel)]="archiveId"
                required
              ></ui-select>
            </div>
          </div>
          <p class="muted">
            Il permesso vale con i diritti che il tuo account ha adesso. Per
            WhatsApp serve un numero connesso. Alla scadenza i messaggi si
            fermano: rinnovalo da «Promemoria automatici».
          </p>
          <button class="primary-btn" [disabled]="!validInput">
            Crea permesso
          </button>
        </fieldset>
      </form>
      <ul class="grants" *ngIf="grants.length; else empty">
        <li *ngFor="let grant of grants">
          <div>
            <strong>{{
              grant.useCase === "customer_commands"
                ? "Risposte dei clienti in agenda"
                : channelLabel(grant.channel)
            }}</strong
            ><span class="state">{{ stateLabel(grant) }}</span
            ><span class="muted"
              >Scadenza {{ grant.expiresAt | date: "dd MMM yyyy, HH:mm" }}</span
            >
          </div>
          <div class="actions">
            <button
              *ngIf="grant.status === 'preparing' || grant.status === 'ready'"
              type="button"
              class="secondary-btn"
              [disabled]="busy"
              (click)="recover(grant)"
            >
              Controlla</button
            ><button
              *ngIf="grant.status !== 'revoked'"
              type="button"
              class="secondary-btn"
              [disabled]="busy"
              (click)="revokeId = grant.id"
            >
              {{
                grant.status === "revocation_pending"
                  ? "Riprendi revoca"
                  : "Revoca"
              }}
            </button>
          </div>
          <div *ngIf="revokeId === grant.id" class="pending">
            <p>
              Revocare il permesso
              {{
                grant.useCase === "customer_commands"
                  ? "Risposte dei clienti in agenda"
                  : channelLabel(grant.channel)
              }}? I nuovi invii che la usano si fermano; un messaggio già
              acquisito richiede verifica.
            </p>
            <div class="actions">
              <button
                type="button"
                class="primary-btn"
                [disabled]="busy"
                (click)="revoke(grant)"
              >
                Conferma revoca</button
              ><button
                type="button"
                class="secondary-btn"
                [disabled]="busy"
                (click)="revokeId = ''"
              >
                Mantieni il permesso
              </button>
            </div>
          </div>
        </li>
      </ul>
      <ng-template #empty
        ><p class="muted">Nessuna autorizzazione registrata.</p></ng-template
      >
      <div class="replies" *ngIf="canWhatsApp">
        <h3>Ricezione delle risposte dei clienti</h3>
        <p class="muted">
          {{ hookLabel }}
        </p>
        <p *ngIf="hook?.lastReceivedAt" class="muted">
          Ultimo evento ricevuto:
          {{ hook?.lastReceivedAt | date: "dd MMM yyyy, HH:mm" }}
        </p>
        <p *ngIf="api.pending('webhooks').kind !== 'empty'" class="pending">
          Configurazione precedente da recuperare. La stessa richiesta conserva
          il segreto e l’indirizzo.
        </p>
        <button
          type="button"
          class="secondary-btn"
          [disabled]="
            busy ||
            hook?.status === 'disabled' ||
            api.pending('webhooks').kind === 'unreadable'
          "
          (click)="registerHook()"
        >
          {{
            api.pending("webhooks").kind === "pending"
              ? "Recupera la stessa ricezione"
              : hook?.id
                ? "Controlla di nuovo"
                : "Configura ricezione delle risposte"
          }}
        </button>
      </div>
    </ng-container>
  </section>`,
  styles: [
    `
      :host {
        display: block;
      }
      .access {
        background: var(--surface, #fff);
        border: 1px solid var(--line, #e2e5e7);
        border-radius: 20px;
        padding: clamp(18px, 3vw, 30px);
        color: var(--ink, #172729);
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
      }
      h2 {
        margin: 3px 0 12px;
        font-size: 1.35rem;
      }
      h3 {
        margin: 0 0 10px;
      }
      .eyebrow {
        font-size: 0.72rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #4b6763;
        margin: 0;
      }
      .notice,
      .feedback,
      .pending {
        background: #f0f5f3;
        padding: 14px 16px;
        border-radius: 12px;
        line-height: 1.55;
      }
      .feedback {
        border-left: 3px solid #50776a;
      }
      .pending {
        background: #faf4e8;
      }
      .muted {
        color: #5c6b6b;
        font-size: 0.88rem;
        line-height: 1.55;
      }
      .fields {
        display: grid;
        grid-template-columns: 2fr 1fr 2fr;
        gap: 16px;
      }
      label,
      .select-field {
        display: grid;
        gap: 7px;
        font-size: 0.87rem;
        font-weight: 600;
      }
      input {
        min-height: 44px;
        border: 1px solid #b9c9c5;
        border-radius: 10px;
        padding: 10px 12px;
        width: 100%;
        min-width: 0;
        background: #fff;
        color: inherit;
        font: inherit;
      }
      fieldset {
        border: 0;
        padding: 0;
        margin: 24px 0;
        min-width: 0;
      }
      .grants {
        padding: 0;
        list-style: none;
        margin: 22px 0;
      }
      .grants li {
        border-top: 1px solid #e2e9e7;
        padding: 18px 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
      }
      .grants li > div:first-child {
        display: flex;
        gap: 8px;
        flex-direction: column;
      }
      .state {
        font-size: 0.85rem;
      }
      .actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .grants .pending {
        width: 100%;
      }
      .replies {
        border-top: 1px solid #e2e9e7;
        padding-top: 24px;
      }
      button {
        min-height: 44px;
        white-space: normal;
      }
      button:focus-visible,
      input:focus-visible {
        outline: 3px solid #86b6a5;
        outline-offset: 3px;
      }
      @media (max-width: 760px) {
        header {
          align-items: flex-start;
          flex-direction: column;
        }
        .fields {
          grid-template-columns: 1fr;
        }
        .grants li {
          align-items: flex-start;
          flex-direction: column;
        }
        .actions {
          width: 100%;
        }
      }
    `,
  ],
})
export class AppointmentAutomationAccessComponent {
  readonly api = inject(AppointmentAutomationAccessApiService);
  private readonly whatsapp = inject(WhatsAppApiService);
  readonly session = inject(SessionStore);
  grants: AppointmentAutomationGrantView[] = [];
  archives: WhatsAppArchiveView[] = [];
  hook: AppointmentAutomationWebhookView | null = null;
  busy = false;
  loaded = false;
  feedback = "";
  revokeId = "";
  useCase: "notifications" | "customer_commands" = "notifications";
  channel: AppointmentAutomationChannel = "email";
  validDays = 30;
  archiveId = "";
  private channelOptionsKey: boolean | null = null;
  private channelOptionsCache: UiOption[] = [];
  get channelOptions(): UiOption[] {
    const canWhatsApp = this.canWhatsApp;
    if (this.channelOptionsKey !== canWhatsApp) {
      this.channelOptionsKey = canWhatsApp;
      this.channelOptionsCache = [
        ...(canWhatsApp ? [{ value: "whatsapp", label: "WhatsApp" }] : []),
        { value: "email", label: "Email" },
        { value: "application_notification", label: "Notifiche nell’app" },
      ];
    }
    return this.channelOptionsCache;
  }
  private purposeOptionsKey: boolean | null = null;
  private purposeOptionsCache: UiOption[] = [];
  get purposeOptions(): UiOption[] {
    const canCommands = this.session.can("appointments.update.all");
    if (this.purposeOptionsKey !== canCommands) {
      this.purposeOptionsKey = canCommands;
      this.purposeOptionsCache = [
        { value: "notifications", label: "Avvisi nell’app" },
        ...(canCommands
          ? [{ value: "customer_commands", label: "Risposte dei clienti in agenda" }]
          : []),
      ];
    }
    return this.purposeOptionsCache;
  }
  private archiveOptionsSource: WhatsAppArchiveView[] | null = null;
  private archiveOptionsCache: UiOption[] = [];
  get archiveOptions(): UiOption[] {
    if (this.archiveOptionsSource !== this.archives) {
      this.archiveOptionsSource = this.archives;
      this.archiveOptionsCache = uiOptions(
        this.archives,
        (archive) => archive.id,
        (archive) => archive.number,
      );
    }
    return this.archiveOptionsCache;
  }
  get canWhatsApp() {
    return ["whatsapp.read", "whatsapp.manage", "whatsapp.send"].every((key) =>
      this.session.can(key),
    );
  }
  get validInput() {
    return (
      Number.isInteger(this.validDays) &&
      this.validDays >= 1 &&
      this.validDays <= 365 &&
      (this.channel !== "whatsapp" || !!this.archiveId)
    );
  }
  get hookLabel() {
    return this.hook?.status === "ready"
      ? "Attiva: ALORA riceve i tocchi dei clienti sui pulsanti."
      : this.hook?.status === "disabled"
        ? "Disattivata dal servizio messaggi: scrivi all’assistenza EULAB."
        : this.hook?.status === "preparing"
          ? "Configurazione da recuperare."
          : "Non attiva: senza, le risposte dei clienti non arrivano in agenda.";
  }
  channelLabel(channel: AppointmentAutomationChannel) {
    return channel === "whatsapp"
      ? "WhatsApp"
      : channel === "email"
        ? "Email"
        : "Notifiche nell’app";
  }
  stateLabel(row: AppointmentAutomationGrantView) {
    if (row.status === "ready" && Date.parse(row.expiresAt) <= Date.now())
      return "Scaduta";
    return {
      ready: "Attivo",
      preparing: "In preparazione: premi «Controlla»",
      revocation_pending: "Revoca in corso · i messaggi sono già fermi",
      revoked: "Revocata",
    }[row.status];
  }
  private message(error: unknown) {
    return humanError(
      error,
      "Operazione non completata. Aggiorna lo stato o recupera la stessa richiesta.",
    );
  }
  private async refresh() {
    this.grants = await this.api.list();
    if (this.canWhatsApp) {
      [this.archives, this.hook] = await Promise.all([
        this.whatsapp.archives(),
        this.api.webhook(),
      ]);
    }
    this.loaded = true;
  }
  private async run(
    operation: () => Promise<unknown>,
    message: string | (() => string),
  ) {
    if (this.busy) return;
    this.busy = true;
    this.feedback = "";
    try {
      await operation();
      await this.refresh();
      this.feedback = typeof message === "string" ? message : message();
    } catch (error) {
      if (
        error instanceof HttpErrorResponse &&
        [401, 403].includes(error.status)
      ) {
        this.grants = [];
        this.hook = null;
        this.archives = [];
        this.loaded = false;
      }
      this.feedback = this.message(error);
    } finally {
      this.busy = false;
    }
  }
  load() {
    return this.run(() => Promise.resolve(), "Permessi aggiornati.");
  }
  prepare() {
    if (!this.validInput) return;
    return this.run(
      () =>
        this.api.prepare(
          this.channel,
          this.validDays,
          this.archiveId,
          this.channel === "application_notification"
            ? this.useCase
            : "notifications",
        ),
      "Permesso creato.",
    );
  }
  resume(kind: "grants" | "webhooks") {
    return this.run(
      () => this.api.resume(kind),
      "Stessa richiesta recuperata.",
    );
  }
  recover(row: AppointmentAutomationGrantView) {
    return this.run(
      () => this.api.action(row.id, "recover"),
      "Stato del permesso aggiornato.",
    );
  }
  revoke(row: AppointmentAutomationGrantView) {
    let confirmed = false;
    return this.run(
      async () => {
        const result = await this.api.action(row.id, "revoke");
        confirmed = result.status === "revoked";
        if (confirmed) this.revokeId = "";
      },
      () =>
        confirmed
          ? "Revoca confermata. Le ricevute degli invii precedenti restano consultabili."
          : "Revoca da completare. I nuovi invii sono già fermati; riprendi la verifica della stessa autorizzazione.",
    );
  }
  registerHook() {
    return this.api.pending("webhooks").kind === "pending"
      ? this.resume("webhooks")
      : this.run(
          () => this.api.prepareWebhook(),
          () => this.hookLabel,
        );
  }
}
