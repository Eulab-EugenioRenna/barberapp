import { ConnectAuthController } from "./connect-auth.controller";
import {
  ForbiddenException,
  ServiceUnavailableException,
  BadRequestException,
} from "@nestjs/common";
import {
  connectApplication,
  closeConnectApplication,
  pruneConnectApplication,
} from "../../common/connect-application";
import {
  ConnectAuthService,
  MIGRATION_CONSENT_VERSION,
} from "./connect-auth.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthResponse, ConnectRequest } from "../../common/connect-http";
import type { ConnectApplication } from "@eulab/connect/application";
jest.mock("../../common/connect-application", () => ({
  connectApplication: jest.fn(),
  closeConnectApplication: jest.fn(),
  pruneConnectApplication: jest.fn(),
}));
describe("ALORA SDK HTTP orchestration", () => {
  const original = { ...process.env },
    origin = "http://localhost:5174",
    email = "user@example.test";
  const configurationSync = jest.fn(),
    signIn = jest.fn(),
    submit = jest.fn(),
    callback = jest.fn(),
    exchange = jest.fn(),
    findUnique = jest.fn(),
    cookie = jest.fn();
  const request: ConnectRequest = {
      headers: { origin, host: "localhost:5174" },
    },
    response = { cookie } as unknown as AuthResponse;
  let service: ConnectAuthService;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    jest.mocked(pruneConnectApplication).mockResolvedValue(undefined);
    jest.mocked(closeConnectApplication).mockResolvedValue(undefined);
    Object.assign(process.env, {
      NODE_ENV: "test",
      ALORA_CONNECT_PRESENTER_ID: "synthetic-presenter",
      ALORA_CONNECT_APP_ID: "alora",
      ALORA_CONNECT_API_URL: "http://localhost:8088",
      ALORA_CONNECT_ISSUER: "http://localhost:8080/realms/eulab",
      ALORA_CONNECT_CLIENT_ID: "qa",
      ALORA_CONNECT_CALLBACK_URL: origin + "/auth/connect/callback",
      ALORA_AUTH_RETURN_URL: origin + "/admin/#/login",
      ALORA_CONNECT_ENCRYPTION_KEY: "a".repeat(64),
    });
    configurationSync.mockResolvedValue({ status: "ready", appId: "alora" });
    jest.mocked(connectApplication).mockResolvedValue({
      configuration: { sync: configurationSync },
      auth: { signIn, callback, exchange },
      migration: { submit },
    } as unknown as ConnectApplication);
    service = new ConnectAuthService({
      user: { findUnique },
    } as unknown as PrismaService);
  });
  afterEach(async () => {
    await service.onModuleDestroy();
    process.env = { ...original };
    jest.useRealTimers();
  });
  it("does not fall back to local access on SDK failure", async () => {
    jest
      .mocked(connectApplication)
      .mockRejectedValue(
        new ServiceUnavailableException("Configurazione Connect incompleta"),
      );
    await expect(
      service.signIn({ email, password: "legacy" }, request, response),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(findUnique).not.toHaveBeenCalled();
  });
  it("requests legacy proof separately after email-only lookup without exposing a local profile", async () => {
    signIn.mockRejectedValue({ code: "invalid_credentials" });
    const result = await service.signIn({ email }, request, response);
    expect(result).toMatchObject({ status: "migration_required", onboarding: {
      email, firstName: "", lastName: "", challenge: "", needsLegacyVerification: true,
    } });
    expect(findUnique).not.toHaveBeenCalled();
  });
  it("keeps invalid legacy proof denied and does not expose profile details", async () => {
    signIn.mockRejectedValue({code: "invalid_credentials"});
    await expect(service.signIn({email, password: "wrong"}, request, response)).rejects.toMatchObject({status: 401});
    expect(findUnique).not.toHaveBeenCalled();
  });
  it("returns callback failures in the hash login route so Angular keeps the feedback", async () => {
    process.env["ALORA_AUTH_RETURN_URL"] = origin + "/admin/";
    callback.mockRejectedValue(new Error("private-provider-detail"));
    const redirect = jest.fn();
    const controller = new ConnectAuthController(service, {} as never);
    await controller.callback({state: "opaque-state", code: "private-code"}, request,
      {...response, redirect, setHeader: jest.fn()} as AuthResponse);
    expect(redirect).toHaveBeenCalledWith(303, origin + "/admin#/login?connect_error=access_failed");
  });
  it("translates a redirect and applies the SDK's actual cookie directives", async () => {
    signIn.mockResolvedValue({
      status: "redirect",
      url: "https://provider.example/authorize",
      cookies: [
        {
          name: "connect_x_flow",
          value: "opaque",
          maxAge: 600,
          httpOnly: true,
          secure: false,
          sameSite: "lax",
          path: "/",
        },
      ],
    });
    expect(await service.signIn({ email }, request, response)).toEqual({
      status: "connect_redirect",
      redirectUrl: "https://provider.example/authorize",
    });
    expect(signIn).toHaveBeenCalledWith({ email }, { origin, cookies: {} });
    expect(cookie).toHaveBeenCalledWith(
      "connect_x_flow",
      "opaque",
      expect.objectContaining({ maxAge: 600000, httpOnly: true }),
    );
  });
  it("syncs approved presenter configuration through the same SDK before sign-in", async () => {
    signIn.mockResolvedValue({ status: "pending", request: { requestId: "fixture", state: "pending" }, nextAction: "wait" });
    await service.signIn({ email }, request, response);
    expect(configurationSync).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledTimes(1);
  });
  it("does not expose local names from an unverified pending lookup", async () => {
    signIn.mockResolvedValue({
      status: "pending",
      request: { requestId: "r1", state: "pending", nextAction: "wait" },
      nextAction: "wait",
    });
    const result = await service.signIn({ email }, request, response);
    expect(result).toMatchObject({
      status: "migration_required",
      onboarding: { challenge: "", firstName: "", lastName: "" },
    });
    expect(findUnique).not.toHaveBeenCalled();
  });
  it("shows the verified profile and typed recovery action without returning private fields", async () => {
    signIn.mockResolvedValue({
      status: "migration_required",
      challenge: "c".repeat(43),
      consentVersion: MIGRATION_CONSENT_VERSION,
      cookies: [],
      request: {
        requestId: "r1",
        state: "failed",
        nextAction: "choose_connect_password",
      },
    });
    findUnique.mockResolvedValue({
      firstName: "Local",
      lastName: "Profile",
      passwordHash: "secret-hash",
    });
    const result = await service.signIn(
      { email, password: "legacy" },
      request,
      response,
    );
    expect(result).toMatchObject({
      onboarding: {
        firstName: "Local",
        request: { nextAction: "choose_connect_password" },
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret-hash");
  });
  it("requires explicit consent before calling the SDK mutator", async () => {
    await expect(
      service.submit(
        {
          challenge: "c".repeat(43),
          password: "legacy",
          accepted: false,
          consentVersion: MIGRATION_CONSENT_VERSION,
        },
        request,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(submit).not.toHaveBeenCalled();
  });
  it("passes distinct credential fields and a proof-specific idempotency key to the SDK", async () => {
    submit.mockResolvedValue({
      requestId: "r1",
      state: "pending",
      nextAction: "wait",
    });
    const result = await service.submit(
      {
        challenge: "c".repeat(43),
        password: "legacy",
        newConnectPassword: "new-connect",
        accepted: true,
        consentVersion: MIGRATION_CONSENT_VERSION,
      },
      request,
    );
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        legacyPassword: "legacy",
        newConnectPassword: "new-connect",
        idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      { origin, cookies: {} },
    );
    expect(JSON.stringify(result)).not.toContain("new-connect");
  });
  it("returns only an opaque fragment handoff, never a token in the query", async () => {
    callback.mockResolvedValue({ handoff: "h".repeat(43), cookies: [] });
    const result = new URL(
      await service.callback(
        { state: "s", code: "provider-code" },
        request,
        response,
      ),
    );
    expect(result.search).toBe("");
    expect(result.hash).toBe("#/login?alora_connect=" + "h".repeat(43));
    expect(result.href).not.toContain("provider-code");
  });
  it("prunes through the SDK and closes the shared store on module shutdown", async () => {
    jest.advanceTimersByTime(5 * 60_000);
    expect(pruneConnectApplication).toHaveBeenCalled();
    await service.onModuleDestroy();
    expect(closeConnectApplication).toHaveBeenCalled();
  });
  it("never constructs an operational session when SDK authorization fails", async () => {
    exchange.mockRejectedValue({
      code: "access_denied",
      message: "provider-secret",
    });
    await expect(
      service.exchange("h".repeat(43), request, response),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(cookie).not.toHaveBeenCalled();
  });
});
