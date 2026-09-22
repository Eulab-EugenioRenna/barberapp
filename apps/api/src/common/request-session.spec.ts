import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { UserRole } from "./domain-types";
import { resolveRequestSession } from "./request-session";

describe("resolveRequestSession", () => {
  it("rejects requests without a bearer token", async () => {
    await expect(
      resolveRequestSession({} as never, undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects suspended tenant access", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "user-1",
          tenantId: "tenant-1",
          email: "owner@example.test",
          firstName: "Owner",
          lastName: "User",
          role: UserRole.Owner,
          isActive: true,
          tenant: {
            id: "tenant-1",
            isActive: true,
            isSuspended: true,
          },
        }),
      },
    } as never;

    await expect(
      resolveRequestSession(prisma, "Bearer barber-session:user-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows platform admins without a tenant", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "admin-1",
          tenantId: null,
          email: "admin@example.test",
          firstName: "Platform",
          lastName: "Admin",
          role: UserRole.PlatformAdmin,
          isActive: true,
          tenant: null,
        }),
      },
    } as never;

    await expect(
      resolveRequestSession(prisma, "Bearer barber-session:admin-1"),
    ).resolves.toEqual({
      tenantId: null,
      user: {
        id: "admin-1",
        tenantId: null,
        email: "admin@example.test",
        firstName: "Platform",
        lastName: "Admin",
        role: UserRole.PlatformAdmin,
      },
    });
  });
});
