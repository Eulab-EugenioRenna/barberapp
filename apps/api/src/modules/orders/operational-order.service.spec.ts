import { Prisma } from "@prisma/client";
import { OperationalOrderService } from "./operational-order.service";

const decimal = (value: string) => new Prisma.Decimal(value);
describe("OperationalOrderService atomic booking boundary", () => {
  function setup() {
    const appointment = {
      id: "booking",
      tenantId: "tenant",
      locationId: "location",
      sectorId: "sector",
      customerId: "customer",
      serviceId: "service",
      startsAt: new Date("2030-01-01T10:00:00Z"),
      createdById: null,
      estimatedPrice: decimal("19.37"),
      finalPrice: null,
      collaboratorId: "planned-professional",
      service: { name: "Service", basePrice: decimal("25") },
    };
    const tx = {
      $executeRaw: jest.fn(),
      appointment: {
        create: jest.fn().mockResolvedValue(appointment),
        update: jest.fn().mockResolvedValue(appointment),
        findFirstOrThrow: jest.fn(),
      },
      sale: {
        create: jest
          .fn()
          .mockImplementation(async ({ data }: { data: any }) => ({
            id: "order",
            total: decimal(data.total),
            items: data.items.create.map((row: any) => ({ ...row })),
          })),
        update: jest.fn(),
      },
      saleItem: {
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const transaction = jest.fn((callback) => callback(tx));
    return {
      tx,
      appointment,
      transaction,
      service: new OperationalOrderService({
        $transaction: transaction,
      } as never),
    };
  }

  it("creates an unpaid order from the booking amount without inventing a performer or a payment", async () => {
    const { service, tx, appointment } = setup();
    const result = await service.createBooking({
      tenantId: "tenant",
      customerId: "customer",
      serviceId: "service",
      startsAt: appointment.startsAt,
      endsAt: appointment.startsAt,
    });
    expect(result.orderItemId).toBe(
      tx.sale.create.mock.calls[0][0].data.items.create[0].id,
    );
    expect(tx.sale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderStatus: "open",
          paymentStatus: "unpaid",
          total: "19.37",
          items: {
            create: expect.arrayContaining([
              expect.objectContaining({
                unitPrice: "19.37",
                quantity: 1,
              }),
            ]),
          },
        }),
      }),
    );
    expect(
      tx.sale.create.mock.calls[0][0].data.items.create[0],
    ).not.toHaveProperty("collaboratorId");
    expect(tx.appointment.update).toHaveBeenCalledWith({
      where: { id: "booking" },
      data: { orderItemId: result.orderItemId, estimatedPrice: "19.37" },
    });
  });

  it("propagates attachment failure from the same transaction instead of returning a booking without its account", async () => {
    const { service, tx, appointment, transaction } = setup();
    tx.sale.create.mockRejectedValue(new Error("fixture write failure"));
    await expect(
      service.createBooking({
        tenantId: "tenant",
        customerId: "customer",
        serviceId: "service",
        startsAt: appointment.startsAt,
        endsAt: appointment.startsAt,
      }),
    ).rejects.toThrow("fixture write failure");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.appointment.update).not.toHaveBeenCalled();
  });

  it("recalculates a legacy account total with exact decimal arithmetic", async () => {
    const { service, tx } = setup();
    tx.saleItem.findMany.mockResolvedValue([
      {
        quantity: 1,
        unitPrice: decimal("0.10"),
        discount: decimal("0"),
        taxTotal: decimal("0"),
        lineTotal: decimal("0.10"),
      },
      {
        quantity: 1,
        unitPrice: decimal("0.20"),
        discount: decimal("0"),
        taxTotal: decimal("0"),
        lineTotal: decimal("0.20"),
      },
    ]);
    await service.recalculate(tx as never, "order");
    expect(tx.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total: "0.30",
          revision: { increment: 1 },
        }),
      }),
    );
  });

  it("rejects stale revisions even when the record still exists", () => {
    const { service } = setup();
    expect(() => service.assertRevision({ revision: 2 }, 1)).toThrow(
      "Il conto è cambiato",
    );
    expect(() => service.assertRevision({ revision: 2 }, 2)).not.toThrow();
  });
});
