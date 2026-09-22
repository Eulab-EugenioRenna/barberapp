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
        <div class="mt-5 grid gap-3">
          <button
            *ngFor="let customer of customers"
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
              />
            </label>
            <label class="field">
              <span>Cognome</span>
              <input
                [(ngModel)]="customerForm.lastName"
                name="customerLastName"
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
              />
            </label>
            <label class="field">
              <span>Telefono</span>
              <input [(ngModel)]="customerForm.phone" name="customerPhone" />
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
            <button type="submit" class="primary-btn" [disabled]="loading">
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
              Reset
            </button>
          </div>
        </form>
      </article>
    </section>
  `,
})
export class AdminCustomersPageComponent {
  @Input() customers: any[] = [];
  @Input() customerForm: any = {};
  @Input() loading = false;

  @Output() edit = new EventEmitter<any>();
  @Output() save = new EventEmitter<void>();
  @Output() remove = new EventEmitter<any>();
  @Output() reset = new EventEmitter<void>();
}
