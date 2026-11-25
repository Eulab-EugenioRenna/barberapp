import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { HttpErrorResponse } from "@angular/common/http";
import type { WhatsAppAudienceView, WhatsAppBroadcastView, WhatsAppConnection, WhatsAppImageInput } from "@barber/shared/whatsapp";
import { prepareWhatsAppImage } from "./whatsapp-image";
import { WhatsAppApiService } from "../core/whatsapp-api.service";

export interface WhatsAppRecipient {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
}

/**
 * WhatsApp message from the signed-in account's own linked number.
 * With a customer: one message to that customer. Without: the same text to
 * every active customer with a valid phone (consent is handled outside ALORA).
 */
@Component({
  selector: "alora-whatsapp-send-dialog",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="confirm-overlay wa-send-overlay">
      <button type="button" class="confirm-backdrop" aria-label="Chiudi" (click)="close()"></button>
      <article class="confirm-dialog panel wa-send" role="dialog" aria-modal="true" aria-labelledby="wa-send-title">
        <p class="eyebrow text-[var(--accent)]">WhatsApp</p>
        <h2 id="wa-send-title" class="font-display text-2xl">
          {{ customer ? "Messaggio a " + customerName : "Messaggio a tutti i clienti" }}
        </h2>

        <p *ngIf="loading" class="mt-3 text-sm text-[var(--muted)]">Verifico il collegamento…</p>
        <ng-container *ngIf="!loading">
          <p *ngIf="connectionChecked && !connection" class="wa-send-note">
            Il tuo numero WhatsApp non è collegato. Collegalo da «Messaggi WhatsApp», poi torna qui.
          </p>
          <p *ngIf="customer && !customer.phone" class="wa-send-note">
            Il cliente non ha un numero di telefono: aggiungilo nella scheda per scrivergli.
          </p>
          <p *ngIf="!customer && audience" class="mt-3 text-sm text-[var(--muted)]">
            Riceveranno il messaggio <strong>{{ audience.eligible }}</strong> clienti con telefono
            su {{ audience.customers }} clienti attivi.
            <ng-container *ngIf="audience.withPhone > audience.eligible">
              {{ audience.withPhone - audience.eligible }} numeri ripetuti su più schede ricevono un solo messaggio.
            </ng-container>
          </p>
          <ul *ngIf="!customer && audience && (audience.prefixAdded || audience.landline || audience.invalid)" class="wa-send-checks">
            <li *ngIf="audience.prefixAdded">
              {{ audience.prefixAdded }} numeri salvati senza prefisso: li tratto come italiani (+39).
            </li>
            <li *ngIf="audience.landline">
              {{ audience.landline }} sono numeri fissi: spesso non hanno WhatsApp e l’invio può non riuscire.
            </li>
            <li *ngIf="audience.invalid" class="wa-send-invalid">
              {{ audience.invalid }} numeri non sono leggibili e restano esclusi: senza prefisso valgono solo i numeri italiani.
              Correggili nella scheda cliente<ng-container *ngIf="audience.invalidCustomers.length">:
                <span *ngFor="let row of audience.invalidCustomers; let last = last">{{ row.name }} ({{ row.phone }}){{ last ? (audience.invalid > audience.invalidCustomers.length ? "…" : ".") : ", " }}</span>
              </ng-container>
            </li>
          </ul>

          <section *ngIf="job" class="wa-job" role="status" aria-live="polite">
            <p class="wa-job-title">{{ jobTitle }}</p>
            <div class="wa-job-bar" aria-hidden="true"><span [style.width.%]="jobPercent"></span></div>
            <p class="text-sm">
              Inviati <strong>{{ job.sent }}</strong> su {{ job.total }}<ng-container *ngIf="job.failed"> · {{ job.failed }} non riusciti</ng-container><ng-container *ngIf="job.skipped"> · {{ job.skipped }} saltati (numero ripetuto, non leggibile o già raggiunto con lo stesso testo)</ng-container>.
            </p>
            <p *ngIf="job.error" class="wa-send-note">{{ job.error }}</p>
            <p *ngIf="job.status === 'running'" class="text-xs text-[var(--muted)]">
              Parte a gruppi di 30 con una pausa tra un gruppo e l’altro, per non far bloccare il numero. Puoi chiudere questa finestra: l’invio continua.
            </p>
            <div class="flex flex-wrap justify-end gap-2">
              <button *ngIf="job.status === 'running' || job.status === 'paused'" type="button" class="pill-btn" [disabled]="sending" (click)="cancelJob()">Annulla l’invio</button>
              <button *ngIf="job.status === 'paused'" type="button" class="primary-btn" [disabled]="sending" (click)="resumeJob()">Riprendi</button>
              <button *ngIf="job.status === 'done' || job.status === 'cancelled'" type="button" class="pill-btn" (click)="newMessage()">Nuovo messaggio</button>
              <button type="button" class="pill-btn" (click)="close()">Chiudi</button>
            </div>
          </section>

          <form *ngIf="canWrite && !job" class="mt-4 grid gap-3" (ngSubmit)="send()">
            <fieldset class="grid gap-3" [disabled]="sending || !!result">
              <label class="field">
                <span>{{ image ? "Didascalia (facoltativa)" : "Messaggio" }}</span>
                <textarea name="text" rows="5" [attr.maxlength]="image ? 2000 : 16000" [(ngModel)]="text" (ngModelChange)="draftChanged()"></textarea>
              </label>
              <div *ngIf="image; else addImage" class="wa-send-image">
                <img [src]="image.data" alt="Foto da inviare" />
                <button type="button" class="pill-btn" (click)="image = null; draftChanged()">Togli foto</button>
              </div>
              <ng-template #addImage>
                <label class="wa-send-attach"><input type="file" accept="image/*" (change)="pickImage($event)" />📎 Allega una foto</label>
              </ng-template>
              <label class="flex items-start gap-2 text-sm">
                <input type="checkbox" name="consent" [(ngModel)]="authorized" />
                <span>{{ customer
                  ? "Ho verificato che il cliente ha acconsentito a ricevere questo messaggio."
                  : "Confermo l’invio a tutti i clienti con telefono." }}</span>
              </label>
            </fieldset>
            <p *ngIf="result" role="status" class="wa-send-ok">{{ result }}</p>
            <p *ngIf="error" role="alert" class="wa-send-note">{{ error }}</p>
            <div class="flex flex-wrap justify-end gap-2">
              <button type="button" class="pill-btn" (click)="close()">{{ result ? "Chiudi" : "Annulla" }}</button>
              <button *ngIf="!result" class="primary-btn" [disabled]="sending || !authorized || (!text.trim() && !image)">
                {{ sending ? "Invio…" : customer ? "Invia" : "Invia a " + (audience?.eligible ?? 0) + " clienti" }}
              </button>
            </div>
          </form>
          <div *ngIf="!canWrite" class="mt-4 flex justify-end">
            <button type="button" class="pill-btn" (click)="close()">Chiudi</button>
          </div>
        </ng-container>
      </article>
    </div>
  `,
  styles: [
    `
      .wa-send-overlay { z-index: 90; }
      .wa-send { width: min(32rem, 100%); }
      .wa-send-note {
        margin-top: 0.75rem;
        border-radius: 1rem;
        background: var(--surface);
        padding: 0.75rem 1rem;
        font-size: 0.875rem;
      }
      .wa-send-ok { font-size: 0.875rem; font-weight: 600; color: var(--accent); }
      .wa-send-checks { margin-top: 0.5rem; display: grid; gap: 0.35rem; padding-left: 1.1rem; list-style: disc; font-size: 0.8rem; color: var(--muted); }
      .wa-send-invalid { color: var(--ink); }
      .wa-job { margin-top: 1rem; display: grid; gap: 0.6rem; }
      .wa-job-title { font-weight: 650; }
      .wa-job-bar { height: 0.5rem; border-radius: 999px; background: var(--line); overflow: hidden; }
      .wa-job-bar span { display: block; height: 100%; background: var(--accent); transition: width 0.4s; }
      textarea { resize: vertical; }
      .wa-send-image { display: flex; align-items: center; gap: 0.75rem; }
      .wa-send-image img { width: 5rem; height: 5rem; object-fit: cover; border-radius: 0.75rem; }
      .wa-send-attach { position: relative; justify-self: start; display: inline-flex; align-items: center; gap: 0.4rem; border: 1px solid var(--line); border-radius: 999px; padding: 0.5rem 1rem; font-size: 0.9rem; cursor: pointer; }
      .wa-send-attach input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    `,
  ],
})
export class WhatsAppSendDialogComponent implements OnInit, OnDestroy {
  private readonly api = inject(WhatsAppApiService);
  /** Recipient; null sends to every active customer with a phone. */
  @Input() customer: WhatsAppRecipient | null = null;
  @Output() closed = new EventEmitter<void>();

  loading = true;
  sending = false;
  connection: WhatsAppConnection | null = null;
  audience: WhatsAppAudienceView | null = null;
  text = "";
  image: WhatsAppImageInput | null = null;
  authorized = false;
  result = "";
  error = "";
  connectionChecked = false;
  /** Background «Messaggio a tutti» of this account, while it runs or just finished. */
  job: WhatsAppBroadcastView | null = null;
  private poll?: ReturnType<typeof setTimeout>;
  /** Kept across retries of the same text, so nobody is messaged twice. */
  private broadcastKey = newKey();

  get customerName(): string {
    return [this.customer?.firstName, this.customer?.lastName].filter(Boolean).join(" ") || "cliente";
  }
  get canWrite(): boolean {
    if (!this.connection) return false;
    return this.customer ? !!this.customer.phone : (this.audience?.eligible ?? 0) > 0;
  }

  async ngOnInit() {
    // Two independent reads: a failure counting recipients must not look like
    // a disconnected number.
    const [sessions, audience] = await Promise.allSettled([
      this.api.sessions(),
      this.customer ? Promise.resolve(null) : this.api.audience(),
    ]);
    if (sessions.status === "fulfilled") {
      this.connection = sessions.value.find((s) => !s.closedAt && s.state === "connected" && s.runnerOnline) ?? null;
      this.connectionChecked = true;
    } else this.error = message(sessions.reason);
    if (audience.status === "fulfilled") this.audience = audience.value;
    else this.error = "Non riesco a contare i destinatari: " + message(audience.reason);
    if (!this.customer) {
      const latest = await this.api.latestBroadcast().catch(() => null);
      if (latest && (latest.status === "running" || latest.status === "paused")) this.track(latest);
    }
    this.loading = false;
  }

  ngOnDestroy() {
    if (this.poll) clearTimeout(this.poll);
  }

  get jobPercent(): number {
    if (!this.job?.total) return 0;
    return Math.round(((this.job.sent + this.job.failed) / this.job.total) * 100);
  }
  get jobTitle(): string {
    switch (this.job?.status) {
      case "running": return "Invio in corso";
      case "paused": return "Invio in pausa";
      case "cancelled": return "Invio annullato";
      default: return "Invio completato";
    }
  }
  private track(job: WhatsAppBroadcastView) {
    this.job = job;
    if (this.poll) clearTimeout(this.poll);
    if (job.status !== "running") return;
    this.poll = setTimeout(async () => {
      try { this.track(await this.api.broadcastStatus(job.id)); }
      catch { this.track(job); }
    }, 3000);
  }
  async cancelJob() {
    if (!this.job) return;
    this.sending = true;
    try { this.track(await this.api.cancelBroadcast(this.job.id)); }
    catch (error) { this.error = message(error); }
    finally { this.sending = false; }
  }
  async resumeJob() {
    if (!this.job) return;
    this.sending = true;
    try { this.track(await this.api.resumeBroadcast(this.job.id)); }
    catch (error) { this.error = message(error); }
    finally { this.sending = false; }
  }
  newMessage() {
    this.job = null;
    this.text = "";
    this.image = null;
    this.authorized = false;
    this.result = "";
    this.error = "";
    this.draftChanged();
  }

  draftChanged() {
    this.broadcastKey = newKey();
  }

  async pickImage(event: Event) {
    const input = event.target as HTMLInputElement, file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try { this.image = await prepareWhatsAppImage(file); this.error = ""; this.draftChanged(); }
    catch (error) { this.error = message(error); }
  }

  async send() {
    if (!this.connection || this.sending || !this.authorized || (!this.text.trim() && !this.image)) return;
    this.sending = true;
    this.error = "";
    try {
      if (this.customer) {
        await this.api.send(this.connection.id, {
          customerId: this.customer.id, text: this.text, ...(this.image ? { image: this.image } : {}), recipientAuthorized: true,
        });
        this.result = "Messaggio affidato a WhatsApp. L’esito è in «Messaggi WhatsApp» › Invii.";
      } else {
        this.track(await this.api.broadcast(this.connection.id, {
          text: this.text,
          ...(this.image ? { image: this.image } : {}),
          idempotencyKey: this.broadcastKey,
          recipientAuthorized: true,
        }));
      }
    } catch (error) {
      this.error = message(error);
    } finally {
      this.sending = false;
    }
  }

  close() {
    this.closed.emit();
  }
}

function newKey(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
function message(error: unknown): string {
  if (error instanceof HttpErrorResponse) return error.error?.message || "Invio non riuscito. Riprova.";
  return error instanceof Error ? error.message : "Invio non riuscito. Riprova.";
}
