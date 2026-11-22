import { BadRequestException } from "@nestjs/common";
import type { Prisma, Sector } from "@prisma/client";
import type { OperationalScope } from "./operational-scope";

/** Where an operation happens: an explicit sector, a location, or neither. */
export interface SectorTarget {
  locationId?: string | null;
  sectorId?: string | null;
}

type ServiceLike = {
  id: string;
  name: string;
  activityId: string;
  sectorId: string;
  sector?: { locationId: string } | null;
};

type SectorClient = Pick<Prisma.TransactionClient, "sector">;

/**
 * A service belongs to an activity, not to a location: the sector it is
 * performed in is the one of that activity at the chosen location. Without a
 * location (single-location accounts, legacy callers) the location of the
 * scope or of the first service's home sector is used.
 *
 * A service whose activity is not active at the location is refused: the
 * operator cannot pick something that is not set up there.
 */
export async function localizeServices<T extends ServiceLike>(
  client: SectorClient,
  tenantId: string,
  services: T[],
  target: SectorTarget = {},
  options: { publicOnly?: boolean; scope?: OperationalScope } = {},
): Promise<Array<T & { sectorId: string; sector: Sector }>> {
  if (!services.length) return [];
  const explicit = target.sectorId
    ? await client.sector.findFirst({
        where: { id: target.sectorId, tenantId },
        select: { id: true, locationId: true, activityId: true },
      })
    : null;
  if (target.sectorId && !explicit)
    throw new BadRequestException("Attività della sede non valida");
  if (explicit && target.locationId && explicit.locationId !== target.locationId)
    throw new BadRequestException("L'attività scelta non appartiene alla sede");
  const homeSector = services[0].sector?.locationId
    ? services[0].sector
    : await client.sector.findFirst({
        where: { id: services[0].sectorId, tenantId },
        select: { locationId: true },
      });
  const locationId =
    target.locationId ||
    explicit?.locationId ||
    (options.scope?.locationIds.length === 1 ? options.scope.locationIds[0] : "") ||
    homeSector?.locationId ||
    "";
  const candidates = await client.sector.findMany({
    where: {
      tenantId,
      locationId,
      activityId: { in: [...new Set(services.map((row) => row.activityId))] },
      isActive: true,
      ...(options.publicOnly ? { isPublic: true } : {}),
      ...(options.scope ? { id: { in: options.scope.allowedSectorIds } } : {}),
      location: {
        isActive: true,
        ...(options.publicOnly ? { isPublic: true } : {}),
      },
    },
  });
  return services.map((service) => {
    const sector =
      candidates.find(
        (row) => row.id === explicit?.id && row.activityId === service.activityId,
      ) ?? candidates.find((row) => row.activityId === service.activityId);
    if (!sector)
      throw new BadRequestException(
        `«${service.name}» non è disponibile in questa sede: la sua attività non è attiva qui`,
      );
    return { ...service, sectorId: sector.id, sector };
  });
}

type CatalogClient = Pick<Prisma.TransactionClient, "activity" | "sector">;

/**
 * Activity of a new or edited service, and its home sector (the first location
 * where the activity runs and the operator has access). Legacy callers may still
 * send a sector: its activity is used.
 */
export async function resolveServiceActivity(
  client: CatalogClient,
  scope: OperationalScope,
  input: { activityId?: unknown; sectorId?: unknown },
  current?: { activityId: string; sectorId: string },
): Promise<{ activityId: string; sectorId: string }> {
  const activityId =
    typeof input.activityId === "string" && input.activityId
      ? input.activityId
      : undefined;
  const sectorId =
    typeof input.sectorId === "string" && input.sectorId ? input.sectorId : undefined;
  if (!activityId && !sectorId && current) return current;
  const wanted =
    activityId ??
    (sectorId
      ? (
          await client.sector.findFirst({
            where: { id: sectorId, tenantId: scope.tenantId },
            select: { activityId: true },
          })
        )?.activityId
      : undefined) ??
    // Not chosen (the operator may not see the catalogue): the activity of the
    // scope, or the first one the operator works in. Never a blocking question.
    (await defaultScopeActivity(client, scope));
  if (!wanted)
    throw new BadRequestException(
      "Nessuna attività disponibile nelle sedi del tuo ambito",
    );
  const activity = await client.activity.findFirst({
    where: { id: wanted, tenantId: scope.tenantId },
    select: { id: true, isActive: true },
  });
  if (!activity) throw new BadRequestException("Attività non valida");
  if (current?.activityId === activity.id) return current;
  if (!activity.isActive) throw new BadRequestException("L'attività scelta è disattivata");
  const homeWhere = { tenantId: scope.tenantId, activityId: activity.id };
  const homeOrder = [{ isActive: "desc" as const }, { createdAt: "asc" as const }];
  // Prefer a location the operator works in; visibility is not a precondition.
  const home =
    (await client.sector.findFirst({
      where: { ...homeWhere, id: { in: scope.allowedSectorIds } },
      orderBy: homeOrder,
      select: { id: true },
    })) ??
    (await client.sector.findFirst({
      where: homeWhere,
      orderBy: homeOrder,
      select: { id: true },
    }));
  if (!home)
    throw new BadRequestException(
      "Attiva l'attività in almeno una sede (Sedi e attività) prima di collegarle servizi",
    );
  return { activityId: activity.id, sectorId: home.id };
}

async function defaultScopeActivity(client: CatalogClient, scope: OperationalScope) {
  const row = await client.sector.findFirst({
    where: {
      tenantId: scope.tenantId,
      id: { in: scope.sectorIds },
      activity: { isActive: true },
    },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: { activityId: true },
  });
  return row?.activityId;
}

/** Activity of a product: the chosen one, or the account's «Rivendita». */
export async function resolveProductActivity(
  client: Pick<Prisma.TransactionClient, "activity">,
  tenantId: string,
  activityId: unknown,
): Promise<string | undefined> {
  if (activityId === undefined || activityId === null || activityId === "") return undefined;
  if (typeof activityId !== "string")
    throw new BadRequestException("Attività non valida");
  const activity = await client.activity.findFirst({
    where: { id: activityId, tenantId },
    select: { id: true },
  });
  if (!activity) throw new BadRequestException("Attività non valida");
  return activity.id;
}
