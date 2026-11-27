import { selectedOperationalScope } from "./operational-context.service";
import { HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { Router } from "@angular/router";
import { catchError, switchMap, throwError } from "rxjs";
import { ADMIN_API_URL } from "./api-config";
import { SessionStore } from "./session.store";
import { SessionRefreshService } from "./session-refresh.service";
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const store = inject(SessionStore);
  const refresh = inject(SessionRefreshService);
  const router = inject(Router);
  store.syncFromStorage();
  if (
    request.url.startsWith(`${ADMIN_API_URL}/`) &&
    /^\/(inventory|appointments|availability|services|collaborators|sales|dashboard|customers\/[^/]+\/history)(?:[/?]|$)/.test(
      request.url.slice(ADMIN_API_URL.length),
    )
  ) {
    const scope = selectedOperationalScope(store.currentUser()?.id || "");
    request = request.clone({
      setHeaders: {
        "X-Alora-Location":
          request.headers.get("X-Alora-Location") ?? scope.locationId,
        "X-Alora-Sector":
          request.headers.get("X-Alora-Sector") ?? scope.sectorId,
      },
    });
  }
  if (
    !request.url.startsWith(`${ADMIN_API_URL}/`) ||
    request.headers.has("Authorization") ||
    /\/auth\/(login|method|signup|refresh|logout|connect\/(exchange|accept))$/.test(
      request.url,
    ) ||
    !store.token()
  )
    return next(request);
  const send = () =>
    next(
      request.clone({
        setHeaders: { Authorization: `Bearer ${store.token()}` },
      }),
    );
  // A session that ended (401 not recoverable by refresh) goes to the login;
  // navigation itself never waits for an identity call.
  const toLogin = (error: unknown) => {
    if (!store.token() && router && !router.url?.startsWith("/login")) {
      store.rememberRequestedUrl(router.url);
      void router.navigateByUrl("/login");
    }
    return throwError(() => error);
  };
  // Renew before sending. Failed mutations are never replayed.
  if (store.refreshToken() && store.needsRefresh())
    return refresh.refresh().pipe(switchMap(send), catchError(toLogin));
  return send().pipe(
    catchError((error) => {
      if (
        error.status === 401 &&
        request.method === "GET" &&
        store.refreshToken()
      )
        return refresh.refresh(true).pipe(switchMap(send));
      if (error.status === 401 && store.refreshToken())
        return refresh
          .refresh(true)
          .pipe(switchMap(() => throwError(() => error)));
      if (error.status === 401) store.clear();
      return throwError(() => error);
    }),
    catchError(toLogin),
  );
};
