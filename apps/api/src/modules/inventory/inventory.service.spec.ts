import { Prisma } from "@prisma/client";
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
  function stock(balance: { quantity: string; initialized: boolean }) {
    const state = {
      balance: {
        id: "balance-1",
        quantity: new Prisma.Decimal(balance.quantity),
        value: new Prisma.Decimal(balance.quantity).times(2),
        initialized: balance.initialized,
      },
      movements: [] as any[],
    };
    const tx = {
      stockBalance: {
        upsert: jest.fn(async () => ({ ...state.balance })),
        findUniqueOrThrow: jest.fn(async () => ({ ...state.balance })),
        update: jest.fn(async ({ data }: any) => {
          state.balance.quantity = new Prisma.Decimal(data.quantity);
          state.balance.value = new Prisma.Decimal(data.value);
          state.balance.initialized = data.initialized;
        }),
      },
      stockMovement: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `m${state.movements.length}`,
            ...data,
            quantityDelta: new Prisma.Decimal(data.quantityDelta),
            valueDelta: new Prisma.Decimal(data.valueDelta),
          };
          state.movements.push(row);
          return row;
        }),
      },
      product: { findUnique: jest.fn(async () => ({ name: "Cera" })) },
    };
    const operation = { id: "op-1", tenantId: "tenant-a" } as never;
    return { state, tx, operation };
  }
  const issue = {
    locationId: "location-a",
    productId: "product-a",
    kind: "sale",
    direction: "out" as const,
    quantity: "3.000",
  };

  it("never blocks a sale: an unknown balance starts at zero and nothing is issued", async () => {
    const { tx, state, operation } = stock({ quantity: "0", initialized: false });
    const warnings: string[] = [];
    const record = await new InventoryService({} as never).movement(
      tx as never,
      operation,
      issue,
      warnings,
    );
    expect(record).toBeNull();
    expect(state.movements).toEqual([
      expect.objectContaining({ kind: "opening" }),
    ]);
    expect(state.balance.initialized).toBe(true);
    expect(warnings[0]).toContain("Cera: giacenza esaurita");
  });

  it("issues what is in stock and warns about the rest", async () => {
    const { tx, state, operation } = stock({ quantity: "2", initialized: true });
    const warnings: string[] = [];
    const record = await new InventoryService({} as never).movement(
      tx as never,
      operation,
      issue,
      warnings,
    );
    expect(record?.quantityDelta.toFixed(3)).toBe("-2.000");
    expect(state.balance.quantity.toFixed(3)).toBe("0.000");
    expect(state.balance.value.toFixed(2)).toBe("0.00");
    expect(warnings[0]).toContain("scaricate 2 unità su 3");
  });

  it("returns every unit still out when a sale is cancelled", async () => {
    const { tx, state, operation } = stock({ quantity: "5", initialized: true });
    const sold = {
      id: "s1",
      locationId: "location-a",
      productId: "product-a",
      sectorId: "sector-a",
      saleItemId: "row-1",
      kind: "sale",
      quantityDelta: new Prisma.Decimal("-2"),
      valueDelta: new Prisma.Decimal("-4"),
      returnOfId: null,
    };
    const partial = {
      ...sold,
      id: "s2",
      kind: "return",
      quantityDelta: new Prisma.Decimal("0.5"),
      valueDelta: new Prisma.Decimal("1"),
      returnOfId: "s1",
    };
    Object.assign(tx, {
      sale: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: "sale-1", tenantId: "tenant-a", revision: 4 }),
      },
      inventoryOperation: {
        create: jest.fn().mockResolvedValue(operation),
        update: jest.fn(),
      },
    });
    tx.stockMovement = Object.assign(tx.stockMovement, {
      findMany: jest.fn().mockResolvedValue([sold, partial]),
    });
    await expect(
      new InventoryService({} as never).reverseOrder(
        tx as never,
        "sale-1",
        "user-1",
        "Annullata dalla cassa",
      ),
    ).resolves.toBe(1);
    expect(state.movements).toEqual([
      expect.objectContaining({
        kind: "return",
        returnOfId: "s1",
        quantityDelta: new Prisma.Decimal("1.5"),
        valueDelta: new Prisma.Decimal("3"),
      }),
    ]);
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
