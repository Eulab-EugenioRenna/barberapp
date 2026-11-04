import type { HttpEvent, HttpInterceptorFn } from "@angular/common/http";
import { finalize, Observable, shareReplay } from "rxjs";
import { ADMIN_API_URL } from "./api-config";

// Share only simultaneous reads. Completed responses and writes are never cached/replayed.
const pending = new Map<string, Observable<HttpEvent<unknown>>>();
export const inFlightGetInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(`${ADMIN_API_URL}/`)) return next(request);
  if (request.method !== "GET") {
    pending.clear();
    return next(request);
  }
  if (request.headers.get("Accept")?.includes("text/event-stream"))
    return next(request);
  const key = JSON.stringify([
    request.urlWithParams,
    request.responseType,
    request.withCredentials,
    request.headers
      .keys()
      .sort()
      .map((name) => [name, request.headers.getAll(name)]),
  ]);
  const existing = pending.get(key);
  if (existing) return existing;
  const response = next(request).pipe(
    finalize(() => {
      if (pending.get(key) === response) pending.delete(key);
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
  pending.set(key, response);
  return response;
};
