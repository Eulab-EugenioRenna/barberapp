import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { resolveRequestSession, requireTenantId } from "./request-session";
import { assertTechnicalOperator } from "./connect-technical";
jest.mock("./connect-technical", () => ({
  ...jest.requireActual("./connect-technical"),
  assertTechnicalOperator: jest.fn(),
}));
const token = "a".repeat(43);
function fixture(overrides = {}, stored = {}): any {
  return {
    localSession: {
      findUnique: jest.fn().mockResolvedValue({
        userId: "u1",
        familyId: "family-1",
        accessExpiresAt: new Date(Date.now() + 60_000),
        ...stored,
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: "u1",
        role: "owner",
        tenantId: "t1",
        isActive: true,
        permissions: [],
        tenant: { isActive: true, isSuspended: false },
        ...overrides,
      }),
    },
  };
}
describe("local request sessions", () => {
  it.each([
    undefined,
    "Bearer barber-session:u1",
    "Bearer u1",
    `Bearer ${"b".repeat(42)}`,
  ])("rejects missing or predictable tokens %s", async (header) => {
    await expect(
      resolveRequestSession({} as never, header),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it.each([
    { revokedAt: new Date() },
    { usedAt: new Date() },
    { accessExpiresAt: new Date(0) },
  ])("rejects revoked, rotated and expired access", async (stored) => {
    const prisma = fixture({}, stored);
    await expect(
      resolveRequestSession(prisma as never, `Bearer ${token}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  it("rejects suspended companies", async () => {
    await expect(
      resolveRequestSession(
        fixture({ tenant: { isActive: true, isSuspended: true } }) as never,
        `Bearer ${token}`,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("allows platform login but denies ordinary tenant operations", async () => {
    const session = await resolveRequestSession(
      fixture({
        role: "platform_admin",
        tenantId: null,
        tenant: null,
      }) as never,
      `Bearer ${token}`,
    );
    expect(session.user?.role).toBe("platform_admin");
    expect(() => requireTenantId(session)).toThrow(ForbiddenException);
  });
  it("rejects existing local tenant tokens before any Connect activation", async () => {
    await expect(
      resolveRequestSession(fixture() as never, `Bearer ${token}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it("queries only the hash and exposes a public user projection", async () => {
    const prisma = fixture({ role: "platform_admin" });
    const session = await resolveRequestSession(
      prisma as never,
      `Bearer ${token}`,
    );
    expect(
      JSON.stringify(prisma.localSession.findUnique.mock.calls),
    ).not.toContain(token);
    expect(session.user).not.toHaveProperty("passwordHash");
    expect(prisma.user.findUnique.mock.calls[0][0].select).not.toHaveProperty(
      "passwordHash",
    );
  });
  it("allows a short access-as session only while its operator grant is rechecked", async () => {
    const prisma = fixture(
      {},
      { technicalAccessId: "grant-1", connectSessionId: null },
    ) as ReturnType<typeof fixture> & {
      connectTechnicalAccess: { findUnique: jest.Mock };
    };
    prisma.localSession.updateMany = jest.fn();
    prisma.connectTechnicalAccess = {
      findUnique: jest.fn().mockResolvedValue({
        id: "grant-1",
        installationId: "i1",
        targetUserId: "u1",
        targetSubject: "subject-1",
        operatorSubject: "operator-1",
        operatorTokenCipher: "sealed",
        handoffExpiresAt: new Date(Date.now() + 60_000),
        expiresAt: new Date(Date.now() + 60_000),
        exchangedAt: new Date(),
        revokedAt: null,
      }),
      updateMany: jest.fn(),
    };
    const session = await resolveRequestSession(
      prisma as never,
      `Bearer ${token}`,
    );
    expect(session.user?.technicalAccess).toBe(true);
    expect(session.user).not.toHaveProperty("connectFunctions");
    expect(assertTechnicalOperator).toHaveBeenCalledTimes(1);
  });
  it("revokes a technical session when the operator recheck fails", async () => {
    jest
      .mocked(assertTechnicalOperator)
      .mockRejectedValueOnce(new UnauthorizedException());
    const prisma = fixture(
      {},
      { technicalAccessId: "grant-1", connectSessionId: null },
    ) as ReturnType<typeof fixture> & {
      connectTechnicalAccess: {
        findUnique: jest.Mock;
        updateMany: jest.Mock;
      };
    };
    prisma.localSession.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    prisma.connectTechnicalAccess = {
      findUnique: jest.fn().mockResolvedValue({
        id: "grant-1",
        installationId: "i1",
        targetUserId: "u1",
        targetSubject: "subject-1",
        operatorSubject: "operator-1",
        operatorTokenCipher: "sealed",
        handoffExpiresAt: new Date(Date.now() + 60_000),
        expiresAt: new Date(Date.now() + 60_000),
        exchangedAt: new Date(),
        revokedAt: null,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    await expect(
      resolveRequestSession(prisma as never, `Bearer ${token}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.localSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ familyId: expect.any(String) }),
      }),
    );
    expect(prisma.connectTechnicalAccess.updateMany).toHaveBeenCalled();
  });
});
