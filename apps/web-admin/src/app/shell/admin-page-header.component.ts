import { ChangeDetectionStrategy, Component, Input, inject } from "@angular/core";
import { UiIconComponent, UiPageHeaderComponent } from "@alora/ui";
import { TourService } from "../core/onboarding/tour.service";
import {
  findNavEntry,
  navGroupLabel,
  type AdminNavKey,
} from "../core/admin-navigation";

/**
 * Page header bound to the navigation config: title, group and description
 * come from ADMIN_NAV so a page cannot drift from its menu entry.
 * Actions: `<button uiPageActions ...>`; at most one `primary-btn`.
 */
@Component({
  selector: "alora-page-header",
  standalone: true,
  imports: [UiPageHeaderComponent, UiIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ui-page-header
    [eyebrow]="eyebrow"
    [title]="title"
    [description]="description"
  >
    <div uiPageActions class="actions">
      <ng-content select="[uiPageActions]"></ng-content>
      @if (tour.hasTour(navKey)) {
        <button
          type="button"
          class="ghost-btn guide-btn"
          data-tour="page-guide"
          aria-label="Guida passo passo di questa pagina"
          (click)="tour.start(navKey)"
        >
          <ui-icon name="help"></ui-icon>
          <span>Guida</span>
        </button>
      }
    </div>
  </ui-page-header>`,
  styles: [
    `
      :host {
        display: block;
      }
      .actions {
        display: contents;
      }
      .guide-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
      }
    `,
  ],
})
export class AdminPageHeaderComponent {
  readonly tour = inject(TourService);
  @Input({ required: true }) navKey!: AdminNavKey;
  /** Overrides the configured title (e.g. a selected team member's agenda). */
  @Input() titleOverride = "";

  get entry() {
    return findNavEntry(this.navKey);
  }
  get title(): string {
    return this.titleOverride || this.entry?.label || "";
  }
  get eyebrow(): string {
    return this.entry ? navGroupLabel(this.entry) : "";
  }
  get description(): string {
    return this.entry?.description ?? "";
  }
}
