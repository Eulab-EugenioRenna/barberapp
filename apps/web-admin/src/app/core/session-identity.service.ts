import { inject, Injectable } from "@angular/core";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { AuthApiService } from "./auth-api.service";
import { SessionStore } from "./session.store";
import { accessFingerprint, routeDecision } from "./route-access";

/** Background re-read of /auth/me; never blocks navigation. */
export const IDENTITY_STALE_MS = 5 * 60_000;

@Injectable({ providedIn: "root" })
export class SessionIdentityService {
  private readonly auth = inject(AuthApiService);
  private readonly store = inject(SessionStore);
  private readonly router = inject(Router);
  private pending?: Promise<void>;

  /**
   * Refreshes the stored profile when it is older than IDENTITY_STALE_MS, or
   * always with `force` (explicit «Aggiorna»). If the rights changed, the current
   * route is re-decided; a 401 ends at the login (see authInterceptor).
   */
  revalidate(force = false): Promise<void> {
    if (!this.store.isAuthenticated()) return Promise.resolve();
    if (this.pending) return this.pending;
    if (!force && this.store.userAge() < IDENTITY_STALE_MS) return Promise.resolve();
    const before = accessFingerprint(this.store.currentUser());
    this.pending = firstValueFrom(this.auth.me())
      .then((user) => {
        if (!this.store.isAuthenticated()) return;
        this.store.setCurrentUser(user);
        if (accessFingerprint(user) === before) return;
        const decision = routeDecision(user, this.router.url, this.router);
        if (decision !== true) void this.router.navigateByUrl(decision);
      })
      .catch(() => undefined)
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
}
