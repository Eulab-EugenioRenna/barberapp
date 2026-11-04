import { ForbiddenException, UnauthorizedException } from "@nestjs/common";

import { ConnectTechnicalService } from "./connect-technical.service";

const createConnectServer = jest.fn();
const checkTechnicalOperator = jest.fn();
const assertTechnicalOperator = jest.fn();
const loadConnectConfigByInstallation = jest.fn();
const sealConnect = jest.fn();
const connectReturnUrl = jest.fn();
const createLocalSession = jest.fn();

jest.mock("../../common/connect-technical", () => ({
  ...jest.requireActual("../../common/connect-technical"),
  createConnectServer: (...args: unknown[]) => createConnectServer(...args),
  checkTechnicalOperator: (...args: unknown[]) =>
    checkTechnicalOperator(...args),
  assertTechnicalOperator: (...args: unknown[]) =>
    assertTechnicalOperator(...args),
}));
jest.mock("../../common/connect-runtime", () => ({
  ...jest.requireActual("../../common/connect-runtime"),
  loadConnectConfigByInstallation: (...args: unknown[]) =>
    loadConnectConfigByInstallation(...args),
  sealConnect: (...args: unknown[]) => sealConnect(...args),
  connectReturnUrl: () => connectReturnUrl(),
}));
jest.mock("../../common/local-sessions", () => ({
  ...jest.requireActual("../../common/local-sessions"),
  createLocalSession: (...args: unknown[]) => createLocalSession(...args),
}));

const installationId = "00000000-0000-4000-8000-000000000001";
const userId = "f5e1f8aa-5055-477c-ae54-a01a8fe9ac15";
const config = {
  tenantId: "tenant-1",
  installationId,
  apiUrl: "https://connect.example",
  secret: "installation-secret",
};
const user = {
  id: userId,
  tenantId: "tenant-1",
  role: "owner",
  isActive: true,
  connectSubject: "subject-1",
  connectInstallationId: installationId,
  tenant: { isActive: true, isSuspended: false },
};

function prismaFixture() {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    connectTechnicalAccess: {
      create: jest
        .fn()
        .mockImplementation(({ data }) => ({ id: "grant-1", ...data })),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (operation: (tx: unknown) => unknown) =>
      operation({
        connectTechnicalAccess: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      }),
    ),
  };
}

function redeem(overrides: Record<string, unknown> = {}) {
  return {
    subject: "operator-subject",
    scope: "eulab-access-as",
    installationId,
    localUserId: userId,
    localSubject: "subject-1",
    accessToken: `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url")}.signature`,
    ...overrides,
  };
}

describe("ConnectTechnicalService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadConnectConfigByInstallation.mockResolvedValue(config);
    sealConnect.mockReturnValue("sealed-operator-token");
    connectReturnUrl.mockReturnValue("http://127.0.0.1:53020/admin/#/login");
    checkTechnicalOperator.mockResolvedValue(undefined);
    assertTechnicalOperator.mockResolvedValue(undefined);
    createConnectServer.mockResolvedValue({
      redeemTechnicalTicket: jest.fn().mockResolvedValue(redeem()),
    });
  });

  it("creates a one-use fragment handoff only for an access-as profile", async () => {
    const prisma = prismaFixture();
    const service = new ConnectTechnicalService(prisma as never);
    const url = await service.start("t".repeat(43), installationId);
    expect(url).toMatch(
      /^http:\/\/127\.0\.0\.1:53020\/admin\/#\/login\?alora_technical=[A-Za-z0-9_-]{43}$/,
    );
    expect(prisma.connectTechnicalAccess.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        installationId,
        targetUserId: userId,
        targetSubject: "subject-1",
        operatorSubject: "operator-subject",
        operatorTokenCipher: "sealed-operator-token",
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "auth.connect.access_as_requested",
          entityId: "grant-1",
        }),
      }),
    );
  });

  it("refuses a generic technical ticket and a mismatched target profile", async () => {
    const service = new ConnectTechnicalService(prismaFixture() as never);
    createConnectServer.mockResolvedValueOnce({
      redeemTechnicalTicket: jest
        .fn()
        .mockResolvedValue(redeem({ scope: "eulab-technical" })),
    });
    await expect(
      service.start("t".repeat(43), installationId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    createConnectServer.mockResolvedValueOnce({
      redeemTechnicalTicket: jest
        .fn()
        .mockResolvedValue(redeem({ localSubject: "other-subject" })),
    });
    await expect(
      service.start("t".repeat(43), installationId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("binds the local session to the grant and rejects a reused handoff", async () => {
    const prisma = prismaFixture();
    prisma.connectTechnicalAccess.findUnique = jest.fn().mockResolvedValue({
      id: "grant-1",
      installationId,
      targetUserId: userId,
      targetSubject: "subject-1",
      operatorSubject: "operator-subject",
      operatorTokenCipher: "sealed",
      handoffExpiresAt: new Date(Date.now() + 30_000),
      expiresAt: new Date(Date.now() + 120_000),
      exchangedAt: null,
      revokedAt: null,
    });
    prisma.connectTechnicalAccess.updateMany.mockResolvedValue({ count: 1 });
    createLocalSession.mockResolvedValue({
      accessToken: "a".repeat(43),
      refreshToken: "r".repeat(43),
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    });
    const service = new ConnectTechnicalService(prisma as never);
    const tokens = await service.exchange("h".repeat(43));
    expect(tokens).toMatchObject({ accessToken: "a".repeat(43) });
    expect(assertTechnicalOperator).toHaveBeenCalledTimes(1);
    expect(createLocalSession).toHaveBeenCalledWith(
      expect.anything(),
      userId,
      undefined,
      expect.any(Date),
      null,
      expect.objectContaining({ id: "grant-1" }),
    );
    prisma.connectTechnicalAccess.findUnique = jest.fn().mockResolvedValue({
      ...(await prisma.connectTechnicalAccess.findUnique()),
      exchangedAt: new Date(),
    });
    await expect(service.exchange("h".repeat(43))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
