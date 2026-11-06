import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { throwError, timeout } from "rxjs";
import { ADMIN_API_URL } from "./api-config";

/** Bound read latency without retrying writes whose result could be uncertain. */
export const apiNetworkInterceptor: HttpInterceptorFn = (request, next) => {
  if (
    request.method !== "GET" ||
    !(request.url === ADMIN_API_URL || request.url.startsWith(`${ADMIN_API_URL}/`))
  ) {
    return next(request);
  }

  return next(request.clone({
    setHeaders: { "Cache-Control": "no-cache, no-store", Pragma: "no-cache" },
  })).pipe(
    timeout({
      each: 20_000,
      with: () => throwError(() => new HttpErrorResponse({
        status: 0,
        statusText: "Request timeout",
        url: request.url,
        error: { message: "Il server impiega troppo tempo a rispondere. Riprova tra poco." },
      })),
    }),
  );
};
