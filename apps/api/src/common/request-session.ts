import { resolveWithinRequest } from "./request-session-scope";
import { resolveConnectPermissions } from "./connect-runtime";
import {
  assertTechnicalGrantActive,
  assertTechnicalOperator,
  forgetTechnicalOperator,
} from "./connect-technical";
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { UserRole } from "./domain-types";
import { PrismaService } from "../prisma/prisma.service";

import { bearerToken, tokenHash } from "./local-sessions";
import {
  buildLocalSnapshot,
  persistConnectSnapshot,
  persistLocalSnapshot,
  readConnectSnapshot,
  readLocalSnapshot,
  SessionSnapshotRef,
} from "./session-snapshot";

export interface RequestSession {
  operationalScope?: import("../modules/locations/operational-scope").OperationalScope;
  connectSessionId?: string | null;
  /** Non-enumerable; present only for sessions resolved from a token row. */
  snapshot?: SessionSnapshotRef;
  user: {
    id: string;
    tenantId: string | null;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    permissions?: string[];
    permissionsConfigured?: boolean;
    connectFunctions?: string[];
    technicalAccess?: boolean;
    collaboratorId?: string | null;
  } | null;
  tenantId: string | null;
}

export async function resolveRequestSession(
  prisma: PrismaService,
  authorization?: string,
): Promise<RequestSession> {
  return resolveWithinRequest(prisma, authorization, () => loadRequestSession(prisma, authorization));
}

async function loadRequestSession(prisma: PrismaService, authorization?: string): Promise<RequestSession> {
  const token = bearerToken(authorization);
  if (!token) throw new UnauthorizedException("Accedi per continuare");
  const stored = await prisma.localSession.findUnique({
    where: { accessHash: tokenHash(token) },
  });
  if (
    !stored ||
    stored.revokedAt ||
    stored.usedAt ||
    stored.accessExpiresAt <= new Date()
  ) {
    throw new UnauthorizedException("Sessione scaduta o revocata");
  }
  if (stored.technicalAccessId) {
    try {
      const grant = await prisma.connectTechnicalAccess.findUnique({
        where: { id: stored.technicalAccessId },
      });
      assertTechnicalGrantActive(grant);
      if (grant.targetUserId !== stored.userId)
        throw new UnauthorizedException("Accesso come profilo non valido");
      await assertTechnicalOperator(prisma, grant);
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        await prisma.localSession
          .updateMany({
            where: { familyId: stored.familyId },
            data: { revokedAt: new Date() },
          })
          .catch(() => undefined);
        await prisma.connectTechnicalAccess
          .updateMany({
            where: { id: stored.technicalAccessId, revokedAt: null },
            data: { revokedAt: new Date() },
          })
          .catch(() => undefined);
        forgetTechnicalOperator(stored.technicalAccessId);
      }
      throw error;
    }
  }
  // Per request: token validity above (one row) + the snapshot stored with it.
  // No Connect call and no profile query while the snapshot is valid.
  const version = typeof stored.snapshotVersion === "number" ? stored.snapshotVersion : 0;
  let local = readLocalSnapshot(stored.localSnapshot);
  if (!local) {
    local = await buildLocalSnapshot(prisma, stored.userId);
    if (local) await persistLocalSnapshot(prisma, stored.id, version, local);
  }
  const user = local?.user;

  if (!local || !user || !user.isActive) {
    throw new UnauthorizedException("Accedi per continuare");
  }

  if (user.role !== UserRole.PlatformAdmin) {
    if (!user.tenantId || !local.tenant) {
      throw new ForbiddenException(
        "Il tuo account non è associato a un'attività attiva",
      );
    }

    if (!local.tenant.isActive || local.tenant.isSuspended) {
      throw new ForbiddenException("L'accesso a questa attività è sospeso");
    }
  }

  if (
    user.role !== UserRole.PlatformAdmin &&
    !stored.connectSessionId &&
    !stored.technicalAccessId
  )
    throw new UnauthorizedException("Accedi tramite Connect");
  let connectFunctions: string[] | undefined;
  if (stored.connectSessionId && !stored.technicalAccessId) {
    // Taken at login; Connect changes apply at the next login (session-snapshot.ts).
    connectFunctions = readConnectSnapshot(stored.connectSnapshot) ?? undefined;
    if (!connectFunctions) {
      // Session opened before snapshots existed: read once, then keep it.
      connectFunctions = await resolveConnectPermissions(
        prisma,
        stored.connectSessionId,
        user,
      );
      await persistConnectSnapshot(prisma, stored.id, connectFunctions);
    }
  }

  const session: RequestSession = {
    connectSessionId: stored.connectSessionId,
    user: {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      permissions: user.permissions,
      permissionsConfigured: user.permissionsConfigured,
      ...(connectFunctions ? { connectFunctions } : {}),
      ...(stored.technicalAccessId ? { technicalAccess: true } : {}),
      collaboratorId: user.collaboratorId,
    },
    tenantId: user.tenantId,
  };
  // Internal: lets the operational scope complete the snapshot without leaking
  // into JSON responses (/auth/me returns only `user`).
  Object.defineProperty(session, "snapshot", {
    value: { sessionId: stored.id, version, local } satisfies SessionSnapshotRef,
    enumerable: false,
    writable: true,
  });
  return session;
}

export function requireTenantId(session: RequestSession): string {
  if (session.user?.role === UserRole.PlatformAdmin) {
    throw new ForbiddenException("Usa l’amministrazione di piattaforma");
  }
  if (!session.tenantId) {
    throw new NotFoundException("Non hai ancora configurato la tua attività");
  }

  return session.tenantId;
}

export function requireUser(
  session: RequestSession,
): NonNullable<RequestSession["user"]> {
  if (!session.user) {
    throw new UnauthorizedException("Accedi per continuare");
  }

  return session.user;
}

export function requirePlatformAdmin(
  session: RequestSession,
): NonNullable<RequestSession["user"]> {
  const user = requireUser(session);

  if (user.role !== UserRole.PlatformAdmin) {
    throw new ForbiddenException("Non hai i permessi per questa operazione");
  }

  return user;
}
