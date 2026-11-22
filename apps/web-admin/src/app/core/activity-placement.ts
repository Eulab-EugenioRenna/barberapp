/**
 * Mirror of the server rule (activity-sectors.ts): a service belongs to an
 * activity and is performed in the sector of that activity at a location.
 */
export interface PlacementSector {
  id: string;
  locationId: string;
  activityId?: string | null;
  isActive?: boolean;
}

/** Sector of the activity at the location (active ones only). */
export function sectorForActivity(
  sectors: readonly PlacementSector[],
  activityId: string | null | undefined,
  locationId: string | null | undefined,
): PlacementSector | undefined {
  if (!activityId || !locationId) return undefined;
  return sectors.find(
    (sector) =>
      sector.locationId === locationId &&
      sector.activityId === activityId &&
      sector.isActive !== false,
  );
}

/**
 * Can the service be chosen at this location? Without a location every service
 * is offered; services without an activity (old data) fall back to their sector.
 */
export function offeredAt(
  sectors: readonly PlacementSector[],
  service: { activityId?: string | null; sectorId?: string | null; sector?: { locationId?: string } | null },
  locationId: string | null | undefined,
): boolean {
  if (!locationId) return true;
  if (!service.activityId)
    return (
      (service.sector?.locationId ||
        sectors.find((sector) => sector.id === service.sectorId)?.locationId) === locationId
    );
  return !!sectorForActivity(sectors, service.activityId, locationId);
}

/** Locations where the activity runs, for hints such as «Disponibile a: …». */
export function activityLocationIds(
  sectors: readonly PlacementSector[],
  activityId: string | null | undefined,
): string[] {
  return [
    ...new Set(
      sectors
        .filter((sector) => sector.activityId === activityId && sector.isActive !== false)
        .map((sector) => sector.locationId),
    ),
  ];
}
