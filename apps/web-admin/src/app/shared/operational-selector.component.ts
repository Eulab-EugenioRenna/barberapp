import { Component, OnInit, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { UiIconComponent, UiSelectComponent, type UiOption } from "@alora/ui";
import { OperationalContextService } from "../core/operational-context.service";

/**
 * Operational scope bar: which location and which activity (barberia,
 * estetica, ...) the whole admin is working on. Changing it reloads the app
 * (see OperationalContextService.select).
 *
 * Mobile: one summary button that expands the two fields.
 * Tablet+: fields inline.
 */
@Component({
  selector: "alora-operational-selector",
  standalone: true,
  imports: [CommonModule, FormsModule, UiIconComponent, UiSelectComponent],
  template: `<section class="scope" aria-label="Sede e attività su cui lavori">
    <button
      type="button"
      class="summary"
      [attr.aria-expanded]="expanded"
      aria-controls="scope-fields"
      (click)="expanded = !expanded"
    >
      <ui-icon name="map-pin"></ui-icon>
      <span class="summary-text">{{ summary }}</span>
      <ui-icon name="chevron-down" class="chevron"></ui-icon>
    </button>
    <div id="scope-fields" class="fields" [class.open]="expanded">
      <div class="field-inline">
        <span>Sede</span>
        <ui-select
          label="Sede"
          [options]="locationOptions"
          [value]="context.selected.locationId"
          (valueChange)="context.select($event)"
        ></ui-select>
      </div>
      <div class="field-inline">
        <span>Attività</span>
        <ui-select
          label="Attività"
          [options]="sectorOptions"
          [value]="context.selected.sectorId"
          (valueChange)="context.select(context.selected.locationId, $event)"
        ></ui-select>
      </div>
      <p *ngIf="context.sectorTotal() !== null" class="total">
        Venduto dell'attività, da sempre: <strong>€ {{ context.sectorTotal() }}</strong>
      </p>
    </div>
    <p *ngIf="error" class="error" role="alert">{{ error }}</p>
  </section>`,
  styles: [
    `
      :host {
        display: block;
        --ui-icon-size: 1rem;
      }
      .scope {
        border: 0.0625rem solid var(--line);
        border-radius: 1.25rem;
        background: var(--panel);
        padding: 0.35rem;
      }
      .summary {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        width: 100%;
        min-height: 2.75rem;
        border: 0;
        border-radius: 1rem;
        background: transparent;
        padding: 0.4rem 0.75rem;
        color: var(--ink);
        font: inherit;
        font-weight: 600;
        text-align: left;
        cursor: pointer;
      }
      .summary-text {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .summary[aria-expanded="true"] .chevron {
        transform: rotate(180deg);
      }
      .fields {
        display: none;
        gap: 0.6rem;
        padding: 0.4rem 0.4rem 0.5rem;
      }
      .fields.open {
        display: grid;
      }
      .field-inline {
        display: grid;
        gap: 0.3rem;
        min-width: 0;
        color: var(--muted);
        font-size: 0.75rem;
        font-weight: 700;
      }
      .total {
        margin: 0;
        color: var(--muted);
        font-size: 0.8rem;
      }
      .total strong {
        color: var(--ink);
      }
      .error {
        margin: 0.4rem 0.6rem;
        color: #b91c1c;
        font-size: 0.8rem;
      }

      @media (min-width: 48rem) {
        .scope {
          padding: 0.5rem 0.75rem;
        }
        .summary {
          display: none;
        }
        .fields,
        .fields.open {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.75rem 1.25rem;
          padding: 0;
        }
        .field-inline {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8rem;
        }
        ui-select {
          width: 15rem;
          max-width: 100%;
        }
        .total {
          margin-left: auto;
        }
      }
    `,
  ],
})
export class OperationalSelectorComponent implements OnInit {
  readonly context = inject(OperationalContextService);
  error = "";
  expanded = false;

  get locationOptions(): UiOption[] {
    return this.cache("locations", () => [
      { value: "", label: "Tutte le sedi" },
      ...this.context.locations().map((location) => ({
        value: location.id,
        label: location.name,
        hint: location.isActive ? location.address || undefined : "disattivata",
      })),
    ]);
  }

  get sectorOptions(): UiOption[] {
    const locationId = this.context.selected.locationId;
    return this.cache("sectors:" + locationId, () => [
      { value: "", label: "Tutte le attività" },
      ...this.context.sectors
        .filter((sector) => !locationId || sector.locationId === locationId)
        .map((sector) => ({
          value: sector.id,
          label: sector.name,
          hint: sector.isActive ? undefined : "disattivata",
          // Without a location filter, activities are grouped by location.
          group: locationId ? undefined : sector.label.split(" · ")[0],
        })),
    ]);
  }

  /** Options keep their identity until the loaded locations change. */
  private readonly memo = new Map<string, { source: unknown; value: UiOption[] }>();
  private cache(key: string, build: () => UiOption[]): UiOption[] {
    const source = this.context.locations();
    const hit = this.memo.get(key);
    if (hit && hit.source === source) return hit.value;
    const value = build();
    this.memo.set(key, { source, value });
    return value;
  }

  get summary(): string {
    const { locationId, sectorId } = this.context.selected;
    const location = this.context.locations().find((item) => item.id === locationId);
    const sector = this.context.sectors.find((item) => item.id === sectorId);
    const where = location?.name ?? "Tutte le sedi";
    const what = sector?.name ?? "tutte le attività";
    return `${where} · ${what}`;
  }

  async ngOnInit() {
    try {
      await this.context.load();
      await this.context.loadTotals();
    } catch {
      this.error = "Sedi non disponibili. Ricarica la pagina.";
    }
  }
}
