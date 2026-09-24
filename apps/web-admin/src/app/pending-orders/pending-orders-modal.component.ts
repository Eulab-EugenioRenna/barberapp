import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { AutofocusFirstDirective } from "../shared/autofocus-first.directive";
import { UiIconComponent } from "../shared/ui-icon.component";

@Component({
  selector: "barber-pending-orders-modal",
  standalone: true,
  imports: [CommonModule, FormsModule, AutofocusFirstDirective, UiIconComponent],
  template: `
    <div class="confirm-overlay" barberAutofocusFirst>
      <button
        type="button"
        class="confirm-backdrop"
        (click)="close.emit()"
        aria-label="Chiudi ordini da confermare"
      ></button>
      <article
        class="confirm-dialog panel max-h-[85vh] overflow-auto !w-[min(52rem,100%)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-orders-title"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="eyebrow text-[var(--accent)]">Appuntamenti trascorsi</p>
            <h2 id="pending-orders-title" class="mt-2 font-display text-3xl">
              Ordini da confermare
            </h2>
            <p class="mt-2 text-sm text-[var(--muted)]">
              Conferma l'ordine per collegarlo alla prenotazione, oppure collega
              un ordine gia registrato senza appuntamento.
            </p>
          </div>
          <button type="button" class="pill-btn" (click)="close.emit()">
            Piu tardi
          </button>
        </div>

        <div class="mt-5 grid gap-3">
          <article
            *ngFor="let appointment of appointments"
            class="rounded-2xl border border-[var(--line)] p-4"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <strong>
                  {{ appointment.customer?.firstName || "Cliente" }}
                  {{ appointment.customer?.lastName || "" }}
                </strong>
                <p class="mt-1 text-sm text-[var(--muted)]">
                  {{ appointment.service?.name || "Servizio" }} ·
                  {{ formatDateTime(appointment.startsAt) }}
                  <span *ngIf="appointment.collaborator">
                    · {{ appointment.collaborator.firstName }}
                    {{ appointment.collaborator.lastName }}
                  </span>
                </p>
                <p class="mt-1 text-xs text-[var(--muted)]">
                  Stato: {{ appointment.status }}
                </p>
              </div>
              <span class="status-pill status-pill-amber">Ordine mancante</span>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="primary-btn"
                [disabled]="loading"
                (click)="confirmOrder.emit(appointment)"
              >
                <barber-ui-icon name="receipt"></barber-ui-icon> Conferma ordine
              </button>
              <button
                type="button"
                class="secondary-btn"
                *ngIf="unlinkedSales.length"
                (click)="toggleLink(appointment.id)"
              >
                <barber-ui-icon name="link"></barber-ui-icon>
                {{ linkOpenFor === appointment.id ? "Chiudi collegamento" : "Collega ordine" }}
              </button>
              <button
                type="button"
                class="ghost-btn"
                (click)="dismiss.emit(appointment.id)"
              >
                Ignora
              </button>
            </div>

            <div
              *ngIf="linkOpenFor === appointment.id"
              class="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-black/5 p-3"
            >
              <select
                class="min-w-[14rem] flex-1 rounded-xl border border-[var(--line)] bg-white/90 px-3 py-2 text-sm"
                [(ngModel)]="selectedSaleId"
                [ngModelOptions]="{ standalone: true }"
              >
                <option value="">Seleziona un ordine senza appuntamento</option>
                <option *ngFor="let sale of unlinkedSales" [value]="sale.id">
                  {{ saleLabel(sale) }}
                </option>
              </select>
              <button
                type="button"
                class="primary-btn"
                [disabled]="!selectedSaleId || loading"
                (click)="linkOrder.emit({ appointment, saleId: selectedSaleId })"
              >
                Collega
              </button>
            </div>
          </article>

          <p
            *ngIf="!appointments.length"
            class="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]"
          >
            Nessun appuntamento in attesa di ordine.
          </p>
        </div>
      </article>
    </div>
  `,
})
export class PendingOrdersModalComponent {
  @Input() appointments: any[] = [];
  @Input() unlinkedSales: any[] = [];
  @Input() loading = false;

  @Output() close = new EventEmitter<void>();
  @Output() confirmOrder = new EventEmitter<any>();
  @Output() linkOrder = new EventEmitter<{ appointment: any; saleId: string }>();
  @Output() dismiss = new EventEmitter<string>();

  linkOpenFor = "";
  selectedSaleId = "";

  toggleLink(appointmentId: string): void {
    this.linkOpenFor = this.linkOpenFor === appointmentId ? "" : appointmentId;
    this.selectedSaleId = "";
  }

  saleLabel(sale: any): string {
    const customer = sale.customer
      ? `${sale.customer.firstName} ${sale.customer.lastName}`.trim()
      : "Vendita senza cliente";
    return `${customer} · EUR ${Number(sale.total || 0).toFixed(2)}`;
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
}
