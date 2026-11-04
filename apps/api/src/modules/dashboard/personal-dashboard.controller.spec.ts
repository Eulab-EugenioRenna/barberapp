import { ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PersonalDashboardController } from "./personal-dashboard.controller";
import { PrismaService } from "../../prisma/prisma.service";
import { resolveRequestSession } from "../../common/request-session";
import { PERSONAL_APPOINTMENT_SELECT } from "../../common/personal-appointment";
jest.mock("../../common/request-session", () => ({ ...jest.requireActual("../../common/request-session"), resolveRequestSession: jest.fn() }));
describe("Personal activity projection", () => {
  const aggregate = jest.fn(), findMany = jest.fn(), groupBy = jest.fn(), professional = jest.fn(), holidays = jest.fn();
  const controller = new PersonalDashboardController({
    collaborator: { findFirst: professional },
    tenantHoliday: { findMany: holidays },
    tenant: { findUniqueOrThrow: jest.fn(async () => ({ timezone: "Europe/Rome", currency: "EUR" })) },
    appointment: { findMany, groupBy }, saleItem: { aggregate },
  } as unknown as PrismaService);
  const user = { id: "person-a", tenantId: "company-a", email: "own@example.test", firstName: "Own", lastName: "A", role: "collaborator", collaboratorId: "professional-a", permissionsConfigured: true, permissions: ["appointments.read.own"], connectFunctions: ["appointments.read.own", "dashboard.personal.values.read"] };
  beforeEach(() => {
    jest.clearAllMocks();
    professional.mockResolvedValue({ firstName: "Own", lastName: "Professional", weeklySchedules: [{ weekday: 0, isWorkingDay: true, startTime: "10:00", endTime: "17:30" }], dayOverrides: [{ date: new Date("2026-10-25T00:00:00Z"), isWorkingDay: false, isHoliday: true, startTime: null, endTime: null }] });
    holidays.mockResolvedValue([{ date: new Date("2026-10-25T00:00:00Z") }]);
    jest.mocked(resolveRequestSession).mockResolvedValue({ tenantId: "company-a", user });
    findMany.mockResolvedValue([]);groupBy.mockResolvedValue([{ status: "completed", _count: { _all: 3 } }]);
    aggregate.mockImplementation(async args => ({ _sum: args._sum.lineTotal ? { lineTotal: new Prisma.Decimal("0.30") } : { quantity: 2 } }));
  });
  it("scopes every read to the authenticated professional and never loads money without permission", async () => {
    const result = await controller.overview({ headers: {} }, { period: "week", date: "2026-10-25" });
    expect(result.values).toBeNull();expect(result.activity.completedAppointments).toBe(3);
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "company-a", collaboratorId: "professional-a", collaborator: { tenantId: "company-a", userId: "person-a", isActive: true } }), select: PERSONAL_APPOINTMENT_SELECT, take: 25 }));
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ collaboratorId: "professional-a", sale: expect.objectContaining({ tenantId: "company-a" }) }) }));
  });
  it("returns exact recorded line values only with both grants", async () => {
    jest.mocked(resolveRequestSession).mockResolvedValue({ tenantId: "company-a", user: { ...user, permissions: [...user.permissions, "dashboard.personal.values.read"] } });
    const result = await controller.overview({ headers: {} }, { period: "day", date: "2026-10-25" });
    expect(result.values).toEqual({ registeredServiceLineTotal: "0.30", currency: "EUR" });
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(result.range.start).toBe("2026-10-24T22:00:00.000Z");
    expect(result.range.end).toBe("2026-10-25T22:59:59.999Z");
  });
  it("projects only personal schedule fields and uses calendar dates across the DST change", async () => {
    const result = await controller.overview({ headers: {} }, { period: "day", date: "2026-10-25" });
    expect(result.schedule).toEqual({ weekly: [{ weekday: 0, isWorkingDay: true, startTime: "10:00", endTime: "17:30" }], overrides: [{ date: "2026-10-25", isWorkingDay: false, isHoliday: true, startTime: null, endTime: null }], closedDates: ["2026-10-25"] });
    const dates = { gte: new Date("2026-10-25T00:00:00Z"), lte: new Date("2026-10-25T00:00:00Z") };
    expect(professional).toHaveBeenCalledWith({ where: { id: "professional-a", tenantId: "company-a", userId: "person-a", isActive: true }, select: { firstName: true, lastName: true, weeklySchedules: { orderBy: { weekday: "asc" }, select: { weekday: true, isWorkingDay: true, startTime: true, endTime: true } }, dayOverrides: { where: { date: dates }, orderBy: { date: "asc" }, select: { date: true, isWorkingDay: true, isHoliday: true, startTime: true, endTime: true } } } });
    expect(holidays).toHaveBeenCalledWith({ where: { tenantId: "company-a", date: dates }, orderBy: { date: "asc" }, select: { date: true } });
    expect(result.professional).toEqual({ firstName: "Own", lastName: "Professional" });
  });
  it("rejects an inactive or reassigned profile before loading schedules and activity", async () => {
    professional.mockResolvedValue(null);
    await expect(controller.overview({ headers: {} }, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(holidays).not.toHaveBeenCalled();expect(aggregate).not.toHaveBeenCalled();
  });
  it("rejects a missing personal association before any activity query", async () => {
    jest.mocked(resolveRequestSession).mockResolvedValue({ tenantId: "company-a", user: { ...user, collaboratorId: null } });
    await expect(controller.overview({ headers: {} }, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();expect(aggregate).not.toHaveBeenCalled();
  });
  it("rejects another profile for own-only access before reading any data", async () => {
    await expect(controller.overview({ headers: {} }, { collaboratorId: "professional-b" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(professional).not.toHaveBeenCalled();expect(findMany).not.toHaveBeenCalled();expect(aggregate).not.toHaveBeenCalled();
  });
  it("lets a company reader without a personal association inspect an unlinked professional, scoped to their tenant", async () => {
    jest.mocked(resolveRequestSession).mockResolvedValue({ tenantId: "company-a", user: { ...user, role: "manager", collaboratorId: null, permissions: ["appointments.read.all", "dashboard.personal.values.read"], connectFunctions: ["appointments.read.all", "dashboard.personal.values.read"] } });
    const result = await controller.overview({ headers: {} }, { collaboratorId: "professional-b" });
    expect(professional).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "professional-b", tenantId: "company-a", isActive: true } }));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ collaboratorId: "professional-b", tenantId: "company-a", collaborator: { tenantId: "company-a", isActive: true } }) }));
    expect(aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ collaboratorId: "professional-b", collaborator: { tenantId: "company-a", isActive: true }, sale: expect.objectContaining({ tenantId: "company-a" }) }) }));
    expect(result.values).toBeNull();expect(aggregate).toHaveBeenCalledTimes(1);
  });
  it("does not resolve another tenant's or unavailable professional for a company reader", async () => {
    jest.mocked(resolveRequestSession).mockResolvedValue({ tenantId: "company-a", user: { ...user, role: "manager", permissions: ["appointments.read.all"], connectFunctions: ["appointments.read.all"] } });
    professional.mockResolvedValue(null);
    await expect(controller.overview({ headers: {} }, { collaboratorId: "foreign-professional" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(professional).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "foreign-professional", tenantId: "company-a", isActive: true } }));
    expect(findMany).not.toHaveBeenCalled();expect(aggregate).not.toHaveBeenCalled();
  });
  it("requires company revenue access for another profile's monetary values", async () => {
    jest.mocked(resolveRequestSession).mockResolvedValue({ tenantId: "company-a", user: { ...user, role: "manager", permissions: ["appointments.read.all", "dashboard.revenue.read"], connectFunctions: ["appointments.read.all", "dashboard.revenue.read"] } });
    const result = await controller.overview({ headers: {} }, { collaboratorId: "professional-b" });
    expect(result.values).toEqual({ registeredServiceLineTotal: "0.30", currency: "EUR" });
  });

});
