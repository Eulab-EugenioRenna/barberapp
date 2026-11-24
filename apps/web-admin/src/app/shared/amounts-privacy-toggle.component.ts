import { Component, inject } from "@angular/core";
import { AmountsPrivacyService } from "../core/amounts-privacy.service";

/** «Nascondi gli importi in Panoramica», a preference of this device. */
@Component({
  selector: "alora-amounts-privacy-toggle",
  standalone: true,
  template: `
    <label class="privacy-toggle">
      <input type="checkbox" [checked]="privacy.hidden()" (change)="privacy.set($any($event.target).checked)" />
      <span>
        <strong>Nascondi gli importi in Panoramica</strong>
        <small>Su questo dispositivo cifre e saldi compaiono come **,**: utile se lo schermo è visibile ai clienti.</small>
      </span>
    </label>
  `,
  styles: [
    `
      .privacy-toggle { display: flex; gap: 0.75rem; align-items: flex-start; cursor: pointer; }
      .privacy-toggle input { margin-top: 0.2rem; width: 1.05rem; height: 1.05rem; flex: none; }
      .privacy-toggle span { display: grid; gap: 0.2rem; }
      .privacy-toggle strong { font-size: 0.9rem; }
      .privacy-toggle small { font-size: 0.78rem; color: var(--muted); }
    `,
  ],
})
export class AmountsPrivacyToggleComponent {
  readonly privacy = inject(AmountsPrivacyService);
}
