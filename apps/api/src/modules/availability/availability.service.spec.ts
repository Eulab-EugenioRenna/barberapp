import { AvailabilityService } from "./availability.service";

describe("AvailabilityService", () => {
  it("accounts for service buffers when evaluating conflicts", async () => {
    const service = new AvailabilityService(
      {
        service: {
          findFirst: jest.fn().mockResolvedValue({
            id: "service-1",
            tenantId: "tenant-1",
            durationMinutes: 30,
            bufferBeforeMinutes: 15,
            bufferAfterMinutes: 15,
            requiresCollaborator: true,
            requiresRoom: false,
            color: "#111111",
          }),
        },
        collaborator: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "collaborator-1",
              tenantId: "tenant-1",
              firstName: "Mario",
              lastName: "Rossi",
              calendarColor: "#111111",
              isActive: true,
              isPublic: true,
            },
          ]),
        },
        appointment: {
          findMany: jest.fn().mockResolvedValue([
            {
              collaboratorId: "collaborator-1",
              roomId: null,
              startsAt: new Date(Date.UTC(2026, 4, 14, 9, 0, 0, 0)),
              endsAt: new Date(Date.UTC(2026, 4, 14, 9, 30, 0, 0)),
              service: {
                bufferBeforeMinutes: 0,
                bufferAfterMinutes: 15,
                requiresRoom: false,
              },
            },
          ]),
        },
        room: { count: jest.fn() },
        tenant: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ timezone: "UTC" }),
        },
      } as never,
      {
        getOrSet: jest.fn(
          async (_key: string, _ttl: number, loader: () => Promise<unknown>) =>
            loader(),
        ),
      } as never,
      {
        resolveWorkingWindow: jest.fn().mockResolvedValue({
          isAvailable: true,
          isHoliday: false,
          startMinutes: 9 * 60,
          endMinutes: 19 * 60,
        }),
      } as never,
    );

    const slots = await service.buildAvailability(
      "tenant-1",
      "service-1",
      "2026-05-14",
      "collaborator-1",
    );

    expect(slots.some((slot) => slot.label === "09:30")).toBe(false);
    expect(slots.some((slot) => slot.label === "10:00")).toBe(true);
  });
});
