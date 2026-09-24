import { CommonModule } from "@angular/common";
import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from "@angular/core";

@Component({
  selector: "barber-admin-appointments-drawer",
  standalone: true,
  imports: [CommonModule],
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 70;
        pointer-events: none;
      }

      .drawer-overlay {
        position: absolute;
        inset: 0;
        background: rgba(15, 23, 32, 0.34);
        pointer-events: auto;
      }

      .drawer-panel {
        position: absolute;
        inset: 0 auto 0 0;
        width: min(30rem, 100vw);
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1rem;
        background: rgba(244, 241, 234, 0.96);
        backdrop-filter: blur(16px);
        border-right: 1px solid rgba(15, 23, 32, 0.08);
        box-shadow: 1.25rem 0 3rem rgba(15, 23, 32, 0.14);
        pointer-events: auto;
      }

      .drawer-scroll {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        padding-right: 0.25rem;
        align-content: start;
      }

      .drawer-card {
        border: 1px solid rgba(15, 23, 32, 0.08);
        border-radius: 1.4rem;
        background: rgba(255, 255, 255, 0.78);
        padding: 1rem;
      }

      .drawer-status {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        background: rgba(15, 23, 32, 0.08);
        padding: 0.4rem 0.7rem;
        font-size: 0.78rem;
        font-weight: 700;
        text-transform: capitalize;
      }

      .drawer-summary-grid {
        display: grid;
        gap: 0.9rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      @media (max-width: 768px) {
        .drawer-summary-grid {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ],
  template: `
    <div class="drawer-overlay" (click)="close.emit()"></div>
    <aside
      class="drawer-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appointment-drawer-title"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="eyebrow text-[var(--accent)]">
            {{
              mode === "detail"
                ? "Dettaglio appuntamento"
                : "Evento selezionato"
            }}
          </p>
          <h3 id="appointment-drawer-title" class="mt-2 font-display text-3xl">
            {{ appointment?.customer?.firstName }}
            {{ appointment?.customer?.lastName }}
          </h3>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <span class="drawer-status">{{
              formatStatus(appointment?.status)
            }}</span>
          </div>
          <p class="mt-3 text-sm text-[var(--muted)]">
            {{ appointment?.service?.name }} ·
            {{ formatDateTime(appointment?.startsAt) }}
          </p>
        </div>
        <button type="button" class="pill-btn" (click)="close.emit()">
          Chiudi
        </button>
      </div>

      <div class="drawer-scroll grid gap-4">
        <article class="drawer-card">
          <div class="drawer-summary-grid">
            <div>
              <p class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Collaboratore
              </p>
              <strong class="mt-2 block">
                {{ appointment?.collaborator?.firstName || "Staff" }}
                {{ appointment?.collaborator?.lastName || "" }}
              </strong>
            </div>
            <div>
              <p class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Stato
              </p>
              <strong class="mt-2 block">{{ appointment?.status }}</strong>
            </div>
            <div>
              <p class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Durata
              </p>
              <strong class="mt-2 block">{{ durationLabel() }}</strong>
            </div>
            <div>
              <p class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                Contatto
              </p>
              <strong class="mt-2 block">{{
                appointment?.customer?.email ||
                  appointment?.customer?.phone ||
                  "N/D"
              }}</strong>
            </div>
          </div>
        </article>

        <article class="drawer-card">
          <p class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Richiesta cliente
          </p>
          <p class="mt-3 text-sm text-[var(--muted)]">
            {{
              appointment?.service?.description ||
                "Nessun dettaglio aggiuntivo sul servizio"
            }}
          </p>
        </article>

        <article *ngIf="mode === 'detail'" class="drawer-card">
          <p class="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Note
          </p>
          <p class="mt-3 text-sm text-[var(--muted)]">
            {{ appointment?.customerNotes || "Nessuna nota cliente" }}
          </p>
        </article>
      </div>

      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          class="primary-btn"
          (click)="createOrder.emit(appointment)"
        >
          Conferma ordine
        </button>
        <button
          *ngIf="mode === 'preview'"
          type="button"
          class="primary-btn"
          (click)="details.emit(appointment.id)"
        >
          Dettagli
        </button>
        <button
          type="button"
          class="secondary-btn"
          (click)="edit.emit(appointment.id)"
        >
          Modifica
        </button>
      </div>
    </aside>
  `,
})
export class AdminAppointmentsDrawerComponent {
  @Input() appointment: any = null;
  @Input() mode: "preview" | "detail" = "preview";
  @Output() close = new EventEmitter<void>();
  @Output() details = new EventEmitter<string>();
  @Output() edit = new EventEmitter<string>();
  @Output() createOrder = new EventEmitter<any>();

  @HostListener("document:keydown.escape")
  closeOnEscape(): void {
    this.close.emit();
  }

  formatDateTime(value?: string): string {
    if (!value) return "";
    return new Date(value).toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  durationLabel(): string {
    if (!this.appointment?.startsAt || !this.appointment?.endsAt) {
      return "N/D";
    }
    const minutes = Math.round(
      (new Date(this.appointment.endsAt).getTime() -
        new Date(this.appointment.startsAt).getTime()) /
        60000,
    );
    return `${minutes} min`;
  }

  formatStatus(status?: string): string {
    return (status || "").replace(/_/g, " ");
  }
}
