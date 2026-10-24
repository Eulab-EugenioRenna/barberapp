import { of, throwError, Subject } from "rxjs";
const providers = new Map<unknown, unknown>();
jest.mock("@angular/core", () => ({
  Component: () => (target: unknown) => target,
  Injectable: () => (target: unknown) => target,
  Input: () => () => {},
  Output: () => () => {},
  ViewChild: () => () => {},
  EventEmitter: class {
    emit = jest.fn();
  },
  inject: (token: unknown) => providers.get(token),
}));
jest.mock("@angular/common", () => ({ CommonModule: class {} }));
jest.mock("@angular/forms", () => ({ FormsModule: class {} }));
jest.mock("@angular/router", () => ({ Router: class {} }));
jest.mock("@angular/common/http", () => ({ HttpClient: class {} }));
jest.mock("@barber/shared/brand", () => ({ AloraBrandComponent: class {} }), {
  virtual: true,
});
import { ConnectOnboardingModalComponent } from "./connect-onboarding-modal.component";
import { Router } from "@angular/router";
import { AuthApiService } from "../core/auth-api.service";
import { SessionStore } from "../core/session.store";
import { AdminAuthPanelComponent } from "./admin-auth-panel.component";

describe("auth onboarding acceptance", () => {
  const profile = {
    version: "2026-10-21-mandatory-v1",
    challenge: "c".repeat(43),
    firstName: "A",
    lastName: "B",
    email: "user@example.test",
  };
  const login = jest.fn(),
    exchangeConnect = jest.fn(),
    acceptConnect = jest.fn(),
    navigateByUrl = jest.fn(),
    assign = jest.fn();
  beforeEach(() => {
    jest.useFakeTimers();
    providers.clear();
    jest.clearAllMocks();
    providers.set(AuthApiService, {
      login,
      acceptConnect,
      exchangeConnect,
      me: () => of({ id: "u1", role: "owner" }),
    });
    providers.set(SessionStore, {
      clear: jest.fn(),
      setSession: jest.fn(),
      setCurrentUser: jest.fn(),
      consumeRequestedUrl: () => null,
    });
    providers.set(Router, { navigateByUrl });
    Object.defineProperty(globalThis, "window", {
      value: {
        location: { href: "http://127.0.0.1/admin/#/login", assign },
        history: { replaceState: jest.fn() },
      },
      configurable: true,
    });
    login.mockReturnValue(
      of({ accessToken: "synthetic", onboarding: profile }),
    );
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  const panel = () => {
    const p = new AdminAuthPanelComponent();
    p.loginForm = { email: profile.email, password: "Synthetic-only-Pass-9!" };
    return p;
  };
  it("never stores a business session or navigates before approval", async () => {
    const p = panel();
    await p.submit();
    expect(p.onboarding).toEqual(profile);
    expect(acceptConnect).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(
      (providers.get(SessionStore) as { setSession: jest.Mock }).setSession,
    ).not.toHaveBeenCalled();
    expect("postponeOnboarding" in p).toBe(false);
  });
  it("sends explicit versioned acceptance once, then clears the password and waits without redirecting", async () => {
    const p = panel();
    await p.submit();
    acceptConnect.mockReturnValue(
      of({ request: { requestId: "r1", state: "pending" } }),
    );
    assign.mockImplementation(() => expect(p.loginForm.password).toBe(""));
    await p.acceptOnboarding({ firstName: "Updated", lastName: "Person" });
    expect(acceptConnect).toHaveBeenCalledWith({
      firstName: "Updated",
      lastName: "Person",
      password: "Synthetic-only-Pass-9!",
      challenge: profile.challenge,
      accepted: true,
      consentVersion: profile.version,
    });
    expect(assign).not.toHaveBeenCalled();
    expect(p.onboarding?.request?.state).toBe("pending");
    expect(p.loginForm.password).toBe("");
  });
  it("clears transient credentials on failure and on expiration", async () => {
    const p = panel();
    await p.submit();
    acceptConnect.mockReturnValue(throwError(() => ({ status: 503 })));
    await p.acceptOnboarding({ firstName: "A", lastName: "B" });
    expect(p.loginForm.password).toBe("");
    expect(p.onboarding).not.toBeNull();
    const expired = panel();
    await expired.submit();
    jest.advanceTimersByTime(120_000);
    expect(expired.loginForm.password).toBe("");
    expect(expired.onboarding).not.toBeNull();
  });
  it("retains newly verified credentials for an expired request and resubmits without entering the application", async () => {
    login.mockReturnValue(
      of({
        onboarding: {
          ...profile,
          request: { requestId: "existing-r1", state: "expired" },
        },
      }),
    );
    const p = panel();
    await p.submit();
    expect(p.loginForm.password).toBe("Synthetic-only-Pass-9!");
    const modal = new ConnectOnboardingModalComponent();
    modal.profile = p.onboarding!;
    modal.ngOnInit();
    expect(modal.canSubmitRequest).toBe(true);
    modal.confirm();
    expect(modal.accept.emit).not.toHaveBeenCalled();
    modal.accepted = true;
    modal.confirm();
    expect(modal.accept.emit).toHaveBeenCalledWith({
      firstName: "A",
      lastName: "B",
    });
    acceptConnect.mockReturnValue(
      of({ request: { requestId: "existing-r1", state: "pending" } }),
    );
    await p.acceptOnboarding({ firstName: "A", lastName: "B" });
    expect(acceptConnect.mock.calls[0][0].password).toBe(
      "Synthetic-only-Pass-9!",
    );
    expect(p.onboarding?.request?.requestId).toBe("existing-r1");
    expect(p.loginForm.password).toBe("");
    expect(p.onboarding?.challenge).toBe("");
    expect(navigateByUrl).not.toHaveBeenCalled();
  });
  it("expires the retained password and disables resubmission after two minutes", async () => {
    login.mockReturnValue(
      of({
        onboarding: {
          ...profile,
          request: { requestId: "r1", state: "expired" },
        },
      }),
    );
    const p = panel();
    await p.submit();
    jest.advanceTimersByTime(120_000);
    expect(p.loginForm.password).toBe("");
    expect(p.onboarding?.challenge).toBe("");
    await p.acceptOnboarding({ firstName: "A", lastName: "B" });
    expect(acceptConnect).not.toHaveBeenCalled();
  });
  it.each([
    "pending",
    "approved",
    "migrating",
    "completed",
    "rejected",
    "failed",
  ])(
    "keeps %s requests blocked and erases credentials immediately",
    async (state) => {
      login.mockReturnValue(
        of({ onboarding: { ...profile, request: { requestId: "r1", state } } }),
      );
      const p = panel();
      await p.submit();
      expect(p.loginForm.password).toBe("");
      const modal = new ConnectOnboardingModalComponent();
      modal.profile = p.onboarding!;
      modal.ngOnInit();
      modal.accepted = true;
      expect(modal.canSubmitRequest).toBe(false);
      modal.confirm();
      expect(modal.accept.emit).not.toHaveBeenCalled();
      await p.acceptOnboarding({ firstName: "A", lastName: "B" });
      expect(acceptConnect).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    },
  );
  it("does not permit repeated submission if Connect returns the same terminal expired request", async () => {
    const p = panel();
    await p.submit();
    acceptConnect.mockReturnValue(
      of({ request: { requestId: "r1", state: "expired" } }),
    );
    await p.acceptOnboarding({ firstName: "A", lastName: "B" });
    await p.acceptOnboarding({ firstName: "A", lastName: "B" });
    expect(acceptConnect).toHaveBeenCalledTimes(1);
    expect(p.loginForm.password).toBe("");
    expect(p.onboarding?.challenge).toBe("");
  });
  it("uses the same button without sending a local password for migrated profiles", async () => {
    const p = panel();
    p.connectLogin = true;
    login.mockReturnValue(
      of({
        status: "connect_redirect",
        redirectUrl: "https://sso.example/auth",
      }),
    );
    await p.submit();
    expect(login).toHaveBeenCalledWith({ email: profile.email });
    expect(p.loginForm.password).toBe("");
  });
  it("does not redirect after the auth component is destroyed while acceptance is pending", async () => {
    const p = panel();
    await p.submit();
    const result = new Subject<{
      request: { requestId: string; state: string };
    }>();
    acceptConnect.mockReturnValue(result);
    const accepting = p.acceptOnboarding({ firstName: "A", lastName: "B" });
    p.ngOnDestroy();
    expect(p.loginForm.password).toBe("");
    result.next({ request: { requestId: "r1", state: "pending" } });
    result.complete();
    await accepting;
    expect(assign).not.toHaveBeenCalled();
  });
  it("requires explicit recovery action and matching new Connect passwords", () => {
    const modal = new ConnectOnboardingModalComponent();
    modal.profile = {
      ...profile,
      request: {
        requestId: "r1",
        state: "failed",
        nextAction: "choose_connect_password",
      },
    };
    modal.ngOnInit();
    modal.accepted = true;
    expect(modal.canSubmitRequest).toBe(true);
    modal.newConnectPassword = "New-Connect-Password-9!";
    modal.confirmConnectPassword = "different";
    modal.confirm();
    expect(modal.accept.emit).not.toHaveBeenCalled();
    modal.newConnectPassword = modal.confirmConnectPassword =
      "New-Connect-Password-9!";
    modal.confirm();
    expect(modal.accept.emit).toHaveBeenCalledWith({
      firstName: "A",
      lastName: "B",
      newConnectPassword: "New-Connect-Password-9!",
    });
    expect(modal.newConnectPassword).toBe("");
    expect(modal.confirmConnectPassword).toBe("");
  });
  it("does not reinterpret an explicitly closed expired request as resubmittable", () => {
    const modal = new ConnectOnboardingModalComponent();
    modal.profile = {
      ...profile,
      request: { requestId: "r1", state: "expired", nextAction: "closed" },
    };
    expect(modal.canSubmitRequest).toBe(false);
  });
  it("keeps recovery password distinct from the verified legacy password", async () => {
    login.mockReturnValue(
      of({
        onboarding: {
          ...profile,
          request: {
            requestId: "r1",
            state: "failed",
            nextAction: "choose_connect_password",
          },
        },
      }),
    );
    const p = panel();
    await p.submit();
    await p.acceptOnboarding({
      firstName: "A",
      lastName: "B",
      newConnectPassword: p.loginForm.password,
    });
    expect(acceptConnect).not.toHaveBeenCalled();
    acceptConnect.mockReturnValue(
      of({
        request: { requestId: "r1", state: "pending", nextAction: "wait" },
      }),
    );
    await p.acceptOnboarding({
      firstName: "A",
      lastName: "B",
      newConnectPassword: "New-Connect-Password-9!",
    });
    expect(acceptConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        password: "Synthetic-only-Pass-9!",
        newConnectPassword: "New-Connect-Password-9!",
      }),
    );
    expect(p.loginForm.password).toBe("");
  });
  it("clears new password inputs when the proof expires", () => {
    const modal = new ConnectOnboardingModalComponent();
    modal.profile = { ...profile, challenge: "" };
    modal.newConnectPassword = modal.confirmConnectPassword =
      "Synthetic-New-9!";
    modal.ngOnChanges({
      profile: {
        previousValue: profile,
        currentValue: modal.profile,
        firstChange: false,
        isFirstChange: () => false,
      },
    });
    expect(modal.newConnectPassword).toBe("");
    expect(modal.confirmConnectPassword).toBe("");
  });
  it("removes a fragment handoff before posting it to the exchange endpoint", () => {
    window.location.href =
      "http://127.0.0.1/admin/#/login?alora_connect=" + "h".repeat(43);
    exchangeConnect.mockReturnValue(
      of({
        accessToken: "local",
        refreshToken: "refresh",
        expiresAt: "2099-01-01",
      }),
    );
    const p = panel();
    p.ngOnInit();
    expect(window.history.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "http://127.0.0.1/admin/#/login",
    );
    expect(exchangeConnect).toHaveBeenCalledWith("h".repeat(43));
    p.ngOnDestroy();
  });
});
