import type { NormalizedOrderItem } from "../sales/sales.logic";
import { attributeOrder } from "./order-attribution";
import type { OperationalScope } from "./operational-scope";
const scope: OperationalScope = {
  tenantId: "tenant-a",
  sectorIds: ["sector-a", "sector-other", "sector-b"],
  allowedSectorIds: ["sector-a", "sector-other", "sector-b"],
  locationIds: ["location-a", "location-b"],
  cacheKey: "test",
};
const sectors = [
  { id: "sector-a", locationId: "location-a" },
  { id: "sector-other", locationId: "location-a" },
  { id: "sector-b", locationId: "location-b" },
].map((sector) => ({
  ...sector,
  isActive: true,
  location: { isActive: true },
}));
const prisma = {
  sector: { findMany: async () => sectors },
  service: {
    findMany: async () => [
      { id: "service-a", sectorId: "sector-a" },
      { id: "service-b", sectorId: "sector-b" },
    ],
  },
  collaboratorSector: { count: async () => 1 },
};
const row: NormalizedOrderItem = {
  serviceId: "service-a",
  label: "Prova",
  quantity: 1,
  unitPrice: "0.10",
  discount: "0.00",
  taxTotal: "0.00",
  lineTotal: "0.10",
  priceMode:"legacy",vatRate:null,lineSubtotal:"0.10",discountNet:"0.00",orderDiscountShare:"0.00",
};
describe("Order location and immutable row attribution", () => {
  it("rejects a mixed-location order even for an owner authorized on both locations", async () => {
    await expect(
      attributeOrder(
        prisma as never,
        scope,
        [row, { ...row, serviceId: "service-b" }],
        [{}, {}],
      ),
    ).rejects.toThrow("stessa sede");
  });
  it("requires an explicit sector for an ambiguous product-only sale", async () => {
    const product = { ...row, serviceId: undefined, productId: "product-a" };
    await expect(
      attributeOrder(prisma as never, scope, [product], [{}], {
        locationId: "location-a",
      }),
    ).rejects.toThrow();
    expect(
      (
        await attributeOrder(
          prisma as never,
          scope,
          [product],
          [{ sectorId: "sector-other" }],
          { locationId: "location-a" },
        )
      ).items[0].sectorId,
    ).toBe("sector-other");
  });
  it("preserves old sector, row ID and monetary fields after the service moves", async () => {
    const existing = {
      locationId: "location-a",
      items: [
        {
          id: "line-a",
          sectorId: "sector-other",
          serviceId: "service-a",
          productId: null,
          collaboratorId: null,
        },
      ],
    };
    const result = await attributeOrder(
      prisma as never,
      scope,
      [row],
      [{ id: "line-a", sectorId: "sector-a" }],
      { existing },
    );
    expect(result.items[0]).toEqual({
      ...row,
      id: "line-a",
      sectorId: "sector-other",
    });
    await expect(
      attributeOrder(prisma as never, scope, [row], [{ id: "forged-row" }], {
        existing,
      }),
    ).rejects.toThrow("Riga");
  });
  it("closes an existing booking in its original sector even if the service now belongs to another location", async () => {
    const fixture = {
      ...prisma,
      appointment: {
        findFirst: async () => ({
          locationId: "location-a",
          sectorId: "sector-a",
          serviceId: "service-b",
          collaboratorId: null,
        }),
      },
    };
    const result = await attributeOrder(
      fixture as never,
      { ...scope, sectorIds: ["sector-a"], locationIds: ["location-a"] },
      [{ ...row, serviceId: "service-b" }],
      [{ sectorId: "sector-a" }],
      { appointmentId: "original-booking" },
    );
    expect(result.locationId).toBe("location-a");
    expect(result.items[0].sectorId).toBe("sector-a");
    expect(result.items[0].lineTotal).toBe("0.10");
  });
});
