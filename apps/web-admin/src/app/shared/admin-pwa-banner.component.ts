import { CommonModule } from "@angular/common";
import { Component, inject } from "@angular/core";
import { AdminPwaService } from "../core/pwa.service";

@Component({
  selector: "barber-admin-pwa-banner",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="pwa-banner-stack" aria-live="polite">
      <section
        *ngIf="pwa.offline()"
        class="pwa-banner pwa-banner-offline"
        role="status"
      >
        <span class="pwa-banner-icon" aria-hidden="true">!</span>
        <div class="pwa-banner-copy">
          <strong>Sei offline</strong>
          <span
            >Serve una connessione per aggiornare i dati e salvare le modifiche.
            Le modifiche non salvate devono essere inviate di nuovo quando torni online.</span
          >
        </div>
      </section>

      <section
        *ngIf="pwa.showInstallBanner()"
        class="pwa-banner pwa-banner-install"
        role="status"
      >
        <img
          src="icons/icon-192.png"
          alt=""
          class="pwa-banner-app-icon"
          aria-hidden="true"
        />
        <div class="pwa-banner-copy">
          <strong>Porta ALORA sul tuo dispositivo</strong>
          <span
            >Aggiungi l'app alla schermata principale per averla sempre a
            portata di mano.</span
          >
        </div>
        <div class="pwa-banner-actions">
          <button type="button" class="pill-btn" (click)="pwa.dismissInstall()">
            Non ora
          </button>
          <button
            type="button"
            class="primary-btn pwa-banner-action"
            (click)="pwa.promptInstall()"
          >
            Installa ALORA
          </button>
        </div>
      </section>
    </div>
  `,
})
export class AdminPwaBannerComponent {
  readonly pwa = inject(AdminPwaService);
}
