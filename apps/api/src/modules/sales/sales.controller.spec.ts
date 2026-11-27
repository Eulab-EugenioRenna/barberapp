import { OrderCommandService } from "../orders/order-command.service";
import { OperationalOrderService } from "../orders/operational-order.service";
import { SalesController } from "./sales.controller";

jest.mock("../../common/request-session", () => ({
  resolveRequestSession: jest.fn().mockResolvedValue({
    tenantId: "tenant-1",
    operationalScope: {
      tenantId: "tenant-1",
      sectorIds: ["sector-1"],
      allowedSectorIds: ["sector-1"],
      locationIds: ["location-1"],
      cacheKey: "fixture",
    },
    user: { id: "user-1" },
  }),
  requireTenantId: jest.fn().mockReturnValue("tenant-1"),
  requireUser: jest.fn().mockReturnValue({ id: "user-1" }),
}));

function controllerWith(
  prisma: Record<string, unknown>,
  services: { inventory?: unknown; payments?: unknown } = {},
) {
  const cacheInvalidation = {
    invalidateSales: jest.fn(),
    invalidateDashboard: jest.fn(),
    invalidateCustomers: jest.fn(),
    invalidateAppointments: jest.fn(),
  };
  return {
    cacheInvalidation,
    controller: new SalesController(
      (services.inventory ?? {
        postOrder: jest.fn().mockResolvedValue([]),
      }) as never,
      { confirm: jest.fn() } as never,
      (services.payments ?? {
        cashierDeclaration: jest.fn().mockResolvedValue({}),
      }) as never,
      new OrderCommandService(),
      new OperationalOrderService(prisma as never),
      {
        sector: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "sector-1",
              locationId: "location-1",
              isActive: true,
              location: { isActive: true },
            },
          ]),
        },
        collaboratorSector: { count: jest.fn().mockResolvedValue(1) },
        ...prisma,
      } as never,
      {} as never,
      cacheInvalidation as never,
      { queueCustomerRefresh: jest.fn().mockResolvedValue(undefined) } as never,
      { warnings: jest.fn().mockResolvedValue([]) } as never,
    ),
  };
}

describe("SalesController order CRUD", () => {
  it("replaces order rows and keeps one collaborator per service row", async () => {
    const transaction = {
      $executeRaw: jest.fn(),
      saleItem: { deleteMany: jest.fn() },
      sale: {
        findFirstOrThrow: jest
          .fn()
          .mockResolvedValue({ revision: 0, orderStatus: "confirmed" }),
        update: jest.fn().mockResolvedValue({
          id: "sale-1",
          items: [],
          orderStatus: "confirmed",
        }),
      },
      appointment: {
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const prisma = {
      sale: {
        findFirst: jest.fn().mockResolvedValue({
          id: "sale-1",
          orderDiscount: "0",
          revision: 0,
          locationId: "location-1",
          items: [],
          appointmentId: "appointment-1",
          customerId: "customer-1",
        }),
      },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      service: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "service-1",
            name: "Taglio",
            basePrice: 25,
            sectorId: "sector-1",
            requiresCollaborator: true,
          },
        ]),
      },
      customer: {
        findFirst: jest.fn().mockResolvedValue({ id: "customer-1" }),
      },
      collaborator: {
        findMany: jest.fn().mockResolvedValue([{ id: "collaborator-1" }]),
        count: jest.fn().mockResolvedValue(1),
      },
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ defaultCollaboratorId: null }),
      },
      $transaction: jest.fn((callback) => callback(transaction)),
    };
    Object.assign(transaction, {
      appointmentAutomationRun: { findMany: jest.fn().mockResolvedValue([]) },
      product: prisma.product,
      service: prisma.service,
      customer: prisma.customer,
      collaborator: prisma.collaborator,
      sector: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "sector-1",
            locationId: "location-1",
            isActive: true,
            location: { isActive: true },
          },
        ]),
      },
      collaboratorSector: { count: jest.fn().mockResolvedValue(1) },
      orderOperation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "operation-a" }),
      },
    });
    Object.assign(transaction.sale, {
      findFirst: prisma.sale.findFirst,
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: "sale-1",
        items: [],
        orderStatus: "confirmed",
      }),
    });
    const { controller } = controllerWith(prisma);

    await controller.update(
      { headers: { authorization: "Bearer token" } },
      "sale-1",
      {
        idempotencyKey: "unit-sale-update-command",
        customerId: "customer-1",
        paymentStatus: "paid",
        paymentMethod: "card",
        items: [
          {
            kind: "service",
            serviceId: "service-1",
            collaboratorId: "collaborator-1",
            quantity: 1,
            unitPrice: 30,
          },
        ],
      },
    );

    expect(transaction.saleItem.deleteMany).toHaveBeenCalledWith({
      where: {
        saleId: "sale-1",
        sale: { tenantId: "tenant-1" },
        id: { notIn: [] },
      },
    });
    expect(transaction.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sale-1", tenantId: "tenant-1" },
        data: expect.objectContaining({
          total: "30.00",
          items: {
            create: [
              expect.objectContaining({
                serviceId: "service-1",
                collaboratorId: "collaborator-1",
              }),
            ],
          },
        }),
      }),
    );
  });

  it("returns stock warnings with the saved account instead of refusing", async () => {
    const transaction = {
      $executeRaw: jest.fn(),
      saleItem: { deleteMany: jest.fn() },
      sale: {
        findFirst: jest.fn().mockResolvedValue({
          id: "sale-1",
          orderDiscount: "0",
          revision: 0,
          locationId: "location-1",
          orderStatus: "confirmed",
          paymentBasis: "ledger",
          items: [],
          customerId: "customer-1",
        }),
        update: jest.fn().mockResolvedValue({ id: "sale-1", items: [] }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: "sale-1", items: [], orderStatus: "confirmed" }),
      },
      // Paid 40 on an account lowered to 25: no refusal, the refund is automatic.
      paymentEntry: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: "p1", kind: "receipt", amount: "40.00" }]),
      },
      appointment: { findMany: jest.fn().mockResolvedValue([]) },
      appointmentAutomationRun: { findMany: jest.fn().mockResolvedValue([]) },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: "product-off", name: "Cera", price: 25, isActive: false },
        ]),
      },
      service: { findMany: jest.fn().mockResolvedValue([]) },
      collaborator: { count: jest.fn().mockResolvedValue(0) },
      sector: {
        findMany: jest.fn().mockResolvedValue([
          { id: "sector-1", locationId: "location-1", isActive: true, location: { isActive: true } },
        ]),
      },
      collaboratorSector: { count: jest.fn().mockResolvedValue(1) },
      orderOperation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "operation-a" }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(transaction)),
    };
    const cashierDeclaration = jest.fn().mockResolvedValue({});
    const { controller } = controllerWith(prisma, {
      inventory: {
        postOrder: jest.fn().mockResolvedValue(["Cera: giacenza esaurita"]),
      },
      payments: { cashierDeclaration },
    });
    const result = await controller.update(
      { headers: { authorization: "Bearer token" } },
      "sale-1",
      {
        idempotencyKey: "unit-sale-update-stock",
        revision: 0,
        // A deactivated product added to an existing account is accepted.
        items: [{ kind: "product", productId: "product-off", quantity: 1 }],
      },
    );
    expect(result).toMatchObject({ warnings: ["Cera: giacenza esaurita"] });
    expect(transaction.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ total: "25.00", paymentStatus: "paid" }),
      }),
    );
    expect(cashierDeclaration).toHaveBeenCalled();
  });

  it("deletes a sale without stock movements with its whole history", async () => {
    const transaction = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ purged: 1 }]),
      stockMovement: { count: jest.fn().mockResolvedValue(0) },
      appointmentAutomationDelivery: { count: jest.fn().mockResolvedValue(0) },
    };
    const prisma = {
      sale: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "sale-1", customerId: "customer-1" }),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((callback) => callback(transaction)),
    };
    const { controller } = controllerWith(prisma);

    await expect(
      controller.remove(
        { headers: { authorization: "Bearer token" } },
        "sale-1",
      ),
    ).resolves.toEqual({ deleted: true });
    const [sql, ...values] = transaction.$queryRaw.mock.calls[0];
    expect(sql.join("?")).toContain("alora_purge_sale(");
    expect(values).toEqual(["tenant-1", "sale-1"]);
    expect(prisma.sale.count).toHaveBeenCalledWith({ where: { id: "sale-1" } });
  });

  it("reports a delete the database did not apply", async () => {
    const transaction = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ purged: 1 }]),
      stockMovement: { count: jest.fn().mockResolvedValue(0) },
      appointmentAutomationDelivery: { count: jest.fn().mockResolvedValue(0) },
    };
    const prisma = {
      sale: {
        findFirst: jest.fn().mockResolvedValue({ id: "sale-1", customerId: null }),
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn((callback) => callback(transaction)),
    };
    const { controller } = controllerWith(prisma);
    await expect(
      controller.remove({ headers: { authorization: "Bearer token" } }, "sale-1"),
    ).rejects.toMatchObject({ status: 409 });
  });

  function cancellable(stock: number) {
    const sale = {
      id: "sale-1",
      tenantId: "tenant-1",
      customerId: "customer-1",
      orderStatus: "confirmed",
      revision: 3,
      items: [
        { id: "row-1", booking: { id: "appointment-1", status: "confirmed" } },
        { id: "row-2", booking: { id: "appointment-2", status: "completed" } },
        { id: "row-3", booking: null },
      ],
    };
    const transaction = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn(),
      stockMovement: { count: jest.fn().mockResolvedValue(stock) },
      appointmentAutomationDelivery: { count: jest.fn().mockResolvedValue(0) },
      appointmentAutomationRun: { findMany: jest.fn().mockResolvedValue([]) },
      appointment: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      appointmentCancellation: { create: jest.fn() },
      orderOperation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "operation-c" }),
      },
      sale: {
        findFirst: jest.fn().mockResolvedValue(sale),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...sale,
          orderStatus: "cancelled",
          paymentStatus: "refunded",
          items: [],
          customer: null,
          collaborator: null,
          appointment: null,
        }),
      },
    };
    const prisma = {
      sale: {
        findFirst: jest.fn().mockResolvedValue(sale),
        findUnique: jest.fn().mockResolvedValue({ orderStatus: "cancelled" }),
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn((callback) => callback(transaction)),
    };
    const inventory = { reverseOrder: jest.fn().mockResolvedValue(stock) };
    const payments = { refundAll: jest.fn().mockResolvedValue({}) };
    return { transaction, prisma, inventory, payments };
  }

  it("cancels a sale: refunds, stock back, open bookings cancelled", async () => {
    const { transaction, prisma, inventory, payments } = cancellable(1);
    const { controller } = controllerWith(prisma, { inventory, payments });
    const result = await controller.cancel(
      { headers: { authorization: "Bearer token" } },
      "sale-1",
      {},
    );
    expect(payments.refundAll).toHaveBeenCalledWith(
      transaction,
      expect.anything(),
      "user-1",
      "sale-1",
      "Annullata dalla cassa",
    );
    expect(inventory.reverseOrder).toHaveBeenCalledWith(
      transaction,
      "sale-1",
      "user-1",
      "Annullata dalla cassa",
    );
    // Only the booking still to perform is cancelled; the performed one stays.
    expect(transaction.appointment.update).toHaveBeenCalledTimes(1);
    expect(transaction.appointment.update).toHaveBeenCalledWith({
      where: { id: "appointment-1" },
      data: { status: "cancelled", updatedById: "user-1" },
    });
    expect(transaction.sale.update).toHaveBeenCalledWith({
      where: { id: "sale-1" },
      data: { revision: { increment: 1 }, orderStatus: "cancelled" },
    });
    expect(transaction.orderOperation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "cancel_sale", saleId: "sale-1" }),
    });
    expect(result).toMatchObject({
      orderStatus: "cancelled",
      cancelledAppointmentIds: ["appointment-1"],
      stockReturned: true,
    });
  });

  it("turns a delete with stock movements into a cancellation and says so", async () => {
    const { transaction, prisma, inventory, payments } = cancellable(2);
    const { controller } = controllerWith(prisma, { inventory, payments });
    const result = (await controller.remove(
      { headers: { authorization: "Bearer token" } },
      "sale-1",
    )) as Record<string, unknown>;
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deleted: false, cancelled: true });
    expect(String(result["message"])).toContain("annullata");
    expect(inventory.reverseOrder).toHaveBeenCalled();
  });
});
