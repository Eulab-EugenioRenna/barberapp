import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, Input } from "@angular/core";

/**
 * The single heading of a page. Hierarchy: eyebrow (where you are) > title
 * (what this page is) > description (what you do here). Actions are projected
 * with the `uiPageActions` attribute; rule: at most one `primary-btn`.
 *
 * Mobile: stacked, actions wrap below the text.
 * Tablet+: text and actions on one row.
 */
@Component({
  selector: "ui-page-header",
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<header class="ui-ph">
    <div class="ui-ph-text">
      <p *ngIf="eyebrow" class="ui-ph-eyebrow">{{ eyebrow }}</p>
      <h1 class="ui-ph-title" [attr.id]="titleId">{{ title }}</h1>
      <p *ngIf="description" class="ui-ph-description">{{ description }}</p>
    </div>
    <div class="ui-ph-actions"><ng-content select="[uiPageActions]"></ng-content></div>
  </header>`,
  styles: [
    `
      :host {
        display: block;
      }
      .ui-ph {
        display: grid;
        gap: 0.9rem;
        border: 0.0625rem solid var(--line);
        border-radius: 1.5rem;
        background: var(--panel);
        box-shadow: 0 0.5rem 1.75rem rgba(30, 52, 37, 0.05);
        padding: 1rem;
      }
      .ui-ph-text {
        display: grid;
        gap: 0.3rem;
        min-width: 0;
      }
      .ui-ph-eyebrow {
        margin: 0;
        color: var(--accent);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.28em;
        text-transform: uppercase;
      }
      .ui-ph-title {
        margin: 0;
        font-family: var(--font-display);
        font-size: 1.6rem;
        font-weight: 600;
        line-height: 1.15;
        letter-spacing: -0.02em;
        overflow-wrap: anywhere;
      }
      .ui-ph-description {
        margin: 0;
        max-width: 62ch;
        color: var(--muted);
        font-size: 0.95rem;
        line-height: 1.45;
      }
      .ui-ph-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
      }
      .ui-ph-actions:empty {
        display: none;
      }

      @media (min-width: 48rem) {
        .ui-ph {
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 1.25rem;
          border-radius: 2rem;
          padding: 1.25rem 1.5rem;
        }
        .ui-ph-title {
          font-size: 2.1rem;
        }
        .ui-ph-actions {
          justify-content: flex-end;
        }
      }

      @media (min-width: 64rem) {
        .ui-ph-title {
          font-size: 2.5rem;
        }
      }
    `,
  ],
})
export class UiPageHeaderComponent {
  @Input({ required: true }) title!: string;
  @Input() eyebrow = "";
  @Input() description = "";
  @Input() titleId = "page-title";
}
