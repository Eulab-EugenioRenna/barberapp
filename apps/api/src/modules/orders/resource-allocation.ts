export interface ResourceInterval {
  start: number;
  end: number;
}
export interface ResourceReservation extends ResourceInterval {
  collaboratorId: string | null;
  roomId: string | null;
  /** Set on rows of this same request: the service time without buffers. */
  core?: ResourceInterval;
}
export interface ResourceDemand extends ResourceInterval {
  collaboratorIds: Array<string | null>;
  rooms: Array<{ id: string | null; capacity: number }>;
  /**
   * The service time without buffers. Services of the same request (one client's
   * sequence) only collide on this: no cleanup between them. Against other
   * bookings the buffered interval still applies.
   */
  core?: ResourceInterval;
}
export class ResourceSearchLimitError extends Error {
  constructor() {
    super(
      "Pianificazione troppo complessa: indica una preferenza o riduci i servizi simultanei",
    );
  }
}
const overlaps = (a: ResourceInterval, b: ResourceInterval) =>
  a.start < b.end && b.start < a.end;

/** Capacity is peak simultaneous occupancy, not the number of all overlapping rows. */
export function roomFits(
  interval: ResourceInterval,
  roomId: string,
  capacity: number,
  reservations: ResourceReservation[],
) {
  const changes: Array<[number, number]> = [
    [interval.start, 1],
    [interval.end, -1],
  ];
  for (const row of reservations) {
    if (row.roomId !== roomId || !overlaps(interval, row)) continue;
    changes.push(
      [Math.max(row.start, interval.start), 1],
      [Math.min(row.end, interval.end), -1],
    );
  }
  // Half-open intervals: an ending reservation releases capacity at the exact instant.
  changes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let occupied = 0;
  for (const [, change] of changes) {
    occupied += change;
    if (occupied > capacity) return false;
  }
  return true;
}

/** Complete bounded search at fixed requested times. A search limit is never "unavailable". */
export function allocateBookingResources(
  demands: ResourceDemand[],
  existing: ResourceReservation[],
  maxStates = 100000,
): ResourceReservation[] | null {
  if (
    demands.length < 1 ||
    demands.length > 20 ||
    !Number.isInteger(maxStates) ||
    maxStates < 1
  )
    throw new Error("Numero di servizi o limite di pianificazione non valido");
  for (const row of [...demands, ...existing]) {
    if (
      !Number.isFinite(row.start) ||
      !Number.isFinite(row.end) ||
      row.start >= row.end
    )
      throw new Error("Intervallo risorsa non valido");
  }
  for (const demand of demands) {
    if (
      new Set(demand.collaboratorIds).size !== demand.collaboratorIds.length ||
      new Set(demand.rooms.map((room) => room.id)).size !==
        demand.rooms.length ||
      demand.rooms.some(
        (room) =>
          room.id !== null &&
          (!Number.isInteger(room.capacity) || room.capacity < 1),
      )
    )
      throw new Error("Risorse candidate non valide");
  }
  const assigned: Array<ResourceReservation | undefined> = new Array(
    demands.length,
  );
  let states = 0;
  const choices = (
    demand: ResourceDemand,
    reservations: ResourceReservation[],
  ) => {
    const rows: ResourceReservation[] = [];
    const core = demand.core ?? demand;
    const theirs = reservations.filter((row) => !row.core);
    const ours = reservations
      .filter((row) => row.core)
      .map((row) => ({ ...row, start: row.core!.start, end: row.core!.end }));
    for (const collaboratorId of demand.collaboratorIds) {
      if (
        collaboratorId &&
        (theirs.some(
          (row) =>
            row.collaboratorId === collaboratorId && overlaps(row, demand),
        ) ||
          ours.some(
            (row) =>
              row.collaboratorId === collaboratorId && overlaps(row, core),
          ))
      )
        continue;
      for (const room of demand.rooms) {
        if (
          room.id &&
          !(
            roomFits(demand, room.id, room.capacity, theirs) &&
            roomFits(core, room.id, room.capacity, [...theirs, ...ours])
          )
        )
          continue;
        rows.push({
          start: demand.start,
          end: demand.end,
          collaboratorId,
          roomId: room.id,
          core: { start: core.start, end: core.end },
        });
      }
    }
    return rows;
  };
  const search = (remaining: number): boolean => {
    if (!remaining) return true;
    if (++states > maxStates) throw new ResourceSearchLimitError();
    const reservations = [
      ...existing,
      ...assigned.filter((row): row is ResourceReservation => !!row),
    ];
    let index = -1,
      candidates: ResourceReservation[] = [];
    for (let i = 0; i < demands.length; i++) {
      if (assigned[i]) continue;
      const available = choices(demands[i], reservations);
      if (!available.length) return false;
      if (index < 0 || available.length < candidates.length) {
        index = i;
        candidates = available;
      }
    }
    for (const choice of candidates) {
      assigned[index] = choice;
      if (search(remaining - 1)) return true;
    }
    assigned[index] = undefined;
    return false;
  };
  return search(demands.length)
    ? assigned.map((row) => {
        const { core: _core, ...plain } = row!;
        return plain;
      })
    : null;
}
