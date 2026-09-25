import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { InfiniteScrollDirective } from "../shared/infinite-scroll.directive";
import { AutofocusFirstDirective } from "../shared/autofocus-first.directive";
import { UiIconComponent } from "../shared/ui-icon.component";
import { appointmentStatusLabel, paymentMethodLabel, paymentStatusLabel } from "../shared/presentation-copy";

@Component({
  selector: "barber-admin-customers-page",
  standalone: true,
  imports: [CommonModule, FormsModule, InfiniteScrollDirective, AutofocusFirstDirective, UiIconComponent],
  template: `
    <section class="grid gap-4">
      <article class="panel rounded-[2rem] p-4 sm:p-5">
        <div class="page-head">
          <div class="min-w-0">
            <p class="eyebrow text-[var(--accent)]">Relazioni</p>
            <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 class="font-display text-2xl sm:text-3xl">Clienti</h3>
              <span class="status-pill status-pill-neutral"
                >{{ customers.length }} contatti</span
              >
            </div>
          </div>
          <button type="button" class="primary-btn" (click)="openNew()">
            <barber-ui-icon name="plus"></barber-ui-icon> Nuovo cliente
          </button>
        </div>
        <label class="field mt-4">
          <span>Cerca cliente</span>
          <input
            [(ngModel)]="customerQuery"
            (ngModelChange)="searchChange.emit($event)"
            name="customerSearch"
            type="search"
            autocomplete="off"
            placeholder="Nome, email o telefono"
          />
        </label>
        <div class="mt-4 grid gap-2.5 sm:gap-3">
          <button
            *ngFor="let customer of customers; trackBy: trackById"
            type="button"
            class="list-card text-left"
            (click)="openEdit(customer)"
          >
            <div>
              <strong>{{ customer.firstName }} {{ customer.lastName }}</strong>
              <p class="mt-1 text-sm text-[var(--muted)]">
                {{ customer.email || "Email non inserita" }}
              </p>
              <p class="text-sm text-[var(--muted)]">
                {{ customer.phone || "Telefono non inserito" }}
              </p>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <span
                *ngFor="let tag of customer.autoTags || []"
                class="status-pill status-pill-blue"
                >{{ tag }}</span
              >
              <span
                *ngFor="let tag of customer.tags"
                class="status-pill status-pill-neutral"
                >{{ tag }}</span
              >
            </div>
          </button>
          <article
            *ngIf="!customers.length && !loading"
            class="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]"
          >
            Nessun cliente trovato. Usa “+ Nuovo cliente” per creare il primo
            contatto.
          </article>
          <p
            *ngIf="hasMore"
            class="text-center text-xs uppercase tracking-wider text-[var(--muted)]"
          >
            Scorri per caricare altri clienti
          </p>
          <div
            *ngIf="hasMore"
            class="h-px w-full"
            barberInfiniteScroll
            (loadMore)="loadMore.emit()"
          ></div>
        </div>
      </article>
    </section>

    <div *ngIf="formOpen" class="confirm-overlay">
      <button
        type="button"
        class="confirm-backdrop"
        (click)="formOpen = false"
        aria-label="Chiudi modulo cliente"
      ></button>
      <article
        barberAutofocusFirst
        class="confirm-dialog panel max-h-[85vh] overflow-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-form-title"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="eyebrow text-[var(--accent)]">Cliente</p>
            <h2
              id="customer-form-title"
              class="mt-2 font-display text-2xl sm:text-3xl"
            >
              {{ customerForm.id ? "Modifica cliente" : "Nuovo cliente" }}
            </h2>
          </div>
          <button
            type="button"
            class="pill-btn"
            (click)="formOpen = false"
          >
            Chiudi
          </button>
        </div>

        <form class="mt-4 grid gap-4" (ngSubmit)="submit()">
          <div class="grid gap-3 sm:gap-4 md:grid-cols-2">
            <label class="field">
              <span
                >Nome <em class="required-mark" aria-hidden="true">*</em></span
              >
              <input
                [(ngModel)]="customerForm.firstName"
                name="customerFirstName"
                autocomplete="given-name"
                required
              />
            </label>
            <label class="field">
              <span
                >Cognome
                <em class="required-mark" aria-hidden="true">*</em></span
              >
              <input
                [(ngModel)]="customerForm.lastName"
                name="customerLastName"
                autocomplete="family-name"
                required
              />
            </label>
          </div>
          <div class="grid gap-3 sm:gap-4 md:grid-cols-2">
            <label class="field">
              <span>Email</span>
              <input
                [(ngModel)]="customerForm.email"
                name="customerEmail"
                type="email"
                autocomplete="email"
              />
            </label>
            <label class="field">
              <span>Telefono</span>
              <input
                [(ngModel)]="customerForm.phone"
                name="customerPhone"
                type="tel"
                autocomplete="tel"
              />
            </label>
          </div>
          <label class="field">
            <span>Tag manuali</span>
            <input
              [(ngModel)]="customerForm.tagsText"
              name="customerTagsText"
              placeholder="vip, richiamo, preferenze"
            />
          </label>
          <label class="field">
            <span>Note</span>
            <textarea
              [(ngModel)]="customerForm.notes"
              name="customerNotes"
              rows="4"
            ></textarea>
          </label>
          <div class="flex flex-wrap gap-3">
            <button
              type="submit"
              class="primary-btn"
              [disabled]="loading || !formValid"
            >
              <barber-ui-icon name="save"></barber-ui-icon>
              {{ customerForm.id ? "Salva cliente" : "Crea cliente" }}
            </button>
            <button
              *ngIf="customerForm.id"
              type="button"
              class="pill-btn"
              [disabled]="loading"
              (click)="removeCustomer()"
            >
              <barber-ui-icon name="trash"></barber-ui-icon> Elimina cliente
            </button>
            <button
              type="button"
              class="secondary-btn"
              [disabled]="loading"
              (click)="openNew()"
            >
              <barber-ui-icon name="plus"></barber-ui-icon> Nuovo cliente
            </button>
          </div>
        </form>

        <section
          *ngIf="customerForm.id"
          class="mt-6 border-t border-[var(--line)] pt-5"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="eyebrow text-[var(--muted)]">Percorso cliente</p>
              <h4 class="font-display text-2xl">Appuntamenti e acquisti</h4>
            </div>
            <strong *ngIf="customerHistory"
              >€{{ customerHistory.salesTotal | number: "1.2-2" }}</strong
            >
          </div>
          <p *ngIf="historyLoading" class="mt-4 text-sm text-[var(--muted)]">
            Caricamento storico...
          </p>
          <div
            *ngIf="!historyLoading"
            class="mt-4 grid max-h-[28rem] gap-3 overflow-auto pr-1"
          >
            <button
              *ngFor="let entry of historyTimeline; trackBy: trackByDate"
              type="button"
              class="list-card text-left"
              (click)="openTimelineEntry(entry)"
            >
              <div>
                <strong>{{ formatDay(entry.date) }}</strong>
                <p class="mt-1 text-sm text-[var(--muted)]">
                  <span *ngIf="entry.appointments.length"
                    >{{ entry.appointments.length }} appuntamenti</span
                  >
                  <span
                    *ngIf="entry.appointments.length && entry.sales.length"
                    > · </span
                  >
                  <span *ngIf="entry.sales.length"
                    >{{ entry.sales.length }} vendite</span
                  >
                </p>
              </div>
              <div class="text-right">
                <strong *ngIf="entry.sales.length"
                  >€{{ entry.salesTotal | number: "1.2-2" }}</strong
                >
              <p class="text-xs text-[var(--muted)]">Vedi la giornata</p>
              </div>
            </button>
            <p
              *ngIf="!historyTimeline.length"
              class="text-sm text-[var(--muted)]"
            >
              Nessuna attività registrata.
            </p>
          </div>
        </section>
      </article>
    </div>

    <div *ngIf="timelineEntry" class="confirm-overlay">
      <button
        type="button"
        class="confirm-backdrop"
        (click)="closeTimelineEntry()"
        aria-label="Chiudi dettaglio storico"
      ></button>
      <article
        class="confirm-dialog panel max-h-[85vh] overflow-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-modal-title"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="eyebrow text-[var(--accent)]">Storico cliente</p>
            <h2
              id="history-modal-title"
              class="mt-2 font-display text-2xl sm:text-3xl"
            >
              {{ formatDay(timelineEntry.date) }}
            </h2>
          </div>
          <button
            type="button"
            class="pill-btn"
            (click)="closeTimelineEntry()"
          >
            Chiudi
          </button>
        </div>

        <section *ngIf="timelineEntry.appointments.length" class="mt-6">
          <h3 class="font-display text-xl">Prenotazioni</h3>
          <article
            *ngFor="let appointment of timelineEntry.appointments"
            class="mt-3 rounded-2xl border border-[var(--line)] p-4"
          >
            <div class="flex items-center justify-between gap-3">
              <strong>{{ appointment.service?.name || "Servizio" }}</strong>
              <span class="status-pill status-pill-neutral">{{
                formatAppointmentStatus(appointment.status)
              }}</span>
            </div>
            <p class="mt-1 text-sm text-[var(--muted)]">
              {{ formatDateTime(appointment.startsAt) }}
              <span *ngIf="appointment.endsAt">
                - {{ formatTime(appointment.endsAt) }}</span
              >
              ·
              {{ appointment.collaborator?.firstName || "Non assegnato" }}
            </p>
            <p
              *ngIf="appointment.customerNotes"
              class="mt-2 text-sm text-[var(--muted)]"
            >
              Note: {{ appointment.customerNotes }}
            </p>
          </article>
        </section>

        <section *ngIf="timelineEntry.sales.length" class="mt-6">
          <h3 class="font-display text-xl">Vendite</h3>
          <article
            *ngFor="let sale of timelineEntry.sales"
            class="mt-3 rounded-2xl border border-[var(--line)] p-4"
          >
            <div class="flex items-center justify-between gap-3">
              <strong>€{{ sale.total | number: "1.2-2" }}</strong>
              <span class="status-pill status-pill-neutral">{{
                formatPaymentStatus(sale.paymentStatus)
              }}</span>
            </div>
            <p class="mt-1 text-sm text-[var(--muted)]">
              {{ formatDateTime(sale.soldAt) }} ·
              {{ formatPaymentMethod(sale.paymentMethod) }}
            </p>
            <ul class="mt-2 grid gap-1 text-sm text-[var(--muted)]">
              <li *ngFor="let item of sale.items">
                {{ item.quantity }} ×
                {{ item.service?.name || item.product?.name || item.label }}
                <span>€{{ item.lineTotal | number: "1.2-2" }}</span>
              </li>
            </ul>
          </article>
        </section>
      </article>
    </div>
  `,
})
export class AdminCustomersPageComponent {
  formatAppointmentStatus = appointmentStatusLabel;
  formatPaymentMethod = paymentMethodLabel;
  formatPaymentStatus = paymentStatusLabel;
  @Input() customers: any[] = [];
  @Input() customerForm: any = {};
  @Input() loading = false;
  @Input() hasMore = false;
  @Input() historyLoading = false;
  @Input() customerHistory: any = null;

  @Output() edit = new EventEmitter<any>();
  @Output() save = new EventEmitter<void>();
  @Output() remove = new EventEmitter<any>();
  @Output() reset = new EventEmitter<void>();
  @Output() loadMore = new EventEmitter<void>();
  @Output() searchChange = new EventEmitter<string>();

  customerQuery = "";
  formOpen = false;
  timelineEntry: any = null;

  get historyTimeline(): any[] {
    return Array.isArray(this.customerHistory?.timeline)
      ? this.customerHistory.timeline
      : [];
  }

  openEdit(customer: any): void {
    this.edit.emit(customer);
    this.formOpen = true;
  }

  openNew(): void {
    this.reset.emit();
    this.formOpen = true;
  }

  submit(): void {
    this.save.emit();
    this.formOpen = false;
  }

  removeCustomer(): void {
    this.formOpen = false;
    this.remove.emit(this.customerForm);
  }

  openTimelineEntry(entry: any): void {
    this.timelineEntry = entry;
  }

  closeTimelineEntry(): void {
    this.timelineEntry = null;
  }

  trackById(_index: number, item: any): string {
    return item.id;
  }

  trackByDate(_index: number, entry: any): string {
    return entry.date;
  }

  get formValid(): boolean {
    return Boolean(
      customerText(this.customerForm.firstName) &&
      customerText(this.customerForm.lastName),
    );
  }

  formatDay(value: string): string {
    return new Date(`${value}T00:00:00`).toLocaleDateString("it-IT", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  }

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString("it-IT", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }

  formatTime(value: string): string {
    return new Date(value).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  saleItemLabels(sale: any): string {
    return (sale.items || [])
      .map(
        (item: any) => item.service?.name || item.product?.name || item.label,
      )
      .join(" · ");
  }
}

function customerText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
