import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from "@angular/core";
import { UiIconComponent, UiPageHeaderComponent } from "@alora/ui";
import { TourService } from "../core/onboarding/tour.service";
import { SessionIdentityService } from "../core/session-identity.service";
import { NotificationsBellComponent } from "./notifications-bell.component";
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
  imports: [UiPageHeaderComponent, UiIconComponent, NotificationsBellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ui-page-header
    [eyebrow]="eyebrow"
    [title]="title"
    [description]="description"
  >
    <div uiPageActions class="actions">
      <ng-content select="[uiPageActions]"></ng-content>
      <!-- Same three icons on every page: refresh, notifications, guide. -->
      <span class="tools">
        @if (refresh.observed) {
          <button type="button" class="icon-btn" [attr.data-tour]="refreshTour" [disabled]="refreshing"
            [class.spinning]="refreshing" aria-label="Aggiorna i dati" data-tip="Aggiorna" (click)="refreshAll()">
            <ui-icon name="refresh"></ui-icon>
          </button>
        }
        <alora-notifications-bell></alora-notifications-bell>
        @if (tour.hasTour(navKey)) {
          <button type="button" class="icon-btn" data-tour="page-guide"
            aria-label="Guida passo passo di questa pagina" data-tip="Guida" (click)="tour.start(navKey)">
            <ui-icon name="help"></ui-icon>
          </button>
        }
      </span>
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
      .tools {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }
      .spinning ui-icon {
        animation: header-spin 0.9s linear infinite;
      }
      @keyframes header-spin {
        to { transform: rotate(360deg); }
      }
    `,
  ],
})
export class AdminPageHeaderComponent {
  readonly tour = inject(TourService);
  private readonly identity = inject(SessionIdentityService);
  @Input({ required: true }) navKey!: AdminNavKey;
  /** Shows the refresh icon when bound; `refreshing` disables it and turns it. */
  @Output() readonly refresh = new EventEmitter<void>();
  @Input() refreshing = false;

  /** Explicit «Aggiorna»: page data plus, in background, the session profile. */
  refreshAll(): void {
    void this.identity.revalidate(true);
    this.refresh.emit();
  }
  /** Anchor used by the page guide. */
  @Input() refreshTour = "page-refresh";
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
