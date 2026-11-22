import { Component, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import {
  NotificationTemplatesApiService,
  NotificationTemplateView,
  TemplateDraft,
  TemplatePreview,
} from "../core/notification-templates-api.service";
import { UiSelectComponent, type UiOption } from "@alora/ui";

@Component({
  selector: "app-notification-template-editor",
  standalone: true,
  imports: [CommonModule, FormsModule, UiSelectComponent],
  template: ` <section class="templates" aria-label="Template delle notifiche">
    <div class="heading">
      <div>
        <p class="eyebrow">Messaggi dell’agenda</p>
        <h2>Template delle notifiche</h2>
      </div>
      <button
        type="button"
        class="secondary-btn"
        [disabled]="busy"
        (click)="load()"
      >
        {{ templates.length ? "Ricarica template salvati" : "Apri template" }}
      </button>
    </div>
    <p class="muted">
      Personalizza i testi email e delle notifiche nell’app. Il salvataggio
      modifica il testo per i nuovi eventi; l’abilitazione dei canali e delle
      automazioni resta separata.
    </p>
    <p class="notice">
      I testi WhatsApp si configurano nella policy dei promemoria. Questa anteprima usa esclusivamente dati di esempio e non invia messaggi.
    </p>
    <p *ngIf="feedback" role="status" class="feedback">{{ feedback }}</p>
    <ng-container *ngIf="templates.length">
      <div class="field">
        <span>Evento e canale</span
        ><ui-select
          label="Evento e canale"
          [options]="templateOptions"
          [ngModel]="selectedId"
          (ngModelChange)="select($event)"
          [disabled]="busy"
        ></ui-select>
      </div>
      <div *ngIf="selected as item" class="editor-grid">
        <form (ngSubmit)="showPreview()">
          <fieldset [disabled]="busy">
            <label *ngIf="item.channel === 'email'" class="field"
              >Oggetto email<input
                name="subject"
                [(ngModel)]="draft.subject"
                (ngModelChange)="edited()"
                maxlength="200"
            /></label>
            <label *ngIf="item.channel === 'in_app'" class="field"
              >Titolo della notifica<input
                name="title"
                [(ngModel)]="draft.title"
                (ngModelChange)="edited()"
                maxlength="200"
            /></label>
            <label class="field"
              >Testo del template<textarea
                name="body"
                [(ngModel)]="draft.body"
                (ngModelChange)="edited()"
                rows="7"
                maxlength="16000"
                required
              ></textarea>
            </label>
            <div class="actions">
              <button class="secondary-btn" [disabled]="!draft.body.trim()">
                Anteprima con dati di esempio</button
              ><button
                type="button"
                class="primary-btn"
                [disabled]="!preview"
                (click)="save()"
              >
                Salva template
              </button>
            </div>
          </fieldset>
        </form>
        <aside
          class="preview"
          aria-label="Anteprima del template"
          aria-live="polite"
        >
          <p class="eyebrow">Dati di esempio · orari UTC</p>
          <ng-container *ngIf="preview; else empty"
            ><h3>
              {{ item.channel === "email" ? preview.subject : preview.title }}
            </h3>
            <p class="rendered">{{ preview.body }}</p></ng-container
          >
          <ng-template #empty
            ><p class="muted">
              Genera l’anteprima per verificare il testo prima di salvare.
            </p></ng-template
          >
        </aside>
      </div>
      <details>
        <summary>Segnaposto disponibili</summary>
        <p class="muted">
          Usa due parentesi graffe, per esempio
          <code [textContent]="example"></code>. I segnaposto indicano i dati
          dell’evento; i campi assenti restano vuoti.
        </p>
        <div class="tokens">
          <code
            *ngFor="let key of placeholders"
            [textContent]="'{{' + key + '}}'"
          ></code>
        </div>
      </details>
    </ng-container>
  </section>`,
  styles: [
    `
      :host {
        display: block;
        margin-top: 24px;
        min-width: 0;
      }
      .templates {
        padding: clamp(22px, 3vw, 36px);
        border: 1px solid var(--line, #d9dfd8);
        border-radius: 24px;
        background: var(--panel, #fffdf8);
      }
      .heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
      }
      h2 {
        font-family: var(--font-display, Georgia, serif);
        font-size: 27px;
        margin: 8px 0 12px;
      }
      .muted {
        font-size: 13px;
        line-height: 1.65;
        color: var(--muted, #68746d);
      }
      .notice,
      .feedback {
        font-size: 13px;
        line-height: 1.6;
        padding: 14px 18px;
        background: #faf2df;
        border-radius: 12px;
        color: #5a4925;
      }
      .editor-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 24px;
      }
      .field {
        display: grid;
        gap: 8px;
        font-size: 12px;
        font-weight: 600;
        margin: 16px 0;
      }
      .field ui-select {
        font-weight: 400;
      }
      .field input,
      .field textarea {
        font: inherit;
        font-weight: 400;
        color: inherit;
        border: 1px solid var(--line, #ccd6ce);
        border-radius: 12px;
        padding: 12px;
        background: #fffefb;
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
      }
      .field textarea {
        resize: vertical;
        font-size: 14px;
      }
      fieldset {
        border: 0;
        padding: 0;
        margin: 0;
        min-width: 0;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 18px 0;
      }
      .preview {
        background: #f1f4ed;
        border-radius: 16px;
        padding: 22px;
        min-width: 0;
        margin: 16px 0;
      }
      .preview h3,
      .rendered {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .rendered {
        font-size: 14px;
        line-height: 1.7;
      }
      .eyebrow {
        font-size: 10px;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        color: var(--muted, #68746d);
      }
      details {
        margin-top: 20px;
      }
      summary {
        cursor: pointer;
        font-size: 13px;
      }
      .tokens {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        font-size: 11px;
      }
      .tokens code {
        overflow-wrap: anywhere;
        max-width: 100%;
        background: #f0f2eb;
        padding: 7px 10px;
        border-radius: 8px;
      }
      @media (max-width: 47.99rem) {
        .editor-grid {
          grid-template-columns: minmax(0, 1fr);
        }
        .actions button {
          flex: 1 1 auto;
        }
        .heading button {
          width: 100%;
        }
      }
    `,
  ],
})
export class NotificationTemplateEditorComponent {
  private readonly api = inject(NotificationTemplatesApiService);
  templates: NotificationTemplateView[] = [];
  selectedId = "";
  draft: TemplateDraft = { subject: "", title: "", body: "" };
  preview: TemplatePreview | null = null;
  busy = false;
  feedback = "";
  readonly example = "{{customer.firstName}}";
  readonly placeholders = [
    "customer.firstName",
    "customer.lastName",
    "service.name",
    "appointment.startsAt",
    "appointment.endsAt",
    "appointment.status",
    "collaborator.firstName",
    "collaborator.lastName",
    "tenant.name",
  ];
  private templateOptionsSource: NotificationTemplateView[] | null = null;
  private templateOptionsCache: UiOption[] = [];
  get templateOptions(): UiOption[] {
    if (this.templateOptionsSource !== this.templates) {
      this.templateOptionsSource = this.templates;
      this.templateOptionsCache = this.templates.map((item) => ({
        value: item.id,
        label: `${this.eventLabel(item.eventType)} · ${item.channel === "email" ? "Email" : "Nell’app"}`,
      }));
    }
    return this.templateOptionsCache;
  }
  get selected() {
    return this.templates.find((t) => t.id === this.selectedId);
  }
  private error(error: any) {
    return error?.error?.message || "Template non disponibili. Riprova.";
  }
  async load() {
    if (this.busy) return;
    this.busy = true;
    this.feedback = "";
    this.preview = null;
    try {
      this.templates = await this.api.list();
      this.select(
        this.templates.some((t) => t.id === this.selectedId)
          ? this.selectedId
          : this.templates[0]?.id || "",
      );
    } catch (e) {
      this.templates = [];
      this.selectedId = "";
      this.feedback = this.error(e);
    } finally {
      this.busy = false;
    }
  }
  select(id: string) {
    this.selectedId = id;
    const item = this.selected;
    this.draft = {
      subject: item?.subject || "",
      title: item?.title || "",
      body: item?.body || "",
    };
    this.preview = null;
    this.feedback = "";
  }
  edited() {
    this.preview = null;
    this.feedback = "";
  }
  async showPreview() {
    const item = this.selected;
    if (!item || this.busy) return;
    this.busy = true;
    this.feedback = "";
    this.preview = null;
    try {
      this.preview = await this.api.preview(item, { ...this.draft });
    } catch (e) {
      this.feedback = this.error(e);
    } finally {
      this.busy = false;
    }
  }
  async save() {
    const item = this.selected;
    if (!item || this.busy || !this.preview) return;
    this.busy = true;
    this.feedback = "";
    try {
      const saved = await this.api.save(item, { ...this.draft });
      this.templates = this.templates.map((t) =>
        t.id === saved.id ? saved : t,
      );
      this.feedback =
        "Template salvato per i nuovi eventi. Nessun messaggio inviato.";
    } catch (e) {
      this.preview = null;
      this.feedback = this.error(e);
    } finally {
      this.busy = false;
    }
  }
  eventLabel(key: string) {
    const labels: Record<string, string> = {
      "appointment.created.internal": "Prenotazione interna",
      "appointment.created.public": "Prenotazione online",
      "appointment.requested": "Richiesta ricevuta",
      "appointment.confirmed": "Conferma",
      "appointment.assigned": "Assegnazione",
      "appointment.reassigned": "Riassegnazione",
      "appointment.cancelled": "Annullamento",
      "appointment.rescheduled": "Riprogrammazione",
      "appointment.completed": "Completamento",
      "appointment.no_show": "Mancata presentazione",
      "appointment.checked_in": "Arrivo del cliente",
    };
    return labels[key] || key;
  }
}
