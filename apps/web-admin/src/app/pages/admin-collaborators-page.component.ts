import { TimeSelectComponent } from "../shared/time-select.component";
import { CalendarInputComponent } from "../calendar-input.component";
import { RouterLink } from "@angular/router";
import { SectorPickerComponent } from "../shared/sector-picker.component";
import { AdminTeamPageComponent } from "./admin-team-page.component";
import { SessionStore } from "../core/session.store";
import { FunctionAccessDirective } from "../shared/function-access.directive";
import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { InfiniteScrollDirective } from "../shared/infinite-scroll.directive";
import { AutofocusFirstDirective } from "../shared/autofocus-first.directive";
import { UiIconComponent } from "../shared/ui-icon.component";
import { UiSheetComponent } from "@alora/ui";

@Component({
  selector: "barber-admin-collaborators-page",
  standalone: true,
  imports: [TimeSelectComponent, 
    CalendarInputComponent,
    RouterLink,
    SectorPickerComponent,
    AdminTeamPageComponent,
    FunctionAccessDirective,
    CommonModule,
    FormsModule,
    InfiniteScrollDirective,
    AutofocusFirstDirective,
    UiIconComponent,
    UiSheetComponent,
  ],
  template: `
    <alora-admin-team-page
      *ngIf="canManageAccounts"
      [professionals]="collaborators"
      (editProfessional)="openEdit($event)"
      (newProfessional)="openNew()"
    ></alora-admin-team-page>
    <section *ngIf="!canManageAccounts" class="grid gap-4">
      <article class="panel rounded-[2rem] p-4 sm:p-5">
        <div class="page-head">
          <div class="min-w-0">
            <p class="eyebrow text-[var(--accent)]">Squadra</p>
            <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 class="font-display text-2xl sm:text-3xl">Professionisti</h3>
              <span class="status-pill status-pill-neutral"
                >{{ filteredCollaborators.length }} in squadra</span
              >
            </div>
          </div>
          <button
            aloraFunction="collaborators.manage"
            type="button"
            class="primary-btn"
            data-tour="collaborators-new"
            (click)="openNew()"
          >
            <barber-ui-icon name="plus"></barber-ui-icon> Nuovo collaboratore
          </button>
        </div>
        <label class="field mt-4" data-tour="collaborators-search">
          <span>Cerca nella squadra</span>
          <input
            [(ngModel)]="collaboratorQuery"
            name="collaboratorSearch"
            type="search"
            autocomplete="off"
            placeholder="Nome, email o telefono"
          />
        </label>
        <div class="mt-4 grid gap-2.5 sm:gap-3 md:grid-cols-2">
          <button
            *ngFor="let collaborator of filteredCollaborators"
            type="button"
            class="list-card text-left"
            data-tour="collaborators-card"
            (click)="openEdit(collaborator)"
          >
            <div>
              <strong
                >{{ collaborator.firstName }}
                {{ collaborator.lastName }}</strong
              >
              <p class="mt-1 text-sm text-[var(--muted)]">
                {{ collaborator.email || "Profilo professionista" }}
              </p>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <span
                *ngIf="isDefaultCollaborator(collaborator.id)"
                class="status-pill status-pill-amber"
                >riferimento</span
              >
              <span
                class="status-pill"
                [ngClass]="collaboratorStatusClass(collaborator.isPublic)"
              >
                {{
                  collaborator.isPublic ? "prenotabile online" : "solo interno"
                }}
              </span>
            </div>
          </button>
          <article
            *ngIf="!filteredCollaborators.length"
            class="rounded-2xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--muted)] md:col-span-2"
          >
            La squadra è ancora vuota. Aggiungi il primo professionista.
          </article>
          <div
            *ngIf="hasMore"
            class="h-px w-full md:col-span-2"
            barberInfiniteScroll
            (loadMore)="loadMore.emit()"
          ></div>
        </div>
      </article>
    </section>

    <ui-sheet
      *ngIf="formOpen"
      size="lg"
      eyebrow="Squadra"
      [title]="collaboratorForm.id ? 'Modifica collaboratore' : 'Nuovo collaboratore'"
      subtitle="Dati della persona, orario settimanale ed eccezioni: salva quando hai finito."
      closeLabel="Chiudi scheda professionista"
      (close)="formOpen = false"
    >
      <ol class="ui-steps" aria-label="Sezioni della scheda">
        <li
          *ngFor="let section of editorSections; let n = index"
          [class.ui-step-on]="editorSection === section.key"
        >
          <button
            type="button"
            [attr.aria-current]="editorSection === section.key ? 'step' : null"
            (click)="editorSection = section.key"
          >
            {{ n + 1 }} · {{ section.label }}
          </button>
        </li>
      </ol>
      <form
        barberAutofocusFirst
        id="collaborator-form"
        class="grid content-start gap-4"
        (ngSubmit)="submit()"
      >
        <section *ngIf="editorSection === 'data'" class="grid content-start gap-4">
            <alora-sector-picker
              *ngIf="!collaboratorForm.id"
              [(value)]="collaboratorForm.sectorId"
            ></alora-sector-picker>
            <a
              *ngIf="collaboratorForm.id"
              routerLink="/locations"
              class="secondary-btn"
              >Sedi e attività in cui lavora</a
            >
            <div class="grid gap-3 sm:gap-4 md:grid-cols-2">
              <label class="field">
                <span
                  >Nome
                  <em class="required-mark" aria-hidden="true">*</em></span
                >
                <input
                  [(ngModel)]="collaboratorForm.firstName"
                  name="collaboratorFirstName"
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
                  [(ngModel)]="collaboratorForm.lastName"
                  name="collaboratorLastName"
                  autocomplete="family-name"
                  required
                />
              </label>
            </div>
            <div class="grid gap-3 sm:gap-4 md:grid-cols-2">
              <label class="field">
                <span>Email</span>
                <input
                  [(ngModel)]="collaboratorForm.email"
                  name="collaboratorEmail"
                  type="email"
                  autocomplete="email"
                />
              </label>
              <label class="field">
                <span>Telefono</span>
                <input
                  [(ngModel)]="collaboratorForm.phone"
                  name="collaboratorPhone"
                  type="tel"
                  autocomplete="tel"
                />
              </label>
            </div>
            <div class="grid gap-3 sm:gap-4 md:grid-cols-2">
              <label class="field">
                <span>Colore calendario</span>
                <input
                  [(ngModel)]="collaboratorForm.calendarColor"
                  name="collaboratorCalendarColor"
                  type="color"
                />
              </label>
              <label class="field checkbox-field pt-6">
                <input
                  [(ngModel)]="collaboratorForm.isPublic"
                  name="collaboratorIsPublic"
                  type="checkbox"
                />
                <span>Prenotabile dai clienti online</span>
              </label>
            </div>
        </section>
        <section *ngIf="editorSection === 'hours'" class="ui-section">
          <p class="ui-step">Orario settimanale</p>
              <div class="mt-4 grid gap-3">
                <article
                  *ngFor="
                    let schedule of collaboratorForm.weeklySchedules;
                    let i = index
                  "
                  class="rounded-[1rem] border border-[var(--line)] p-3"
                >
                  <div
                    class="grid gap-3 md:grid-cols-[1.1fr_0.8fr_0.8fr_auto] md:items-center"
                  >
                    <strong>{{ weekdayLabels[i] }}</strong>
                    <label class="field checkbox-field">
                      <input
                        [(ngModel)]="schedule.isWorkingDay"
                        [name]="'weeklyWorking' + i"
                        type="checkbox"
                      />
                      <span>Lavora</span>
                    </label>
                    <alora-time-select
                      label="Inizio turno"
                      [value]="schedule.startTime"
                      (valueChange)="schedule.startTime = $event"
                      [disabled]="!schedule.isWorkingDay"
                    ></alora-time-select>
                    <alora-time-select
                      label="Fine turno"
                      [value]="schedule.endTime"
                      (valueChange)="schedule.endTime = $event"
                      [disabled]="!schedule.isWorkingDay"
                    ></alora-time-select>
                  </div>
                </article>
              </div>
        </section>
        <section *ngIf="editorSection === 'exceptions'" class="ui-section">
          <div class="flex items-center justify-between gap-3">
            <p class="ui-step">Eccezioni giornaliere</p>
            <button
              aloraFunction="collaborators.manage"
              type="button"
              class="pill-btn"
              (click)="addDayOverride()"
            >
              Aggiungi giorno
            </button>
          </div>
              <div class="mt-4 grid gap-3">
                <article
                  *ngFor="
                    let override of collaboratorForm.dayOverrides;
                    let i = index
                  "
                  class="rounded-[1rem] border border-[var(--line)] p-3"
                >
                  <div class="grid gap-3 md:grid-cols-2">
                    <div class="field">
                      <span>Data</span>
                      <barber-calendar-input
                        compact
                        label="Data"
                        placeholder="Scegli il giorno"
                        [value]="override.date"
                        (valueChange)="override.date = $event"
                      ></barber-calendar-input>
                    </div>
                    <label class="field checkbox-field pt-6">
                      <input
                        [(ngModel)]="override.isHoliday"
                        [name]="'overrideHoliday' + i"
                        type="checkbox"
                      />
                      <span>Festivo</span>
                    </label>
                  </div>
                  <div
                    class="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-center"
                  >
                    <label class="field checkbox-field">
                      <input
                        [(ngModel)]="override.isWorkingDay"
                        [name]="'overrideWorking' + i"
                        type="checkbox"
                      />
                      <span>Disponibile</span>
                    </label>
                    <alora-time-select
                      label="Inizio"
                      [value]="override.startTime"
                      (valueChange)="override.startTime = $event"
                      [disabled]="!override.isWorkingDay"
                    ></alora-time-select>
                    <alora-time-select
                      label="Fine"
                      [value]="override.endTime"
                      (valueChange)="override.endTime = $event"
                      [disabled]="!override.isWorkingDay"
                    ></alora-time-select>
                    <button
                      aloraFunction="collaborators.manage"
                      type="button"
                      class="pill-btn"
                      (click)="removeDayOverride(i)"
                    >
                      Rimuovi
                    </button>
                  </div>
                  <label class="field mt-3">
                    <span>Nota</span>
                    <input
                      [(ngModel)]="override.note"
                      [name]="'overrideNote' + i"
                      placeholder="Chiuso per festa locale"
                    />
                  </label>
                </article>
                <p
                  *ngIf="!collaboratorForm.dayOverrides?.length"
                  class="text-sm text-[var(--muted)]"
                >
                  Nessuna eccezione configurata.
                </p>
              </div>
        </section>
      </form>
      <ng-container ngProjectAs="[uiSheetBar]">
        <button
          aloraFunction="collaborators.manage"
          *ngIf="collaboratorForm.id"
          type="button"
          class="danger-btn ui-bar-start"
          [disabled]="isDefaultCollaborator(collaboratorForm.id)"
          [attr.title]="
            isDefaultCollaborator(collaboratorForm.id)
              ? 'Professionista di riferimento: scegline un altro prima di eliminarlo'
              : null
          "
          (click)="removeCollaborator()"
        >
          <barber-ui-icon name="trash"></barber-ui-icon> Elimina
        </button>
        <span
          *ngIf="collaboratorForm.id && isDefaultCollaborator(collaboratorForm.id)"
          class="ui-bar-info"
          >Professionista di riferimento</span
        >
        <button
          aloraFunction="settings.manage"
          *ngIf="collaboratorForm.id && !isDefaultCollaborator(collaboratorForm.id)"
          type="button"
          class="pill-btn"
          [disabled]="loading"
          (click)="setDefault.emit(collaboratorForm.id)"
        >
          Imposta come riferimento
        </button>
        <button
          aloraFunction="collaborators.manage"
          type="submit"
          form="collaborator-form"
          class="primary-btn"
          [disabled]="loading || !formValid"
        >
          <barber-ui-icon name="save"></barber-ui-icon>
          {{ collaboratorForm.id ? "Salva professionista" : "Aggiungi professionista" }}
        </button>
      </ng-container>
    </ui-sheet>
  `,
})
export class AdminCollaboratorsPageComponent {
  private readonly session = inject(SessionStore);
  get canManageAccounts(): boolean {
    return this.session.can("users.manage");
  }
  @Input() collaborators: any[] = [];
  @Input() collaboratorForm: any = {};
  @Input() defaultCollaboratorId = "";
  @Input() loading = false;
  @Input() hasMore = false;

  @Output() edit = new EventEmitter<any>();
  @Output() save = new EventEmitter<void>();
  @Output() setDefault = new EventEmitter<string>();
  @Output() remove = new EventEmitter<void>();
  @Output() reset = new EventEmitter<void>();
  @Output() loadMore = new EventEmitter<void>();

  formOpen = false;
  collaboratorQuery = "";
  /** Editor sections, shown one at a time: 1 · Dati, 2 · Orari, 3 · Eccezioni. */
  readonly editorSections = [
    { key: "data", label: "Dati" },
    { key: "hours", label: "Orari" },
    { key: "exceptions", label: "Eccezioni" },
  ] as const;
  editorSection: "data" | "hours" | "exceptions" = "data";

  get filteredCollaborators(): any[] {
    const query = this.collaboratorQuery.trim().toLowerCase();
    if (!query) {
      return this.collaborators;
    }
    return this.collaborators.filter((collaborator) =>
      [
        collaborator.firstName,
        collaborator.lastName,
        collaborator.email,
        collaborator.phone,
      ]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }

  openEdit(collaborator: any): void {
    this.edit.emit(collaborator);
    this.editorSection = "data";
    this.formOpen = true;
  }

  openNew(): void {
    this.reset.emit();
    this.editorSection = "data";
    this.formOpen = true;
  }

  submit(): void {
    this.save.emit();
    this.formOpen = false;
  }

  removeCollaborator(): void {
    this.formOpen = false;
    this.remove.emit();
  }

  get formValid(): boolean {
    return Boolean(
      collaboratorText(this.collaboratorForm.firstName) &&
      collaboratorText(this.collaboratorForm.lastName),
    );
  }

  readonly weekdayLabels = [
    "Lunedì",
    "Martedì",
    "Mercoledì",
    "Giovedì",
    "Venerdi",
    "Sabato",
    "Domenica",
  ];

  isDefaultCollaborator(collaboratorId: string): boolean {
    return this.defaultCollaboratorId === collaboratorId;
  }

  collaboratorStatusClass(isPublic: boolean): string {
    return isPublic ? "status-pill-green" : "status-pill-neutral";
  }

  addDayOverride(): void {
    this.collaboratorForm.dayOverrides = [
      ...(this.collaboratorForm.dayOverrides || []),
      {
        date: "",
        isWorkingDay: false,
        startTime: "09:00",
        endTime: "19:00",
        note: "",
        isHoliday: false,
      },
    ];
  }

  removeDayOverride(index: number): void {
    this.collaboratorForm.dayOverrides = (
      this.collaboratorForm.dayOverrides || []
    ).filter((_: unknown, currentIndex: number) => currentIndex !== index);
  }
}

function collaboratorText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
