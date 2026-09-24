import { NotificationChannel } from "@prisma/client";
import { firstValueFrom } from "rxjs";
import { NotificationsController } from "./notifications.controller";

jest.mock("../../common/request-session", () => ({
  resolveRequestSession: jest.fn().mockResolvedValue({
    tenantId: "tenant-1",
    user: {
      id: "user-1",
      tenantId: "tenant-1",
      email: "owner@example.test",
      firstName: "Owner",
      lastName: "User",
      role: "owner",
    },
  }),
  requireTenantId: jest.fn().mockReturnValue("tenant-1"),
  requireUser: jest.fn().mockReturnValue({
    id: "user-1",
    tenantId: "tenant-1",
    email: "owner@example.test",
    firstName: "Owner",
    lastName: "User",
    role: "owner",
  }),
}));

describe("NotificationsController", () => {
  it("streams appointments that crossed now and await order confirmation", async () => {
    const notificationsService = {
      listAppointmentsAwaitingOrder: jest
        .fn()
        .mockResolvedValue([{ id: "appointment-1" }]),
    };
    const controller = new NotificationsController(
      {} as never,
      notificationsService as never,
      {} as never,
    );

    await expect(
      firstValueFrom(
        controller.stream({ headers: { authorization: "Bearer token" } }),
      ),
    ).resolves.toEqual({
      type: "appointment.awaiting_order",
      data: {
        appointments: [{ id: "appointment-1" }],
        generatedAt: expect.any(String),
      },
    });
    expect(
      notificationsService.listAppointmentsAwaitingOrder,
    ).toHaveBeenCalledWith("tenant-1", expect.any(Date));
  });

  it("delegates unread count to the service", async () => {
    const controller = new NotificationsController(
      {} as never,
      {
        unreadCount: jest.fn().mockResolvedValue({ unreadCount: 4 }),
      } as never,
      {} as never,
    );

    await expect(
      controller.unreadCount({ headers: { authorization: "Bearer token" } }),
    ).resolves.toEqual({ unreadCount: 4 });
  });

  it("delegates provider update to the service", async () => {
    const notificationsService = {
      upsertProvider: jest.fn().mockResolvedValue({ ok: true }),
    };

    const controller = new NotificationsController(
      {} as never,
      notificationsService as never,
      {} as never,
    );

    await controller.updateProvider(
      { headers: { authorization: "Bearer token" } },
      NotificationChannel.email,
      { providerKey: "email.smtp" },
    );

    expect(notificationsService.upsertProvider).toHaveBeenCalledWith(
      "tenant-1",
      NotificationChannel.email,
      { providerKey: "email.smtp" },
    );
  });
});
