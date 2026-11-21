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
  template: ` <section
    class="contact"
    aria-label="Promemoria WhatsApp della prenotazione"
  >
    <h3>Promemoria WhatsApp</h3>
    <p *ngIf="contact">
      {{
        contact.authorized
          ? "Consenso registrato per questa prenotazione"
          : "Consenso non registrato"
      }}
      · {{ contact.phoneMasked || "Numero internazionale non disponibile" }}
    </p>
    <p>
      Registra il consenso solo su richiesta del cliente. La revoca ferma i
      promemoria ancora da inviare; un messaggio già acquisito dal canale può
      essere già partito.
    </p>
    <p *ngIf="feedback" role="status">{{ feedback }}</p>
    <button
      *ngIf="pending().kind === 'pending'"
      type="button"
      class="secondary-btn"
      [disabled]="busy || disabled"
      (click)="retry()"
    >
      Verifica consenso precedente
    </button>
    <button
      *ngIf="contact && pending().kind === 'empty'"
      type="button"
      class="secondary-btn"
      [disabled]="
        busy || disabled || (!contact.authorized && !contact.phoneMasked)
      "
      (click)="save(!contact.authorized)"
    >
      {{
        contact.authorized
          ? "Revoca per questa prenotazione"
          : "Registra il consenso del cliente"
      }}
    </button>
    <button
      type="button"
      class="secondary-btn"
      [disabled]="busy || disabled"
      (click)="load()"
    >
      Aggiorna consenso
    </button>
  </section>`,
  styles: [
    `
      :host {
        display: block;
        margin: 1rem 0;
      }
      .contact {
        padding: 1rem;
        border: 1px solid var(--line, #d9dfd8);
        border-radius: 1rem;
        background: var(--panel, #fffdf8);
      }
      h3 {
        font-size: 1rem;
        margin: 0 0 0.5rem;
      }
      p {
        font-size: 0.85rem;
        line-height: 1.6;
        color: var(--muted, #68746d);
      }
      button {
        margin: 0.3rem 0.5rem 0.3rem 0;
        max-width: 100%;
      }
    `,
  ],
})
export class AppointmentContactComponent implements OnChanges {
  @Input({ required: true }) appointmentId = "";
  @Input() disabled = false;
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
      this.feedback = e?.error?.message || "Consenso non disponibile.";
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
        e?.error?.message ||
        "Esito da verificare: riprendi la stessa richiesta.";
    } finally {
      this.busy = false;
    }
  }
}
