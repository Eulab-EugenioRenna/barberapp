import { of } from "rxjs";
import { DATASET_MAX_AGE_MS, VIEW_DATASETS, planDatasets, splitChanged, type AdminDataset } from "./admin-data-policy";
import { isWorkspacePair } from "./admin-route-reuse.strategy";

const providers = new Map<unknown, unknown>();
jest.mock("@angular/core", () => ({
  Injectable: () => (target: unknown) => target,
  inject: (token: unknown) => providers.get(token),
  signal: (initial: unknown) => {
    let value = initial;
    const read = () => value;
    read.set = (next: unknown) => { value = next; };
    read.update = (fn: (v: unknown) => unknown) => { value = fn(value); };
    return read;
  },
  computed: (read: () => unknown) => read,
}));
jest.mock("./session-refresh.service", () => ({ SessionRefreshService: class {} }));
jest.mock("./admin-api.service", () => ({ AdminApiService: class {} }));
jest.mock("./auth-api.service", () => ({ AuthApiService: class {} }));
jest.mock("./session.store", () => ({ SessionStore: class {} }));
jest.mock("@angular/router", () => ({ BaseRouteReuseStrategy: class {} }));

import { AdminFacade } from "./admin.facade";
import { AdminApiService } from "./admin-api.service";
import { AuthApiService } from "./auth-api.service";
import { SessionRefreshService } from "./session-refresh.service";
import { SessionStore } from "./session.store";

describe("admin data policy", () => {
  const at = (entries: Array<[AdminDataset, number]>) => new Map(entries);

  it("waits only for what was never loaded and refreshes the rest after a minute", () => {
    const now = 1_000_000;
    const plan = planDatasets(["tenant", "sales", "customers"], at([["tenant", now - 1_000], ["sales", now - DATASET_MAX_AGE_MS]]), now);
    expect(plan).toEqual({ wait: ["customers"], revalidate: ["sales"] });
  });

  it("does not ask twice for a dataset already on its way", () => {
    const plan = planDatasets(["sales"], at([]), 0, { inFlight: new Set<AdminDataset>(["sales"]) });
    expect(plan).toEqual({ wait: [], revalidate: [] });
  });

  it("an explicit refresh fetches fresh data too", () => {
    expect(planDatasets(["tenant"], at([["tenant", 5]]), 6, { force: true }).revalidate).toEqual(["tenant"]);
  });

  it("loads reports only on the Panoramica", () => {
    for (const [view, datasets] of Object.entries(VIEW_DATASETS))
      expect(datasets.includes("stats")).toBe(view === "dashboard");
  });

  it("after a save reloads what is on screen and marks the rest stale", () => {
    expect(splitChanged(["sales", "stats", "customers"], VIEW_DATASETS.sales)).toEqual({
      reloadNow: ["sales"],
      markStale: ["stats", "customers"],
    });
  });

  it("reuses the workspace component between its views only", () => {
    const view = { routeConfig: { data: { workspaceView: true } } } as any;
    const page = { routeConfig: { data: {} } } as any;
    expect(isWorkspacePair(view, view)).toBe(true);
    expect(isWorkspacePair(view, page)).toBe(false);
  });
});

describe("AdminFacade cache (stale-while-revalidate)", () => {
  let now = 0;
  let api: Record<string, jest.Mock>;
  let facade: AdminFacade;

  beforeEach(() => {
    now = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    api = {
      loadTenantContext: jest.fn(() => of({ id: "t1", name: "Salone" })),
      loadSalesPage: jest.fn(() => of({ items: [{ id: "s1" }], hasMore: false })),
      loadCustomersPage: jest.fn(() => of({ items: [{ id: "c1" }], hasMore: false })),
      loadCustomerOptions: jest.fn(() => of([])),
      loadAdminStatsData: jest.fn(() => of({ revenue: { metrics: [] }, appointmentStats: null, upcomingAppointments: [] })),
    };
    providers.clear();
    providers.set(AdminApiService, api);
    providers.set(AuthApiService, {});
    providers.set(SessionRefreshService, { logout: jest.fn() });
    providers.set(SessionStore, { currentUser: () => ({ id: "u1" }), isAuthenticated: () => true });
    facade = new AdminFacade();
  });
  afterEach(() => jest.restoreAllMocks());

  it("a page change within a minute makes no request", async () => {
    await facade.ensure(VIEW_DATASETS.sales);
    await facade.ensure(VIEW_DATASETS.customers);
    await facade.ensure(VIEW_DATASETS.sales);
    expect(api["loadTenantContext"]).toHaveBeenCalledTimes(1);
    expect(api["loadSalesPage"]).toHaveBeenCalledTimes(1);
    expect(api["loadCustomersPage"]).toHaveBeenCalledTimes(1);
    expect(api["loadAdminStatsData"]).not.toHaveBeenCalled();
  });

  it("after a minute shows the cached list and refreshes it in the background", async () => {
    await facade.ensure(["sales"]);
    now += DATASET_MAX_AGE_MS;
    api["loadSalesPage"].mockReturnValue(of({ items: [{ id: "s2" }], hasMore: false }));
    const pending = facade.ensure(["sales"]);
    expect(facade.sales()).toEqual([{ id: "s1" }]);
    expect(facade.loading()).toBe(false);
    await pending;
    await Promise.resolve();
    expect(api["loadSalesPage"]).toHaveBeenCalledTimes(2);
    expect(facade.sales()).toEqual([{ id: "s2" }]);
  });

  it("a stale mark makes the next visit refresh, a reload fetches now", async () => {
    await facade.ensure(["customers"]);
    facade.markStale(["customers"]);
    await facade.ensure(["customers"]);
    expect(api["loadCustomersPage"]).toHaveBeenCalledTimes(2);
    await facade.reload(["customers"]);
    expect(api["loadCustomersPage"]).toHaveBeenCalledTimes(3);
  });

  it("never shows one account's data to the next", async () => {
    await facade.ensure(["sales"]);
    providers.set(SessionStore, { currentUser: () => ({ id: "u2" }), isAuthenticated: () => true });
    const other = facade as any;
    other.sessionStore = providers.get(SessionStore);
    await facade.ensure(["sales"]);
    expect(api["loadSalesPage"]).toHaveBeenCalledTimes(2);
  });
});
