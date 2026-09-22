import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";

@Component({
  selector: "barber-admin-collaborators-page",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="grid gap-4 xl:grid-cols-2">
      <article class="panel rounded-[2rem] p-5">
        <p class="eyebrow text-[var(--accent)]">Team</p>
        <h3 class="font-display text-3xl">Collaboratori</h3>
        <div class="mt-5 grid gap-3 md:grid-cols-2">
          <button
            *ngFor="let collaborator of collaborators"
            type="button"
            class="list-card text-left"
            (click)="edit.emit(collaborator)"
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
                >default</span
              >
              <span
                class="status-pill"
                [ngClass]="collaboratorStatusClass(collaborator.isPublic)"
              >
                {{ collaborator.isPublic ? "visibile online" : "interno" }}
              </span>
            </div>
          </button>
        </div>
      </article>

      <article class="dark-panel rounded-[2rem] p-5 text-white">
        <p class="eyebrow text-white/45">CRUD collaboratori</p>
        <h3 class="font-display text-3xl">
          {{
            collaboratorForm.id
              ? "Modifica collaboratore"
              : "Nuovo collaboratore"
          }}
        </h3>
        <form class="mt-5 grid gap-4" (ngSubmit)="save.emit()">
          <div class="grid gap-4 md:grid-cols-2">
            <label class="field">
              <span>Nome</span>
              <input
                [(ngModel)]="collaboratorForm.firstName"
                name="collaboratorFirstName"
              />
            </label>
            <label class="field">
              <span>Cognome</span>
              <input
                [(ngModel)]="collaboratorForm.lastName"
                name="collaboratorLastName"
              />
            </label>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <label class="field">
              <span>Email</span>
              <input
                [(ngModel)]="collaboratorForm.email"
                name="collaboratorEmail"
              />
            </label>
            <label class="field">
              <span>Telefono</span>
              <input
                [(ngModel)]="collaboratorForm.phone"
                name="collaboratorPhone"
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
              <span>Visibile nel booking pubblico</span>
            </label>
          </div>
          <div class="rounded-[1.4rem] border border-white/10 p-4">
            <p class="text-sm font-semibold text-white">Orari feriali</p>
            <div class="mt-4 grid gap-3">
              <article
                *ngFor="
                  let schedule of collaboratorForm.weeklySchedules;
                  let i = index
                "
                class="rounded-[1rem] border border-white/10 p-3"
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
          <div class="rounded-[1.4rem] border border-white/10 p-4">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm font-semibold text-white">
                Eccezioni giornaliere
              </p>
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
                class="rounded-[1rem] border border-white/10 p-3"
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
                class="text-sm text-white/60"
              >
                Nessuna eccezione configurata.
              </p>
            </div>
          </div>
          <div class="flex flex-wrap gap-3">
            <button type="submit" class="primary-btn" [disabled]="loading">
              {{
                collaboratorForm.id
                  ? "Salva collaboratore"
                  : "Crea collaboratore"
              }}
            </button>
            <button
              *ngIf="
                collaboratorForm.id &&
                !isDefaultCollaborator(collaboratorForm.id)
              "
              type="button"
              class="secondary-btn"
              (click)="setDefault.emit(collaboratorForm.id)"
            >
              Imposta come default
            </button>
            <button
              *ngIf="collaboratorForm.id"
              type="button"
              class="pill-btn"
              [disabled]="isDefaultCollaborator(collaboratorForm.id)"
              (click)="remove.emit()"
            >
              Elimina
            </button>
            <span
              *ngIf="
                collaboratorForm.id &&
                isDefaultCollaborator(collaboratorForm.id)
              "
              class="status-pill status-pill-amber"
            >
              Collaboratore default: impostane un altro prima di eliminarlo
            </span>
            <button type="button" class="secondary-btn" (click)="reset.emit()">
              Reset
            </button>
          </div>
        </form>
      </article>
    </section>
  `,
})
export class AdminCollaboratorsPageComponent {
  @Input() collaborators: any[] = [];
  @Input() collaboratorForm: any = {};
  @Input() defaultCollaboratorId = "";
  @Input() loading = false;

  @Output() edit = new EventEmitter<any>();
  @Output() save = new EventEmitter<void>();
  @Output() setDefault = new EventEmitter<string>();
  @Output() remove = new EventEmitter<void>();
  @Output() reset = new EventEmitter<void>();

  readonly weekdayLabels = [
    "Lunedi",
    "Martedi",
    "Mercoledi",
    "Giovedi",
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
