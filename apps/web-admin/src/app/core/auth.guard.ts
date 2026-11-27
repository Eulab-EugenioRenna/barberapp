import { isTransientAuthError } from "./auth-errors";
import { firstValueFrom } from "rxjs";
import { AuthApiService } from "./auth-api.service";
import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { SessionStore } from "./session.store";
import { SessionIdentityService } from "./session-identity.service";
import { routeDecision } from "./route-access";

/**
 * Decides synchronously from the profile kept in sessionStorage (taken at login).
 * /auth/me blocks only when this tab has no profile yet; otherwise it is re-read
 * in background (throttled) and never holds a navigation.
 */
export const authGuard: CanActivateFn = async (_, state) => {
  const sessionStore = inject(SessionStore);
  const router = inject(Router);
  const auth = inject(AuthApiService);
  const identity = inject(SessionIdentityService);
  if (sessionStore.isAuthenticated()) {
    if (state.url.split("?")[0] === "/access-unavailable" && new URLSearchParams(state.url.split("?")[1] || "").get("reason") === "temporary") return true;
    const stored = sessionStore.currentUser();
    if (stored) {
      identity.revalidate();
      return routeDecision(stored, state.url, router);
    }
    try {
      const user = await firstValueFrom(auth.me());
      sessionStore.setCurrentUser(user);
      return routeDecision(user, state.url, router);
    } catch (error) {
      if (isTransientAuthError(error)) {
        sessionStore.rememberRequestedUrl(state.url);
        return router.createUrlTree(["/access-unavailable"], { queryParams: { reason: "temporary" } });
      }
      sessionStore.clear();
    }
  }

  sessionStore.rememberRequestedUrl(state.url);
  return router.createUrlTree(["/login"]);
};
