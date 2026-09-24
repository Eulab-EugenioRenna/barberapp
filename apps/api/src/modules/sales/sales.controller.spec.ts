import { SalesController } from "./sales.controller";

jest.mock("../../common/request-session", () => ({
  resolveRequestSession: jest.fn().mockResolvedValue({
    tenantId: "tenant-1",
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
      prisma as never,
      {} as never,
      cacheInvalidation as never,
      {} as never,
    ),
  };
}

describe("SalesController order CRUD", () => {
  it("replaces order rows and keeps one collaborator per service row", async () => {
    const transaction = {
      saleItem: { deleteMany: jest.fn() },
      sale: {
        update: jest.fn().mockResolvedValue({ id: "sale-1", items: [] }),
      },
      appointment: { update: jest.fn() },
    };
    const prisma = {
      sale: {
        findFirst: jest.fn().mockResolvedValue({
          id: "sale-1",
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
            requiresCollaborator: true,
          },
        ]),
      },
      customer: { findFirst: jest.fn().mockResolvedValue({ id: "customer-1" }) },
      collaborator: {
        findMany: jest.fn().mockResolvedValue([{ id: "collaborator-1" }]),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ defaultCollaboratorId: null }),
      },
      $transaction: jest.fn((callback) => callback(transaction)),
    };
    const { controller } = controllerWith(prisma);

    await controller.update(
      { headers: { authorization: "Bearer token" } },
      "sale-1",
      {
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
      where: { saleId: "sale-1" },
    });
    expect(transaction.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sale-1" },
        data: expect.objectContaining({
          total: 30,
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
      sale: { delete: jest.fn() },
      appointment: { update: jest.fn() },
    };
    const prisma = {
      sale: {
        findFirst: jest.fn().mockResolvedValue({
          id: "sale-1",
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
      where: { id: "sale-1" },
    });
    expect(transaction.appointment.update).toHaveBeenCalledWith({
      where: { id: "appointment-1" },
      data: { finalPrice: null },
    });
  });
});
