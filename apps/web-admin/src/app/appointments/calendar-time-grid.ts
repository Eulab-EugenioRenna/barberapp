/**
 * Pure layout math of the agenda time grid (week and day views).
 * Times are minutes from local midnight of the column's day.
 */

export interface Interval {
  start: number;
  end: number;
}

/** Drag snapping: a 5-minute grid plus magnets on nearby edges. */
export const SNAP_STEP_MINUTES = 5;
export const MAGNET_THRESHOLD_MINUTES = 8;
/** Shown when no working window is known (same default the facade uses). */
export const DEFAULT_RANGE: Interval = { start: 9 * 60, end: 19 * 60 };
const DAY_MINUTES = 24 * 60;

export function clockToMinutes(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value || "");
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= DAY_MINUTES ? minutes : null;
}

export function minutesToClock(minutes: number): string {
  const safe = Math.max(0, Math.min(DAY_MINUTES, Math.round(minutes)));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
}

export function timeRangeLabel(interval: Interval): string {
  return `${minutesToClock(interval.start)}–${minutesToClock(interval.end)}`;
}

/**
 * Wall-clock interval of a booking on its day. The end is capped at
 * midnight and a booking is never shorter than 5 minutes on screen.
 */
export function bookingInterval(
  startsAt: string | Date,
  endsAt: string | Date | null | undefined,
): Interval {
  const start = new Date(startsAt);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const end = endsAt ? new Date(endsAt) : null;
  const duration =
    end && Number.isFinite(end.getTime())
      ? Math.round((end.getTime() - start.getTime()) / 60000)
      : 30;
  return {
    start: startMinutes,
    end: Math.min(DAY_MINUTES, startMinutes + Math.max(5, duration)),
  };
}

/**
 * Closed days are hidden unless a booking was forced on them anyway.
 */
export function visibleDays<T>(
  days: T[],
  isClosed: (day: T) => boolean,
  bookingCount: (day: T) => number,
): T[] {
  return days.filter((day) => !isClosed(day) || bookingCount(day) > 0);
}

/**
 * Vertical extent: earliest opening to latest closing of the windows,
 * stretched only as much as needed to show bookings outside them,
 * rounded outwards to whole hours.
 */
export function timeRange(
  windows: Interval[],
  bookings: Interval[],
  fallback: Interval = DEFAULT_RANGE,
): Interval {
  const base = windows.length
    ? {
        start: Math.min(...windows.map((window) => window.start)),
        end: Math.max(...windows.map((window) => window.end)),
      }
    : { ...fallback };
  for (const booking of bookings) {
    base.start = Math.min(base.start, booking.start);
    base.end = Math.max(base.end, booking.end);
  }
  let start = Math.max(0, Math.floor(base.start / 60) * 60);
  let end = Math.min(DAY_MINUTES, Math.ceil(base.end / 60) * 60);
  if (end - start < 60) {
    end = Math.min(DAY_MINUTES, start + 60);
    start = Math.min(start, end - 60);
  }
  return { start, end };
}

export interface LanePlacement {
  /** Zero-based lane of the booking inside its overlap cluster. */
  lane: number;
  /** Lanes of the cluster: the booking is 1/lanes wide... */
  lanes: number;
  /** ...times span, when lanes to its right are free for its time. */
  span: number;
}

export function overlaps(left: Interval, right: Interval): boolean {
  return left.start < right.end && right.start < left.end;
}

/**
 * Classic calendar layout: bookings that overlap (directly or through a
 * chain) form a cluster; each gets the first free lane, then widens over
 * the free lanes to its right.
 */
export function layoutLanes<T extends Interval & { id: string }>(
  items: T[],
): Map<string, LanePlacement> {
  const sorted = [...items].sort(
    (left, right) =>
      left.start - right.start ||
      right.end - left.end ||
      left.id.localeCompare(right.id),
  );
  const result = new Map<string, LanePlacement>();
  let cluster: Array<T & { lane: number }> = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const lanes = cluster.reduce((max, item) => Math.max(max, item.lane + 1), 0);
    for (const item of cluster) {
      let span = 1;
      while (
        item.lane + span < lanes &&
        !cluster.some(
          (other) => other.lane === item.lane + span && overlaps(other, item),
        )
      )
        span++;
      result.set(item.id, { lane: item.lane, lanes, span });
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length && item.start >= clusterEnd) flush();
    const busy = new Set(
      cluster.filter((other) => overlaps(other, item)).map((other) => other.lane),
    );
    let lane = 0;
    while (busy.has(lane)) lane++;
    cluster.push({ ...item, lane });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (cluster.length) flush();
  return result;
}

export interface SnapOptions {
  step?: number;
  threshold?: number;
  /** Edges that attract the start or the end of the dragged booking. */
  magnets?: number[];
  min: number;
  max: number;
}

export interface SnapResult {
  start: number;
  /** The edge the booking stuck to, null when only the grid applied. */
  magnet: number | null;
}

/**
 * Where a dragged booking lands: the nearest magnet edge within the
 * threshold (for its start or its end), otherwise the nearest grid step,
 * always kept inside [min, max].
 */
export function snapStart(
  rawStart: number,
  duration: number,
  options: SnapOptions,
): SnapResult {
  const step = options.step ?? SNAP_STEP_MINUTES;
  const threshold = options.threshold ?? MAGNET_THRESHOLD_MINUTES;
  let best: { start: number; distance: number; magnet: number } | null = null;
  for (const magnet of options.magnets || []) {
    const candidates = [
      { start: magnet, distance: Math.abs(rawStart - magnet) },
      { start: magnet - duration, distance: Math.abs(rawStart + duration - magnet) },
    ];
    for (const candidate of candidates) {
      if (
        candidate.distance <= threshold &&
        (!best || candidate.distance < best.distance)
      )
        best = { ...candidate, magnet };
    }
  }
  const wanted = best ? best.start : Math.round(rawStart / step) * step;
  const highest = Math.max(options.min, options.max - duration);
  const start = Math.min(highest, Math.max(options.min, wanted));
  return { start, magnet: best && start === wanted ? best.magnet : null };
}

/** Magnet edges of a column: other bookings' edges and the working hours. */
export function magnetEdges(
  bookings: Array<Interval & { id: string }>,
  excludeId: string,
  window?: Interval | null,
): number[] {
  const edges = new Set<number>();
  for (const booking of bookings) {
    if (booking.id === excludeId) continue;
    edges.add(booking.start);
    edges.add(booking.end);
  }
  if (window) {
    edges.add(window.start);
    edges.add(window.end);
  }
  return [...edges];
}

export function minutesToPx(
  minutes: number,
  rangeStart: number,
  pxPerMinute: number,
): number {
  return (minutes - rangeStart) * pxPerMinute;
}

export function pxToMinutes(
  px: number,
  rangeStart: number,
  pxPerMinute: number,
): number {
  return rangeStart + px / pxPerMinute;
}

/** Scale that fits the range in the space, between readable bounds. */
export function fitPxPerMinute(
  availablePx: number,
  rangeMinutes: number,
  min = 1,
  max = 2,
): number {
  if (!(availablePx > 0) || !(rangeMinutes > 0)) return min;
  return Math.min(max, Math.max(min, availablePx / rangeMinutes));
}

/** Parts of the range outside the working window (all of it when closed). */
export function closedSegments(
  range: Interval,
  window: Interval | null,
): Interval[] {
  if (!window) return [{ ...range }];
  const segments: Interval[] = [];
  if (window.start > range.start)
    segments.push({ start: range.start, end: Math.min(range.end, window.start) });
  if (window.end < range.end)
    segments.push({ start: Math.max(range.start, window.end), end: range.end });
  return segments.filter((segment) => segment.end > segment.start);
}

/** Civil "YYYY-MM-DDTHH:MM" of a minute on a day, as the facade expects. */
export function localDateTime(day: Date, minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${minutesToClock(minutes)}`;
}

/** Whole hours of a range, for the time axis and the grid lines. */
export function hourMarks(range: Interval): number[] {
  const marks: number[] = [];
  for (let minute = Math.ceil(range.start / 60) * 60; minute <= range.end; minute += 60)
    marks.push(minute);
  return marks;
}
