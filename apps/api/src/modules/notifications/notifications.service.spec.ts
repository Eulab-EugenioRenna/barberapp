import { NotificationChannel } from "@prisma/client";
import { NotificationsService } from "./notifications.service";

describe("NotificationsService", () => {
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
