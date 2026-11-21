import { NotificationChannel } from "@prisma/client";
import { NotificationsService } from "../notifications/notifications.service";
import { NotificationsDispatchService } from "../notifications/notifications.dispatch.service";
describe("Operational scope for pending notifications", () => {
  const history = {
    id: "history-a",
    tenantId: "tenant-a",
    recipientUserId: "user-a",
    recipientType: "user",
    payload: { entityType: "appointment", entityId: "appointment-a" },
  };
  it("checks the authoritative appointment sector for queued events, including older payloads", async () => {
    const count = jest.fn().mockResolvedValue(0);
    const service = new NotificationsService(
      {
        appointment: {
          findFirst: async () => ({
            sectorId: "sector-a",
            collaboratorId: "professional-a",
          }),
        },
        user: { count },
      } as never,
      {} as never,
    );
    expect(await service.canDispatchInScope(history)).toBe(false);
    expect(count).toHaveBeenCalledWith({
      where: {
        id: "user-a",
        tenantId: "tenant-a",
        isActive: true,
        OR: [
          { role: "owner" },
          {
            role: { in: ["manager", "reception"] },
            AND: [{ sectorAccess: { some: { sectorId: "sector-a" } } }],
          },
          {
            role: "collaborator",
            collaborator: {
              id: "professional-a",
              isActive: true,
              AND: [{ sectors: { some: { sectorId: "sector-a" } } }],
            },
          },
        ],
      },
    });
  });
  it("does not dispatch an event whose appointment has disappeared", async () => {
    const count = jest.fn();
    const service = new NotificationsService(
      {
        appointment: { findFirst: async () => null },
        user: { count },
      } as never,
      {} as never,
    );
    expect(await service.canDispatchInScope(history)).toBe(false);
    expect(count).not.toHaveBeenCalled();
  });
  it("skips an out-of-scope queued email before calling any provider", async () => {
    const finished = jest.fn(), send = jest.fn();
    const service = new NotificationsDispatchService(
      {
        claimHistory: async () => ({ ...history, channel: NotificationChannel.email, dispatchToken: "claim-a" }),
        dispatchPolicyActive: async () => false,
        finishHistory: finished,
      } as never,
      { send } as never, { send } as never, { send } as never,
      {dispatchIfKnown:async()=>false,authorizeHistory:async()=>true} as never,
    );
    await service.dispatchHistory("history-a");
    expect(finished).toHaveBeenCalledWith("history-a", "claim-a", {
      status: "skipped", reason: "Recipient, scope or notification policy no longer permits dispatch",
    });
    expect(send).not.toHaveBeenCalled();
  });
});
