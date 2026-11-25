import { TimeSelectComponent } from "../shared/time-select.component";
import { Component, OnInit, HostListener, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { UiPageComponent, UiTabsComponent, type UiTab } from "@alora/ui";
import { AdminPageHeaderComponent } from "../shell/admin-page-header.component";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { ADMIN_API_URL } from "../core/api-config";
import { SessionStore } from "../core/session.store";
import { OperationalContextService } from "../core/operational-context.service";
import { ActivitiesService } from "../core/activities.service";
@Component({
  standalone: true,
  imports: [TimeSelectComponent, CommonModule, FormsModule, UiPageComponent, UiTabsComponent, AdminPageHeaderComponent],
  template: ` <ui-page class="locations-shell">
    <alora-page-header navKey="locations">
      <button
        uiPageActions
        *ngIf="canEdit && section === 'structure'"
        type="button"
        class="primary-btn"
        data-tour="locations-create"
        [attr.aria-expanded]="createOpen"
        aria-controls="location-create"
        (click)="createOpen = !createOpen"
      >
        {{ createOpen ? "Chiudi" : "Nuova sede" }}
      </button>
    </alora-page-header>
    <ui-tabs
      *ngIf="tabs.length > 1"
      ariaLabel="Sezioni di sedi e attività"
      [tabs]="tabs"
      [active]="section"
      (activeChange)="section = $any($event)"
    ></ui-tabs>
    <p *ngIf="feedback" role="status" class="feedback">{{ feedback }}</p>
    <p *ngIf="loading" role="status">Caricamento delle sedi…</p>
    <ng-container *ngIf="section === 'structure'">
    <section
      *ngIf="canEdit && (createOpen || (!loading && !locations.length))"
      id="location-create"
      class="panel create-panel"
    >
      <h2>Nuova sede</h2>
      <form (ngSubmit)="create()">
        <label
          >Nome<input
            [(ngModel)]="newName"
            name="newName"
            maxlength="120"
            required /></label
        ><label
          >Indirizzo<input
            [(ngModel)]="newAddress"
            name="newAddress"
            maxlength="500" /></label
        >
        <fieldset class="activity-checks" data-tour="locations-create-activities">
          <legend>Attività svolte in questa sede (facoltativo)</legend>
          <label *ngFor="let activity of activities.active(); trackBy: trackById"
            ><input
              type="checkbox"
              [checked]="newActivityIds.includes(activity.id)"
              (change)="toggleNewActivity(activity.id)"
            />{{ activity.name }}</label
          >
          <button type="button" class="text-btn" (click)="section = 'activities'">
            + Aggiungi un’attività al catalogo
          </button>
        </fieldset>
        <button
          class="primary-btn"
          [disabled]="busy || !newName.trim()"
        >
          Crea sede
        </button>
      </form>
    </section>
    <section class="locations-grid">
      <article
        *ngFor="let location of locations; trackBy: trackById"
        class="panel location-card"
        data-tour="locations-card"
      >
        <div class="card-heading">
          <div>
            <span class="status" [class.inactive]="!location.isActive">{{
              location.isActive ? "Attiva" : "Disattivata"
            }}</span>
            <h2>{{ location.name }}</h2>
            <p>{{ location.address || "Indirizzo da completare" }}</p>
          </div>
          <button
            *ngIf="canEdit"
            class="secondary-btn"
            data-tour="locations-configure"
            (click)="edit(location)"
          >
            Configura sede
          </button>
        </div>
        <p class="public-state">
          {{
            location.isPublic
              ? "Visibile nelle prenotazioni online"
              : "Uso interno"
          }}
        </p>
        <div
          *ngFor="let sector of location.sectors; trackBy: trackById"
          class="sector-card"
        >
          <div class="card-heading">
            <div>
              <h3>{{ sector.name }}</h3>
              <span class="status" [class.inactive]="!sector.isActive">{{
                sector.isActive ? "Attiva" : "Disattivata"
              }}</span>
            </div>
            <button
              *ngIf="canEdit"
              class="secondary-btn"
              data-tour="locations-sector-configure"
              (click)="edit(sector, true)"
            >
              Configura attività
            </button>
          </div>
          <p class="professionals">
            {{ professionalNames(sector) || "Nessun professionista assegnato" }}
          </p>
          <h4>Risorse</h4>
          <p *ngIf="!sector.rooms.length" class="muted">
            Nessuna risorsa configurata
          </p>
          <div
            *ngFor="let room of sector.rooms; trackBy: trackById"
            class="resource"
          >
            <span
              >{{ room.name }} · capienza {{ room.capacity }} ·
              {{
                room.isActive
                  ? room.isPublic
                    ? "online e interno"
                    : "interno"
                  : "disattivata"
              }}</span
            >
            <div *ngIf="canEdit" class="capacity-control" data-tour="locations-resource-controls">
              <label
                >Capienza<input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  [attr.aria-label]="'Capienza di ' + room.name"
                  [ngModel]="room.requestedCapacity ?? room.capacity"
                  (ngModelChange)="room.requestedCapacity = $event"
                  [ngModelOptions]="{ standalone: true }"
                  [disabled]="busy"
              /></label>
              <button
                class="text-btn"
                [disabled]="
                  busy ||
                  room.requestedCapacity == null ||
                  room.requestedCapacity === room.capacity
                "
                (click)="roomCapacity(room)"
              >
                Salva capienza
              </button>
              <button
                class="text-btn"
                [disabled]="busy"
                (click)="roomState(room)"
              >
                {{ room.isActive ? "Disattiva" : "Riattiva" }}</button
              ><button
                class="text-btn"
                [disabled]="busy"
                (click)="roomPublic(room)"
              >
                {{ room.isPublic ? "Solo interno" : "Abilita online" }}
              </button>
            </div>
          </div>
          <form
            *ngIf="canEdit"
            (ngSubmit)="createRoom(sector)"
            class="inline-form"
            data-tour="locations-resource-add"
          >
            <label class="grow"
              >Nome della risorsa<input
                [(ngModel)]="sector.newRoomName"
                [name]="'room-' + sector.id"
                maxlength="120"
                placeholder="Es. Postazione 1"
                required /></label
            ><label
              >Capienza<input
                type="number"
                min="1"
                max="100"
                step="1"
                [(ngModel)]="sector.newRoomCapacity"
                [name]="'room-capacity-' + sector.id"
                placeholder="1" /></label
            ><button
              class="secondary-btn"
              [disabled]="busy || !sector.newRoomName?.trim()"
            >
              Aggiungi
            </button>
          </form>
        </div>
        <form
          *ngIf="canEdit && missingActivities(location).length"
          (ngSubmit)="createSector(location)"
          class="inline-form"
          data-tour="locations-sector-add"
        >
          <label class="grow"
            >Aggiungi un’attività a questa sede<select
              [(ngModel)]="location.newActivityId"
              [name]="'sector-' + location.id"
              required
            >
              <option value="">Scegli dal catalogo</option>
              <option
                *ngFor="let activity of missingActivities(location); trackBy: trackById"
                [value]="activity.id"
              >
                {{ activity.name }}
              </option>
            </select></label
          ><button
            class="secondary-btn"
            [disabled]="busy || !location.newActivityId"
          >
            Aggiungi
          </button>
        </form>
      </article>
    </section>
    </ng-container>
    <section
      *ngIf="section === 'activities'"
      class="panel assignments"
      data-tour="locations-activities"
    >
      <h2>Catalogo attività</h2>
      <p>
        Le attività sono ciò che fai (Barberia, Estetica, Rivendita…). Ogni servizio e
        prodotto appartiene a un’attività; una sede svolge una o più attività e un’attività
        può essere svolta in più sedi. In agenda e in cassa, in ogni sede compaiono solo i
        servizi delle attività presenti lì.
      </p>
      <div *ngIf="canEdit && activities.presets().length" class="preset-row" data-tour="locations-activity-presets">
        <span class="muted">Aggiungi dal catalogo:</span>
        <button
          *ngFor="let preset of activities.presets()"
          type="button"
          class="pill-btn"
          [disabled]="busy"
          (click)="addPreset(preset.preset)"
        >
          + {{ preset.name }}
        </button>
      </div>
      <form
        *ngIf="canEdit"
        (ngSubmit)="addCustomActivity()"
        class="inline-form"
        data-tour="locations-activity-custom"
      >
        <label class="grow"
          >Attività personalizzata<input
            [(ngModel)]="newActivityName"
            name="newActivityName"
            maxlength="80"
            placeholder="Es. Tatuaggi"
        /></label>
        <button class="secondary-btn" [disabled]="busy || !newActivityName.trim()">
          Crea attività
        </button>
      </form>
      <div class="activity-list" data-tour="locations-activity-list">
        <article
          *ngFor="let activity of activities.activities(); trackBy: trackById"
          class="activity-row"
          [class.inactive]="!activity.isActive"
        >
          <div class="activity-main">
            <input
              *ngIf="canEdit; else plainName"
              class="activity-name"
              [ngModel]="activity.name"
              (change)="renameActivity(activity, $any($event.target).value)"
              [name]="'activity-name-' + activity.id"
              [ngModelOptions]="{ standalone: true }"
              maxlength="80"
              [attr.aria-label]="'Nome attività ' + activity.name"
            />
            <ng-template #plainName><strong>{{ activity.name }}</strong></ng-template>
            <span class="muted">
              {{ activity.sectors.length ? "Sedi: " + sectorLocations(activity) : "Non ancora in nessuna sede" }}
              · {{ activity.servicesCount }} servizi · {{ activity.productsCount }} prodotti
            </span>
          </div>
          <button
            *ngIf="canEdit"
            type="button"
            class="text-btn"
            [disabled]="busy"
            (click)="toggleActivity(activity)"
          >
            {{ activity.isActive ? "Disattiva" : "Riattiva" }}
          </button>
        </article>
      </div>
    </section>
    <section
      *ngIf="section === 'people' && canEdit && professionals.length"
      class="panel assignments"
    >
      <h2>Professionisti e appartenenze</h2>
      <p>
        Una persona può lavorare in più sedi e attività. Gli orari personali si
        incrociano con le aperture dei luoghi selezionati.
      </p>
      <div
        *ngFor="let person of professionals; trackBy: trackById"
        class="professional-row"
        data-tour="locations-people-row"
      >
        <h3>{{ person.firstName }} {{ person.lastName }}</h3>
        <div class="checks">
          <label *ngFor="let sector of allSectors"
            ><input
              type="checkbox"
              [checked]="person.sectorIds.includes(sector.id)"
              (change)="toggleSector(person, sector.id)"
            />{{ sector.label }}</label
          >
        </div>
        <button
          class="secondary-btn"
          [disabled]="busy || !person.sectorIds.length"
          (click)="saveProfessional(person)"
        >
          Salva appartenenze
        </button>
      </div>
    </section>
    <section
      *ngIf="section === 'visibility' && canManageVisibility && visibilityUsers.length"
      class="panel assignments"
    >
      <h2>Visibilità operativa</h2>
      <p>
        Indica le attività consultabili da manager e reception. Le funzioni
        abilitate restano quelle già concesse. I professionisti consultano la
        propria agenda nelle sedi assegnate.
      </p>
      <div
        *ngFor="let person of visibilityUsers; trackBy: trackById"
        class="professional-row visibility-row"
        data-tour="locations-visibility-row"
      >
        <h3>{{ person.firstName }} {{ person.lastName }}</h3>
        <div class="checks">
          <label *ngFor="let sector of allSectors"
            ><input
              type="checkbox"
              [checked]="person.sectorIds.includes(sector.id)"
              (change)="toggleSector(person, sector.id)"
            />{{ sector.label }}</label
          >
        </div>
        <button
          class="secondary-btn"
          [disabled]="busy"
          (click)="saveVisibility(person)"
        >
          Salva visibilità
        </button>
      </div>
    </section>
    <div
      *ngIf="editor"
      class="editor-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-editor-title"
    >
      <form class="panel editor" (ngSubmit)="save()">
        <div class="card-heading">
          <h2 id="location-editor-title">
            {{ editor.isSector ? "Configura attività" : "Configura sede" }}
          </h2>
          <button
            type="button"
            class="secondary-btn"
            (click)="closeEditor()"
            [disabled]="busy"
          >
            Chiudi
          </button>
        </div>
        <label *ngIf="!editor.isSector"
          >Nome<input
            [(ngModel)]="editor.name"
            name="editName"
            maxlength="120"
            required /></label
        ><p *ngIf="editor.isSector" class="muted">
          <strong>{{ editor.name }}</strong> · il nome dell’attività vale per tutte le sedi e
          si cambia dal Catalogo attività.
        </p><label *ngIf="!editor.isSector"
          >Indirizzo<input
            [(ngModel)]="editor.address"
            name="editAddress"
            maxlength="500"
        /></label>
        <div class="checks">
          <label
            ><input
              type="checkbox"
              [(ngModel)]="editor.isActive"
              name="active"
            />Attivo</label
          ><label
            ><input
              type="checkbox"
              [(ngModel)]="editor.isPublic"
              name="public"
            />Visibile online</label
          >
        </div>
        <p class="muted">
          La disattivazione impedisce nuove prenotazioni. Lo storico resta
          consultabile.
        </p>
        <label class="check"
          ><input
            type="checkbox"
            [(ngModel)]="editor.inherit"
            name="inherit"
          />{{
            editor.isSector
              ? "Usa gli orari della sede"
              : "Usa gli orari standard 09:00–19:00"
          }}</label
        >
        <fieldset *ngIf="!editor.inherit">
          <legend>Apertura settimanale</legend>
          <div *ngFor="let day of editor.hours" class="hours-row">
            <label
              ><input
                type="checkbox"
                [(ngModel)]="day.isWorkingDay"
                [name]="'day-' + day.weekday"
              />{{ weekdays[day.weekday] }}</label
            ><alora-time-select
              [label]="'Apertura ' + weekdays[day.weekday]"
              [value]="day.startTime"
              (valueChange)="day.startTime = $event"
              [disabled]="!day.isWorkingDay"
            ></alora-time-select
            ><alora-time-select
              [label]="'Chiusura ' + weekdays[day.weekday]"
              [value]="day.endTime"
              (valueChange)="day.endTime = $event"
              [disabled]="!day.isWorkingDay"
            ></alora-time-select>
          </div>
        </fieldset>
        <label
          >Giorni di chiusura<textarea
            [(ngModel)]="editor.closedDates"
            name="closedDates"
            rows="3"
            placeholder="Una data per riga, es. 2026-12-25"
          ></textarea></label
        ><button class="primary-btn" [disabled]="busy || (!editor.isSector && !editor.name.trim())">
          {{ busy ? "Salvataggio…" : "Salva configurazione" }}
        </button>
        <p *ngIf="feedback" role="status">{{ feedback }}</p>
      </form>
    </div>
  </ui-page>`,
  styles: [
    `
      .locations-shell {
        color: var(--ink);
      }
      .card-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
      }
      h2 {
        font-family: var(--font-display);
        font-size: 1.35rem;
        margin: 0.6rem 0;
      }
      h3 {
        font-weight: 650;
        font-size: 1.1rem;
        margin: 0.5rem 0;
      }
      h4 {
        font-size: 0.8rem;
        margin: 1rem 0 0.5rem;
        color: var(--muted);
      }
      .eyebrow {
        text-transform: uppercase;
        font-size: 0.72rem;
        letter-spacing: 0.18em;
        color: var(--accent);
      }
      p {
        line-height: 1.6;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 1.3rem;
        padding: 1.4rem;
      }
      .create-panel {
        margin-bottom: 1.4rem;
      }
      .activity-checks {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1rem;
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 1rem;
        padding: 0.7rem 0.9rem;
        min-width: min(100%, 22rem);
      }
      .activity-checks legend {
        font-size: 0.85rem;
        padding: 0 0.3rem;
      }
      .activity-checks label {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }
      .preset-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
        margin: 1rem 0;
      }
      .activity-list {
        display: grid;
        gap: 0.6rem;
        margin-top: 1.2rem;
      }
      .activity-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        border: 1px solid var(--line);
        border-radius: 1rem;
        padding: 0.75rem 1rem;
      }
      .activity-row.inactive {
        opacity: 0.6;
      }
      .activity-main {
        display: grid;
        gap: 0.25rem;
        min-width: 0;
      }
      .activity-name {
        font-weight: 700;
        max-width: 18rem;
      }
      .create-panel form {
        display: flex;
        gap: 0.8rem;
        align-items: end;
        flex-wrap: wrap;
      }
      label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.85rem;
      }
      input:not([type="checkbox"]),
      textarea {
        padding: 0.65rem 0.8rem;
        border: 1px solid #bdc9bb;
        border-radius: 0.55rem;
        background: #fff;
        min-width: 0;
        width: 100%;
      }
      input[type="checkbox"] {
        accent-color: #27593c;
      }
      .locations-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr));
        gap: 1.4rem;
      }
      .status {
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.09em;
        color: #2f6743;
        background: #e3efe1;
        border-radius: 99px;
        padding: 0.25rem 0.6rem;
      }
      .inactive {
        color: #7c6651;
        background: #f0e8df;
      }
      .public-state,
      .muted,
      .professionals {
        font-size: 0.82rem;
        color: var(--muted);
      }
      .sector-card {
        border-top: 1px solid var(--line);
        margin-top: 1.2rem;
        padding-top: 1rem;
      }
      .capacity-control {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .capacity-control label {
        font-size: 0.75rem;
        display: grid;
        gap: 0.25rem;
      }
      .capacity-control input {
        width: 5rem;
        min-height: 40px;
      }
      .resource {
        display: flex;
        justify-content: space-between;
        gap: 0.5rem;
        align-items: center;
        font-size: 0.85rem;
        margin: 0.5rem 0;
      }
      .text-btn {
        color: #345c3c;
        text-decoration: underline;
        font-size: 0.75rem;
        margin-left: 0.6rem;
      }
      .inline-form {
        display: flex;
        gap: 0.7rem;
        align-items: end;
        margin-top: 1rem;
      }
      .grow {
        flex: 1;
      }
      .assignments {
        margin-top: 1.5rem;
      }
      .professional-row {
        border-top: 1px solid var(--line);
        margin-top: 1rem;
        padding-top: 1rem;
      }
      .checks {
        display: flex;
        flex-wrap: wrap;
        gap: 0.9rem;
        margin: 0.9rem 0;
      }
      .checks label,
      .check {
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
      .editor-overlay {
        position: fixed;
        inset: 0;
        background: #11271988;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 100;
        padding: 1rem;
      }
      .editor {
        width: 100%;
        max-width: 640px;
        max-height: 92vh;
        overflow: auto;
        display: grid;
        gap: 1rem;
      }
      .hours-row {
        display: grid;
        grid-template-columns: 1fr 110px 110px;
        gap: 0.5rem;
        align-items: center;
        margin: 0.5rem 0;
      }
      .hours-row label {
        display: flex;
        gap: 0.4rem;
      }
      fieldset {
        border-top: 1px solid var(--line);
      }
      .feedback {
        background: #e8efdf;
        padding: 1rem;
        border-radius: 0.7rem;
        margin-bottom: 1rem;
      }
      @media (max-width: 500px) {
        header,
        .card-heading {
          flex-wrap: wrap;
        }
        .hours-row {
          grid-template-columns: 1fr 90px 90px;
        }
        .panel {
          padding: 1rem;
        }
        .resource {
          flex-wrap: wrap;
        }
      }
    `,
  ],
})
export class LocationsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  private readonly context = inject(OperationalContextService);
  private focusedBefore: HTMLElement | null = null;
  closeEditor() {
    const wasOpen = !!this.editor;
    this.editor = null;
    if (wasOpen) this.focusedBefore?.focus();
    this.focusedBefore = null;
  }
  @HostListener("document:keydown", ["$event"])
  onKey(event: KeyboardEvent) {
    if (!this.editor) return;
    if (event.key === "Escape" && !this.busy) {
      event.preventDefault();
      this.closeEditor();
    }
    if (event.key === "Tab") {
      const controls = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".editor input:not([disabled]), .editor button:not([disabled]), .editor textarea:not([disabled])",
        ),
      ).filter((control) => control.offsetParent !== null);
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
  locations: any[] = [];
  createOpen = false;
  section: "structure" | "activities" | "people" | "visibility" = "structure";
  readonly activities = inject(ActivitiesService);
  newActivityIds: string[] = [];
  newActivityName = "";
  get tabs(): UiTab[] {
    const tabs: UiTab[] = [
      { key: "structure", label: "Sedi" },
      { key: "activities", label: "Catalogo attività" },
    ];
    if (this.canEdit && this.professionals.length)
      tabs.push({ key: "people", label: "Chi lavora dove" });
    if (this.canManageVisibility && this.visibilityUsers.length)
      tabs.push({ key: "visibility", label: "Visibilità per ruolo" });
    return tabs;
  }
  professionals: any[] = [];
  visibilityUsers: any[] = [];
  get canManageVisibility() {
    return (
      this.canEdit &&
      this.session.can("users.manage") &&
      this.session.can("team.manage")
    );
  }
  saveVisibility(person: any) {
    return this.change("/access/" + person.id, { sectorIds: person.sectorIds });
  }
  editor: any = null;
  feedback = "";
  busy = false;
  loading = false;
  newName = "";
  newAddress = "";
  weekdays = [
    "Domenica",
    "Lunedì",
    "Martedì",
    "Mercoledì",
    "Giovedì",
    "Venerdì",
    "Sabato",
  ];
  get canEdit() {
    return this.session.can("locations.manage");
  }
  get allSectors() {
    return this.locations.flatMap((location) =>
      location.sectors.map((sector: any) => ({
        id: sector.id,
        label: `${location.name} · ${sector.name}`,
      })),
    );
  }
  trackById(_index: number, row: { id: string }) {
    return row.id;
  }
  ngOnInit() {
    void this.load();
  }
  async load() {
    this.loading = true;
    try {
      this.locations = await firstValueFrom(
        this.http.get<any[]>(`${ADMIN_API_URL}/locations`),
      );
      const people = new Map<string, any>();
      for (const location of this.locations)
        for (const sector of location.sectors)
          for (const membership of sector.collaborators) {
            const person = people.get(membership.collaboratorId) || {
              ...membership.collaborator,
              sectorIds: [],
            };
            person.sectorIds.push(sector.id);
            people.set(person.id, person);
          }
      this.professionals = [...people.values()];
      if (this.canManageVisibility) {
        const users = await firstValueFrom(
          this.http.get<any[]>(`${ADMIN_API_URL}/locations/access-context`),
        );
        this.visibilityUsers = users.map((user) => ({
          ...user,
          sectorIds: user.sectorAccess.map((access: any) => access.sectorId),
        }));
      }
      await Promise.all([this.context.load(), this.activities.load(true)]);
    } catch (error: any) {
      this.feedback = error?.error?.message || "Impossibile caricare le sedi.";
    } finally {
      this.loading = false;
    }
  }
  professionalNames(sector: any) {
    return sector.collaborators
      .map(
        (row: any) =>
          `${row.collaborator.firstName} ${row.collaborator.lastName}`,
      )
      .join(", ");
  }
  async change(path: string, data: any, method = "POST") {
    this.busy = true;
    this.feedback = "";
    try {
      await firstValueFrom(
        this.http.request(method, `${ADMIN_API_URL}/locations${path}`, {
          body: data,
        }),
      );
      this.closeEditor();
      await this.load();
      this.feedback = "Configurazione salvata.";
      return true;
    } catch (error: any) {
      this.feedback = error?.error?.message || "Salvataggio non riuscito.";
      return false;
    } finally {
      this.busy = false;
    }
  }
  async create() {
    if (
      await this.change("", {
        name: this.newName,
        address: this.newAddress,
        activityIds: this.newActivityIds,
      })
    ) {
      this.newName = "";
      this.newAddress = "";
      this.newActivityIds = [];
      this.createOpen = false;
      await this.activities.load(true);
    }
  }
  toggleNewActivity(id: string) {
    this.newActivityIds = this.newActivityIds.includes(id)
      ? this.newActivityIds.filter((entry) => entry !== id)
      : [...this.newActivityIds, id];
  }
  /** Active activities of the account not yet run at this location. */
  missingActivities(location: any) {
    const present = new Set((location.sectors || []).map((sector: any) => sector.activityId));
    return this.activities.active().filter((activity) => !present.has(activity.id));
  }
  async createSector(location: any) {
    const ok = await this.change("/" + location.id + "/sectors", {
      activityId: location.newActivityId,
    });
    if (ok) await this.activities.load(true);
    return ok;
  }
  sectorLocations(activity: any): string {
    return activity.sectors
      .map((sector: any) => sector.location.name + (sector.isActive ? "" : " (disattivata)"))
      .join(", ");
  }
  private async activityChange(run: () => Promise<unknown>, done: string) {
    this.busy = true;
    this.feedback = "";
    try {
      await run();
      await this.load();
      this.feedback = done;
    } catch (error: any) {
      this.feedback = error?.error?.message || "Salvataggio non riuscito.";
    } finally {
      this.busy = false;
    }
  }
  addPreset(preset: string) {
    return this.activityChange(() => this.activities.create({ preset }), "Attività aggiunta al catalogo.");
  }
  async addCustomActivity() {
    const name = this.newActivityName.trim();
    if (!name) return;
    await this.activityChange(() => this.activities.create({ name }), "Attività creata.");
    this.newActivityName = "";
  }
  renameActivity(activity: any, value: string) {
    const name = String(value || "").trim();
    if (!name || name === activity.name) return;
    return this.activityChange(
      () => this.activities.update(activity.id, { name }),
      "Nome aggiornato in tutte le sedi.",
    );
  }
  toggleActivity(activity: any) {
    return this.activityChange(
      () => this.activities.update(activity.id, { isActive: !activity.isActive }),
      activity.isActive
        ? "Attività disattivata: i suoi servizi non si possono più prenotare o vendere."
        : "Attività riattivata.",
    );
  }
  createRoom(sector: any) {
    return this.change("/rooms", {
      sectorId: sector.id,
      name: sector.newRoomName,
      capacity: sector.newRoomCapacity ?? 1,
    });
  }
  roomCapacity(room: any) {
    return this.change(
      "/rooms/" + room.id,
      { capacity: room.requestedCapacity },
      "PATCH",
    );
  }
  roomState(room: any) {
    return this.change(
      "/rooms/" + room.id,
      { isActive: !room.isActive },
      "PATCH",
    );
  }
  roomPublic(room: any) {
    return this.change(
      "/rooms/" + room.id,
      { isPublic: !room.isPublic },
      "PATCH",
    );
  }
  edit(row: any, isSector = false) {
    this.focusedBefore = document.activeElement as HTMLElement;
    setTimeout(() =>
      document.querySelector<HTMLInputElement>(".editor input")?.focus(),
    );
    this.feedback = "";
    this.editor = {
      ...row,
      isSector,
      inherit: row.weeklyHours == null,
      closedDates: (row.closures || []).join("\n"),
      hours: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        isWorkingDay: false,
        startTime: "09:00",
        endTime: "19:00",
        ...(row.weeklyHours || []).find((day: any) => day.weekday === weekday),
      })),
    };
  }
  save() {
    const row = this.editor;
    return this.change(
      (row.isSector ? "/sectors/" : "/") + row.id,
      {
        ...(row.isSector ? {} : { name: row.name, address: row.address }),
        isActive: row.isActive,
        isPublic: row.isPublic,
        weeklyHours: row.inherit ? null : row.hours,
        closures: row.closedDates.split(/\s+/).filter(Boolean),
      },
      "PATCH",
    );
  }
  toggleSector(person: any, id: string) {
    person.sectorIds = person.sectorIds.includes(id)
      ? person.sectorIds.filter((entry: string) => entry !== id)
      : [...person.sectorIds, id];
  }
  saveProfessional(person: any) {
    return this.change("/professionals/" + person.id + "/sectors", {
      sectorIds: person.sectorIds,
    });
  }
}
