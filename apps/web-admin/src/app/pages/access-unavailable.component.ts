import { CommonModule } from "@angular/common";
import { Component, inject } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { SessionStore } from "../core/session.store";
@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `<main class="min-h-screen grid place-items-center p-6">
    <article class="panel rounded-3xl p-8 max-w-lg">
      <ng-container *ngIf="temporary; else permissions">
        <h1 class="text-2xl font-semibold">Connessione temporaneamente non disponibile</h1>
        <p class="mt-3 text-[var(--muted)]">La sessione è conservata. Attendi qualche istante e riprova ad aprire l’app.</p>
        <button type="button" class="primary-btn mt-6" [disabled]="busy" (click)="retry()">{{ busy ? "Verifica in corso…" : "Riprova" }}</button>
      </ng-container>
      <ng-template #permissions>
        <h1 class="text-2xl font-semibold">Accesso da configurare</h1>
        <p class="mt-3 text-[var(--muted)]">Il tuo account non dispone ancora di una sezione abilitata. Chiedi al titolare di verificare le autorizzazioni.</p>
        <a class="secondary-btn mt-6" routerLink="/login">Torna all’accesso</a>
      </ng-template>
    </article>
  </main>`,
})
export class AccessUnavailableComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  get temporary(): boolean { return this.route.snapshot.queryParamMap.get("reason") === "temporary"; }
  busy = false;
  async retry(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { await this.router.navigateByUrl(this.session.consumeRequestedUrl() || "/dashboard"); }
    finally { this.busy = false; }
  }
}
