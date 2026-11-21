import { ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PersonalAccountController } from "./personal-account.controller";
import { PersonalAccountService } from "./personal-account.service";
jest.mock("../../common/connect-runtime", () => ({ connectApplicationConfig: () => ({ callbackUrl: "https://alora.test/callback" }) }));

describe("Personal account HTTP boundaries", () => {
  const sessions = jest.fn().mockResolvedValue({ sessions: [], truncated: false });
  const logoutSession = jest.fn().mockResolvedValue({ loggedOut: true, current: false });
  let app: import("@nestjs/common").INestApplication, origin: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [PersonalAccountController], providers: [
      { provide: PersonalAccountService, useValue: { sessions, logoutSession, profile: () => ({ accountUrl: "https://sso.test/account" }) } },
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
});
