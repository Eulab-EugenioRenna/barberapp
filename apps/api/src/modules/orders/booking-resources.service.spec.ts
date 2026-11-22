import { BookingResourcesService } from "./booking-resources.service";
import { CollaboratorScheduleService } from "../availability/collaborator-schedule.service";
const at = (time: string) => new Date(`2032-11-12T${time}:00Z`);
function fixture() {
  const services = ["one", "two"].map((id, index) => ({
    id,
    name: "Servizio " + id,
    sectorId: "sector-" + index,
    activityId: "activity-" + index,
    tenantId: "tenant",
    sector: { locationId: "location" },
    durationMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    requiresCollaborator: true,
    requiresRoom: false,
  }));
  const people = [
    { id: "A", sectors: [{ sectorId: "sector-0" }, { sectorId: "sector-1" }] },
    { id: "B", sectors: [{ sectorId: "sector-0" }] },
  ];
  const activitySectors = [
    { id: "sector-0", locationId: "location", activityId: "activity-0" },
    { id: "sector-1", locationId: "location", activityId: "activity-1" },
  ];
  const calendar = {
    service: {
      findMany: jest.fn().mockResolvedValue(services),
      aggregate: jest
        .fn()
        .mockResolvedValue({
          _max: { bufferBeforeMinutes: 0, bufferAfterMinutes: 0 },
        }),
    },
    collaborator: { findMany: jest.fn().mockResolvedValue(people) },
    room: { findMany: jest.fn().mockResolvedValue([]) },
    appointment: { findMany: jest.fn().mockResolvedValue([]) },
    sector: {
      // Each service's activity runs in one sector of the location.
      findMany: jest.fn(async ({ where }: any) =>
        activitySectors.filter(
          (row) =>
            row.locationId === where.locationId &&
            where.activityId.in.includes(row.activityId),
        ),
      ),
      findFirst: jest
        .fn()
        .mockResolvedValue({
          tenantId: "tenant",
          weeklyHours: null,
          closures: [],
          location: { weeklyHours: null, closures: [] },
        }),
    },
    tenantHoliday: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    collaboratorWeeklySchedule: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    collaboratorDayOverride: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  // The planner must read the caller's calendar/transaction, not the injected global client.
  const injected = {
    collaboratorDayOverride: {
      findFirst: () => {
        throw Error("Global calendar escaped the transaction");
      },
    },
  };
  const planner = new BookingResourcesService(
    new CollaboratorScheduleService(injected as never),
  );
  const plan = (
    lines = [
      { serviceId: "one", startsAt: at("09:00") },
      { serviceId: "two", startsAt: at("09:00") },
    ],
  ) => planner.plan(calendar as never, "tenant", "Europe/Rome", lines);
  return { calendar, services, people, plan, activitySectors };
}
describe("transaction-bound booking resource planner", () => {
  it("resolves a complete assignment across sectors of one location", async () => {
    const { plan } = fixture();
    const result = await plan();
    expect(result.map((row) => row.collaboratorId)).toEqual(["B", "A"]);
    expect(result.map((row) => row.startsAt.toISOString())).toEqual([
      at("09:00").toISOString(),
      at("09:00").toISOString(),
    ]);
  });
  it("uses the profession's day override from the transaction", async () => {
    const { calendar, plan } = fixture();
    calendar.collaboratorDayOverride.findFirst.mockImplementation(
      async ({ where }: { where: { collaboratorId: string } }) =>
        where.collaboratorId === "B"
          ? {
              isWorkingDay: false,
              isHoliday: false,
              startTime: null,
              endTime: null,
            }
          : null,
    );
    await expect(plan()).rejects.toMatchObject({
      response: { code: "RESOURCES_UNAVAILABLE" },
    });
  });
  it("rejects company holidays and mixed locations before returning an assignment", async () => {
    const { calendar, plan, activitySectors } = fixture();
    calendar.tenantHoliday.count.mockResolvedValue(1);
    await expect(plan()).rejects.toMatchObject({
      response: { code: "BOOKING_OUTSIDE_HOURS" },
    });
    // The second service's activity does not run at this location.
    calendar.tenantHoliday.count.mockResolvedValue(0);
    activitySectors[1].locationId = "different-site";
    await expect(plan()).rejects.toThrow("non è disponibile in questa sede");
  });
  it("keeps non-grid sequential times exact and honors buffer conflicts between lines", async () => {
    const { services, plan } = fixture();
    services[0].durationMinutes = 45;
    const exact = await plan([
      { serviceId: "one", startsAt: at("09:00") },
      { serviceId: "two", startsAt: at("09:45") },
    ]);
    expect(exact[0].endsAt.toISOString()).toBe(exact[1].startsAt.toISOString());
    services[0].bufferAfterMinutes = 1;
    const buffered = await plan([
      { serviceId: "one", startsAt: at("09:00") },
      { serviceId: "two", startsAt: at("09:45") },
    ]);
    expect(buffered.map((row) => row.collaboratorId)).toEqual(["B", "A"]);
  });
  it("does not claim availability when an overlapping legacy booking has unknown resources", async () => {
    const { calendar, plan } = fixture();
    calendar.appointment.findMany.mockResolvedValue([
      {
        startsAt: at("09:00"),
        endsAt: at("09:30"),
        sectorId: "elsewhere",
        collaboratorId: null,
        roomId: null,
        service: {
          requiresCollaborator: true,
          requiresRoom: false,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
        },
      },
    ]);
    await expect(plan()).rejects.toMatchObject({
      response: { code: "LEGACY_RESOURCES_UNKNOWN" },
    });
  });
  it("allows exact peak room capacity across successive existing reservations", async () => {
    const { calendar, services, plan } = fixture();
    services[0].requiresCollaborator = false;
    services[0].requiresRoom = true;
    services[0].durationMinutes = 60;
    calendar.service.findMany.mockResolvedValue([services[0]]);
    calendar.room.findMany.mockResolvedValue([
      { id: "R", sectorId: "sector-0", capacity: 2 },
    ]);
    calendar.appointment.findMany.mockResolvedValue(
      [0, 1].map((index) => ({
        startsAt: at(index ? "09:30" : "09:00"),
        endsAt: at(index ? "10:00" : "09:30"),
        sectorId: "sector-0",
        collaboratorId: null,
        roomId: "R",
        service: {
          requiresCollaborator: false,
          requiresRoom: true,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
        },
      })),
    );
    const result = await plan([{ serviceId: "one", startsAt: at("09:00") }]);
    expect(result[0]).toMatchObject({ roomId: "R", collaboratorId: null });
  });
});
