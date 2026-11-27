import { CustomersController } from "./customers.controller";

jest.mock("../../common/request-session", () => ({
  resolveRequestSession: jest.fn().mockResolvedValue({ tenantId: "tenant-1" }),
  requireTenantId: jest.fn().mockReturnValue("tenant-1"),
}));

describe("customer update", () => {
  const request = { headers: { authorization: "Bearer token" } };
  function fixture() {
    const tx = {
      $executeRaw: jest.fn(),
      customer: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ phone: "+39 333 1234567", isActive: true }),
        update: jest.fn().mockResolvedValue({ id: "customer-1" }),
      },
      appointmentAutomationRun: { findMany: jest.fn().mockResolvedValue([]) },
      appointmentAutomationDelivery: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      customer: {
        findUniqueOrThrow: tx.customer.findUniqueOrThrow,
        update: jest.fn().mockResolvedValue({ id: "customer-1" }),
        findUnique: jest.fn().mockResolvedValue({ id: "customer-1" }),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const controller = new CustomersController(
      prisma as never,
      {} as never,
      { invalidateDashboard: jest.fn() } as never,
      { alignCustomer: jest.fn(), queueCustomerRefresh: jest.fn() } as never,
    );
    return { tx, prisma, controller };
  }

  it("saves name and notes without the tenant lock", async () => {
    const { prisma, controller } = fixture();
    await controller.update(request, "customer-1", {
      firstName: "Mario",
      notes: "Preferisce la mattina",
      phone: "+393331234567",
    } as never);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ firstName: "Mario" }),
      }),
    );
  });

  it("locks and stops reminders only when the phone really changes", async () => {
    const { prisma, tx, controller } = fixture();
    await controller.update(request, "customer-1", {
      phone: "+39 333 7654321",
    } as never);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.appointmentAutomationRun.findMany).toHaveBeenCalled();
  });
});
