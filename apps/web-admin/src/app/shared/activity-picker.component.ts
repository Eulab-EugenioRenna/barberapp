import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, OnInit, Output, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { UiSelectComponent, type UiOption } from "@alora/ui";
import { ActivitiesService } from "../core/activities.service";

/**
 * Activity of a service or product. A service needs an activity that runs in at
 * least one location (otherwise it could not be booked or sold anywhere); a
 * product may use any activity and defaults to «Rivendita».
 */
@Component({
  selector: "alora-activity-picker",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, UiSelectComponent],
  template: `<div class="field" data-tour="activity-picker">
    <span>Attività</span>
    <ui-select
      [ngModel]="value"
      (ngModelChange)="valueChange.emit($event)"
      [ngModelOptions]="{ standalone: true }"
      [disabled]="disabled"
      [options]="options"
      label="Attività"
      ariaLabel="Attività"
      placeholder="Scegli l’attività"
    ></ui-select>
    <small *ngIf="hint" class="activity-hint" [class.warn]="!locations && kind === 'service'">{{
      hint
    }}</small>
    <small *ngIf="!activities.active().length && activities.loaded()" class="activity-hint warn">
      Nessuna attività configurata.
      <a routerLink="/locations">Configurala in Sedi e attività</a>
    </small>
  </div>`,
  styles: [
    `
      .activity-hint {
        color: var(--muted);
        font-size: 0.8rem;
      }
      .activity-hint.warn {
        color: #b45309;
      }
      .activity-hint a {
        font-weight: 700;
        text-decoration: underline;
      }
    `,
  ],
})
export class ActivityPickerComponent implements OnInit {
  readonly activities = inject(ActivitiesService);
  @Input() value = "";
  @Input() kind: "service" | "product" = "service";
  @Input() disabled = false;
  /** Till/agenda location: only activities running there can be chosen for a service. */
  @Input() locationId = "";
  @Output() valueChange = new EventEmitter<string>();

  private optionsKey = "";
  private optionsCache: UiOption[] = [];

  get options(): UiOption[] {
    const rows = this.activities
      .activities()
      .filter((row) => row.isActive || row.id === this.value)
      .filter(
        (row) =>
          this.kind === "product" ||
          row.id === this.value ||
          row.sectors.some(
            (sector) =>
              sector.isActive && (!this.locationId || sector.locationId === this.locationId),
          ),
      );
    const options: UiOption[] = rows.map((row) => ({ value: row.id, label: row.name }));
    const key = JSON.stringify(options);
    if (key !== this.optionsKey) {
      this.optionsKey = key;
      this.optionsCache = options;
    }
    return this.optionsCache;
  }

  get locations(): string {
    return this.activities.locationNames(this.value);
  }

  get hint(): string {
    if (!this.value) return "";
    if (this.locations) return `Disponibile in: ${this.locations}`;
    return this.kind === "service"
      ? "Questa attività non è attiva in nessuna sede: il servizio non si potrà prenotare né vendere."
      : "Attività non presente nelle sedi: in cassa il prodotto va con l’attività del conto.";
  }

  async ngOnInit(): Promise<void> {
    await this.activities.load().catch(() => undefined);
    if (this.value) return;
    // Products start in «Rivendita»; a single activity for services needs no choice.
    if (this.kind === "product") {
      const resale = this.activities.resale();
      if (resale) this.valueChange.emit(resale.id);
      return;
    }
    // Preselect the first usable activity; if none can be listed (permissions
    // changed in Connect) the server picks one, saving is never blocked.
    const usable = this.options;
    if (usable.length) this.valueChange.emit(String(usable[0].value));
  }
}
