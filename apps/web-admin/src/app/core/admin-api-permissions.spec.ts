import { firstValueFrom, of } from "rxjs";
const providers = new Map<unknown, unknown>();
jest.mock("@angular/core", () => ({
  Injectable: () => (target: unknown) => target,
  inject: (token: unknown) => providers.get(token),
}));
jest.mock("@angular/common/http", () => ({ HttpClient: class {} }));
import { HttpClient } from "@angular/common/http";
import { SessionStore } from "./session.store";
import { AdminApiService } from "./admin-api.service";
import { canUseLocalFunction } from "@barber/shared/functions";

describe("permission-aware admin data loading", () => {
  const requests: string[] = [];
  function api(permissions: string[]) {
    providers.set(SessionStore, {
      can: (key: string) =>
        canUseLocalFunction({ role: "manager", permissions }, key),
    });
    providers.set(HttpClient, {
      get: (url: string) => {
        requests.push(url);
        if (url.endsWith("/appointments/context"))
          return of({
            services: [{ id: "s1", name: "Servizio" }],
            collaborators: [{ id: "c1", firstName: "A" }],
          });
        if (url.endsWith("/tenant/context"))
          return of({ id: "t1", name: "Attività" });
        if (url.endsWith("/appointments")) return of([{ id: "a1" }]);
        return of({ items: [], total: 0, hasMore: false });
      },
    });
    return new AdminApiService();
  }
  beforeEach(() => {
    requests.length = 0;
    providers.clear();
  });
  it("renders agenda using operational projections, without settings, customer catalog or reports", async () => {
    const data = await firstValueFrom(
      api(["appointments.read.all"]).loadAppointmentsViewData(),
    );
    expect(requests.map((url) => url.replace(/^.*\/api/, ""))).toEqual([
      "/tenant/context",
      "/appointments",
      "/appointments/context",
    ]);
    expect(data["services"]).toEqual([{ id: "s1", name: "Servizio" }]);
    expect(data["customers"]).toEqual({ items: [], total: 0, hasMore: false });
  });
  it("loads the personal dashboard with own-only access and never calls company reports", async () => {
    await firstValueFrom(api(["appointments.read.own"]).loadPersonalDashboard("week", "2026-10-25"));
    expect(requests).toEqual(["/api/dashboard/personal?period=week&page=1&date=2026-10-25"]);
  });
  it("does not fetch a personal dashboard without own read permission", async () => {
    await expect(firstValueFrom(api(["clients.read.full"]).loadPersonalDashboard("week"))).rejects.toThrow("Agenda personale non abilitata");
    expect(requests).toEqual([]);
  });
  it("requests a selected professional only with company agenda access", async () => {
    await firstValueFrom(api(["appointments.read.all"]).loadPersonalDashboard("week", "", 1, "professional-b"));
    expect(requests).toEqual(["/api/dashboard/personal?period=week&page=1&collaboratorId=professional-b"]);
    requests.length=0;
    await expect(firstValueFrom(api(["appointments.read.own"]).loadPersonalDashboard("week", "", 1, "professional-b"))).rejects.toThrow();
    expect(requests).toEqual([]);
  });
  it("does not issue forbidden secondary requests during global refresh", async () => {
    const service = api(["clients.read.full"]);
    await firstValueFrom(service.loadAdminCoreData());
    await firstValueFrom(service.loadAdminStatsData());
    expect(requests.some((url) => url.includes("/customers?"))).toBe(true);
    expect(
      requests.some((url) =>
        /\/(dashboard|sales|services|products|collaborators|appointments)(\/|\?|$)/.test(
          url,
        ),
      ),
    ).toBe(false);
    expect(requests.some((url) => url.includes("/tenant/settings"))).toBe(
      false,
    );
  });
});
