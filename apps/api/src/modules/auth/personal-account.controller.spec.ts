import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PersonalAccountController } from "./personal-account.controller";
import { PersonalAccountService } from "./personal-account.service";
import { ConnectAuthService } from "./connect-auth.service";
jest.mock("../../common/connect-runtime", () => ({ connectApplicationConfig: () => ({ callbackUrl: "https://alora.test/callback" }) }));

describe("Personal account HTTP boundaries", () => {
  const sessions = jest.fn().mockResolvedValue({ sessions: [], truncated: false });
  const logoutSession = jest.fn().mockResolvedValue({ loggedOut: true, current: false });
  const updateProfile = jest.fn().mockResolvedValue({ profile: { firstName: "A", lastName: "B", email: "a@b.test" } });
  const actionIdentity = jest.fn().mockResolvedValue({ email: "person@example.test" });
  const signIn = jest.fn().mockResolvedValue({ status: "connect_redirect", redirectUrl: "https://sso.test/auth?client_id=alora&state=s" });
  let app: import("@nestjs/common").INestApplication, origin: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [PersonalAccountController], providers: [
      { provide: PersonalAccountService, useValue: { sessions, logoutSession, updateProfile, actionIdentity, profile: () => ({ accountUrl: "https://sso.test/account" }) } },
      { provide: ConnectAuthService, useValue: { signIn } },
    ] }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, "127.0.0.1");
    origin = await app.getUrl();
  });
  afterAll(async () => { await app.close(); });
  it("does not pass a caller-supplied subject into session lookup", async () => {
    const response = await fetch(origin + "/account/sessions?subject=victim", { headers: { Authorization: "Bearer local" } });
    expect(response.status).toBe(200);
    expect(sessions).toHaveBeenCalledWith("Bearer local");
  });
  it("requires the configured browser origin on writes", async () => {
    const response = await fetch(origin + "/account/sessions/00000000-0000-4000-8000-000000000000/logout", { method: "POST", headers: { Origin: "https://other.test" } });
    expect(response.status).toBe(403);
    expect(logoutSession).not.toHaveBeenCalled();
  });
  it("rejects malformed provider IDs before invoking a mutation", async () => {
    const response = await fetch(origin + "/account/sessions/other/logout", { method: "POST", headers: { Origin: "https://alora.test" } });
    expect(response.status).toBe(400);
    expect(logoutSession).not.toHaveBeenCalled();
  });
  it("does not allow caching of account responses", async () => {
    const response = await fetch(origin + "/account");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("starts only known provider actions, for the signed-in person's own email", async () => {
    const bad = await fetch(origin + "/account/actions", { method: "POST", headers: { Origin: "https://alora.test", "Content-Type": "application/json" }, body: JSON.stringify({ action: "DELETE_ACCOUNT" }) });
    expect(bad.status).toBe(400);
    expect(signIn).not.toHaveBeenCalled();
    const ok = await fetch(origin + "/account/actions", { method: "POST", headers: { Authorization: "Bearer local", Origin: "https://alora.test", "Content-Type": "application/json" }, body: JSON.stringify({ action: "UPDATE_PASSWORD", email: "victim@example.test" }) });
    expect(ok.status).toBe(201);
    const url = new URL((await ok.json()).redirectUrl);
    expect(url.searchParams.get("kc_action")).toBe("UPDATE_PASSWORD");
    expect(signIn).toHaveBeenCalledWith({ email: "person@example.test" }, expect.anything(), expect.anything());
  });
  it("requires the browser origin to change the profile", async () => {
    const response = await fetch(origin + "/account/profile", { method: "PUT", headers: { Origin: "https://other.test", "Content-Type": "application/json" }, body: JSON.stringify({ firstName: "A", lastName: "B" }) });
    expect(response.status).toBe(403);
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
