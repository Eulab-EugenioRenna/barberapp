import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { firstValueFrom } from "rxjs";
import { AdminApiService } from "./core/admin-api.service";

export type QuickCreateKind = "customer" | "service" | "product";

@Component({
  selector: "barber-quick-create-dialog",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="quick-create-overlay" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId">
      <button type="button" class="quick-create-backdrop" aria-label="Chiudi" [disabled]="saving" (click)="cancel.emit()"></button>
      <form class="quick-create-dialog" (ngSubmit)="save()">
        <p class="eyebrow text-[var(--accent)]">Creazione rapida</p>
        <h2 [id]="titleId" class="font-display text-3xl">{{ title }}</h2>
        <p class="mt-2 text-sm text-[var(--muted)]">I dettagli completi restano modificabili dalla relativa scheda.</p>
        <label class="field mt-5">
          <span
            >{{ kind === "customer" ? "Nome cliente" : "Nome" }}
            <em class="required-mark" aria-hidden="true">*</em></span
          >
          <input [(ngModel)]="name" name="quickCreateName" required autofocus [placeholder]="placeholder" />
        </label>
        <label *ngIf="kind !== 'customer'" class="field mt-4">
          <span>Prezzo <em class="required-mark" aria-hidden="true">*</em></span>
          <input [(ngModel)]="price" name="quickCreatePrice" type="number" min="0" step="0.01" inputmode="decimal" required placeholder="0,00" />
        </label>
        <p *ngIf="error" class="mt-3 text-sm font-semibold text-red-700">{{ error }}</p>
        <div class="mt-6 flex flex-wrap gap-3">
          <button type="button" class="pill-btn" [disabled]="saving" (click)="cancel.emit()">Annulla</button>
          <button type="submit" class="primary-btn" [disabled]="saving || !name.trim() || (kind !== 'customer' && price === '')">{{ saving ? "Salvataggio..." : "Salva e seleziona" }}</button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .quick-create-overlay { position: fixed; z-index: 1300; inset: 0; display: grid; place-items: center; padding: 1rem; }
    .quick-create-backdrop { position: absolute; inset: 0; border: 0; background: rgba(15, 23, 32, .42); backdrop-filter: blur(3px); }
    .quick-create-dialog { position: relative; width: min(100%, 28rem); border: .0625rem solid var(--line); border-radius: 1.75rem; background: #fffdf9; padding: 1.5rem; box-shadow: 0 1.5rem 4rem rgba(15,23,32,.22); }
  `],
})
export class QuickCreateDialogComponent {
  private readonly adminApi = inject(AdminApiService);
  @Input({ required: true }) kind: QuickCreateKind = "customer";
  @Output() cancel = new EventEmitter<void>();
  @Output() created = new EventEmitter<{ kind: QuickCreateKind; entity: any }>();
  name = "";
  price: number | "" = "";
  saving = false;
  error = "";
  readonly titleId = `quick-create-${Math.random().toString(36).slice(2)}`;
  get title(): string { return `Nuovo ${this.kind === "customer" ? "cliente" : this.kind === "service" ? "servizio" : "prodotto"}`; }
  get placeholder(): string { return this.kind === "customer" ? "Es. Mario Rossi" : this.kind === "service" ? "Es. Taglio classico" : "Es. Shampoo"; }
  async save(): Promise<void> {
    if (!this.name.trim() || (this.kind !== "customer" && this.price === "")) return;
    this.saving = true; this.error = "";
    try {
      const name = this.name.trim();
      let entity: any;
      if (this.kind === "customer") {
        const [firstName, ...lastName] = name.split(/\s+/);
        entity = await firstValueFrom(this.adminApi.createOrUpdateCustomer("", { firstName, lastName: lastName.join(" ") }));
      } else if (this.kind === "service") {
        entity = await firstValueFrom(this.adminApi.createOrUpdateService("", { name, basePrice: Number(this.price), durationMinutes: 30, requiresCollaborator: true, isPublic: false, isBookableOnline: false }));
      } else {
        entity = await firstValueFrom(this.adminApi.createOrUpdateProduct("", { name, price: Number(this.price) }));
      }
      this.created.emit({ kind: this.kind, entity });
    } catch (error: any) {
      this.error = error?.error?.message || "Salvataggio non riuscito. Riprova.";
    } finally { this.saving = false; }
  }
}
