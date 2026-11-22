import { Component, OnInit, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, Router } from "@angular/router";
import { AdminAuthPanelComponent } from "../auth/admin-auth-panel.component";

@Component({
  selector: "barber-admin-auth-page",
  standalone: true,
  imports: [AdminAuthPanelComponent, CommonModule],
  template: `
    <main class="admin-shell min-h-screen">
      <p *ngIf="accountNotice" class="panel mx-auto max-w-xl rounded-3xl p-5" role="status">{{ accountNotice }}</p>
      <barber-admin-auth-panel
        [mode]="authMode"
        (modeChange)="onModeChange($event)"
      ></barber-admin-auth-panel>
    </main>
  `,
})
export class AdminAuthPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  authMode: "login" | "signup" = "login";
  get accountNotice(): string {
    const messages: Record<string, string> = {
      device_revoked: "Dispositivo revocato e sessioni SSO disconnesse. Accedi nuovamente per continuare.",
      device_revoked_sessions_pending: "Dispositivo revocato. Connect non ha confermato la chiusura di tutte le sessioni SSO; verifica gli accessi nell’area account EULAB. L’accesso locale è stato chiuso.",
      sessions_closed: "Tutte le tue sessioni SSO sono state disconnesse. Accedi nuovamente per continuare.",
      authenticator_removed: "App di autenticazione rimossa: per sicurezza tutte le sessioni sono state chiuse. Accedi di nuovo; se la verifica in due passaggi è obbligatoria ti verrà chiesto di configurarla.",
      session_closed: "Questa sessione è stata disconnessa. Accedi nuovamente per continuare.",
      session_expired: "La sessione personale è scaduta o non è più valida. Accedi nuovamente per continuare.",
      outcome_unknown: "Esito dell’operazione SSO da verificare. L’accesso locale è stato chiuso; accedi e controlla lo stato prima di riprovare. Nessun tentativo automatico eseguito.",
    };
    return messages[this.route.snapshot.queryParamMap.get("accountNotice") || ""] || "";
  }

  ngOnInit(): void {
    this.authMode =
      this.route.snapshot.routeConfig?.path === "signup" ? "signup" : "login";
  }

  onModeChange(mode: "login" | "signup"): void {
    this.authMode = mode;
    void this.router.navigate([`/${mode}`]);
  }
}
