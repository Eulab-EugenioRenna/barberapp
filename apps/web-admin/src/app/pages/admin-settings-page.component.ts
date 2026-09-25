import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CustomSelectComponent } from "../custom-select.component";
import { bookingModeLabel } from "../shared/presentation-copy";

@Component({
  selector: "barber-admin-settings-page",
  standalone: true,
  imports: [CommonModule, FormsModule, CustomSelectComponent],
  template: `
    <section class="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <article class="dark-panel rounded-[2rem] p-5 text-white">
        <p class="eyebrow text-white/45">Vetrina online</p>
        <h3 class="font-display text-3xl">Anteprima per i clienti</h3>
        <p class="mt-3 text-sm text-white/70">
          Guarda come apparirà la pagina di prenotazione del tuo salone.
        </p>
        <div class="public-editor-preview mt-5">
          <aside
            class="public-editor-hero"
            [style.background]="publicPreviewHeroBackground"
          >
            <p class="eyebrow text-white/55">Il tuo momento</p>
            <div class="mt-4 flex flex-wrap items-center gap-3 md:gap-4">
              <img
                *ngIf="logoPreviewUrl || settingsForm.logoUrl"
                [src]="resolveAssetUrl(logoPreviewUrl || settingsForm.logoUrl)"
                alt="Logo del salone"
                class="h-auto w-auto max-h-20 max-w-[16rem] object-contain md:max-h-24 md:max-w-[20rem]"
              />
              <h4 class="font-display text-4xl leading-none">
                {{
                  settingsForm.publicTitle ??
                    settingsForm.name ??
                    tenant?.publicTitle ??
                    tenant?.name ??
                    "Prenota online"
                }}
              </h4>
            </div>
            <p class="mt-4 text-sm text-white/72">
              {{
                settingsForm.publicDescription ||
                  "Scegli il servizio, trova il momento giusto e invia la tua richiesta al salone."
              }}
            </p>

            <div class="mt-6 grid gap-3">
              <article
                *ngFor="let step of publicPreviewSteps; index as index"
                class="rounded-[1.2rem] border border-white/12 bg-white/8 p-4"
              >
                <div class="flex items-center gap-3">
                  <span
                    class="grid size-9 place-items-center rounded-full bg-white text-[#101923] font-bold"
                    >{{ index + 1 }}</span
                  >
                  <div>
                    <strong class="block">{{ step.title }}</strong>
                    <span class="text-sm text-white/64">{{
                      step.caption
                    }}</span>
                  </div>
                </div>
              </article>
            </div>

            <div
              class="mt-6 rounded-[1.4rem] border border-white/10 bg-white/8 p-4 text-sm"
            >
              <p class="text-xs uppercase tracking-[0.28em] text-white/45">
                Pagina del salone
              </p>
              <p class="mt-2">
                Pagina clienti:
                <strong>{{ computedPublicUrl || "non configurata" }}</strong>
              </p>
              <p class="mt-1">
                Prenotazioni:
                <strong>{{ formatBookingMode(settingsForm.bookingMode) }}</strong>
              </p>
            </div>
          </aside>

          <section class="public-editor-panel">
            <div class="public-editor-scroll">
              <div class="flex flex-col gap-2">
                <p class="eyebrow" [style.color]="settingsForm.accentColor">
                  Prenotazione
                </p>
                <h4 class="font-display text-3xl text-[var(--ink)]">
                  Scegli servizio e orario
                </h4>
              </div>

              <div class="mt-5 grid gap-3">
                <article
                  *ngFor="let service of publicPreviewServices"
                  class="public-editor-service"
                  [class.active]="service.highlighted"
                >
                  <div>
                    <strong class="font-display text-xl">{{
                      service.name
                    }}</strong>
                    <p class="mt-1 text-sm text-[var(--muted)]">
                      {{ service.description }}
                    </p>
                  </div>
                  <div class="text-right">
                    <strong>€{{ service.price }}</strong>
                    <p class="text-sm text-[var(--muted)]">
                      {{ service.duration }} min
                    </p>
                  </div>
                </article>
              </div>

              <div class="mt-5 grid gap-4 md:grid-cols-2">
                <div class="field">
                  <span>Professionista</span>
                  <div class="public-editor-field-surface">
                    {{ publicPreviewCollaboratorLabel }}
                  </div>
                </div>
                <div class="field">
                  <span>Orari disponibili</span>
                  <div class="public-editor-field-surface">09:30</div>
                </div>
              </div>

              <div class="mt-5 grid gap-4 md:grid-cols-2">
                <div class="field">
                  <span>Nome e cognome</span>
                  <div class="public-editor-field-surface">Mario Rossi</div>
                </div>
                <div class="field">
                  <span>Email</span>
                  <div class="public-editor-field-surface">
                    mario&#64;email.it
                  </div>
                </div>
              </div>

              <button
                type="button"
                class="public-editor-submit mt-6"
                [style.background]="
                  'linear-gradient(135deg, ' +
                  settingsForm.primaryColor +
                  ', #123b33)'
                "
              >
                Conferma prenotazione
              </button>
            </div>
          </section>
        </div>
      </article>

      <article class="panel rounded-[2rem] p-5">
        <p class="eyebrow text-[var(--accent)]">Identità del salone</p>
        <h3 class="font-display text-3xl">Immagine e prenotazioni</h3>
        <form class="mt-5 grid gap-4" (ngSubmit)="save.emit()">
          <label class="field"
            ><span>Nome del salone o boutique <em class="required-mark" aria-hidden="true">*</em></span
            ><input
              [(ngModel)]="settingsForm.name"
              name="settingsName"
              required
          /></label>
          <label class="field">
            <span>Indirizzo web per le prenotazioni</span>
            <input
              [(ngModel)]="settingsForm.publicDomain"
              name="settingsPublicDomain"
              placeholder="booking.miodominio.it"
            />
            <a
              *ngIf="computedPublicUrl"
              class="mt-2 inline-flex text-sm text-[var(--accent)] underline"
              [href]="computedPublicUrl"
              target="_blank"
              rel="noreferrer"
              >Apri la pagina clienti: {{ computedPublicUrl }}</a
            >
          </label>
          <div class="field">
            <span>Logo</span>
            <input
              #logoInput
              class="upload-input"
              type="file"
              accept="image/*"
              (change)="mediaSelected.emit({ event: $event, kind: 'logo' })"
            />
            <button
              type="button"
              class="upload-trigger"
              (click)="logoInput.click()"
            >
              {{ selectedLogoFile ? selectedLogoFile.name : "Seleziona logo" }}
            </button>
            <div
              *ngIf="logoPreviewUrl || settingsForm.logoUrl"
              class="upload-preview upload-preview-logo"
            >
              <img
                [src]="resolveAssetUrl(logoPreviewUrl || settingsForm.logoUrl)"
                alt="Anteprima logo"
              />
            </div>
            <div class="field-actions-row">
              <button
                type="button"
                class="secondary-btn"
                [disabled]="loading || !selectedLogoFile"
                (click)="uploadMedia.emit('logo')"
              >
                {{
                  loading &&
                  uploadFeedback?.target === "logo" &&
                  uploadFeedback?.pending
                    ? "Caricamento..."
                    : "Carica logo"
                }}
              </button>
              <button
                *ngIf="settingsForm.logoUrl && !logoPreviewUrl"
                type="button"
                class="danger-btn"
                [disabled]="loading"
                (click)="deleteMedia.emit('logo')"
              >
                Rimuovi logo
              </button>
            </div>
            <div
              *ngIf="uploadFeedback?.target === 'logo'"
              class="upload-banner"
              [class.upload-banner-success]="uploadFeedback?.kind === 'success'"
              [class.upload-banner-error]="uploadFeedback?.kind === 'error'"
            >
              <span>{{ uploadFeedback?.kind === "success" ? "✓" : "✕" }}</span>
              {{ uploadFeedback?.message }}
            </div>
          </div>
          <div class="field">
            <span>Immagine di copertina</span>
            <input
              #coverInput
              class="upload-input"
              type="file"
              accept="image/*"
              (change)="mediaSelected.emit({ event: $event, kind: 'cover' })"
            />
            <button
              type="button"
              class="upload-trigger"
              (click)="coverInput.click()"
            >
              {{
                selectedCoverFile ? selectedCoverFile.name : "Seleziona copertina"
              }}
            </button>
            <div
              *ngIf="coverPreviewUrl || settingsForm.coverUrl"
              class="upload-preview upload-preview-cover"
              [style.background-image]="
                'url(' +
                resolveAssetUrl(coverPreviewUrl || settingsForm.coverUrl) +
                ')'
              "
            ></div>
            <div class="field-actions-row">
              <button
                type="button"
                class="secondary-btn"
                [disabled]="loading || !selectedCoverFile"
                (click)="uploadMedia.emit('cover')"
              >
                {{
                  loading &&
                  uploadFeedback?.target === "cover" &&
                  uploadFeedback?.pending
                    ? "Caricamento..."
                    : "Carica copertina"
                }}
              </button>
              <button
                *ngIf="settingsForm.coverUrl && !coverPreviewUrl"
                type="button"
                class="danger-btn"
                [disabled]="loading"
                (click)="deleteMedia.emit('cover')"
              >
                Rimuovi copertina
              </button>
            </div>
            <div
              *ngIf="uploadFeedback?.target === 'cover'"
              class="upload-banner"
              [class.upload-banner-success]="uploadFeedback?.kind === 'success'"
              [class.upload-banner-error]="uploadFeedback?.kind === 'error'"
            >
              <span>{{ uploadFeedback?.kind === "success" ? "✓" : "✕" }}</span>
              {{ uploadFeedback?.message }}
            </div>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <label class="field"
              ><span>Colore principale</span
              ><input
                [(ngModel)]="settingsForm.primaryColor"
                name="settingsPrimaryColor"
                type="color"
            /></label>
            <label class="field"
              ><span>Colore in evidenza</span
              ><input
                [(ngModel)]="settingsForm.accentColor"
                name="settingsAccentColor"
                type="color"
            /></label>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <label class="field">
              <span>Come accetti le prenotazioni</span>
              <barber-custom-select
                [value]="settingsForm.bookingMode"
                (valueChange)="settingsForm.bookingMode = $event"
                [options]="bookingModeOptions"
              ></barber-custom-select>
              <small class="field-hint">Scegli se ricevere richieste online, inserirle dal salone o usare entrambe le modalità.</small>
            </label>
            <label class="field"
              ><span>Titolo della pagina clienti</span
              ><input
                [(ngModel)]="settingsForm.publicTitle"
                name="settingsPublicTitle"
                placeholder="Prenota online"
            /></label>
          </div>
          <label class="field"
            ><span>Messaggio di benvenuto</span
            ><textarea
              [(ngModel)]="settingsForm.publicDescription"
              name="settingsPublicDescription"
              rows="3"
            ></textarea>
          </label>
          <label class="field">
            <span>Come funziona la prenotazione</span>
            <textarea
              [(ngModel)]="settingsForm.publicStepsText"
              name="settingsPublicStepsText"
              rows="4"
              placeholder="Scegli|Trova il servizio che desideri&#10;Prenota|Scegli professionista, giorno e orario&#10;Conferma|Invia la richiesta al salone"
            ></textarea>
            <small class="field-hint"
              >Una riga per passaggio, nel formato Titolo|Descrizione</small
            >
          </label>
          <div class="rounded-[1.4rem] border border-[var(--line)]/80 p-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-semibold">Chiusure del salone</p>
                <p class="mt-1 text-xs text-[var(--muted)]">
                  In questi giorni nessun professionista risulterà disponibile.
                </p>
              </div>
              <button type="button" class="pill-btn" (click)="addHoliday()">
                Aggiungi festivo
              </button>
            </div>
            <div class="mt-4 grid gap-3">
              <article
                *ngFor="let holiday of settingsForm.holidays; let i = index"
                class="grid gap-3 rounded-[1rem] border border-[var(--line)]/70 p-3 md:grid-cols-[0.8fr_1.2fr_auto] md:items-center"
              >
                <input
                  [(ngModel)]="holiday.date"
                  [name]="'holidayDate' + i"
                  type="date"
                />
                <input
                  [(ngModel)]="holiday.name"
                  [name]="'holidayName' + i"
                  placeholder="Natale, Ferragosto, chiusura speciale"
                />
                <button
                  type="button"
                  class="pill-btn"
                  (click)="removeHoliday(i)"
                >
                  Rimuovi
                </button>
              </article>
              <p
                *ngIf="!settingsForm.holidays?.length"
                class="text-sm text-[var(--muted)]"
              >
                Nessuna chiusura programmata.
              </p>
            </div>
          </div>
          <section class="rounded-[1.4rem] border border-[var(--line)]/80 p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold">Interfaccia</p>
                <p class="mt-1 text-xs text-[var(--muted)]">
                  Dimensione locale di testi, controlli e spazi su questo dispositivo.
                </p>
              </div>
              <strong class="text-sm text-[var(--accent)]">{{ uiScale }}%</strong>
            </div>
            <label class="field mt-4">
              <span>Scala interfaccia</span>
              <input
                [ngModel]="uiScale"
                (ngModelChange)="uiScaleChange.emit($event)"
                name="settingsUiScale"
                type="range"
                min="85"
                max="110"
                step="1"
              />
              <small class="field-hint"
                >Preferenza di questo dispositivo: 92% è il valore consigliato.</small
              >
            </label>
          </section>
          <section class="rounded-[1.4rem] border border-[var(--line)]/80 p-4">
            <p class="text-sm font-semibold">Prenotazioni online</p>
            <p class="mt-1 text-xs text-[var(--muted)]">
              Controlla se i clienti possono inviare prenotazioni dal link pubblico.
            </p>
            <div class="mt-4">
            <label class="field checkbox-field"
              ><input
                [(ngModel)]="settingsForm.publicEnabled"
                name="settingsPublicEnabled"
                type="checkbox"
              /><span>Permetti ai clienti di prenotare online</span></label
            >
            </div>
          </section>
          <button
            type="submit"
            class="primary-btn"
            [disabled]="loading || !formValid"
          >
            Salva impostazioni
          </button>
          <button
            type="button"
            class="secondary-btn"
            [disabled]="loading"
            (click)="resetDefaults.emit()"
          >
            Ripristina impostazioni consigliate
          </button>
        </form>
      </article>
    </section>
  `,
})
export class AdminSettingsPageComponent {
  formatBookingMode = bookingModeLabel;
  @Input() tenant: any = null;
  @Input() settingsForm: any = {};
  @Input() bookingModeOptions: Array<{ value: string; label: string }> = [];
  @Input() computedPublicUrl = "";
  @Input() selectedLogoFile: File | null = null;
  @Input() selectedCoverFile: File | null = null;
  @Input() logoPreviewUrl = "";
  @Input() coverPreviewUrl = "";
  @Input() uploadFeedback: any = null;
  @Input() publicPreviewHeroBackground = "";
  @Input() publicPreviewSteps: Array<{ title: string; caption: string }> = [];
  @Input() publicPreviewServices: Array<{
    name: string;
    description: string;
    price: string;
    duration: number;
    highlighted: boolean;
  }> = [];
  @Input() publicPreviewCollaboratorLabel = "";
  @Input() uiScale = 92;
  @Input() loading = false;
  @Input() assetUrlResolver: ((path: string) => string) | null = null;

  @Output() save = new EventEmitter<void>();
  @Output() uiScaleChange = new EventEmitter<number>();
  @Output() resetDefaults = new EventEmitter<void>();
  @Output() mediaSelected = new EventEmitter<{
    event: Event;
    kind: "logo" | "cover";
  }>();
  @Output() uploadMedia = new EventEmitter<"logo" | "cover">();
  @Output() deleteMedia = new EventEmitter<"logo" | "cover">();

  addHoliday(): void {
    this.settingsForm.holidays = [
      ...(this.settingsForm.holidays || []),
      { date: "", name: "" },
    ];
  }

  removeHoliday(index: number): void {
    this.settingsForm.holidays = (this.settingsForm.holidays || []).filter(
      (_: unknown, currentIndex: number) => currentIndex !== index,
    );
  }

  resolveAssetUrl(path: string): string {
    return this.assetUrlResolver ? this.assetUrlResolver(path) : path;
  }

  get formValid(): boolean {
    return Boolean(
      typeof this.settingsForm.name === "string" &&
        this.settingsForm.name.trim(),
    );
  }
}
