/**
 * What each admin view needs and when cached data must be fetched again.
 *
 * Stale-while-revalidate: data already in memory is shown at once; a dataset
 * is fetched again in the background at most once per `DATASET_MAX_AGE_MS`.
 * Only a dataset never loaded makes the screen wait.
 */
export type AdminDataset =
  | "tenant"
  | "services"
  | "products"
  | "collaborators"
  | "collaboratorOptions"
  | "customers"
  | "customerOptions"
  | "sales"
  | "stats";

export type AdminViewKey =
  | "platform"
  | "dashboard"
  | "appointments"
  | "sales"
  | "customers"
  | "services"
  | "team"
  | "collaborators"
  | "settings";

export const DATASET_MAX_AGE_MS = 60_000;

/** Panoramica auto-refresh while it is on screen and the tab is visible. */
export const DASHBOARD_REFRESH_MS = 60_000;

/** Datasets a view renders. Reports (`stats`) belong to the Panoramica only. */
export const VIEW_DATASETS: Readonly<Record<AdminViewKey, readonly AdminDataset[]>> = {
  platform: [],
  dashboard: ["tenant", "stats", "customerOptions"],
  // The agenda loads its own data (AppointmentsFacade).
  appointments: ["tenant"],
  sales: ["tenant", "sales"],
  customers: ["tenant", "customers"],
  services: ["tenant", "services", "products"],
  team: ["tenant", "collaborators"],
  collaborators: ["tenant", "collaborators"],
  // Public page preview: first services and the reference collaborator.
  settings: ["tenant", "services", "collaborators"],
};

/** Catalog the till («Vendi adesso») needs, whatever the page it opens from. */
export const QUICK_ORDER_DATASETS: readonly AdminDataset[] = ["services", "products", "collaboratorOptions"];

export type DatasetPlan = {
  /** Not in memory yet: the view waits for these. */
  wait: AdminDataset[];
  /** In memory but older than the max age: refreshed in the background. */
  revalidate: AdminDataset[];
};

/**
 * Splits the requested datasets by what must happen to them now.
 * `inFlight` ones are skipped: the running request will update them.
 */
export function planDatasets(
  requested: readonly AdminDataset[],
  loadedAt: ReadonlyMap<AdminDataset, number>,
  now: number,
  options: { force?: boolean; maxAgeMs?: number; inFlight?: ReadonlySet<AdminDataset> } = {},
): DatasetPlan {
  const maxAge = options.maxAgeMs ?? DATASET_MAX_AGE_MS;
  const plan: DatasetPlan = { wait: [], revalidate: [] };
  for (const dataset of new Set(requested)) {
    if (options.inFlight?.has(dataset)) continue;
    const at = loadedAt.get(dataset);
    if (at === undefined) plan.wait.push(dataset);
    else if (options.force || now - at >= maxAge) plan.revalidate.push(dataset);
  }
  return plan;
}

/**
 * After a save: datasets on screen are fetched again now, the others are only
 * marked stale so the next view that needs them refreshes them quietly.
 */
export function splitChanged(
  changed: readonly AdminDataset[],
  onScreen: readonly AdminDataset[],
): { reloadNow: AdminDataset[]; markStale: AdminDataset[] } {
  const visible = new Set(onScreen);
  const unique = [...new Set(changed)];
  return {
    reloadNow: unique.filter((dataset) => visible.has(dataset)),
    markStale: unique.filter((dataset) => !visible.has(dataset)),
  };
}
