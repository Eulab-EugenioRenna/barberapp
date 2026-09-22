import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { SessionStore } from "./session.store";

export const authGuard: CanActivateFn = (_, state) => {
  const sessionStore = inject(SessionStore);
  const router = inject(Router);

  if (sessionStore.isAuthenticated()) {
    return true;
  }

  sessionStore.rememberRequestedUrl(state.url);
  return router.createUrlTree(["/login"]);
};
