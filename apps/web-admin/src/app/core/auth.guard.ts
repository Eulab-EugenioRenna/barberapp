import { canAccessLocalView, canUseLocalFunction, VIEW_FUNCTIONS } from "@barber/shared/functions";
import { firstValueFrom } from "rxjs";
import { AuthApiService } from "./auth-api.service";
import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { SessionStore } from "./session.store";

export const authGuard: CanActivateFn = async (_, state) => {
  const sessionStore = inject(SessionStore);
  const router = inject(Router);

  const auth = inject(AuthApiService);
  if (sessionStore.isAuthenticated()) {
    try {
      // Re-read operational restrictions on navigation; the server remains authoritative.
      const user = await firstValueFrom(auth.me());
      sessionStore.setCurrentUser(user);
      if (user.role === "collaborator") {
        const destination = canUseLocalFunction(user, "appointments.read.own") ? "/my-agenda" : "/access-unavailable";
        return state.url.split("?")[0] === destination ? true : router.createUrlTree([destination]);
      }
      if (user.role === "platform_admin")
        return state.url.startsWith("/platform")
          ? true
          : router.createUrlTree(["/platform"]);
      if (state.url.startsWith("/my-agenda") && (!user.collaboratorId || !canUseLocalFunction(user, "appointments.read.own")))
        return router.createUrlTree(["/access-unavailable"]);
      const view = state.url.split("?")[0].split("/")[1];
      const required = VIEW_FUNCTIONS[view];
      if (required && !canAccessLocalView(user, view)) {
        const first = Object.entries(VIEW_FUNCTIONS).find(([view]) =>
          canAccessLocalView(user, view),
        );
        return router.createUrlTree([
          first ? `/${first[0]}` : user.collaboratorId && canUseLocalFunction(user, "appointments.read.own") ? "/my-agenda" : "/access-unavailable",
        ]);
      }
      if (view === "platform")
        return router.createUrlTree(["/access-unavailable"]);
      return true;
    } catch {
      sessionStore.clear();
    }
  }

  sessionStore.rememberRequestedUrl(state.url);
  return router.createUrlTree(["/login"]);
};
