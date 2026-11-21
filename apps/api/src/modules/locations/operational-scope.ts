import { Prisma } from "@prisma/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../../prisma/prisma.service";
import type { RequestSession } from "../../common/request-session";

export interface OperationalScope {
  tenantId: string;
  sectorIds: string[];
  allowedSectorIds: string[];
  locationIds: string[];
  cacheKey: string;
}
export type ScopeHeaders = {
  authorization?: string;
  "x-alora-location"?: string;
  "x-alora-sector"?: string;
};
const cacheScope = new AsyncLocalStorage<string>();
export const runOperationalCacheScope = <T>(
  key: string | undefined,
  action: () => T,
): T => cacheScope.run(key || "", action);
export const operationalCacheKey = (key: string): string =>
  cacheScope.getStore() ? `${key}:scope9:${cacheScope.getStore()}` : key;

/** Function grants are checked separately. Membership never grants an ALORA function. */
export async function resolveOperationalScope(
  prisma: PrismaService,
  session: RequestSession,
  headers: ScopeHeaders = {},
): Promise<OperationalScope> {
  if (session.operationalScope) return session.operationalScope;
  const tenantId = session.tenantId;
  if (!tenantId || !session.user)
    throw new ForbiddenException("Attività non disponibile");
  const locationId = headers["x-alora-location"];
  const sectorId = headers["x-alora-sector"];
  if (
    (locationId && locationId.length > 100) ||
    (sectorId && sectorId.length > 100)
  )
    throw new BadRequestException("Ambito non valido");
  const allowed = await prisma.sector.findMany({
    where: {
      tenantId,

      ...(["owner", "collaborator"].includes(session.user.role)
        ? {}
        : { access: { some: { userId: session.user.id } } }),
      ...(session.user.role === "collaborator"
        ? {
            collaborators: {
              some: { collaboratorId: session.user.collaboratorId || "" },
            },
          }
        : {}),
    },
    select: { id: true, locationId: true },
    orderBy: { id: "asc" },
  });
  const sectors = allowed.filter(
    (sector) =>
      (!locationId || sector.locationId === locationId) &&
      (!sectorId || sector.id === sectorId),
  );
  if ((locationId || sectorId) && !sectors.length)
    throw new ForbiddenException("Sede o settore non accessibili");
  const scope: OperationalScope = {
    tenantId,
    sectorIds: sectors.map((s) => s.id),
    allowedSectorIds: allowed.map((s) => s.id),
    locationIds: [...new Set(sectors.map((s) => s.locationId))],
    cacheKey: "",
  };
  scope.cacheKey = createHash("sha256")
    .update(JSON.stringify([tenantId, scope.allowedSectorIds, scope.sectorIds]))
    .digest("hex")
    .slice(0, 24);
  session.operationalScope = scope;
  return scope;
}
export const sectorFilter = (scope: OperationalScope) => ({
  sectorId: { in: scope.sectorIds },
});
export const collaboratorFilter = (scope: OperationalScope) => ({
  sectors: { some: sectorFilter(scope) },
});
/** A partially authorized account must not reveal the other sectors' lines or total. */
export const saleFilter = (scope: OperationalScope) => ({
  locationId: { in: scope.locationIds },
  items: { every: { sectorId: { in: scope.allowedSectorIds } } },
  AND: [
    { OR: [{ items: { none: {} } }, { items: { some: sectorFilter(scope) } }] },
    {
      OR: [
        { appointmentId: null },
        { appointment: { sectorId: { in: scope.allowedSectorIds } } },
      ],
    },
  ],
});

export async function requireSector(
  prisma: PrismaService,
  scope: OperationalScope,
  sectorId?: unknown,
  active = true,
) {
  const id =
    typeof sectorId === "string" && sectorId
      ? sectorId
      : scope.sectorIds.length === 1
        ? scope.sectorIds[0]
        : "";
  if (!id || !scope.sectorIds.includes(id))
    throw new BadRequestException("Seleziona un settore abilitato");
  const sector = await prisma.sector.findFirst({
    where: {
      id,
      tenantId: scope.tenantId,
      ...(active ? { isActive: true, location: { isActive: true } } : {}),
    },
  });
  if (!sector) throw new BadRequestException("Settore o sede non disponibili");
  return sector;
}

export async function requireServiceScope(
  prisma: PrismaService,
  scope: OperationalScope,
  id: string,
  active = true,
) {
  const service = await prisma.service.findFirst({
    where: {
      id,
      tenantId: scope.tenantId,
      ...sectorFilter(scope),
      ...(active
        ? {
            isActive: true,
            sector: { isActive: true, location: { isActive: true } },
          }
        : {}),
    },
    include: { sector: true },
  });
  if (!service)
    throw new BadRequestException(
      "Servizio non disponibile in questa sede o settore",
    );
  return service;
}

export async function appointmentResources(
  prisma: PrismaService,
  input: {
    tenantId: string;
    sectorId: string;
    requiresCollaborator: boolean;
    requiresRoom: boolean;
    collaboratorId?: string | null;
    roomId?: string | null;
    startsAt: Date;
    endsAt: Date;
    excludeId?: string;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
  },
) {
  if (input.requiresCollaborator && !input.collaboratorId)
    throw new BadRequestException("Scegli un professionista abilitato");
  if (
    input.collaboratorId &&
    !(await prisma.collaborator.count({
      where: {
        id: input.collaboratorId,
        tenantId: input.tenantId,
        isActive: true,
        sectors: { some: { sectorId: input.sectorId } },
      },
    }))
  )
    throw new BadRequestException("Professionista non abilitato al settore");
  if (!input.requiresRoom && !input.roomId) return undefined;
  const rooms = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT r.id FROM "Room" r WHERE r."tenantId"=${input.tenantId} AND r."sectorId"=${input.sectorId} AND r."isActive"
    ${input.roomId ? Prisma.sql`AND r.id=${input.roomId}` : Prisma.empty}
    AND alora_room_has_capacity(r.id,
      ${input.startsAt}::timestamp-${input.bufferBeforeMinutes || 0}*INTERVAL '1 minute',
      ${input.endsAt}::timestamp+${input.bufferAfterMinutes || 0}*INTERVAL '1 minute',
      ${input.excludeId ?? null}) ORDER BY r.id LIMIT 1`);
  const room = rooms[0];
  if (!room)
    throw new BadRequestException("Nessuna risorsa disponibile nel settore");
  return room.id;
}
