import { NotificationChannel } from "@prisma/client";
import { NotificationsService } from "./notifications.service";

describe("NotificationsService", () => {
  it("lists only ended appointments without an order", async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: "appointment-1" }]);
    const service = new NotificationsService(
      { appointment: { findMany } } as never,
      {} as never,
    );
    const now = new Date("2026-09-24T14:00:00.000Z");

    await expect(
      service.listAppointmentsAwaitingOrder("tenant-1", now),
    ).resolves.toEqual([{ id: "appointment-1" }]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        startsAt: { lte: now },
        endsAt: { lte: now },
        status: {
          in: [
            "requested",
            "confirmed",
            "checked_in",
            "rescheduled",
            "completed",
          ],
        },
        sales: { none: {} },
      },
      orderBy: { startsAt: "desc" },
      take: 20,
      select: {
        id: true,
        customerId: true,
        serviceId: true,
        collaboratorId: true,
        startsAt: true,
        endsAt: true,
        status: true,
        customer: {
          select: { id: true, firstName: true, lastName: true },
        },
        service: {
          select: {
            id: true,
            name: true,
            basePrice: true,
            durationMinutes: true,
          },
        },
        collaborator: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  });

  it("creates default tenant preferences and providers", async () => {
    const prisma = {
      notificationTemplate: {
        count: jest.fn().mockResolvedValue(0),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      notificationPreferenceTenant: {
        count: jest.fn().mockResolvedValue(0),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      notificationProviderConfig: {
        upsert: jest.fn().mockResolvedValue({ id: "cfg-1" }),
      },
    } as unknown as never;

    const cacheManager = {
      del: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const service = new NotificationsService(prisma, cacheManager as never);

    await service.ensureTenantNotificationDefaults("tenant-1");

    expect(
      (prisma as unknown as { notificationTemplate: { createMany: jest.Mock } })
        .notificationTemplate.createMany,
    ).toHaveBeenCalled();
    expect(
      (
        prisma as unknown as {
          notificationPreferenceTenant: { createMany: jest.Mock };
        }
      ).notificationPreferenceTenant.createMany,
    ).toHaveBeenCalled();
    expect(
      (
        prisma as unknown as {
          notificationProviderConfig: { upsert: jest.Mock };
        }
      ).notificationProviderConfig.upsert,
    ).toHaveBeenCalledTimes(3);
    expect(
      (
        prisma as unknown as {
          notificationProviderConfig: { upsert: jest.Mock };
        }
      ).notificationProviderConfig.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId_channel: {
            tenantId: "tenant-1",
            channel: NotificationChannel.email,
          },
        },
      }),
    );
  });
});
