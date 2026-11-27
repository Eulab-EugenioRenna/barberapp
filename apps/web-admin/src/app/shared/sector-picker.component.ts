import { CommonModule } from "@angular/common";
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  inject,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { UiSelectComponent, type UiOption } from "@alora/ui";
import { OperationalContextService } from "../core/operational-context.service";
@Component({
  selector: "alora-sector-picker",
  standalone: true,
  imports: [CommonModule, FormsModule, UiSelectComponent],
  // One location with one activity: nothing to choose, it is assigned silently.
  template: `<div class="field" *ngIf="!single || error || !value"
    ><span>Attività</span
    ><ui-select
      [ngModel]="value"
      (ngModelChange)="valueChange.emit($event)"
      [ngModelOptions]="{ standalone: true }"
      [disabled]="disabled"
      [options]="sectorOptions"
      label="Attività"
      ariaLabel="Attività della sede per questa operazione"
      placeholder="Seleziona l’attività"
      required
    ></ui-select
    ><small *ngIf="error" role="alert">{{ error }}</small></div
  >`,
})
export class SectorPickerComponent implements OnInit, OnChanges {
  readonly context = inject(OperationalContextService);
  @Input() value = "";
  @Input() locationId = "";
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();
  error = "";
  /** The salon has a single location and a single activity. */
  get single(): boolean {
    return this.context.locations().length === 1 && this.context.sectors.length === 1 && this.choices.length === 1;
  }
  get choices() {
    const selected = this.context.selected;
    return this.context.sectors.filter(
      (sector) =>
        (!this.locationId || sector.locationId === this.locationId) &&
        (!selected.locationId || sector.locationId === selected.locationId) &&
        (!selected.sectorId || sector.id === selected.sectorId),
    );
  }
  private sectorOptionsKey = "";
  private sectorOptionsCache: UiOption[] = [];
  get sectorOptions(): UiOption[] {
    const options: UiOption[] = [
      { value: "", label: "Seleziona l’attività" },
      ...this.choices.map((sector) => ({
        value: sector.id,
        label: `${sector.label}${sector.isActive ? "" : " · disattivato"}`,
      })),
    ];
    const key = JSON.stringify(options);
    if (key !== this.sectorOptionsKey) {
      this.sectorOptionsKey = key;
      this.sectorOptionsCache = options;
    }
    return this.sectorOptionsCache;
  }
  /** A form reset empties the value: with one choice it is assigned again. */
  ngOnChanges() {
    if (!this.value && this.context.locations().length && this.choices.length === 1)
      queueMicrotask(() => { if (!this.value) this.valueChange.emit(this.choices[0].id); });
  }
  async ngOnInit() {
    try {
      if (!this.context.locations().length) await this.context.load();
      if (!this.value && this.choices.length === 1)
        this.valueChange.emit(this.choices[0].id);
    } catch {
      this.error = "Attività non disponibili";
    }
  }
}
