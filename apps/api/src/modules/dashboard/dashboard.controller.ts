import { canUseLocalFunction } from "../../common/function-catalog";
import { Prisma } from "@prisma/client";
import { FinancialReportService } from "./financial-report.service";
import {
  FinancialActivityDto,
  FinancialReportDto,
} from "./financial-report.dto";
import {
  resolveOperationalScope,
  sectorFilter,
  saleFilter,
} from "../locations/operational-scope";
import { Controller, Get, Query, Req } from "@nestjs/common";
import { CACHE_TTL_SECONDS, cacheKeys } from "../../cache/cache.constants";
import { AppCacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  requireTenantId,
  resolveRequestSession,
} from "../../common/request-session";
import { getRevenueRange } from "./revenue-report.logic";

@Controller("dashboard")
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly financialReport: FinancialReportService,
  ) {}

  @Get("revenue")
  async revenue(
    @Req()
    request: { headers: { authorization?: string; "x-alora-sector"?: string } },
    @Query() filters: FinancialReportDto,
  ) {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    return this.financialReport.read(
      scope,
      filters,
      !!request.headers["x-alora-sector"],
      !!session.user && canUseLocalFunction(session.user, "inventory.read"),
    );
  }

  @Get("activity")
  async activity(
    @Req()
    request: { headers: { authorization?: string; "x-alora-sector"?: string } },
    @Query() filters: FinancialActivityDto,
  ) {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const range = getRevenueRange(
      filters.period ?? "month",
      filters.date ?? filters.month,
      tenant.timezone,
    );
    const page = filters.page ?? 1,
      pageSize = filters.pageSize ?? 20;
    const lineWhere = {
      ...sectorFilter(scope),
      ...(filters.collaboratorId
        ? {
            collaboratorId: filters.collaboratorId,
            booking: { tenantId, status: "completed" as const },
          }
        : {}),
    };
    const accountScope = saleFilter(scope);
    const rows = await this.prisma.sale.findMany({
      where: {
        ...accountScope,
        AND: [
          ...accountScope.AND,
          {
            OR: [
              { items: { some: {} } },
              {
                location: {
                  sectors: { every: { id: { in: scope.allowedSectorIds } } },
                },
              },
            ],
          },
        ],
        tenantId,
        orderStatus: { in: ["open", "confirmed", "cancelled"] },
        soldAt:
          range.start && range.end
            ? { gte: range.start, lte: range.end }
            : undefined,
        customerId: filters.customerId,
        ...(filters.collaboratorId
          ? {
              items: {
                every: { sectorId: { in: scope.allowedSectorIds } },
                some: lineWhere,
              },
            }
          : {}),
      },
      orderBy: [{ soldAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
      select: {
        id: true,
        soldAt: true,
        total: true,
        orderStatus: true,
        paymentStatus: true,
        customer: { select: { firstName: true, lastName: true } },
        items: {
          where: lineWhere,
          select: {
            id: true,
            lineTotal: true,
            taxTotal: true,
            booking: { select: { id: true } },
          },
        },
      },
    });
    const lineFiltered =
      !!request.headers["x-alora-sector"] || !!filters.collaboratorId;
    return {
      page,
      pageSize,
      hasMore: rows.length > pageSize,
      basis: "one-row-per-authorized-account",
      items: rows.slice(0, pageSize).map((row) => ({
        kind: row.items.some((item) => item.booking) ? "combined" : "sale",
        id: row.id,
        orderId: row.id,
        occurredAt: row.soldAt.toISOString(),
        customerName: row.customer
          ? `${row.customer.firstName} ${row.customer.lastName}`.trim()
          : "Senza cliente",
        collaboratorName: "",
        detail: `${row.items.length} righe del conto`,
        amount: lineFiltered
          ? row.items
              .reduce(
                (sum, item) => sum.plus(item.lineTotal).plus(item.taxTotal),
                new Prisma.Decimal(0),
              )
              .toFixed(2)
          : row.total.toFixed(2),
        amountBasis:
          row.orderStatus === "confirmed"
            ? "confirmed-account-value"
            : "planned-account-value",
        status:
          row.orderStatus === "confirmed" ? row.paymentStatus : row.orderStatus,
        appointmentId:
          row.items.find((item) => item.booking)?.booking?.id ?? null,
      })),
    };
  }

  @Get("appointments")
  async appointments(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const range = getRevenueRange(
      "month",
      undefined,
      tenant?.timezone ?? "Europe/Rome",
    ) as { start: Date; end: Date };

    return this.cacheService.getOrSet(
      cacheKeys.dashboardAppointments(
        tenantId,
        range.start.toISOString().slice(0, 7),
      ),
      CACHE_TTL_SECONDS.dashboard,
      async () => {
        const appointments = await this.prisma.appointment.findMany({
          where: {
            ...sectorFilter(scope),
            tenantId,
            startsAt: { gte: range.start, lte: range.end },
          },
        });

        return {
          total: appointments.length,
          completed: appointments.filter((item) => item.status === "completed")
            .length,
          cancelled: appointments.filter((item) => item.status === "cancelled")
            .length,
          noShow: appointments.filter((item) => item.status === "no_show")
            .length,
          requested: appointments.filter((item) => item.status === "requested")
            .length,
          confirmed: appointments.filter((item) => item.status === "confirmed")
            .length,
        };
      },
    );
  }

  @Get("upcoming-appointments")
  async upcomingAppointments(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );

    return this.prisma.appointment.findMany({
      where: {
        ...sectorFilter(scope),
        tenantId,
        startsAt: { gte: new Date() },
        status: { in: ["requested", "confirmed", "checked_in", "rescheduled"] },
      },
      orderBy: { startsAt: "asc" },
      take: 6,
      include: {
        customer: true,
        service: true,
        collaborator: true,
      },
    });
  }

  @Get("collaborators")
  async collaborators(
    @Req()
    request: { headers: { authorization?: string; "x-alora-sector"?: string } },
    @Query() filters: FinancialReportDto,
  ) {
    const report = await this.revenue(request, { period: "all", ...filters });
    return report.byCollaborator.map((row) => ({
      collaboratorId: row.id,
      collaboratorName: row.label,
      revenue: row.revenue,
      basis: "confirmed-service-lines-declared-performer",
    }));
  }

  @Get("services")
  async services(
    @Req()
    request: { headers: { authorization?: string; "x-alora-sector"?: string } },
    @Query() filters: FinancialReportDto,
  ) {
    const report = await this.revenue(request, { period: "all", ...filters });
    return report.byService.map((row) => ({
      serviceId: row.id,
      serviceName: row.label,
      revenue: row.revenue,
      quantity: row.quantity,
      basis: "confirmed-service-lines",
    }));
  }

  @Get("products")
  async products(
    @Req()
    request: { headers: { authorization?: string; "x-alora-sector"?: string } },
    @Query() filters: FinancialReportDto,
  ) {
    const report = await this.revenue(request, { period: "all", ...filters });
    return report.byProduct.map((row) => ({
      productId: row.id,
      productName: row.label,
      revenue: row.revenue,
      quantity: row.quantity,
      basis: "confirmed-product-lines",
    }));
  }
}
