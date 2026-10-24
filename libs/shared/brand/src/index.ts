import { Component, Input } from "@angular/core";

/** Product identity; tenant logos and names remain separate. */
@Component({
  selector: "alora-brand",
  standalone: true,
  host: { "[class.on-dark]": "onDark" },
  styles: [
    `
      :host {
        color: #88bd39;
        vertical-align: middle;
      }
      :host(.on-dark) {
        color: #fff;
      }
      .identity {
        display: inline-flex;
        flex-direction: column;
        align-items: flex-start;
        font-family: "Inter", sans-serif;
      }
      .name {
        display: block;
        font-size: 1.75rem;
        font-weight: 600;
        line-height: 1.15;
        letter-spacing: -0.035em;
      }
      .signature {
        display: block;
        color: #58635a;
        font-size: 0.75rem;
        font-weight: 400;
        line-height: 1.4;
        letter-spacing: 0.025em;
        margin-top: 0.3rem;
      }
      :host(.on-dark) .signature {
        display: none;
      }
    `,
  ],
  template: `<span class="identity" aria-label="alora by EULAB">
    <span class="name">alora</span><span class="signature">by EULAB</span>
  </span>`,
})
export class AloraBrandComponent {
  @Input() onDark = false;
}
