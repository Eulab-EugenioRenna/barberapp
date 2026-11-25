import { AvailabilityService } from "./availability.service";

function build() {
  return new AvailabilityService(
    {
      sector: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            {
              id: "sector-1",
              locationId: "location-1",
              activityId: "activity-1",
            },
          ]),
        findFirst: jest.fn().mockResolvedValue({
          id: "sector-1",
          tenantId: "tenant-1",
          weeklyHours: null,
          closures: null,
          location: { weeklyHours: null, closures: null },
        }),
      },
      tenantHoliday: { count: jest.fn().mockResolvedValue(0) },
      service: {
        aggregate: jest.fn().mockResolvedValue({
          _max: { bufferBeforeMinutes: 15, bufferAfterMinutes: 15 },
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "service-1",
          name: "Taglio",
          sectorId: "sector-1",
          activityId: "activity-1",
          sector: { locationId: "location-1" },
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
        findUnique: jest.fn().mockResolvedValue({ timezone: "UTC" }),
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
}

describe("AvailabilityService", () => {
  it("accounts for service buffers when evaluating conflicts", async () => {
    const service = build();

    const slots = await service.buildAvailability(
      "tenant-1",
      "service-1",
      "2026-05-14",
      "collaborator-1",
    );

    expect(slots.some((slot) => slot.label === "09:30")).toBe(false);
    expect(slots.some((slot) => slot.label === "10:00")).toBe(true);
  });

  it("ends public slots at closing minus the duration; staff see the whole day, flagged", async () => {
    const service = build();
    const publicSlots = await service.buildAvailability(
      "tenant-1",
      "service-1",
      "2026-05-14",
      "collaborator-1",
      { publicOnly: true },
    );
    // Legacy day 09:00–19:00, 30 minutes: last public start 18:30.
    expect(publicSlots[0].label).toBe("10:00"); // 09:00 is taken
    expect(publicSlots.at(-1)!.label).toBe("18:30");
    expect(publicSlots.some((slot) => slot.outsideHours)).toBe(false);

    const staffSlots = await service.buildAvailability(
      "tenant-1",
      "service-1",
      "2026-05-14",
      "collaborator-1",
      { includeOutsideHours: true },
    );
    expect(staffSlots[0].label).toBe("00:00");
    expect(staffSlots.at(-1)!.label).toBe("23:30");
    expect(
      staffSlots.find((slot) => slot.label === "08:00")!.outsideHours,
    ).toBe(true);
    expect(
      staffSlots.find((slot) => slot.label === "19:00")!.outsideHours,
    ).toBe(true);
    expect(
      staffSlots.find((slot) => slot.label === "12:00")!.outsideHours,
    ).toBeUndefined();
    // Conflicts still bind staff.
    expect(staffSlots.some((slot) => slot.label === "09:30")).toBe(false);
  });
});
