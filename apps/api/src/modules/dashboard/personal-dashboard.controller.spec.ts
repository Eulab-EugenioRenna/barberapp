import { ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PersonalDashboardController } from "./personal-dashboard.controller";
import { PrismaService } from "../../prisma/prisma.service";
import { resolveRequestSession } from "../../common/request-session";
import { PERSONAL_APPOINTMENT_SELECT } from "../../common/personal-appointment";
jest.mock("../../common/request-session", () => ({ ...jest.requireActual("../../common/request-session"), resolveRequestSession: jest.fn() }));
describe("Personal activity projection", () => {
  const aggregate = jest.fn(), findMany = jest.fn(), groupBy = jest.fn();
  const controller = new PersonalDashboardController({
    collaborator: { findFirst: jest.fn(async () => ({ firstName: "Own", lastName: "Professional" })) },
    tenant: { findUniqueOrThrow: jest.fn(async () => ({ timezone: "Europe/Rome", currency: "EUR" })) },
    appointment: { findMany, groupBy }, saleItem: { aggregate },
  } as unknown as PrismaService);
  const user = { id: "person-a", tenantId: "company-a", email: "own@example.test", firstName: "Own", lastName: "A", role: "collaborator", collaboratorId: "professional-a", permissionsConfigured: true, permissions: ["appointments.read.own"], connectFunctions: ["appointments.read.own", "dashboard.personal.values.read"] };
  beforeEach(() => {
    jest.clearAllMocks();
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
  it("rejects a missing personal association before any activity query", async () => {
    jest.mocked(resolveRequestSession).mockResolvedValue({ tenantId: "company-a", user: { ...user, collaboratorId: null } });
    await expect(controller.overview({ headers: {} }, {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();expect(aggregate).not.toHaveBeenCalled();
  });
});
