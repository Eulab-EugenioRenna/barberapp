import { Prisma } from "@prisma/client";
import { PaymentsService } from "./payments.service";
import { paymentBalance } from "./payment-balance";

const scope = {
  tenantId: "tenant-1",
  sectorIds: ["sector-1"],
  allowedSectorIds: ["sector-1"],
  locationIds: ["location-1"],
  cacheKey: "fixture",
};

/** In-memory ledger with the same invariants the database checks before commit. */
function ledger(sale: Record<string, unknown>, entries: any[] = []) {
  const state = {
    sale: {
      id: "sale-1",
      tenantId: "tenant-1",
      revision: 0,
      orderStatus: "confirmed",
      paymentBasis: "ledger",
      paymentStatus: "unpaid",
      paymentMethod: null as string | null,
      total: new Prisma.Decimal("50.00"),
      ...sale,
    } as any,
    entries: entries.map((row, index) => ({
      createdAt: new Date(2026, 0, 1, 0, index),
      refundOfId: null,
      ...row,
      amount: new Prisma.Decimal(row.amount),
    })),
    operations: [] as any[],
  };
  let clock = 100;
  const tx = {
    $executeRaw: jest.fn(),
    sale: {
      findFirst: jest.fn(async () => ({ ...state.sale })),
      findUniqueOrThrow: jest.fn(async () => ({ ...state.sale })),
      update: jest.fn(async ({ data }: any) => {
        const { revision, ...rest } = data;
        Object.assign(state.sale, rest);
        if (revision?.increment) state.sale.revision += revision.increment;
        return { ...state.sale };
      }),
    },
    paymentEntry: {
      findMany: jest.fn(async () => state.entries.map((row) => ({ ...row }))),
      createMany: jest.fn(async ({ data }: any) => {
        for (const row of data)
          state.entries.push({
            ...row,
            amount: new Prisma.Decimal(row.amount),
            createdAt: new Date(2026, 0, 1, 1, clock++),
          });
      }),
    },
    paymentOperation: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        expect(data.expectedRevision).toBe(state.sale.revision);
        if (data.kind !== "receive") expect(data.reason?.length).toBeGreaterThan(2);
        state.operations.push(data);
        return data;
      }),
    },
  };
  /** What the deferred database check would say at commit. */
  const verify = () => {
    const summary = paymentBalance(state.sale.total, "ledger", state.entries);
    expect(state.sale.paymentStatus).toBe(summary.status);
    return summary;
  };
  return { state, tx, verify };
}

describe("PaymentsService automatic corrections", () => {
  const service = new PaymentsService({} as never);

  it("records the whole receipt when the till says paid, without asking for anything", async () => {
    const { tx, state, verify } = ledger({});
    await service.cashierDeclaration(tx as never, scope, "user-1", "sale-1", {
      paymentStatus: "paid",
    });
    expect(verify().status).toBe("paid");
    expect(state.entries).toEqual([
      expect.objectContaining({ kind: "receipt", amount: new Prisma.Decimal("50.00"), method: "cash" }),
    ]);
  });

  it("changes the method of a paid account by refunding and receiving again", async () => {
    const { tx, state, verify } = ledger(
      { paymentStatus: "paid", paymentMethod: "cash" },
      [{ id: "r1", kind: "receipt", amount: "50.00", method: "cash" }],
    );
    await service.cashierDeclaration(tx as never, scope, "user-1", "sale-1", {
      paymentStatus: "paid",
      paymentMethod: "card",
    });
    expect(verify()).toMatchObject({ status: "paid", netReceived: "50.00" });
    expect(state.sale.paymentMethod).toBe("card");
    expect(state.entries.map((row) => [row.kind, row.method, row.amount.toFixed(2)])).toEqual([
      ["receipt", "cash", "50.00"],
      ["refund", "cash", "50.00"],
      ["receipt", "card", "50.00"],
    ]);
  });

  it("refunds the difference when the total drops below what was paid", async () => {
    const { tx, state, verify } = ledger(
      { paymentStatus: "paid", paymentMethod: "card", total: new Prisma.Decimal("30.00") },
      [{ id: "r1", kind: "receipt", amount: "50.00", method: "card" }],
    );
    await service.cashierDeclaration(tx as never, scope, "user-1", "sale-1", {});
    expect(verify()).toMatchObject({ status: "paid", netReceived: "30.00", refunds: "20.00" });
    expect(state.operations.at(-1).reason).toContain("rimborso automatico");
  });

  it("refunds everything when the account goes back to unpaid", async () => {
    const { tx, verify } = ledger({ paymentStatus: "paid" }, [
      { id: "r1", kind: "receipt", amount: "20.00", method: "cash" },
      { id: "r2", kind: "receipt", amount: "30.00", method: "card" },
    ]);
    await service.cashierDeclaration(tx as never, scope, "user-1", "sale-1", {
      paymentStatus: "unpaid",
    });
    expect(verify()).toMatchObject({ status: "refunded", netReceived: "0.00" });
  });

  it("reconciles a historic sale to its declared status on first save", async () => {
    const { tx, state, verify } = ledger({
      paymentBasis: "legacy_unknown",
      paymentStatus: "paid",
      paymentMethod: "cash",
    });
    await service.cashierDeclaration(tx as never, scope, "user-1", "sale-1", {
      paymentStatus: "paid",
      paymentMethod: "cash",
    });
    expect(state.sale.paymentBasis).toBe("ledger");
    expect(state.operations[0]).toMatchObject({ kind: "reconcile" });
    expect(verify()).toMatchObject({ status: "paid", opening: "50.00" });
  });

  it("refundAll gives back every receipt, also on a historic sale", async () => {
    const { tx, verify } = ledger({
      paymentBasis: "legacy_unknown",
      paymentStatus: "paid",
    });
    await service.refundAll(tx as never, scope, "user-1", "sale-1", "Annullata dalla cassa");
    expect(verify()).toMatchObject({ status: "refunded", netReceived: "0.00" });
  });

  it("accepts a refund without a written reason", async () => {
    const { tx, state, verify } = ledger({ paymentStatus: "paid", paymentMethod: "cash" }, [
      { id: "r1", kind: "receipt", amount: "50.00", method: "cash" },
    ]);
    await service.recordInTransaction(tx as never, scope, "user-1", "sale-1", {
      kind: "refund",
      idempotencyKey: "manual-refund-1",
      revision: 0,
      entries: [{ amount: "10.00", method: "cash", refundOfId: "r1" }],
    });
    expect(state.operations[0].reason).toBe("Rimborso registrato dal conto");
    expect(verify().status).toBe("partial");
  });
});
