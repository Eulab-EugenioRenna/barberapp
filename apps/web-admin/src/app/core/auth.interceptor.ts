import { HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { SessionStore } from "./session.store";

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const sessionStore = inject(SessionStore);
  const token = sessionStore.token();

  if (!token || request.headers.has("Authorization")) {
    return next(request);
  }

  return next(
    request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    }),
  );
};
