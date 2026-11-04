import { firstValueFrom, Subject, of, throwError, Observable } from "rxjs";
import { inFlightGetInterceptor } from "./in-flight-get.interceptor";
function request(token = "user-a", method = "GET") {
  return {
    url: "/api/auth/me",
    urlWithParams: "/api/auth/me",
    method,
    responseType: "json",
    withCredentials: false,
    headers: {
      get: () => null,
      keys: () => ["Authorization"],
      getAll: () => [token],
    },
  };
}
it("shares concurrent same-user reads and reads again after completion", async () => {
  const source = new Subject<unknown>(),
    next = jest.fn((): Observable<unknown> => source);
  const a = firstValueFrom(
    inFlightGetInterceptor(request() as never, next as never),
  );
  const b = firstValueFrom(
    inFlightGetInterceptor(request() as never, next as never),
  );
  expect(next).toHaveBeenCalledTimes(1);
  source.next({});
  source.complete();
  await Promise.all([a, b]);
  next.mockReturnValue(of({}));
  await firstValueFrom(
    inFlightGetInterceptor(request() as never, next as never),
  );
  expect(next).toHaveBeenCalledTimes(2);
});
it("never combines different credentials", async () => {
  const source = new Subject<unknown>(),
    next = jest.fn((): Observable<unknown> => source);
  const a = firstValueFrom(
    inFlightGetInterceptor(request("user-a") as never, next as never),
  );
  const b = firstValueFrom(
    inFlightGetInterceptor(request("user-b") as never, next as never),
  );
  expect(next).toHaveBeenCalledTimes(2);
  source.next({});
  source.complete();
  await Promise.all([a, b]);
});
it("removes failed requests and does not automatically retry", async () => {
  const next = jest.fn((): Observable<unknown> => throwError(() => ({ status: 503 })));
  await expect(
    firstValueFrom(inFlightGetInterceptor(request() as never, next as never)),
  ).rejects.toEqual({ status: 503 });
  expect(next).toHaveBeenCalledTimes(1);
  next.mockReturnValue(of({}));
  await firstValueFrom(
    inFlightGetInterceptor(request() as never, next as never),
  );
  expect(next).toHaveBeenCalledTimes(2);
});
it("invalidates pending reads on writes and never combines or replays writes", async () => {
  const source = new Subject<unknown>(),
    next = jest.fn((): Observable<unknown> => source);
  const old = firstValueFrom(
    inFlightGetInterceptor(request() as never, next as never),
  );
  const writeNext = jest.fn(() => of({}));
  await firstValueFrom(
    inFlightGetInterceptor(
      request("user-a", "POST") as never,
      writeNext as never,
    ),
  );
  await firstValueFrom(
    inFlightGetInterceptor(
      request("user-a", "POST") as never,
      writeNext as never,
    ),
  );
  expect(writeNext).toHaveBeenCalledTimes(2);
  const newer = firstValueFrom(
    inFlightGetInterceptor(request() as never, next as never),
  );
  expect(next).toHaveBeenCalledTimes(2);
  source.next({});
  source.complete();
  await Promise.all([old, newer]);
});
