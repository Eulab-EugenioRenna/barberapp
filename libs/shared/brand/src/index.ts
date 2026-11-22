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
      .name-row {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
      }
      .pro {
        display: inline-block;
        border-radius: 0.4rem;
        background: #c8f169;
        color: #1e3425;
        font-size: 0.68rem;
        font-weight: 800;
        line-height: 1;
        letter-spacing: 0.08em;
        padding: 0.28rem 0.4rem;
      }
      :host(:not(.on-dark)) .pro {
        background: #1e3425;
        color: #c8f169;
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
  template: `<span class="identity" [attr.aria-label]="pro ? 'alora PRO by EULAB' : 'alora by EULAB'">
    <span class="name-row"
      ><span class="name">alora</span
      >@if (pro) {<span class="pro" aria-hidden="true">PRO</span>}</span
    ><span class="signature">by EULAB</span>
  </span>`,
})
export class AloraBrandComponent {
  @Input() onDark = false;
  /** Every ALORA function is active for the signed-in profile. */
  @Input() pro = false;
}
