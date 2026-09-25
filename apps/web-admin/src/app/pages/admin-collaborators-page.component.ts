import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { InfiniteScrollDirective } from "../shared/infinite-scroll.directive";
import { AutofocusFirstDirective } from "../shared/autofocus-first.directive";
import { UiIconComponent } from "../shared/ui-icon.component";

@Component({
  selector: "barber-admin-collaborators-page",
  standalone: true,
  imports: [CommonModule, FormsModule, InfiniteScrollDirective, AutofocusFirstDirective, UiIconComponent],
  template: `
    <section class="grid gap-4">
      <article class="panel rounded-[2rem] p-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="eyebrow text-[var(--accent)]">Squadra</p>
            <h3 class="font-display text-3xl">Professionisti</h3>
          </div>
          <button type="button" class="primary-btn" (click)="openNew()">
            <barber-ui-icon name="plus"></barber-ui-icon> Nuovo professionista
          </button>
        </div>
        <label class="field mt-5">
          <span>Cerca nella squadra</span>
          <input
            [(ngModel)]="collaboratorQuery"
            name="collaboratorSearch"
            type="search"
            autocomplete="off"
            placeholder="Nome, email o telefono"
          />
        </label>
        <div class="mt-5 grid gap-3 md:grid-cols-2">
          <button
            *ngFor="let collaborator of filteredCollaborators"
            type="button"
            class="list-card text-left"
            (click)="openEdit(collaborator)"
          >
            <div>
              <strong
                >{{ collaborator.firstName }}
                {{ collaborator.lastName }}</strong
              >
              <p class="mt-1 text-sm text-[var(--muted)]">
                {{ collaborator.email || "Accesso non associato" }}
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
                {{ collaborator.isPublic ? "prenotabile online" : "solo interno" }}
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

    <div *ngIf="formOpen" class="confirm-overlay">
      <button
        type="button"
        class="confirm-backdrop"
        (click)="formOpen = false"
        aria-label="Chiudi scheda professionista"
      ></button>
      <article
        barberAutofocusFirst
        class="confirm-dialog panel max-h-[85vh] overflow-auto !w-[min(64rem,100%)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collaborator-form-title"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="eyebrow text-[var(--accent)]">Squadra</p>
            <h2
              id="collaborator-form-title"
              class="mt-2 font-display text-3xl"
            >
              <barber-ui-icon name="save"></barber-ui-icon>
              {{
                collaboratorForm.id
                  ? "Modifica professionista"
                  : "Nuovo professionista"
              }}
            </h2>
          </div>
          <button type="button" class="pill-btn" (click)="formOpen = false">
            Chiudi
          </button>
        </div>

        <form class="mt-5 grid gap-4 lg:grid-cols-2" (ngSubmit)="submit()">
          <div class="grid content-start gap-4">
          <div class="grid gap-4 md:grid-cols-2">
            <label class="field">
              <span
                >Nome <em class="required-mark" aria-hidden="true">*</em></span
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
          <div class="grid gap-4 md:grid-cols-2">
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
          <div class="grid gap-4 md:grid-cols-2">
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
          </div>
          <div class="grid content-start gap-4">
          <div class="rounded-[1.4rem] border border-[var(--line)] p-4">
            <p class="text-sm font-semibold">Orario settimanale</p>
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
                  <input
                    [(ngModel)]="schedule.startTime"
                    [name]="'weeklyStart' + i"
                    type="time"
                    [disabled]="!schedule.isWorkingDay"
                  />
                  <input
                    [(ngModel)]="schedule.endTime"
                    [name]="'weeklyEnd' + i"
                    type="time"
                    [disabled]="!schedule.isWorkingDay"
                  />
                </div>
              </article>
            </div>
          </div>
          <div class="rounded-[1.4rem] border border-[var(--line)] p-4">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm font-semibold">Eccezioni giornaliere</p>
              <button type="button" class="pill-btn" (click)="addDayOverride()">
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
                  <label class="field">
                    <span>Data</span>
                    <input
                      [(ngModel)]="override.date"
                      [name]="'overrideDate' + i"
                      type="date"
                    />
                  </label>
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
                  <input
                    [(ngModel)]="override.startTime"
                    [name]="'overrideStart' + i"
                    type="time"
                    [disabled]="!override.isWorkingDay"
                  />
                  <input
                    [(ngModel)]="override.endTime"
                    [name]="'overrideEnd' + i"
                    type="time"
                    [disabled]="!override.isWorkingDay"
                  />
                  <button
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
          </div>
          </div>
          <div class="flex flex-wrap gap-3 lg:col-span-2">
            <button
              type="submit"
              class="primary-btn"
              [disabled]="loading || !formValid"
            >
              {{
                collaboratorForm.id
                  ? "Salva professionista"
                  : "Aggiungi professionista"
              }}
            </button>
            <button
              *ngIf="
                collaboratorForm.id &&
                !isDefaultCollaborator(collaboratorForm.id)
              "
              type="button"
              class="secondary-btn"
              [disabled]="loading"
              (click)="setDefault.emit(collaboratorForm.id)"
            >
              Imposta come riferimento
            </button>
            <button
              *ngIf="collaboratorForm.id"
              type="button"
              class="pill-btn"
              [disabled]="isDefaultCollaborator(collaboratorForm.id)"
              (click)="removeCollaborator()"
            >
              <barber-ui-icon name="trash"></barber-ui-icon> Elimina
            </button>
            <span
              *ngIf="
                collaboratorForm.id &&
                isDefaultCollaborator(collaboratorForm.id)
              "
              class="status-pill status-pill-amber"
            >
              Professionista di riferimento: scegline un altro prima di eliminarlo
            </span>
            <button
              type="button"
              class="secondary-btn"
              [disabled]="loading"
              (click)="openNew()"
            >
              <barber-ui-icon name="plus"></barber-ui-icon> Nuovo professionista
            </button>
          </div>
        </form>
      </article>
    </div>
  `,
})
export class AdminCollaboratorsPageComponent {
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
