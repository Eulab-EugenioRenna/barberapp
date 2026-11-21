import { CommonModule } from "@angular/common";
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  inject,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { OperationalContextService } from "../core/operational-context.service";
@Component({
  selector: "alora-sector-picker",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `<label class="field"
    ><span>Settore</span
    ><select
      [ngModel]="value"
      (ngModelChange)="valueChange.emit($event)"
      [ngModelOptions]="{ standalone: true }"
      [disabled]="disabled"
      aria-label="Settore dell’operazione"
      required
    >
      <option value="">Seleziona un settore</option>
      <option *ngFor="let sector of choices" [value]="sector.id">
        {{ sector.label }}{{ sector.isActive ? "" : " · disattivato" }}
      </option></select
    ><small *ngIf="error" role="alert">{{ error }}</small></label
  >`,
  styles: [
    `
      select {
        padding: 0.7rem;
        border: 1px solid var(--line, #bfcaba);
        border-radius: 0.65rem;
        background: white;
        width: 100%;
        color: var(--ink, #183322);
      }
    `,
  ],
})
export class SectorPickerComponent implements OnInit {
  readonly context = inject(OperationalContextService);
  @Input() value = "";
  @Input() locationId = "";
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();
  error = "";
  get choices() {
    const selected = this.context.selected;
    return this.context.sectors.filter(
      (sector) =>
        (!this.locationId || sector.locationId === this.locationId) &&
        (!selected.locationId || sector.locationId === selected.locationId) &&
        (!selected.sectorId || sector.id === selected.sectorId),
    );
  }
  async ngOnInit() {
    try {
      if (!this.context.locations().length) await this.context.load();
      if (!this.value && this.choices.length === 1)
        this.valueChange.emit(this.choices[0].id);
    } catch {
      this.error = "Settori non disponibili";
    }
  }
}
