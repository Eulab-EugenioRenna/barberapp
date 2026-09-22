import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { UserRole } from "./domain-types";
import { PrismaService } from "../prisma/prisma.service";

const SESSION_PREFIX = "barber-session:";

export interface RequestSession {
  user: {
    id: string;
    tenantId: string | null;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  } | null;
  tenantId: string | null;
}

type UserSessionRecord = {
  id: string;
  tenantId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  tenant: {
    id: string;
    isActive: boolean;
    isSuspended: boolean;
  } | null;
};

export function buildSessionToken(userId: string): string {
  return `${SESSION_PREFIX}${userId}`;
}

function parseSessionToken(authorization?: string): string | null {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice(7).trim();

  if (!token.startsWith(SESSION_PREFIX)) {
    return null;
  }

  return token.slice(SESSION_PREFIX.length) || null;
}

export async function resolveRequestSession(
  prisma: PrismaService,
  authorization?: string,
): Promise<RequestSession> {
  const userId = parseSessionToken(authorization);

  if (!userId) {
    throw new UnauthorizedException("Authentication required");
  }

  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      tenantId: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      tenant: {
        select: {
          id: true,
          isActive: true,
          isSuspended: true,
        },
      },
    },
  })) as UserSessionRecord | null;

  if (!user || !user.isActive) {
    throw new UnauthorizedException("Authentication required");
  }

  if (user.role !== UserRole.PlatformAdmin) {
    if (!user.tenantId || !user.tenant) {
      throw new ForbiddenException("User is not assigned to an active tenant");
    }

    if (!user.tenant.isActive || user.tenant.isSuspended) {
      throw new ForbiddenException("Tenant access is suspended");
    }
  }

  return {
    user: {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
    tenantId: user.tenantId,
  };
}

export function requireTenantId(session: RequestSession): string {
  if (!session.tenantId) {
    throw new NotFoundException(
      "No tenant is configured yet. Create an account first.",
    );
  }

  return session.tenantId;
}

export function requireUser(
  session: RequestSession,
): NonNullable<RequestSession["user"]> {
  if (!session.user) {
    throw new UnauthorizedException("Authentication required");
  }

  return session.user;
}

export function requirePlatformAdmin(
  session: RequestSession,
): NonNullable<RequestSession["user"]> {
  const user = requireUser(session);

  if (user.role !== UserRole.PlatformAdmin) {
    throw new ForbiddenException("Platform admin required");
  }

  return user;
}
