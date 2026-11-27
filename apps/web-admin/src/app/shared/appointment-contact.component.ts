import { humanError } from "../core/human-error";
import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  inject,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import {
  beginPendingCommand,
  clearPendingCommand,
  readPendingCommand,
  PendingCommand,
} from "@barber/shared/utils";
import { ADMIN_API_URL } from "../core/api-config";
import { SessionStore } from "../core/session.store";
type Contact = {
  revision: number;
  authorized: boolean;
  phoneMasked: string | null;
  authorizedAt: string | null;
};
@Component({
  selector: "app-appointment-contact",
  standalone: true,
  imports: [CommonModule],
  template: ` <label class="compact-line">
      <input
        type="checkbox"
        [checked]="!!contact?.authorized"
        [disabled]="
          busy ||
          disabled ||
          !contact ||
          pending().kind !== 'empty' ||
          (!contact.authorized && !contact.phoneMasked)
        "
        (change)="save(!contact?.authorized)"
      />
      <span
        >Promemoria WhatsApp consentiti<ng-container *ngIf="contact?.phoneMasked">
          · {{ contact?.phoneMasked }}</ng-container
        ></span
      >
      <span
        class="info"
        tabindex="0"
        role="note"
        [attr.title]="compactInfo"
        [attr.aria-label]="compactInfo"
        >i</span
      >
      <button
        *ngIf="pending().kind === 'pending'"
        type="button"
        class="link"
        [disabled]="busy || disabled"
        (click)="retry()"
      >
        Verifica
      </button>
      <small *ngIf="feedback" role="status">{{ feedback }}</small>
      <small *ngIf="!feedback && contact && !contact.authorized && !contact.phoneMasked"
        >Serve il numero con prefisso internazionale nella scheda cliente.</small
      >
    </label>
`,
  styles: [
    `
      :host {
        display: block;
      }
      .compact-line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.9rem;
      }
      .compact-line input {
        width: 1.15rem;
        height: 1.15rem;
      }
      .compact-line small {
        flex-basis: 100%;
        color: var(--muted, #68746d);
      }
      .compact-line .info {
        display: inline-grid;
        place-items: center;
        width: 1.2rem;
        height: 1.2rem;
        border: 1px solid var(--line, #d9dfd8);
        border-radius: 999px;
        font-size: 0.7rem;
        font-weight: 800;
        font-style: italic;
        color: var(--muted, #68746d);
        cursor: help;
      }
      .compact-line .link {
        margin: 0;
        border: 0;
        background: transparent;
        text-decoration: underline;
        font-weight: 700;
      }
    `,
  ],
})
export class AppointmentContactComponent implements OnChanges {
  @Input({ required: true }) appointmentId = "";
  @Input() disabled = false;
  readonly compactInfo =
    "Registra il consenso solo su richiesta del cliente: promemoria e richieste di conferma su WhatsApp per questa prenotazione, al numero con prefisso internazionale. La revoca ferma i promemoria ancora da inviare.";
  @Output() changed = new EventEmitter<void>();
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  contact: Contact | null = null;
  busy = false;
  feedback = "";
  private url() {
    return `${ADMIN_API_URL}/appointments/${encodeURIComponent(this.appointmentId)}/notification-contact`;
  }
  private key() {
    const user = this.session.currentUser();
    return `alora.booking.contact:${user?.tenantId}:${user?.id}:${this.appointmentId}`;
  }
  pending() {
    try {
      return readPendingCommand(sessionStorage, this.key());
    } catch {
      return { kind: "unreadable" } as const;
    }
  }
  ngOnChanges() {
    void this.load();
  }
  async load() {
    if (this.busy || !this.appointmentId) return;
    this.busy = true;
    try {
      this.contact = await firstValueFrom(this.http.get<Contact>(this.url()));
      this.feedback =
        this.pending().kind === "unreadable"
          ? "Richiesta precedente non leggibile: verifica il consenso con il salone prima di modificare."
          : "";
    } catch (e: any) {
      this.contact = null;
      this.feedback = humanError(e, "Consenso non disponibile.");
    } finally {
      this.busy = false;
    }
  }
  async save(authorized: boolean) {
    if (
      this.busy ||
      this.disabled ||
      !this.contact ||
      this.pending().kind !== "empty"
    )
      return;
    await this.send(
      beginPendingCommand(sessionStorage, this.key(), {
        revision: this.contact.revision,
        authorized,
      }),
    );
  }
  async retry() {
    const state = this.pending();
    if (!this.busy && !this.disabled && state.kind === "pending")
      await this.send(state.command);
  }
  private async send(command: PendingCommand) {
    this.busy = true;
    try {
      this.contact = await firstValueFrom(
        this.http.patch<Contact>(this.url(), command.body),
      );
      clearPendingCommand(
        sessionStorage,
        this.key(),
        command.body.idempotencyKey,
      );
      this.feedback = this.contact.authorized
        ? "Consenso registrato."
        : "Consenso revocato.";
      this.changed.emit();
    } catch (e: any) {
      if ([400, 403, 404, 409].includes(e?.status))
        clearPendingCommand(
          sessionStorage,
          this.key(),
          command.body.idempotencyKey,
        );
      this.feedback =
        humanError(e, "Esito da verificare: riprendi la stessa richiesta.");
    } finally {
      this.busy = false;
    }
  }
}
