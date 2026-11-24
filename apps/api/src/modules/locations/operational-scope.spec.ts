import { ForbiddenException } from "@nestjs/common";
import { AppCacheService } from "../../cache/cache.service";
import { RequestSession } from "../../common/request-session";
import {
  canUseLocalFunction,
  createFunctionMatrix,
} from "../../common/function-catalog";
import {
  resolveOperationalScope,
  runOperationalCacheScope,
  saleFilter,
} from "./operational-scope";
const session = (role = "manager"): RequestSession => ({
  tenantId: "company-a",
  user: {
    id: "user-a",
    tenantId: "company-a",
    role,
    email: "fixture@example.invalid",
    firstName: "Test",
    lastName: "Scope",
    collaboratorId: role === "collaborator" ? "professional-a" : undefined,
  },
});
const allowed = [
  { id: "sector-a", locationId: "location-a" },
  { id: "sector-b", locationId: "location-b" },
];
describe("Operational membership intersection", () => {
  it("uses server tenant and local user, keeps authorized sectors distinct from the selected sector", async () => {
    const findMany = jest.fn(async () => allowed);
    const scope = await resolveOperationalScope(
      { sector: { findMany } } as never,
      session(),
      { "x-alora-location": "location-a", "x-alora-sector": "sector-a" },
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "company-a",
          access: { some: { userId: "user-a" } },
        },
      }),
    );
    expect(scope.sectorIds).toEqual(["sector-a"]);
    expect(scope.allowedSectorIds).toEqual(["sector-a", "sector-b"]);
    expect(scope.locationIds).toEqual(["location-a"]);
    expect(saleFilter(scope)).toMatchObject({
      items: { every: { sectorId: { in: ["sector-a", "sector-b"] } } },
      AND: [
        { OR: expect.any(Array) },
        {
          OR: [
            { appointmentId: null },
            { appointment: { sectorId: { in: ["sector-a", "sector-b"] } } },
          ],
        },
      ],
    });
  });
  it("uses explicit professional membership and rejects a forged location", async () => {
    const findMany = jest.fn(async () => [allowed[0]]);
    await expect(
      resolveOperationalScope(
        { sector: { findMany } } as never,
        session("collaborator"),
        { "x-alora-location": "location-b" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "company-a",
          collaborators: { some: { collaboratorId: "professional-a" } },
        },
      }),
    );
  });
  it("grants no new function through membership or a legacy owner role", () => {
    expect(canUseLocalFunction({ role: "owner" }, "locations.manage")).toBe(
      false,
    );
    expect(
      canUseLocalFunction(
        {
          role: "manager",
          permissions: ["locations.manage"],
          connectFunctions: [],
        },
        "locations.manage",
      ),
    ).toBe(false);
    expect(
      canUseLocalFunction(
        {
          role: "collaborator",
          collaboratorId: "professional-a",
          permissions: ["locations.manage"],
          connectFunctions: ["locations.manage"],
        },
        "locations.manage",
      ),
    ).toBe(false);
    // v10: «La mia agenda · Prenotare e aggiornare» also books in one's own agenda.
    expect(createFunctionMatrix("alora-test").version).toBe(10);
    // v9: products.* and confirmations.read merged into Listino and Cassa.
    expect(createFunctionMatrix("alora-test").functions).toHaveLength(29);
  });
  it("isolates concurrent cache loads and changes the key on membership revocation", async () => {
    const scopes = await Promise.all([
      resolveOperationalScope(
        { sector: { findMany: async () => allowed } } as never,
        session("owner"),
      ),
      resolveOperationalScope(
        { sector: { findMany: async () => [allowed[0]] } } as never,
        session(),
      ),
      resolveOperationalScope(
        { sector: { findMany: async () => [] } } as never,
        session(),
      ),
    ]);
    const values = new Map<string, string>();
    const cache = new AppCacheService({
      get: async (key: string) => values.get(key) || null,
      set: async (key: string, value: string) => {
        values.set(key, value);
      },
    } as never);
    const results = await Promise.all(
      scopes.map((scope, index) =>
        runOperationalCacheScope(scope.cacheKey, () =>
          cache.getOrSet("tenant:appointments", 30, async () => {
            await Promise.resolve();
            return [index];
          }),
        ),
      ),
    );
    expect(results).toEqual([[0], [1], [2]]);
    expect(values.size).toBe(3);
    expect(new Set(scopes.map((scope) => scope.cacheKey)).size).toBe(3);
  });
});
