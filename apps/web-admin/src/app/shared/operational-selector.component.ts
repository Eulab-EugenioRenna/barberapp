import { Component, OnInit, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { OperationalContextService } from "../core/operational-context.service";
@Component({
  selector: "alora-operational-selector",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `<div class="scope-selector" aria-label="Ambito operativo">
    <label
      >Sede<select
        aria-label="Sede"
        [ngModel]="context.selected.locationId"
        (ngModelChange)="context.select($event)"
      >
        <option value="">Tutte le sedi abilitate</option>
        <option
          *ngFor="let location of context.locations()"
          [value]="location.id"
        >
          {{ location.name }}{{ location.isActive ? "" : " · disattivata" }}
        </option>
      </select></label
    >
    <label
      >Settore<select
        aria-label="Settore"
        [ngModel]="context.selected.sectorId"
        (ngModelChange)="context.select(context.selected.locationId, $event)"
      >
        <option value="">Tutti i settori abilitati</option>
        <ng-container *ngFor="let sector of context.sectors"
          ><option
            *ngIf="
              !context.selected.locationId ||
              sector.locationId === context.selected.locationId
            "
            [value]="sector.id"
          >
            {{ sector.label }}{{ sector.isActive ? "" : " · disattivato" }}
          </option></ng-container
        >
      </select></label
    >
    <small *ngIf="context.sectorTotal() !== null"
      >Venduto del settore, tutti i periodi: € {{ context.sectorTotal() }}</small
    >
    <small *ngIf="error" role="alert">{{ error }}</small>
  </div>`,
  styles: [
    `
      .scope-selector {
        display: grid;
        gap: 0.7rem;
        padding: 1rem 0;
      }
      label {
        display: grid;
        gap: 0.35rem;
        font-size: 0.75rem;
      }
      select {
        width: 100%;
        padding: 0.65rem;
        border: 1px solid #899b8c;
        border-radius: 0.7rem;
        color: #183322;
        background: #fff;
      }
      small {
        color: #be5144;
      }
    `,
  ],
})
export class OperationalSelectorComponent implements OnInit {
  readonly context = inject(OperationalContextService);
  error = "";
  async ngOnInit() {
    try {
      await this.context.load();
      await this.context.loadTotals();
    } catch {
      this.error = "Sedi non disponibili. Ricarica la pagina.";
    }
  }
}
