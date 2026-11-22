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

function controllerWith(prisma: Record<string, unknown>) {
  const cacheInvalidation = {
    invalidateSales: jest.fn(),
    invalidateDashboard: jest.fn(),
    invalidateCustomers: jest.fn(),
    invalidateAppointments: jest.fn(),
  };
  return {
    cacheInvalidation,
    controller: new SalesController(
      { postOrder: jest.fn() } as never,
      { confirm: jest.fn() } as never,
      { cashierDeclaration: jest.fn().mockResolvedValue({}) } as never,
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
      {} as never,
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

  it("deletes the order without deleting its appointment", async () => {
    const transaction = {
      $executeRaw: jest.fn(),
      stockMovement: { count: jest.fn().mockResolvedValue(0) },
      paymentOperation: { count: jest.fn().mockResolvedValue(0) },
      orderOperation: { count: jest.fn().mockResolvedValue(0) },
      sale: { delete: jest.fn() },
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
      $transaction: jest.fn((callback) => callback(transaction)),
    };
    const { controller } = controllerWith(prisma);

    await expect(
      controller.remove(
        { headers: { authorization: "Bearer token" } },
        "sale-1",
      ),
    ).resolves.toEqual({ deleted: true });
    expect(transaction.sale.delete).toHaveBeenCalledWith({
      where: { id: "sale-1", tenantId: "tenant-1" },
    });
    expect(transaction.appointment.update).toHaveBeenCalledWith({
      where: { id: "appointment-1", tenantId: "tenant-1" },
      data: { finalPrice: null },
    });
  });
});
