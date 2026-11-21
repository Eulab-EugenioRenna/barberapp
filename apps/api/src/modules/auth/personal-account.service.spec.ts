import { ForbiddenException, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import type { PrismaService } from "../../prisma/prisma.service";
import { connectApplication } from "../../common/connect-application";
import { resolveRequestSession, RequestSession } from "../../common/request-session";
import { openConnect } from "../../common/connect-runtime";
import { authorizeLocalOperation } from "../../common/local-policy.guard";
import { PersonalAccountService } from "./personal-account.service";
jest.mock("../../common/connect-application", () => ({ connectApplication: jest.fn() }));
jest.mock("../../common/connect-runtime", () => ({
  openConnect: jest.fn(), checkedConnectUrl: (value: string) => {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new ServiceUnavailableException();
    return value;
  },
  connectApplicationConfig: () => ({ callbackUrl: "https://alora.test/api/callback", returnUrl: "https://alora.test/admin/" }),
}));
jest.mock("../../common/request-session", () => ({ ...jest.requireActual("../../common/request-session"), resolveRequestSession: jest.fn() }));

describe("Personal SSO account", () => {
  const actor: RequestSession = { tenantId: "tenant-a", connectSessionId: "connected-a", user: {
    id: "user-a", tenantId: "tenant-a", role: "collaborator", permissions: [], permissionsConfigured: true,
    email: "worker@example.test", firstName: "Ada", lastName: "Rossi",
  } };
  const findFirst = jest.fn(), localUpdate = jest.fn(), connectUpdate = jest.fn(), lock = jest.fn();
  const transaction = jest.fn(async operation => operation({ $executeRaw: lock, localSession: { updateMany: localUpdate }, connectSession: { updateMany: connectUpdate } }));
  const client = { request: jest.fn(), accountSecurity: jest.fn(), logoutSession: jest.fn(), logoutAllSessions: jest.fn(), revokeTrustedDevice: jest.fn(), notifications: jest.fn() };
  const configuration = jest.fn();
  const services = jest.fn(async (_handle, operation) => operation(client, "private-provider-token"));
  const service = new PersonalAccountService({ connectSession: { findFirst }, $transaction: transaction } as unknown as PrismaService);
  const own = { id: "own-session", subject: "subject-a", ipAddress: "127.0.0.1", startedAt: 10, lastAccess: 20, clients: ["alora"], current: false };
  const settings = { sourceId: "source-a", appId: "alora", issuer: "https://sso.test/realms/eulab", clientId: "alora", redirectUri: "https://alora.test/api/callback", clientSecret: "must-not-escape" };
  beforeEach(() => {
    jest.resetAllMocks();
    process.env["ALORA_CONNECT_SOURCE_ID"] = "source-a";
    jest.mocked(resolveRequestSession).mockResolvedValue(actor);
    findFirst.mockResolvedValue({ sdkSessionCipher: "encrypted", user: { connectSubject: "subject-a" } });
    jest.mocked(openConnect).mockReturnValue("private-sdk-handle");
    services.mockImplementation(async (_handle, operation) => operation(client, "private-provider-token"));
    transaction.mockImplementation(async operation => operation({ $executeRaw: lock, localSession: { updateMany: localUpdate }, connectSession: { updateMany: connectUpdate } }));
    configuration.mockResolvedValue({ status: "ready", configuration: settings });
    jest.mocked(connectApplication).mockResolvedValue({ services, source: { configuration }, catalog: { appId: "alora" } } as unknown as Awaited<ReturnType<typeof connectApplication>>);
    client.request.mockResolvedValue({ sessions: [own], truncated: false });
  });
  afterAll(() => { delete process.env["ALORA_CONNECT_SOURCE_ID"]; });

  it("admits self service with no business grants but keeps company APIs denied", () => {
    for (const operation of ["profile", "security", "sessions", "notices", "logoutAll", "logoutSession", "revokeDevice"])
      expect(() => authorizeLocalOperation(actor, "PersonalAccountController", operation)).not.toThrow();
    expect(() => authorizeLocalOperation(actor, "TeamController", "overview")).toThrow(ForbiddenException);
    expect(() => authorizeLocalOperation(actor, "DashboardController", "revenue")).toThrow(ForbiddenException);
  });
  it.each([
    { ...actor, user: { ...actor.user!, technicalAccess: true } },
    { ...actor, user: { ...actor.user!, role: "platform_admin" } },
  ])("rejects impersonation and local platform identity", async session => {
    jest.mocked(resolveRequestSession).mockResolvedValue(session);
    await expect(service.security("Bearer local")).rejects.toBeInstanceOf(ForbiddenException);
    expect(connectApplication).not.toHaveBeenCalled();
  });
  it("rejects absent/expired provider linkage without invoking a provider operation", async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.sessions("Bearer local")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(services).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "connected-a", userId: "user-a", revokedAt: null, expiresAt: { gt: expect.any(Date) } } }));
  });
  it("scopes admin-capable tokens to their own subject and projects only public session fields", async () => {
    const value = await service.sessions("Bearer local");
    expect(client.request).toHaveBeenCalledWith("/v1/sessions?subject=subject-a", "GET", undefined, "private-provider-token");
    expect(value.sessions).toEqual([{ id: own.id, ipAddress: own.ipAddress, startedAt: 10, lastAccess: 20, clients: ["alora"], current: false }]);
    expect(JSON.stringify(value)).not.toMatch(/subject-a|private-/);
  });
  it("fails closed when the provider returns someone else's session", async () => {
    client.request.mockResolvedValue({ sessions: [{ ...own, subject: "subject-b" }], truncated: false });
    await expect(service.sessions("Bearer local")).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.logoutSession("Bearer local", "own-session")).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(client.logoutSession).not.toHaveBeenCalled();
  });
  it("denies foreign session IDs even when the provider token has global admin rights", async () => {
    await expect(service.logoutSession("Bearer local", "foreign-session")).rejects.toBeInstanceOf(NotFoundException);
    expect(client.logoutSession).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("preserves current local access when closing another owned session", async () => {
    client.logoutSession.mockResolvedValue({ loggedOut: true, current: false, secret: "hidden" });
    await expect(service.logoutSession("Bearer local", own.id)).resolves.toEqual({ loggedOut: true, current: false });
    expect(client.logoutSession).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("revokes the current local family on an uncertain current-session logout without a retry", async () => {
    client.request.mockResolvedValue({ sessions: [{ ...own, current: true }], truncated: false });
    client.logoutSession.mockRejectedValue(new Error("transport timeout with private body"));
    await expect(service.logoutSession("Bearer local", own.id)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(client.logoutSession).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalled();
    expect(localUpdate).toHaveBeenCalledWith({ where: { userId: "user-a", connectSessionId: "connected-a", revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  });
  it("revokes all local families only for the actor, even after a provider timeout", async () => {
    client.logoutAllSessions.mockRejectedValue(new Error("timeout"));
    await expect(service.logoutAll("Bearer local")).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(localUpdate).toHaveBeenCalledWith({ where: { userId: "user-a", revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(connectUpdate).toHaveBeenCalledWith({ where: { userId: "user-a", revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(client.logoutAllSessions).toHaveBeenCalledTimes(1);
  });
  it("preserves partial device revocation status and closes local access", async () => {
    client.accountSecurity.mockResolvedValue({ trustedDevices: [{ id: "device-id" }] });
    client.revokeTrustedDevice.mockResolvedValue({ revoked: true, sessionsLoggedOut: false, secret: "hidden" });
    await expect(service.revokeDevice("Bearer local", "device-id")).resolves.toEqual({ revoked: true, sessionsLoggedOut: false });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it("rejects another person's device before a provider mutation or local logout", async () => {
    client.accountSecurity.mockResolvedValue({ trustedDevices: [{ id: "own-device" }] });
    await expect(service.revokeDevice("Bearer local", "foreign-device")).rejects.toBeInstanceOf(NotFoundException);
    expect(client.revokeTrustedDevice).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
  it.each([403, 404])("preserves local access when the provider definitively rejects a device revocation with %s", async status => {
    client.accountSecurity.mockResolvedValue({ trustedDevices: [{ id: "device-id" }] });
    client.revokeTrustedDevice.mockRejectedValue(new Error(`Connect ${status}: private provider body`));
    await expect(service.revokeDevice("Bearer local", "device-id")).rejects.toBeInstanceOf(status === 403 ? ForbiddenException : NotFoundException);
    expect(client.revokeTrustedDevice).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("preserves local access when ownership cannot be read from a temporarily unavailable provider", async () => {
    client.accountSecurity.mockRejectedValue(new Error("Connect 503: unavailable"));
    await expect(service.revokeDevice("Bearer local", "device-id")).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(client.revokeTrustedDevice).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("identifies a preflight failure before the SDK operation begins without clearing the session", async () => {
    jest.mocked(resolveRequestSession).mockRejectedValue(new ServiceUnavailableException("Temporarily unavailable"));
    try {
      await service.revokeDevice("Bearer local", "device-id");
      throw new Error("Expected a preflight rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({ code: "account_operation_not_started" });
    }
    expect(services).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("closes local access after an uncertain revocation of a known owned device, without retry", async () => {
    client.accountSecurity.mockResolvedValue({ trustedDevices: [{ id: "device-id" }] });
    client.revokeTrustedDevice.mockRejectedValue(new Error("transport timeout"));
    await expect(service.revokeDevice("Bearer local", "device-id")).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(client.revokeTrustedDevice).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it("does not turn a transient read failure into local revocation or leak provider errors", async () => {
    client.accountSecurity.mockRejectedValue(new Error('Connect 503: {"token":"private"}'));
    await expect(service.security("Bearer local")).rejects.toThrow("Connect non disponibile o non configurato");
    expect(transaction).not.toHaveBeenCalled();
  });
  it("uses only the approved provider console URL and excludes configuration secrets", async () => {
    const result = await service.profile("Bearer local");
    expect(new URL(result.accountUrl).origin).toBe("https://sso.test");
    expect(new URL(result.accountUrl).pathname).toBe("/realms/eulab/account/");
    expect(result.profile).toEqual({ firstName: "Ada", lastName: "Rossi", email: "worker@example.test" });
    expect(JSON.stringify(result)).not.toMatch(/must-not-escape|private-|subject-a/);
    configuration.mockResolvedValue({ status: "ready", configuration: { ...settings, sourceId: "different" } });
    await expect(service.profile("Bearer local")).rejects.toBeInstanceOf(ServiceUnavailableException);
    configuration.mockResolvedValue({ status: "ready", configuration: { ...settings, issuer: "javascript:alert(1)" } });
    await expect(service.profile("Bearer local")).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it("keeps a missing capability visible instead of fabricating security state", async () => {
    client.accountSecurity.mockResolvedValue({ totp: false });
    await expect(service.security("Bearer local")).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it("projects credentials and notifications without raw provider data", async () => {
    client.accountSecurity.mockResolvedValue({ totp: true, emailVerified: true, preferredMethod: "totp", requiredActions: [], authenticators: [{ id: "otp", name: "Phone", createdAt: 123, credentialData: "secret" }], trustedDevices: [] });
    expect(JSON.stringify(await service.security("Bearer local"))).not.toContain("secret");
    client.notifications.mockResolvedValue({ items: [{ id: "notice", title: "Accesso", body: "Nuovo accesso", created_at: "2026-11-06T10:00:00Z", read_at: null, subject: "private" }], unreadCount: 1 });
    expect(JSON.stringify(await service.notices("Bearer local"))).not.toContain("private");
    expect(client.notifications).toHaveBeenCalledWith("private-provider-token", { limit: 10 });
  });
});
