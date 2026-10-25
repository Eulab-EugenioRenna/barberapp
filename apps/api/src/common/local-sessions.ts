import { resolveConnectPermissions } from "./connect-runtime";
import { UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

export const ACCESS_TTL_MS = 15 * 60_000;
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60_000;
export const publicUserSelect = {
  id: true,
  tenantId: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  permissions: true,
  permissionsConfigured: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;
export const sessionUserSelect = {
  ...publicUserSelect,
  connectActivatedAt: true,
  connectSubject: true,
  tenant: { select: { id: true, isActive: true, isSuspended: true } },
} as const;

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function bearerToken(authorization?: string): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? "");
  return match?.[1] ?? null;
}
export function assertActiveUser(
  user: Prisma.UserGetPayload<{ select: typeof sessionUserSelect }> | null,
): void {
  if (!user?.isActive) throw new UnauthorizedException("Accedi per continuare");
  if (
    user.role !== "platform_admin" &&
    (!user.tenantId || !user.tenant?.isActive || user.tenant.isSuspended)
  ) {
    throw new UnauthorizedException("L'accesso a questa attività è sospeso");
  }
}
export async function createLocalSession(
  tx: Prisma.TransactionClient,
  userId: string,
  familyId: string = randomUUID(),
  refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS),
  connectSessionId: string | null = null,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"user:" + userId}, 0))`;
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: sessionUserSelect,
  });
  assertActiveUser(user);
  if (user?.role !== "platform_admin" && !connectSessionId)
    throw new UnauthorizedException("Accedi tramite Connect");
  const accessToken = randomBytes(32).toString("base64url");
  const refreshToken = randomBytes(32).toString("base64url");
  const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS);
  await tx.localSession.create({
    data: {
      userId,
      familyId,
      connectSessionId,
      accessHash: tokenHash(accessToken),
      refreshHash: tokenHash(refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
    },
  });
  return {
    accessToken,
    refreshToken,
    expiresAt: accessExpiresAt.toISOString(),
  };
}
export async function rotateLocalSession(
  prisma: PrismaClient,
  refreshToken: string,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(refreshToken))
    throw new UnauthorizedException();
  const providerSession = await prisma.localSession.findUnique({
    where: { refreshHash: tokenHash(refreshToken) },
    include: {
      user: { select: { id: true, tenantId: true, connectSubject: true } },
    },
  });
  if (
    providerSession?.connectSessionId &&
    !providerSession.usedAt &&
    !providerSession.revokedAt
  ) {
    await resolveConnectPermissions(
      prisma,
      providerSession.connectSessionId,
      providerSession.user,
      true,
    );
  }
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.localSession.findUnique({
      where: { refreshHash: tokenHash(refreshToken) },
    });
    if (!current) return null;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"user:" + current.userId}, 0))`;
    // Serialize every transition in this family, including concurrent replay/logout.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${current.familyId}, 0))`;
    const claimed = await tx.localSession.updateMany({
      where: {
        id: current.id,
        usedAt: null,
        revokedAt: null,
        refreshExpiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      const actor = await tx.user.findUnique({
        where: { id: current.userId },
        select: { tenantId: true, role: true },
      });
      const latest = await tx.localSession.findUnique({
        where: { id: current.id },
        select: { usedAt: true },
      });
      await tx.localSession.updateMany({
        where: { familyId: current.familyId },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: current.userId,
          tenantId: actor?.tenantId,
          actorRole: actor?.role,
          action: latest?.usedAt
            ? "auth.refresh_reuse"
            : "auth.refresh_rejected",
          entityType: "session",
        },
      });
      return null;
    }
    const user = await tx.user.findUnique({
      where: { id: current.userId },
      select: sessionUserSelect,
    });
    try {
      assertActiveUser(user);
      if (user?.role !== "platform_admin" && !current.connectSessionId)
        throw new UnauthorizedException();
      if (current.connectSessionId) {
        const session = await tx.connectSession.findUnique({
          where: { id: current.connectSessionId },
        });
        if (!session || session.revokedAt) throw new UnauthorizedException();
      }
    } catch {
      await tx.localSession.updateMany({
        where: { familyId: current.familyId },
        data: { revokedAt: new Date() },
      });
      return null;
    }
    return createLocalSession(
      tx,
      current.userId,
      current.familyId,
      current.refreshExpiresAt,
      current.connectSessionId,
    );
  });
  if (!result) throw new UnauthorizedException("Sessione scaduta o revocata");
  return result;
}
export async function revokeLocalSession(
  prisma: PrismaClient,
  authorization?: string,
) {
  const token = bearerToken(authorization);
  if (!token) throw new UnauthorizedException();
  await prisma.$transaction(async (tx) => {
    const current = await tx.localSession.findUnique({
      where: { accessHash: tokenHash(token) },
    });
    if (!current) throw new UnauthorizedException();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${current.familyId}, 0))`;
    await tx.localSession.updateMany({
      where: { familyId: current.familyId },
      data: { revokedAt: new Date() },
    });
    if (current.connectSessionId)
      await tx.connectSession.updateMany({
        where: { id: current.connectSessionId },
        data: { revokedAt: new Date() },
      });
    const actor = await tx.user.findUnique({
      where: { id: current.userId },
      select: { tenantId: true, role: true },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: current.userId,
        tenantId: actor?.tenantId,
        actorRole: actor?.role,
        action: "auth.logout",
        entityType: "session",
      },
    });
  });
}
