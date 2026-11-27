import { humanError } from "../core/human-error";
import { Component, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import {
  AppointmentAutomationPolicyApiService,
  AppointmentAutomationRunView,
} from "../core/appointment-automation-policy-api.service";
@Component({
  selector: "app-appointment-automation-monitor",
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: ` <section
    class="monitor"
    aria-label="Esiti promemoria e richieste cliente"
  >
    <header>
      <div>
        <p class="eyebrow">Risposte e prossimi invii</p>
        <h2>Promemoria e azioni cliente</h2>
      </div>
      <button
        type="button"
        class="secondary-btn"
        [disabled]="busy"
        (click)="load()"
      >
        {{ loaded ? "Aggiorna esiti" : "Apri esiti e richieste" }}
      </button>
    </header>
    <p class="muted">
      {{
        view === "open_requests"
          ? "Le prime 50 richieste ancora da gestire, a partire dalle più vecchie."
          : "Le ultime 50 prenotazioni gestite dalle automazioni."
      }}
      Una richiesta di modifica richiede l’intervento del salone. La scadenza
      senza risposta mantiene l’appuntamento.
    </p>
    <div class="actions" *ngIf="loaded">
      <button
        type="button"
        class="secondary-btn"
        [attr.aria-pressed]="view === 'recent'"
        [disabled]="busy"
        (click)="load('recent')"
      >
        Ultime prenotazioni</button
      ><button
        type="button"
        class="secondary-btn"
        [attr.aria-pressed]="view === 'open_requests'"
        [disabled]="busy"
        (click)="load('open_requests')"
      >
        Richieste da gestire
      </button>
    </div>
    <p *ngIf="feedback" role="status" class="notice">{{ feedback }}</p>
    <p *ngIf="loaded && !runs.length" class="muted">
      {{
        view === "open_requests"
          ? "Nessuna richiesta ancora da gestire."
          : "Nessun promemoria programmato. Servono policy attiva, prenotazione futura e consenso WhatsApp per quel numero."
      }}
    </p>
    <ol>
      <li
        *ngFor="let run of runs"
        [class.needs-review]="
          run.status === 'change_requested' && !run.reviewedAt
        "
      >
        <div class="row">
          <div>
            <p *ngIf="run.kind === 'event_notice'" class="eyebrow">
              {{
                run.eventType === "appointment.cancelled"
                  ? "Avviso di annullamento"
                  : "Avviso di conferma"
              }}
            </p>
            <strong
              >{{ run.plan.customer.firstName }}
              {{ run.plan.customer.lastName }}</strong
            >
            <p class="muted">
              {{ run.startsAt | date: "dd MMM yyyy, HH:mm" }} ·
              {{ services(run) }}
            </p>
          </div>
          <span class="badge">{{
            run.status === "change_requested" && run.reviewedAt
              ? "Richiesta gestita"
              : status(run.status)
          }}</span>
        </div>
        <p *ngIf="run.status === 'change_requested'">
          {{
            run.responseAction === "cancel"
              ? "Richiesta di annullamento entro le 24 ore: valuta con il cliente."
              : "Il cliente ha chiesto una modifica: concorda il nuovo orario."
          }}
          La prenotazione è mantenuta.
        </p>
        <p *ngIf="run.status === 'cancelled'" class="muted">
          Prenotazione annullata dal cliente. Eventuali rimborsi e resi vanno
          gestiti dal conto.
        </p>
        <ul class="deliveries">
          <li *ngFor="let d of run.deliveries">
            <span
              >{{
                d.sequence === 0
                  ? run.kind === "event_notice"
                    ? "Notifica evento"
                    : "Messaggio iniziale"
                  : "Promemoria " + d.sequence
              }}
              · {{ d.dueAt | date: "dd/MM HH:mm" }}</span
            ><strong>{{ deliveryStatus(d) }}</strong>
            <p *ngIf="d.reason" class="muted">{{ d.reason }}</p>
            <p *ngIf="d.withdrawRequested" class="muted">
              {{
                d.withdrawOutcome === "withdrawn" ||
                d.providerState === "cancelled"
                  ? "Ritiro confermato dal canale"
                  : d.withdrawOutcome === "effect_started"
                    ? "Invio già acquisito: il ritiro non può essere garantito"
                    : "Ritiro richiesto: verifica del canale in corso"
              }}
            </p>
          </li>
        </ul>
        <div class="actions">
          <a
            class="secondary-btn"
            [routerLink]="['/appointments']"
            [queryParams]="{ detail: run.appointmentId }"
            >Apri agenda</a
          ><button
            *ngIf="run.status === 'change_requested' && !run.reviewedAt"
            type="button"
            class="primary-btn"
            [disabled]="busy"
            (click)="review(run)"
          >
            Segna richiesta gestita</button
          ><span *ngIf="run.reviewedAt" class="muted"
            >Gestita il {{ run.reviewedAt | date: "dd/MM HH:mm" }}</span
          >
        </div>
      </li>
    </ol>
  </section>`,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        margin-top: 24px;
      }
      .monitor {
        padding: clamp(22px, 3vw, 36px);
        border: 1px solid var(--line, #d9dfd8);
        border-radius: 24px;
        background: var(--panel, #fffdf8);
      }
      header,
      .row,
      .actions {
        display: flex;
        gap: 1rem;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
      }
      h2 {
        font-family: var(--font-display, Georgia, serif);
        font-size: 27px;
        margin: 0.5rem 0;
      }
      .eyebrow {
        font-size: 10px;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .muted {
        font-size: 13px;
        line-height: 1.6;
        color: var(--muted, #68746d);
      }
      ol {
        list-style: none;
        padding: 0;
        display: grid;
        gap: 1rem;
      }
      ol > li {
        border: 1px solid var(--line, #d9dfd8);
        border-radius: 16px;
        padding: 20px;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .needs-review {
        border-left: 4px solid #9a641b;
        background: #faf2df;
      }
      .badge {
        padding: 0.45rem 0.75rem;
        border-radius: 2rem;
        background: #edf2e8;
        font-size: 12px;
      }
      .deliveries {
        padding: 0;
        list-style: none;
        border-top: 1px solid var(--line);
      }
      .deliveries li {
        padding: 0.75rem 0;
        border-bottom: 1px solid var(--line);
        font-size: 13px;
      }
      .deliveries strong {
        display: block;
        margin-top: 0.3rem;
      }
      .actions {
        margin-top: 1rem;
        justify-content: flex-start;
      }
      .notice {
        padding: 1rem;
        border-radius: 12px;
        background: #faf2df;
        font-size: 13px;
      }
      @media (max-width: 600px) {
        header button,
        .actions a,
        .actions button {
          width: 100%;
          text-align: center;
        }
        ol > li {
          padding: 16px;
        }
      }
    `,
  ],
})
export class AppointmentAutomationMonitorComponent {
  private readonly api = inject(AppointmentAutomationPolicyApiService);
  runs: AppointmentAutomationRunView[] = [];
  busy = false;
  loaded = false;
  feedback = "";
  view: "recent" | "open_requests" = "recent";
  deliveryStatus(d: AppointmentAutomationRunView["deliveries"][number]) {
    return (
      (
        {
          cancelled: "Invio ritirato",
          sent: "Inviato",
          sending: "Invio acquisito dal canale",
          failed: "Invio fallito",
          uncertain: "Esito da verificare",
        } as Record<string, string>
      )[d.providerState || ""] || this.status(d.status)
    );
  }
  services(run: AppointmentAutomationRunView) {
    return run.plan.appointments.map((a) => a.service).join(" · ");
  }
  status(value: string) {
    return (
      (
        {
          waiting: "In attesa della risposta",
          confirmed: "Confermata dal cliente",
          change_requested: "Richiesta da gestire",
          cancelled: "Annullata dal cliente",
          expired: "Scaduta · prenotazione mantenuta",
          superseded: "Piano fermato o sostituito",
          pending: "Programmato",
          dispatching: "Invio in verifica",
          queued: "In coda sul canale",
          sent: "Inviato",
          failed: "Invio fallito",
          skipped: "Invio omesso",
          uncertain: "Esito da verificare",
        } as Record<string, string>
      )[value] || value
    );
  }
  async load(view = this.view) {
    if (this.busy) return;
    this.busy = true;
    this.view = view;
    try {
      this.runs = await this.api.monitor(view);
      this.loaded = true;
      this.feedback = "";
    } catch (e: any) {
      this.runs = [];
      this.feedback = humanError(e, "Esiti non disponibili.");
    } finally {
      this.busy = false;
    }
  }
  async review(run: AppointmentAutomationRunView) {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.api.review(run.id, run.updatedAt);
      this.runs = await this.api.monitor(this.view);
      this.feedback =
        "Richiesta segnata come gestita. L’agenda non è stata modificata.";
    } catch (e: any) {
      this.feedback =
        humanError(e, "Richiesta non aggiornata: ricarica gli esiti.");
    } finally {
      this.busy = false;
    }
  }
}
