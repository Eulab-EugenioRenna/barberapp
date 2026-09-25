import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { UiIconComponent } from "../shared/ui-icon.component";
import { appointmentStatusLabel } from "../shared/presentation-copy";

@Component({
  selector: "barber-pending-orders-queue",
  standalone: true,
  imports: [CommonModule, FormsModule, UiIconComponent],
  template: `
    <section class="grid gap-4">
      <article class="panel rounded-[2rem] p-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p class="eyebrow text-[var(--accent)]">Fine servizio</p>
            <h3 class="font-display text-3xl">Conti da chiudere</h3>
            <p class="mt-1 text-sm text-[var(--muted)]">
              Qui trovi gli appuntamenti conclusi che non hanno ancora una
              vendita registrata.
            </p>
          </div>
          <span class="status-pill status-pill-amber"
            >{{ appointments.length }} in attesa</span
          >
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
                  {{ formatAppointmentStatus(appointment.status) }}
                </p>
              </div>
              <span class="status-pill status-pill-amber">Conto da chiudere</span>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="primary-btn"
                [disabled]="loading"
                (click)="confirmOrder.emit(appointment)"
              >
                <barber-ui-icon name="receipt"></barber-ui-icon> Registra vendita
              </button>
              <button
                type="button"
                class="secondary-btn"
                *ngIf="unlinkedSales.length"
                (click)="toggleLink(appointment.id)"
              >
                <barber-ui-icon name="link"></barber-ui-icon>
                {{
                  linkOpenFor === appointment.id
                    ? "Chiudi collegamento"
                    : "Collega vendita"
                }}
              </button>
              <button
                type="button"
                class="ghost-btn text-red-700"
                [disabled]="loading"
                (click)="cancelAppointment.emit(appointment)"
              >
                <barber-ui-icon name="ban"></barber-ui-icon> Annulla appuntamento
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
                <option value="">Seleziona una vendita senza appuntamento</option>
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
            class="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]"
          >
            Tutti i conti sono chiusi.
          </p>
        </div>
      </article>
    </section>
  `,
})
export class PendingOrdersQueueComponent {
  formatAppointmentStatus = appointmentStatusLabel;
  @Input() appointments: any[] = [];
  @Input() unlinkedSales: any[] = [];
  @Input() loading = false;

  @Output() confirmOrder = new EventEmitter<any>();
  @Output() linkOrder = new EventEmitter<{ appointment: any; saleId: string }>();
  @Output() cancelAppointment = new EventEmitter<any>();

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
