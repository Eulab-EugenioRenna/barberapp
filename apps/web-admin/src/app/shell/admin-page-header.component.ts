import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from "@angular/core";
import { UiIconComponent, UiPageHeaderComponent } from "@alora/ui";
import { TourService } from "../core/onboarding/tour.service";
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
            [class.spinning]="refreshing" aria-label="Aggiorna i dati" data-tip="Aggiorna" (click)="refresh.emit()">
            <ui-icon name="refresh"></ui-icon>
          </button>
        }
        <alora-notifications-bell></alora-notifications-bell>
        @if (tour.hasTour(navKey)) {
          @if (tour.hintFor(navKey)) {
            <!-- Quiet suggestion: never opens anything, never takes focus. -->
            <span class="guide-hint">
              <button type="button" class="guide-hint-label" (click)="tour.startGuide(navKey)">
                Nuovo? Guarda la guida
              </button>
              <button type="button" class="guide-hint-close" aria-label="Non suggerire la guida di questa pagina"
                data-tip="Non suggerire più" (click)="tour.dismissHint(navKey)">
                <span aria-hidden="true">×</span>
              </button>
            </span>
          }
          <button type="button" class="icon-btn guide-btn" data-tour="page-guide"
            [class.has-hint]="tour.hintFor(navKey)"
            [attr.aria-label]="tour.hintFor(navKey) ? 'Guida passo passo di questa pagina (nuova)' : 'Guida passo passo di questa pagina'"
            data-tip="Guida" (click)="tour.startGuide(navKey)">
            <ui-icon name="help"></ui-icon>
            @if (tour.hintFor(navKey)) {
              <span class="guide-dot" aria-hidden="true"></span>
            }
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
      .guide-btn {
        position: relative;
      }
      .guide-dot {
        position: absolute;
        top: 0.3rem;
        right: 0.3rem;
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 999px;
        background: var(--accent, #0f3d32);
        box-shadow: 0 0 0 2px var(--surface, #fff);
        pointer-events: none;
      }
      .guide-hint {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        border: 1px solid color-mix(in srgb, var(--accent, #0f3d32) 25%, transparent);
        background: color-mix(in srgb, var(--accent, #0f3d32) 8%, transparent);
        color: var(--accent, #0f3d32);
        font-size: 0.78rem;
        font-weight: 600;
        line-height: 1;
        white-space: nowrap;
      }
      .guide-hint button {
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .guide-hint-label {
        padding: 0.4rem 0.25rem 0.4rem 0.7rem;
      }
      .guide-hint-close {
        padding: 0.4rem 0.6rem 0.4rem 0.3rem;
        font-size: 0.95rem;
        opacity: 0.7;
      }
      .guide-hint-close:hover,
      .guide-hint-close:focus-visible {
        opacity: 1;
      }
      /* One soft fade-in, nothing looping; skipped when motion is reduced. */
      @media (prefers-reduced-motion: no-preference) {
        .guide-hint,
        .guide-dot {
          animation: guide-hint-in 0.4s ease-out both;
        }
      }
      @keyframes guide-hint-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      /* Narrow screens: only the dot on «Guida», the header stays on one line. */
      @media (max-width: 40rem) {
        .guide-hint {
          display: none;
        }
      }
    `,
  ],
})
export class AdminPageHeaderComponent {
  readonly tour = inject(TourService);
  @Input({ required: true }) navKey!: AdminNavKey;
  /** Shows the refresh icon when bound; `refreshing` disables it and turns it. */
  @Output() readonly refresh = new EventEmitter<void>();
  @Input() refreshing = false;
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
