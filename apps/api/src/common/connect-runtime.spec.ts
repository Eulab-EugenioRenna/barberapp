import { canUseLocalFunction } from "./function-catalog";
import { connectConfig, openConnect, sealConnect, resolveConnectPermissions, refreshConnectSession, connectFunctionKeys } from "./connect-runtime";
import { ForbiddenException, UnauthorizedException, ServiceUnavailableException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { connectApplication } from "./connect-application";
jest.mock("./connect-application", () => ({ connectApplication: jest.fn() }));

describe("Connect boundary", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env = {
      ...original,
      ALORA_CONNECT_ENCRYPTION_KEY: "a".repeat(64),
      ALORA_CONNECT_API_URL: "http://127.0.0.1:8088",
      ALORA_CONNECT_ISSUER: "http://127.0.0.1:8080/realms/test",
      ALORA_CONNECT_CLIENT_ID: "alora-client",
      ALORA_CONNECT_CALLBACK_URL:
        "http://127.0.0.1:53020/api/auth/connect/callback",
      ALORA_AUTH_RETURN_URL: "http://127.0.0.1:53020/admin/#/login",
      ALORA_CONNECT_APP_ID: "alora",
      ALORA_CONNECT_TENANTS_JSON: JSON.stringify({
        t1: { customerId: "c1", installationId: "i1", secret: "synthetic" },
      }),
    };
  });
  afterEach(() => {
    process.env = original;
  });
  it("configures only explicitly mapped tenants, without a public-host fallback", () => {
    expect(connectConfig("t2")).toBeNull();
    expect(connectConfig("t1")?.installationId).toBe("i1");
    delete process.env["ALORA_CONNECT_ISSUER"];
    expect(() => connectConfig("t1")).toThrow(
      "Configurazione Connect incompleta",
    );
  });
  it("rejects cross-origin callbacks, non-HTTPS production and missing encryption keys", () => {
    process.env["ALORA_CONNECT_CALLBACK_URL"] =
      "https://other.example/callback";
    expect(() => connectConfig("t1")).toThrow();
    process.env["ALORA_CONNECT_CALLBACK_URL"] =
      "http://127.0.0.1:53020/api/auth/connect/callback";
    process.env["NODE_ENV"] = "production";
    expect(() => connectConfig("t1")).toThrow();
    process.env["NODE_ENV"] = "test";
    delete process.env["ALORA_CONNECT_ENCRYPTION_KEY"];
    expect(() => sealConnect("provider-token")).toThrow();
  });
  it("encrypts credentials with authentication and a different IV each time", () => {
    const one = sealConnect("provider-token"),
      two = sealConnect("provider-token");
    expect(one).not.toBe(two);
    expect(one).not.toContain("provider-token");
    expect(openConnect(one)).toBe("provider-token");
    const parts = one.split(".");
    parts[3] = "A" + parts[3].slice(1);
    if (parts.join(".") === one) parts[3] = "B" + parts[3].slice(1);
    expect(() => openConnect(parts.join("."))).toThrow();
  });
  it("never turns an owner or local alias into a Connect grant", () => {
    expect(
      canUseLocalFunction(
        { role: "owner", connectFunctions: [] },
        "services.manage",
      ),
    ).toBe(false);
    expect(
      canUseLocalFunction(
        {
          role: "manager",
          permissions: ["settings.manage"],
          connectFunctions: ["settings.manage"],
        },
        "notifications.manage",
      ),
    ).toBe(false);
    expect(
      canUseLocalFunction(
        { role: "owner", connectFunctions: ["services.read"] },
        "services.read",
      ),
    ).toBe(true);
    expect(
      canUseLocalFunction(
        {
          role: "collaborator",
          collaboratorId: "c1",
          connectFunctions: ["appointments.read.own"],
        },
        "appointments.read.own",
      ),
    ).toBe(true);
    expect(
      canUseLocalFunction(
        {
          role: "collaborator",
          collaboratorId: "c1",
          connectFunctions: ["appointments.read.all"],
        },
        "appointments.read.all",
      ),
    ).toBe(false);
  });
  it("distinguishes an invalidated SDK session from temporary provider unavailability", async () => {
    const prisma = { connectSession: { findUnique: jest.fn(async () => ({ userId: "u1", installationId: "i1", sdkSessionCipher: sealConnect("private-handle"), expiresAt: new Date(Date.now() + 60000), revokedAt: null })) } } as unknown as PrismaClient;
    const services = jest.fn();
    jest.mocked(connectApplication).mockResolvedValue({ services } as unknown as Awaited<ReturnType<typeof connectApplication>>);
    services.mockRejectedValue({ code: "access_denied" });
    await expect(resolveConnectPermissions(prisma, "s1", { id: "u1", tenantId: "t1", connectSubject: "subject" })).rejects.toBeInstanceOf(UnauthorizedException);
    services.mockRejectedValue({ code: "provider_unavailable" });
    await expect(resolveConnectPermissions(prisma, "s1", { id: "u1", tenantId: "t1", connectSubject: "subject" })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  describe("permissions only at session creation", () => {
    const user = { id: "u1", tenantId: "t1", connectSubject: "subject" };
    const granted = { localUserId: "u1", subject: "subject", installationId: "i1", functions: [{ key: "sales.read" }] };
    let row: Record<string, unknown>;
    let prisma: PrismaClient;
    let services: jest.Mock;
    let refresh: jest.Mock;
    beforeEach(() => {
      row = { userId: "u1", installationId: "i1", sdkSessionCipher: sealConnect("private-handle"), expiresAt: new Date(Date.now() + 60000), revokedAt: null };
      prisma = { connectSession: { findUnique: jest.fn(async () => row) } } as unknown as PrismaClient;
      services = jest.fn(async () => granted);
      refresh = jest.fn(async () => undefined);
      jest.mocked(connectApplication).mockResolvedValue({ services, auth: { refresh } } as unknown as Awaited<ReturnType<typeof connectApplication>>);
    });

    it("reads the functions of the exact local user, subject and installation", async () => {
      await expect(resolveConnectPermissions(prisma, "s1", user)).resolves.toEqual(["sales.read"]);
      expect(() => connectFunctionKeys(granted, { localUserId: "u2", subject: "subject", installationId: "i1" })).toThrow(ForbiddenException);
      expect(() => connectFunctionKeys(granted, { localUserId: "u1", subject: "subject", installationId: "i2" })).toThrow(ForbiddenException);
    });

    it("refuses a locally revoked or expired Connect session before calling Connect", async () => {
      row["revokedAt"] = new Date();
      await expect(resolveConnectPermissions(prisma, "s1", user)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(refreshConnectSession(prisma, "s1", user)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(services).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("token refresh keeps the SSO session alive without reading permissions", async () => {
      await refreshConnectSession(prisma, "s1", user);
      expect(refresh).toHaveBeenCalledWith("private-handle");
      expect(services).not.toHaveBeenCalled();
      refresh.mockRejectedValueOnce({ code: "access_denied" });
      await expect(refreshConnectSession(prisma, "s1", user)).rejects.toBeInstanceOf(UnauthorizedException);
      refresh.mockRejectedValueOnce({ code: "provider_unavailable" });
      await expect(refreshConnectSession(prisma, "s1", user)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
