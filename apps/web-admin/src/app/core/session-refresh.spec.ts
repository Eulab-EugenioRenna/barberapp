import { firstValueFrom, of, Subject, throwError } from "rxjs";
const providers = new Map<unknown, unknown>();
const mockPost = jest.fn();
jest.mock("@angular/core", () => ({
  Injectable: () => (target: unknown) => target,
  inject: (token: unknown) => providers.get(token),
  signal: (initial: unknown) => {
    let value = initial;
    const read = () => value;
    read.set = (next: unknown) => {
      value = next;
    };
    return read;
  },
  computed: (read: () => unknown) => read,
}));
jest.mock("@angular/common/http", () => ({
  HttpBackend: class {},
  HttpClient: class {
    post(...args: unknown[]) {
      return mockPost(...args);
    }
  },
}));
import { SessionStore } from "./session.store";
import { SessionRefreshService } from "./session-refresh.service";
import { authInterceptor } from "./auth.interceptor";
let store: SessionStore;
let service: SessionRefreshService;
const response = (label: string, expired = false) => ({
  accessToken: `access-${label}`,
  refreshToken: `refresh-${label}`,
  expiresAt: new Date(Date.now() + (expired ? -1 : 60_000)).toISOString(),
});
function request(method: string, url = "/api/sales") {
  return {
    method,
    url,
    headers: { has: () => false },
    clone: jest.fn().mockReturnValue({ method, url }),
  };
}
beforeEach(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {},
  });
  providers.clear();
  mockPost.mockReset();
  store = new SessionStore();
  providers.set(SessionStore, store);
  service = new SessionRefreshService();
  providers.set(SessionRefreshService, service);
});
describe("shared session renewal", () => {
  it("shares one rotation among simultaneous requests", async () => {
    store.setSession(response("old", true));
    const pending = new Subject<unknown>();
    mockPost.mockReturnValue(pending);
    const a = firstValueFrom(service.refresh());
    const b = firstValueFrom(service.refresh());
    expect(mockPost).toHaveBeenCalledTimes(1);
    pending.next(response("new"));
    pending.complete();
    await Promise.all([a, b]);
    expect(store.token()).toBe("access-new");
  });
  it("does not restore a session when logout occurs during refresh", async () => {
    store.setSession(response("old", true));
    const pending = new Subject<unknown>();
    mockPost.mockReturnValue(pending);
    const renewal = firstValueFrom(service.refresh());
    store.clear();
    pending.next(response("new"));
    pending.complete();
    await expect(renewal).rejects.toThrow();
    expect(store.isAuthenticated()).toBe(false);
  });
  it("does not overwrite a subsequent login", async () => {
    store.setSession(response("old", true));
    const pending = new Subject<unknown>();
    mockPost.mockReturnValue(pending);
    const renewal = firstValueFrom(service.refresh());
    store.setSession(response("other-user"));
    pending.next(response("new"));
    pending.complete();
    await expect(renewal).rejects.toThrow();
    expect(store.token()).toBe("access-other-user");
  });
  it("uses a rotation completed by another tab while waiting for the lock", async () => {
    store.setSession(response("old", true));
    let run: () => Promise<void> = async () => undefined;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        locks: {
          request: (_name: string, callback: () => Promise<void>) =>
            new Promise<void>((resolve, reject) => {
              run = () => callback().then(resolve, reject);
            }),
        },
      },
    });
    const renewal = firstValueFrom(service.refresh());
    const next = response("other-tab");
    localStorage.setItem("barber.session", next.accessToken);
    localStorage.setItem("barber.refresh", next.refreshToken);
    localStorage.setItem("barber.expires", next.expiresAt);
    await run();
    await renewal;
    expect(mockPost).not.toHaveBeenCalled();
    expect(store.token()).toBe("access-other-tab");
  });
  it("renews after a failed mutation without resending it", async () => {
    store.setSession(response("old"));
    mockPost.mockReturnValue(of(response("new")));
    const next = jest.fn(() => throwError(() => ({ status: 401 })));
    await expect(
      firstValueFrom(authInterceptor(request("POST") as never, next as never)),
    ).rejects.toEqual({ status: 401 });
    expect(next).toHaveBeenCalledTimes(1);
    expect(store.token()).toBe("access-new");
  });
  it("never attaches credentials to an external request", async () => {
    store.setSession(response("old"));
    const original = request("GET", "https://example.test/data");
    const next = jest.fn(() => of({}));
    await firstValueFrom(authInterceptor(original as never, next as never));
    expect(original.clone).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
  });
});
