import { Controller, ForbiddenException, Get, Query, Req } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, Matches, Max, Min } from "class-validator";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { requireTenantId, requireUser, resolveRequestSession } from "../../common/request-session";
import { canUseLocalFunction } from "../../common/function-catalog";
import { PERSONAL_APPOINTMENT_SELECT, type PersonalDashboard } from "../../common/personal-appointment";
import { zonedDateKey } from "../../common/zoned-time";
import { getRevenueRange } from "./revenue-report.logic";
class PersonalRangeDto {
  @IsOptional() @IsIn(["day", "week", "month"]) period?: "day" | "week" | "month";
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) date?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number;
}
@Controller("dashboard/personal")
export class PersonalDashboardController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  async overview(@Req() request: { headers: { authorization?: string } }, @Query() query: PersonalRangeDto): Promise<PersonalDashboard> {
    const session = await resolveRequestSession(this.prisma, request.headers.authorization);
    const tenantId = requireTenantId(session), user = requireUser(session);
    if (!user.collaboratorId || !canUseLocalFunction(user, "appointments.read.own")) throw new ForbiddenException("Agenda personale non abilitata o professionista non associato");
    const professional = await this.prisma.collaborator.findFirst({ where: { id: user.collaboratorId, tenantId, userId: user.id, isActive: true }, select: { firstName: true, lastName: true } });
    if (!professional) throw new ForbiddenException("Professionista personale non disponibile");
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true, currency: true } });
    const referenceDate = query.date || zonedDateKey(new Date(), tenant.timezone);
    const range = getRevenueRange(query.period || "week", referenceDate, tenant.timezone);
    const where = { tenantId, OR: [{ roomId: null }, { room: { tenantId } }], customer: { tenantId }, service: { tenantId }, collaboratorId: user.collaboratorId, collaborator: { tenantId, userId: user.id, isActive: true }, startsAt: { gte: range.start!, lte: range.end! } };
    const saleWhere: Prisma.SaleItemWhereInput = { collaboratorId: user.collaboratorId, collaborator: { tenantId, userId: user.id, isActive: true }, serviceId: { not: null }, service: { tenantId }, sale: { tenantId, soldAt: { gte: range.start!, lte: range.end! }, paymentStatus: { not: "cancelled" } } };
    const valuesAllowed = canUseLocalFunction(user, "dashboard.personal.values.read");
    const page = query.page || 1, pageSize = 25;
    const [groups, items, services, amounts] = await Promise.all([
      this.prisma.appointment.groupBy({ by: ["status"], where, _count: { _all: true } }),
      this.prisma.appointment.findMany({ where, orderBy: [{ startsAt: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: PERSONAL_APPOINTMENT_SELECT }),
      this.prisma.saleItem.aggregate({ where: saleWhere, _sum: { quantity: true } }),
      valuesAllowed ? this.prisma.saleItem.aggregate({ where: saleWhere, _sum: { lineTotal: true } }) : Promise.resolve(null),
    ]);
    const count = (status: string) => groups.find(group => group.status === status)?._count._all || 0;
    const total = groups.reduce((sum, group) => sum + group._count._all, 0);
    return { professional, referenceDate, timezone: tenant.timezone, range: { start: range.start!.toISOString(), end: range.end!.toISOString() },
      activity: { totalAppointments: total, completedAppointments: count("completed"), cancelledAppointments: count("cancelled"), noShows: count("no_show"), attributedServices: services._sum.quantity || 0 },
      values: amounts ? { registeredServiceLineTotal: amounts._sum.lineTotal?.toFixed(2) || "0.00", currency: tenant.currency } : null,
      appointments: { items: items.map(item => ({ ...item, startsAt: item.startsAt.toISOString(), endsAt: item.endsAt.toISOString() })), total, page, pageSize, hasMore: page * pageSize < total },
    };
  }
}
