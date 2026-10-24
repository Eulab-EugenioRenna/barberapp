import { HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { catchError, switchMap, throwError } from "rxjs";
import { ADMIN_API_URL } from "./api-config";
import { SessionStore } from "./session.store";
import { SessionRefreshService } from "./session-refresh.service";
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const store = inject(SessionStore);
  const refresh = inject(SessionRefreshService);
  store.syncFromStorage();
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
  // Renew before sending. Failed mutations are never replayed.
  if (store.refreshToken() && store.needsRefresh())
    return refresh.refresh().pipe(switchMap(send));
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
  );
};
