import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";

@Component({
  selector: "barber-admin-customers-page",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="grid gap-4 xl:grid-cols-2">
      <article class="panel rounded-[2rem] p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="eyebrow text-[var(--accent)]">CRM</p>
            <h3 class="font-display text-3xl">Clienti</h3>
          </div>
          <span class="status-pill status-pill-neutral"
            >{{ customers.length }} contatti</span
          >
        </div>
        <label class="field mt-5">
          <span>Cerca cliente</span>
          <input
            [(ngModel)]="customerQuery"
            (ngModelChange)="customerLimit = 100"
            name="customerSearch"
            type="search"
            autocomplete="off"
            placeholder="Nome, email o telefono"
          />
        </label>
        <div class="mt-5 grid gap-3">
          <button
            *ngFor="let customer of visibleCustomers; trackBy: trackById"
            type="button"
            class="list-card text-left"
            (click)="edit.emit(customer)"
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
            *ngIf="!customers.length"
            class="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]"
          >
            Nessun cliente. Usa “Nuovo cliente” per creare il primo contatto.
          </article>
          <article
            *ngIf="customers.length && !filteredCustomers.length"
            class="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)]"
          >
            Nessun cliente corrisponde alla ricerca.
          </article>
          <button
            *ngIf="visibleCustomers.length < filteredCustomers.length"
            type="button"
            class="secondary-btn justify-self-start"
            (click)="customerLimit = customerLimit + 100"
          >
            Mostra altri clienti
          </button>
        </div>
      </article>

      <article class="dark-panel rounded-[2rem] p-5 text-white">
        <p class="eyebrow text-white/45">CRUD clienti</p>
        <h3 class="font-display text-3xl">
          {{ customerForm.id ? "Modifica cliente" : "Nuovo cliente" }}
        </h3>
        <form class="mt-5 grid gap-4" (ngSubmit)="save.emit()">
          <div class="grid gap-4 md:grid-cols-2">
            <label class="field">
              <span>Nome</span>
              <input
                [(ngModel)]="customerForm.firstName"
                name="customerFirstName"
                autocomplete="given-name"
                required
              />
            </label>
            <label class="field">
              <span>Cognome</span>
              <input
                [(ngModel)]="customerForm.lastName"
                name="customerLastName"
                autocomplete="family-name"
                required
              />
            </label>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
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
              {{ customerForm.id ? "Salva cliente" : "Crea cliente" }}
            </button>
            <button
              *ngIf="customerForm.id"
              type="button"
              class="pill-btn"
              (click)="remove.emit(customerForm)"
            >
              Elimina cliente
            </button>
            <button type="button" class="secondary-btn" (click)="reset.emit()">
              Nuovo cliente
            </button>
          </div>
        </form>

        <section
          *ngIf="customerForm.id"
          class="mt-6 border-t border-white/10 pt-5"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="eyebrow text-white/45">Timeline</p>
              <h4 class="font-display text-2xl">Storico cliente</h4>
            </div>
            <strong *ngIf="customerHistory"
              >€{{ customerHistory.salesTotal | number: "1.2-2" }}</strong
            >
          </div>
          <p *ngIf="historyLoading" class="mt-4 text-sm text-white/60">
            Caricamento storico...
          </p>
          <div
            *ngIf="!historyLoading"
            class="mt-4 grid max-h-[28rem] gap-3 overflow-auto pr-1"
          >
            <article
              *ngFor="let appointment of customerHistory?.appointments"
              class="rounded-2xl border border-white/10 p-4"
            >
              <span class="text-xs uppercase tracking-wider text-white/45"
                >Prenotazione · {{ appointment.status }}</span
              >
              <strong class="mt-1 block">{{
                appointment.service?.name
              }}</strong>
              <p class="text-sm text-white/65">
                {{ formatDateTime(appointment.startsAt) }} ·
                {{ appointment.collaborator?.firstName || "Non assegnato" }}
              </p>
            </article>
            <article
              *ngFor="let sale of customerHistory?.sales"
              class="rounded-2xl border border-white/10 p-4"
            >
              <span class="text-xs uppercase tracking-wider text-white/45"
                >Ordine · {{ sale.paymentStatus }}</span
              >
              <strong class="mt-1 block"
                >€{{ sale.total | number: "1.2-2" }}</strong
              >
              <p class="text-sm text-white/65">
                {{ formatDateTime(sale.soldAt) }} ·
                {{ sale.items?.length || 0 }} righe
              </p>
              <p class="mt-1 text-xs text-white/50">
                {{ saleItemLabels(sale) }}
              </p>
            </article>
            <p
              *ngIf="
                !customerHistory?.appointments?.length &&
                !customerHistory?.sales?.length
              "
              class="text-sm text-white/60"
            >
              Nessuna attività registrata.
            </p>
          </div>
        </section>
      </article>
    </section>
  `,
})
export class AdminCustomersPageComponent {
  @Input() customers: any[] = [];
  @Input() customerForm: any = {};
  @Input() loading = false;
  @Input() historyLoading = false;
  @Input() customerHistory: any = null;

  @Output() edit = new EventEmitter<any>();
  @Output() save = new EventEmitter<void>();
  @Output() remove = new EventEmitter<any>();
  @Output() reset = new EventEmitter<void>();

  customerQuery = "";
  customerLimit = 100;

  get filteredCustomers(): any[] {
    const query = this.customerQuery.trim().toLocaleLowerCase("it-IT");
    if (!query) {
      return this.customers;
    }
    return this.customers.filter((customer) =>
      [customer.firstName, customer.lastName, customer.email, customer.phone]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("it-IT")
        .includes(query),
    );
  }

  get visibleCustomers(): any[] {
    return this.filteredCustomers.slice(0, this.customerLimit);
  }

  trackById(_index: number, item: any): string {
    return item.id;
  }

  get formValid(): boolean {
    return Boolean(
      customerText(this.customerForm.firstName) &&
      customerText(this.customerForm.lastName),
    );
  }

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString("it-IT", {
      dateStyle: "short",
      timeStyle: "short",
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
