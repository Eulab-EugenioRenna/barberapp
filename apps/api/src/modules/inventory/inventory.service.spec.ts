import { InventoryService } from "./inventory.service";

describe("InventoryService balances tenant and location scope", () => {
  const scope = {
    tenantId: "tenant-a",
    sectorIds: ["sector-a"],
    allowedSectorIds: ["sector-a", "sector-b"],
    locationIds: ["location-a"],
    cacheKey: "fixture",
  };
  function fixture() {
    const prisma = {
      sector: {
        findMany: jest.fn().mockResolvedValue([{ locationId: "location-a" }]),
      },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      stockBalance: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { prisma, inventory: new InventoryService(prisma as never) };
  }
  it("validates a tenant-scoped selected sector before reading balances", async () => {
    const { inventory, prisma } = fixture();
    await expect(inventory.balances(scope, "location-a")).resolves.toEqual([]);
    expect(prisma.sector.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", id: { in: ["sector-a"] } },
      select: { locationId: true },
    });
    expect(prisma.stockBalance.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-a", locationId: "location-a" },
    });
  });
  it.each(["foreign-location", "unselected-location", "missing-location"])(
    "rejects %s without querying stock or products",
    async (locationId) => {
      const { inventory, prisma } = fixture();
      await expect(inventory.balances(scope, locationId)).rejects.toMatchObject(
        { status: 403 },
      );
      expect(prisma.stockBalance.findMany).not.toHaveBeenCalled();
      expect(prisma.product.findMany).not.toHaveBeenCalled();
    },
  );
});
