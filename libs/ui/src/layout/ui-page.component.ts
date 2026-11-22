import { ChangeDetectionStrategy, Component } from "@angular/core";

/**
 * Page body: a vertical stack with the design system rhythm. Every page is
 * `<ui-page>` > `<ui-page-header>` > sections, so spacing is never redefined.
 */
@Component({
  selector: "ui-page",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content></ng-content>`,
  styles: [
    `
      :host {
        display: grid;
        /* minmax(0, 1fr): wide content scrolls inside its section, never widens the page. */
        grid-template-columns: minmax(0, 1fr);
        align-content: start;
        gap: 0.75rem;
        min-width: 0;
        padding-bottom: 1rem;
      }
      @media (min-width: 48rem) {
        :host {
          gap: 1rem;
          padding-bottom: 1.5rem;
        }
      }
    `,
  ],
})
export class UiPageComponent {}
