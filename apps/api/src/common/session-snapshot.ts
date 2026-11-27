import type { Prisma } from "@prisma/client";

/**
 * Session snapshot, stored on the LocalSession row and read with the token in a
 * single query.
 *
 * Why a column and not Redis: the token row is read on every request anyway, so
 * the snapshot costs no extra round trip; it is revoked, expired and deleted
 * together with the session (same row, same transaction) and survives a cache
 * flush or restart. Redis would add a second lookup and a second source of truth
 * to keep consistent with revocation.
 *
 * Freshness contract
 *  - connect: the Connect functions are read ONLY at login (Connect callback /
 *    exchange) and copied unchanged on refresh. A function granted or withdrawn on
 *    Connect takes effect at the next login. Logout and every ALORA revocation
 *    (logout, «chiudi sessioni», tenant suspension, personal account) stay
 *    immediate: "revokedAt" is checked on every request. Connect exposes no
 *    revocation webhook to ALORA today; a definitive access_denied from Connect is
 *    still detected at the next token refresh (SSO refresh, no permissions call).
 *  - local: ALORA profile, company state and sector memberships. Database triggers
 *    (migration 20261127090000_session_snapshot) clear it and bump
 *    "snapshotVersion" whenever a source row changes; the next request rebuilds it
 *    once. Local changes therefore keep taking effect immediately.
 */
export const SNAPSHOT_VERSION = 1;

export interface SnapshotUser {
  id: string;
  tenantId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  permissions: string[];
  permissionsConfigured: boolean;
  isActive: boolean;
  connectSubject: string | null;
  collaboratorId: string | null;
}
export interface SnapshotSector {
  id: string;
  locationId: string;
}
export interface LocalSnapshot {
  v: typeof SNAPSHOT_VERSION;
  user: SnapshotUser;
  tenant: { id: string; isActive: boolean; isSuspended: boolean } | null;
  /** Sectors the account may operate on (no header filter); filled on first use. */
  sectors?: SnapshotSector[];
}
export interface ConnectSnapshot {
  v: typeof SNAPSHOT_VERSION;
  functions: string[];
  takenAt: string;
}
/** Request-side handle used to complete the snapshot lazily (e.g. the sectors). */
export interface SessionSnapshotRef {
  sessionId: string;
  version: number;
  local: LocalSnapshot;
}

type Db = {
  user: { findUnique: (args: never) => Promise<unknown> };
  sector: { findMany: (args: never) => Promise<unknown> };
  localSession: { updateMany: (args: never) => Promise<unknown> };
};

const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export function connectSnapshot(functions: string[]): Prisma.InputJsonValue {
  return {
    v: SNAPSHOT_VERSION,
    functions: [...new Set(functions)].sort(),
    takenAt: new Date().toISOString(),
  } satisfies ConnectSnapshot;
}

export function readConnectSnapshot(value: unknown): string[] | null {
  const snapshot = value as Partial<ConnectSnapshot> | null | undefined;
  return snapshot?.v === SNAPSHOT_VERSION && strings(snapshot.functions)
    ? snapshot.functions
    : null;
}

export function readLocalSnapshot(value: unknown): LocalSnapshot | null {
  const snapshot = value as Partial<LocalSnapshot> | null | undefined;
  const user = snapshot?.user;
  if (
    snapshot?.v !== SNAPSHOT_VERSION ||
    !user ||
    typeof user.id !== "string" ||
    typeof user.role !== "string" ||
    typeof user.isActive !== "boolean" ||
    !strings(user.permissions)
  )
    return null;
  if (
    snapshot.sectors !== undefined &&
    (!Array.isArray(snapshot.sectors) ||
      snapshot.sectors.some(
        (sector) =>
          typeof sector?.id !== "string" ||
          typeof sector?.locationId !== "string",
      ))
  )
    return { ...(snapshot as LocalSnapshot), sectors: undefined };
  return snapshot as LocalSnapshot;
}

/** One query: user, company state and the collaborator profile link. */
export async function buildLocalSnapshot(
  prisma: Pick<Db, "user">,
  userId: string,
): Promise<LocalSnapshot | null> {
  const user = (await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      tenantId: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      permissions: true,
      permissionsConfigured: true,
      isActive: true,
      connectSubject: true,
      tenant: { select: { id: true, isActive: true, isSuspended: true } },
      collaborator: { select: { id: true, tenantId: true, isActive: true } },
    },
  } as never)) as
    | (Omit<SnapshotUser, "collaboratorId"> & {
        tenant?: LocalSnapshot["tenant"];
        collaborator?: { id: string; tenantId: string; isActive: boolean } | null;
      })
    | null;
  if (!user) return null;
  return {
    v: SNAPSHOT_VERSION,
    user: {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      permissions: user.permissions ?? [],
      permissionsConfigured: !!user.permissionsConfigured,
      isActive: !!user.isActive,
      connectSubject: user.connectSubject ?? null,
      collaboratorId:
        user.collaborator?.isActive &&
        user.collaborator.tenantId === user.tenantId
          ? user.collaborator.id
          : null,
    },
    tenant: user.tenant
      ? {
          id: user.tenant.id,
          isActive: !!user.tenant.isActive,
          isSuspended: !!user.tenant.isSuspended,
        }
      : null,
  };
}

/** Operational membership; function grants are checked elsewhere. */
export async function allowedSectors(
  prisma: Pick<Db, "sector">,
  tenantId: string,
  user: { id: string; role: string; collaboratorId?: string | null },
): Promise<SnapshotSector[]> {
  return (await prisma.sector.findMany({
    where: {
      tenantId,
      ...(["owner", "collaborator"].includes(user.role)
        ? {}
        : { access: { some: { userId: user.id } } }),
      ...(user.role === "collaborator"
        ? {
            collaborators: {
              some: { collaboratorId: user.collaboratorId || "" },
            },
          }
        : {}),
    },
    select: { id: true, locationId: true },
    orderBy: { id: "asc" },
  } as never)) as SnapshotSector[];
}

/**
 * Best effort and only if nothing changed meanwhile: a trigger that cleared the
 * snapshot after we read its sources bumped the version, so the stale copy is
 * dropped and rebuilt on the next request. A failed write never fails a request.
 */
export async function persistLocalSnapshot(
  prisma: Pick<Db, "localSession">,
  sessionId: string | undefined,
  version: number,
  snapshot: LocalSnapshot,
): Promise<void> {
  if (!sessionId) return;
  try {
    await prisma.localSession.updateMany({
      where: { id: sessionId, snapshotVersion: version, revokedAt: null },
      data: { localSnapshot: snapshot },
    } as never);
  } catch {
    // The request already has the fresh value; the next one retries.
  }
}

export async function persistConnectSnapshot(
  prisma: Pick<Db, "localSession">,
  sessionId: string | undefined,
  functions: string[],
): Promise<void> {
  if (!sessionId) return;
  try {
    await prisma.localSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { connectSnapshot: connectSnapshot(functions) },
    } as never);
  } catch {
    // Legacy session: the next request asks Connect again.
  }
}
