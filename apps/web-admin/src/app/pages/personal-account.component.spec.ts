import { of, throwError, Subject } from "rxjs";
const providers = new Map<unknown, unknown>();
jest.mock("@angular/core", () => ({ Component: () => (target: unknown) => target, inject: (token: unknown) => providers.get(token) }));
jest.mock("@angular/common", () => ({ CommonModule: {} }));
jest.mock("@angular/forms", () => ({ FormsModule: {} }));
jest.mock("@angular/router", () => ({ Router: class {}, RouterLink: class {} }));
jest.mock("@barber/shared/brand", () => ({ AloraBrandComponent: class {} }), { virtual: true });
jest.mock("../core/auth-api.service", () => ({ AuthApiService: class {} }));
jest.mock("../core/session.store", () => ({ SessionStore: class {} }));
jest.mock("../core/session-refresh.service", () => ({ SessionRefreshService: class {} }));
jest.mock("../shared/autofocus-first.directive", () => ({ AutofocusFirstDirective: class {} }));
import { Router } from "@angular/router";
import { AuthApiService } from "../core/auth-api.service";
import { SessionStore } from "../core/session.store";
import { PersonalAccountComponent } from "./personal-account.component";

describe("Personal account interactions", () => {
  let page: PersonalAccountComponent;
  const clear = jest.fn(), navigate = jest.fn();
  const profile = { profile: { firstName: "Ada", lastName: "Rossi", email: "ada@example.test" }, accountUrl: "https://sso.test/account/" };
  const security = { totp: false, preferredMethod: "auto", emailVerified: true, requiredActions: [], authenticators: [], trustedDevices: [] };
  const api = {
    personalAccount: jest.fn(), personalSecurity: jest.fn(), personalSessions: jest.fn(), personalNotices: jest.fn(),
    logoutPersonalSession: jest.fn(), logoutAllPersonalSessions: jest.fn(), revokePersonalDevice: jest.fn(),
  };
  beforeEach(() => {
    jest.resetAllMocks();
    providers.set(AuthApiService, api);
    providers.set(SessionStore, { clear, currentUser: () => ({ role: "collaborator", permissions: [], permissionsConfigured: true }), can: () => false });
    providers.set(Router, { navigate });
    api.personalAccount.mockReturnValue(of(profile)); api.personalSecurity.mockReturnValue(of(security));
    api.personalSessions.mockReturnValue(of({ sessions: [], truncated: false })); api.personalNotices.mockReturnValue(of({ items: [], unreadCount: 0 }));
    page = new PersonalAccountComponent();
  });
  it("shows independent provider failures without pretending that protection is disabled", async () => {
    api.personalSecurity.mockReturnValue(throwError(() => ({ status: 503 })));
    await page.load();
    expect(page.account).toEqual(profile);
    expect(page.security).toBeNull();
    expect(page.errors.security).toContain("non disponibile");
    expect(page.sessions).toEqual({ sessions: [], truncated: false });
    expect(clear).not.toHaveBeenCalled();
  });
  it("never issues a destructive request without a pending confirmation", async () => {
    await page.commit();
    expect(api.logoutAllPersonalSessions).not.toHaveBeenCalled();
    expect(api.logoutPersonalSession).not.toHaveBeenCalled();
    expect(api.revokePersonalDevice).not.toHaveBeenCalled();
  });
  it("returns to login when an expired personal session is definitively rejected", async () => {
    api.personalSessions.mockReturnValue(throwError(() => ({ status: 401 })));
    await page.load();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(["/login"], { queryParams: { accountNotice: "session_expired" } });
  });
  it("blocks repeated clicks and closes local access after confirmed logout-all", async () => {
    const pending = new Subject<{ loggedOut: boolean }>();
    api.logoutAllPersonalSessions.mockReturnValue(pending);
    page.pending = { kind: "all", id: "" };
    const first = page.commit();
    await page.commit();
    expect(api.logoutAllPersonalSessions).toHaveBeenCalledTimes(1);
    pending.next({ loggedOut: true }); pending.complete(); await first;
    expect(clear).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(["/login"], { queryParams: { accountNotice: "sessions_closed" } });
  });
  it("retains local access on an uncertain other-session logout and requires a fresh read", async () => {
    page.pending = { kind: "session", id: "other", current: false };
    api.logoutPersonalSession.mockReturnValue(throwError(() => ({ status: 503 })));
    await page.commit();
    expect(api.logoutPersonalSession).toHaveBeenCalledTimes(1);
    expect(page.sessions).toBeNull(); expect(page.feedback).toContain("Esito da verificare");
    expect(clear).not.toHaveBeenCalled();
  });
  it("closes local access on an uncertain current-session logout without retrying", async () => {
    page.pending = { kind: "session", id: "current", current: true };
    api.logoutPersonalSession.mockReturnValue(throwError(() => ({ status: 503 })));
    await page.commit();
    expect(api.logoutPersonalSession).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(["/login"], { queryParams: { accountNotice: "outcome_unknown" } });
  });
  it("reports partial provider device revocation instead of claiming every session was closed", async () => {
    page.pending = { kind: "device", id: "device" };
    api.revokePersonalDevice.mockReturnValue(of({ revoked: true, sessionsLoggedOut: false }));
    await page.commit();
    expect(navigate).toHaveBeenCalledWith(["/login"], { queryParams: { accountNotice: "device_revoked_sessions_pending" } });
  });
  it.each([403, 404])("preserves the browser session after a definitively rejected device operation with %s", async status => {
    page.pending = { kind: "device", id: "device" };
    api.revokePersonalDevice.mockReturnValue(throwError(() => ({ status })));
    await page.commit();
    expect(api.revokePersonalDevice).toHaveBeenCalledTimes(1);
    expect(page.security).toBeNull();
    expect(page.feedback).toContain("non eseguita");
    expect(clear).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
  it("preserves access when the server confirms the device operation never started", async () => {
    page.pending = { kind: "device", id: "device" };
    api.revokePersonalDevice.mockReturnValue(throwError(() => ({ status: 503, error: { code: "account_operation_not_started" } })));
    await page.commit();
    expect(page.feedback).toContain("non eseguita");
    expect(clear).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
