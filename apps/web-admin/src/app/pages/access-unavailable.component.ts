import { Component } from "@angular/core";
import { RouterLink } from "@angular/router";
@Component({
  standalone: true,
  imports: [RouterLink],
  template: `<main class="min-h-screen grid place-items-center p-6">
    <article class="panel rounded-3xl p-8 max-w-lg">
      <h1 class="text-2xl font-semibold">Accesso da configurare</h1>
      <p class="mt-3 text-[var(--muted)]">
        Il tuo account non dispone ancora di una sezione abilitata. Chiedi al
        titolare di verificare le autorizzazioni.
      </p>
      <a class="secondary-btn mt-6" routerLink="/login">Torna all’accesso</a>
    </article>
  </main>`,
})
export class AccessUnavailableComponent {}
