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

import { bearerToken, tokenHash, sessionUserSelect } from "./local-sessions";

export interface RequestSession {
  connectSessionId?: string | null;
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
  const user = await prisma.user.findUnique({
    where: { id: stored.userId },
    select: {
      ...sessionUserSelect,
      collaborator: { select: { id: true, tenantId: true, isActive: true } },
    },
  });

  if (!user || !user.isActive) {
    throw new UnauthorizedException("Accedi per continuare");
  }

  if (user.role !== UserRole.PlatformAdmin) {
    if (!user.tenantId || !user.tenant) {
      throw new ForbiddenException(
        "Il tuo account non è associato a un'attività attiva",
      );
    }

    if (!user.tenant.isActive || user.tenant.isSuspended) {
      throw new ForbiddenException("L'accesso a questa attività è sospeso");
    }
  }

  if (
    user.role !== UserRole.PlatformAdmin &&
    !stored.connectSessionId &&
    !stored.technicalAccessId
  )
    throw new UnauthorizedException("Accedi tramite Connect");
  const connectFunctions =
    stored.connectSessionId && !stored.technicalAccessId
      ? await resolveConnectPermissions(prisma, stored.connectSessionId, user)
      : undefined;

  return {
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
      collaboratorId:
        user.collaborator?.isActive &&
        user.collaborator.tenantId === user.tenantId
          ? user.collaborator.id
          : null,
    },
    tenantId: user.tenantId,
  };
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
