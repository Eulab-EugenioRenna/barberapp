import { BadRequestException } from "@nestjs/common";
import { parseServicesStartAt, SaleScheduleWarningsService } from "./sale-schedule";

describe("till execution time", () => {
  const now = new Date("2026-11-22T15:00:00.000Z");

  it("is optional and accepts any past time (late registration)", () => {
    expect(parseServicesStartAt(undefined, now)).toBeUndefined();
    expect(parseServicesStartAt("", now)).toBeUndefined();
    expect(parseServicesStartAt("2026-10-01T09:00:00.000Z", now)?.toISOString()).toBe(
      "2026-10-01T09:00:00.000Z",
    );
  });

  it("refuses a future time: that is a booking", () => {
    expect(() => parseServicesStartAt("2026-11-22T16:00:00.000Z", now)).toThrow(/Prenota/);
    expect(() => parseServicesStartAt("not a date", now)).toThrow(BadRequestException);
  });
});

describe("till schedule warnings", () => {
  const prisma: any = {
    tenant: { findUnique: jest.fn(async () => ({ timezone: "Europe/Rome" })) },
    sector: {
      findFirst: jest.fn(async () => ({
        tenantId: "t1",
        location: { weeklyHours: null, closures: [] },
        weeklyHours: null,
        closures: [],
      })),
    },
    tenantHoliday: { count: jest.fn(async () => 0) },
    collaborator: { findFirst: jest.fn(async () => ({ firstName: "Marco", lastName: "Neri" })) },
    appointment: { findFirst: jest.fn(async () => null) },
  };
  const schedules: any = {
    resolveWorkingWindow: jest.fn(async () => ({ isAvailable: true, startMinutes: 540, endMinutes: 1140 })),
  };
  const service = new SaleScheduleWarningsService(prisma, schedules);
  const line = {
    serviceId: "s1",
    sectorId: "sec1",
    collaboratorId: "c1",
    durationMinutes: 30,
    label: "Taglio",
    booked: false,
  };

  beforeEach(() => jest.clearAllMocks());

  it("says nothing when the slot is free and inside the hours", async () => {
    // 10:00 Rome
    expect(await service.warnings("t1", new Date("2026-11-20T09:00:00.000Z"), [line])).toEqual([]);
  });

  it("warns, without blocking, about overlaps and hours", async () => {
    prisma.appointment.findFirst.mockResolvedValueOnce({
      startsAt: new Date("2026-11-20T19:15:00.000Z"),
      service: { name: "Barba" },
    });
    // 20:00 Rome: after the 09:00–19:00 legacy day and the collaborator's hours.
    const warnings = await service.warnings("t1", new Date("2026-11-20T19:00:00.000Z"), [line], "sale-1");
    expect(warnings.map((w) => w.code).sort()).toEqual([
      "COLLABORATOR_BUSY",
      "OUTSIDE_COLLABORATOR_HOURS",
      "OUTSIDE_SECTOR_HOURS",
    ]);
    expect(warnings.find((w) => w.code === "COLLABORATOR_BUSY")?.message).toContain("Marco Neri");
    // The account's own appointments never count as overlaps.
    expect(prisma.appointment.findFirst.mock.calls[0][0].where.NOT).toEqual({
      orderItem: { is: { saleId: "sale-1" } },
    });
  });

  it("places services one after another and skips lines already booked", async () => {
    await service.warnings("t1", new Date("2026-11-20T09:00:00.000Z"), [
      { ...line, booked: true },
      line,
      { ...line, serviceId: "s2", label: "Barba" },
    ]);
    const windows = prisma.appointment.findFirst.mock.calls.map((call: any) => [
      call[0].where.endsAt.gt.toISOString(),
      call[0].where.startsAt.lt.toISOString(),
    ]);
    expect(windows).toEqual([
      ["2026-11-20T09:00:00.000Z", "2026-11-20T09:30:00.000Z"],
      ["2026-11-20T09:30:00.000Z", "2026-11-20T10:00:00.000Z"],
    ]);
  });
});
