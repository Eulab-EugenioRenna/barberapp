import { Component, OnInit, HostListener, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { ADMIN_API_URL } from "../core/api-config";
import { SessionStore } from "../core/session.store";
import { OperationalContextService } from "../core/operational-context.service";
@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: ` <main class="locations-shell">
    <header>
      <div>
        <p class="eyebrow">Organizzazione</p>
        <h1>Sedi e settori</h1>
        <p>Spazi, aperture e professionisti della tua attività.</p>
      </div>
      <a routerLink="/appointments" class="secondary-btn">Torna all’agenda</a>
    </header>
    <p *ngIf="feedback" role="status" class="feedback">{{ feedback }}</p>
    <p *ngIf="loading" role="status">Caricamento delle sedi…</p>
    <section *ngIf="canEdit" class="panel create-panel">
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
        ><label
          >Primo settore<input
            [(ngModel)]="newSector"
            name="newSector"
            maxlength="120"
            required /></label
        ><button
          class="primary-btn"
          [disabled]="busy || !newName.trim() || !newSector.trim()"
        >
          Crea sede
        </button>
      </form>
    </section>
    <section class="locations-grid">
      <article
        *ngFor="let location of locations; trackBy: trackById"
        class="panel location-card"
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
                sector.isActive ? "Attivo" : "Disattivato"
              }}</span>
            </div>
            <button
              *ngIf="canEdit"
              class="secondary-btn"
              (click)="edit(sector, true)"
            >
              Configura settore
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
            <div *ngIf="canEdit" class="capacity-control">
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
          *ngIf="canEdit"
          (ngSubmit)="createSector(location)"
          class="inline-form"
        >
          <label class="grow"
            >Nuovo settore<input
              [(ngModel)]="location.newSectorName"
              [name]="'sector-' + location.id"
              maxlength="120"
              placeholder="Nome del settore"
              required /></label
          ><button
            class="secondary-btn"
            [disabled]="busy || !location.newSectorName?.trim()"
          >
            Aggiungi
          </button>
        </form>
      </article>
    </section>
    <section *ngIf="canEdit && professionals.length" class="panel assignments">
      <h2>Professionisti e appartenenze</h2>
      <p>
        Una persona può lavorare in più sedi e settori. Gli orari personali si
        incrociano con le aperture dei luoghi selezionati.
      </p>
      <div
        *ngFor="let person of professionals; trackBy: trackById"
        class="professional-row"
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
      *ngIf="canManageVisibility && visibilityUsers.length"
      class="panel assignments"
    >
      <h2>Visibilità operativa</h2>
      <p>
        Indica i settori consultabili da manager e reception. Le funzioni
        abilitate restano quelle già concesse. I professionisti consultano la
        propria agenda nelle sedi assegnate.
      </p>
      <div
        *ngFor="let person of visibilityUsers; trackBy: trackById"
        class="professional-row visibility-row"
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
            {{ editor.isSector ? "Configura settore" : "Configura sede" }}
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
        <label
          >Nome<input
            [(ngModel)]="editor.name"
            name="editName"
            maxlength="120"
            required /></label
        ><label *ngIf="!editor.isSector"
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
            ><input
              type="time"
              [(ngModel)]="day.startTime"
              [name]="'start-' + day.weekday"
              [disabled]="!day.isWorkingDay"
              [attr.aria-label]="'Apertura ' + weekdays[day.weekday]"
            /><input
              type="time"
              [(ngModel)]="day.endTime"
              [name]="'end-' + day.weekday"
              [disabled]="!day.isWorkingDay"
              [attr.aria-label]="'Chiusura ' + weekdays[day.weekday]"
            />
          </div>
        </fieldset>
        <label
          >Giorni di chiusura<textarea
            [(ngModel)]="editor.closedDates"
            name="closedDates"
            rows="3"
            placeholder="Una data per riga, es. 2026-12-25"
          ></textarea></label
        ><button class="primary-btn" [disabled]="busy || !editor.name.trim()">
          {{ busy ? "Salvataggio…" : "Salva configurazione" }}
        </button>
        <p *ngIf="feedback" role="status">{{ feedback }}</p>
      </form>
    </div>
  </main>`,
  styles: [
    `
      .locations-shell {
        max-width: 1240px;
        margin: auto;
        padding: clamp(1rem, 4vw, 3rem);
        color: var(--ink, #183322);
      }
      header,
      .card-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
      }
      header {
        margin-bottom: 2rem;
      }
      h1 {
        font-family: Georgia, serif;
        font-size: clamp(2rem, 4vw, 3rem);
        line-height: 1.1;
        margin: 0.4rem 0 0.8rem;
      }
      h2 {
        font-family: Georgia, serif;
        font-size: 1.6rem;
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
        color: #667768;
      }
      .eyebrow {
        text-transform: uppercase;
        font-size: 0.72rem;
        letter-spacing: 0.18em;
        color: #9c6832;
      }
      p {
        line-height: 1.6;
      }
      .panel {
        background: #fffdf8;
        border: 1px solid #dce1d4;
        border-radius: 1.3rem;
        padding: 1.4rem;
      }
      .create-panel {
        margin-bottom: 1.4rem;
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
        color: #667768;
      }
      .sector-card {
        border-top: 1px solid #dce1d4;
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
        border-top: 1px solid #dce1d4;
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
        border-top: 1px solid #dce1d4;
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
  newSector = "Generale";
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
      await this.context.load();
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
        sectorName: this.newSector,
      })
    ) {
      this.newName = "";
      this.newAddress = "";
    }
  }
  createSector(location: any) {
    return this.change("/" + location.id + "/sectors", {
      name: location.newSectorName,
    });
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
        name: row.name,
        ...(row.isSector ? {} : { address: row.address }),
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
