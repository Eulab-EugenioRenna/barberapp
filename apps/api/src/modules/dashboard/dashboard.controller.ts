import { Controller, Get, Query, Req } from "@nestjs/common";
import { CACHE_TTL_SECONDS, cacheKeys } from "../../cache/cache.constants";
import { AppCacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  requireTenantId,
  resolveRequestSession,
} from "../../common/request-session";
import {
  calculateRevenueKpis,
  getRevenueRange,
  RevenuePeriod,
} from "./revenue-report.logic";

@Controller("dashboard")
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
  ) {}

  @Get("revenue")
  async revenue(
    @Req() request: { headers: { authorization?: string } },
    @Query() filters: Record<string, string>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const period = (
      ["day", "week", "month", "year", "all"].includes(filters["period"])
        ? filters["period"]
        : "month"
    ) as RevenuePeriod;
    const reference = filters["date"] ?? filters["month"];
    const range = getRevenueRange(
      period,
      reference,
      tenant?.timezone ?? "Europe/Rome",
    );
    const rangeFilter =
      range.start && range.end
        ? { gte: range.start, lte: range.end }
        : undefined;
    const customerId = filters["customerId"] || undefined;
    const stationId = filters["stationId"] || undefined;
    const cacheToken = [
      period,
      reference ?? "now",
      customerId ?? "all",
      stationId ?? "all",
      tenant?.timezone ?? "Europe/Rome",
    ].join(":");

    return this.cacheService.getOrSet(
      cacheKeys.dashboardRevenue(tenantId, cacheToken),
      CACHE_TTL_SECONDS.dashboard,
      async () => {
        const [sales, completedAppointments, appointmentCount, customerCount] =
          await Promise.all([
            this.prisma.sale.findMany({
              where: {
                tenantId,
                soldAt: rangeFilter,
                customerId,
                paymentStatus: { in: ["paid", "partial"] },
                ...(stationId
                  ? { items: { some: { stations: { some: { stationId } } } } }
                  : {}),
              },
              include: {
                customer: {
                  select: { id: true, firstName: true, lastName: true },
                },
                items: {
                  include: { stations: { include: { station: true } } },
                },
              },
            }),
            this.prisma.appointment.findMany({
              where: {
                tenantId,
                status: "completed",
                startsAt: rangeFilter,
                customerId,
                stationId,
                // An appointment linked to any sale is represented by that
                // sale only. This prevents cancelled/refunded/unpaid orders
                // from falling back to appointment revenue.
                sales: { none: {} },
              },
              include: {
                customer: {
                  select: { id: true, firstName: true, lastName: true },
                },
                station: { select: { id: true, name: true } },
              },
            }),
            this.prisma.appointment.count({
              where: {
                tenantId,
                startsAt: rangeFilter,
                customerId,
                stationId,
              },
            }),
            this.prisma.customer.count({ where: { tenantId } }),
          ]);

        const saleRevenue = (sale: (typeof sales)[number]) =>
          stationId
            ? sale.items
                .filter((item) =>
                  item.stations.some(
                    (assignment) => assignment.stationId === stationId,
                  ),
                )
                .reduce(
                  (total, item) =>
                    total + Number(item.lineTotal) + Number(item.taxTotal),
                  0,
                )
            : Number(sale.total);
        const appointmentValues = completedAppointments.map((appointment) =>
          Number(appointment.finalPrice ?? appointment.estimatedPrice ?? 0),
        );
        const productRevenue = sales.reduce(
          (total, sale) =>
            total +
            sale.items
              .filter(
                (item) =>
                  item.productId &&
                  (!stationId ||
                    item.stations.some(
                      (assignment) => assignment.stationId === stationId,
                    )),
              )
              .reduce(
                (sum, item) =>
                  sum + Number(item.lineTotal) + Number(item.taxTotal),
                0,
              ),
          0,
        );
        const kpis = calculateRevenueKpis({
          salesValues: sales.map(saleRevenue),
          appointmentValues,
          productRevenue,
          appointmentCount,
        });

        const customerRevenue = new Map<
          string,
          { id: string; label: string; revenue: number }
        >();
        const stationRevenue = new Map<
          string,
          { id: string; label: string; revenue: number }
        >();
        for (const sale of sales) {
          if (sale.customer) {
            const current = customerRevenue.get(sale.customer.id) ?? {
              id: sale.customer.id,
              label:
                `${sale.customer.firstName} ${sale.customer.lastName}`.trim(),
              revenue: 0,
            };
            current.revenue += saleRevenue(sale);
            customerRevenue.set(current.id, current);
          }
          for (const item of sale.items) {
            const assignedStations = item.stations;
            const stationShare = assignedStations.length
              ? (Number(item.lineTotal) + Number(item.taxTotal)) /
                assignedStations.length
              : 0;
            for (const assignment of assignedStations) {
              if (stationId && assignment.station.id !== stationId) {
                continue;
              }
              const current = stationRevenue.get(assignment.station.id) ?? {
                id: assignment.station.id,
                label: assignment.station.name,
                revenue: 0,
              };
              current.revenue += stationShare;
              stationRevenue.set(current.id, current);
            }
          }
        }
        for (const appointment of completedAppointments) {
          const value = Number(
            appointment.finalPrice ?? appointment.estimatedPrice ?? 0,
          );
          const customer = appointment.customer;
          const currentCustomer = customerRevenue.get(customer.id) ?? {
            id: customer.id,
            label: `${customer.firstName} ${customer.lastName}`.trim(),
            revenue: 0,
          };
          currentCustomer.revenue += value;
          customerRevenue.set(currentCustomer.id, currentCustomer);
          if (appointment.station) {
            const currentStation = stationRevenue.get(
              appointment.station.id,
            ) ?? {
              id: appointment.station.id,
              label: appointment.station.name,
              revenue: 0,
            };
            currentStation.revenue += value;
            stationRevenue.set(currentStation.id, currentStation);
          }
        }

        return {
          filters,
          period,
          range: {
            start: range.start?.toISOString() ?? null,
            end: range.end?.toISOString() ?? null,
          },
          metrics: [
            {
              label: `Fatturato ${range.label.toLowerCase()}`,
              value: `EUR ${kpis.totalRevenue.toFixed(2)}`,
              trend: `${sales.length} vendite`,
            },
            {
              label: "Prenotazioni",
              value: String(appointmentCount),
              trend: `${completedAppointments.length} completate`,
            },
            {
              label: "Ticket medio",
              value: `EUR ${kpis.averageTicket.toFixed(2)}`,
              trend: `${kpis.revenueEvents} operazioni · ${customerCount} clienti`,
            },
            {
              label: "Ricavi da prodotti",
              value: `EUR ${kpis.productRevenue.toFixed(2)}`,
              trend: `${sales.reduce((sum, sale) => sum + sale.items.filter((item) => item.productId).length, 0)} prodotti`,
            },
          ],
          byCustomer: [...customerRevenue.values()].sort(
            (a, b) => b.revenue - a.revenue,
          ),
          byStation: [...stationRevenue.values()].sort(
            (a, b) => b.revenue - a.revenue,
          ),
        };
      },
    );
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
          where: { tenantId, startsAt: { gte: range.start, lte: range.end } },
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

  @Get("collaborators")
  async collaborators(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    return this.cacheService.getOrSet(
      cacheKeys.dashboardCollaborators(tenantId),
      CACHE_TTL_SECONDS.dashboard,
      async () => {
        const rows = await this.prisma.collaborator.findMany({
          where: { tenantId },
          include: {
            appointments: {
              include: {
                sales: { select: { id: true } },
              },
            },
            sales: {
              where: { paymentStatus: { in: ["paid", "partial"] } },
            },
          },
        });

        return rows.map((row) => ({
          collaboratorName: `${row.firstName} ${row.lastName}`,
          revenue:
            row.sales.reduce((total, sale) => total + Number(sale.total), 0) +
            row.appointments
              .filter(
                (appointment) =>
                  appointment.status === "completed" &&
                  appointment.sales.length === 0,
              )
              .reduce(
                (total, appointment) =>
                  total + Number(appointment.estimatedPrice ?? 0),
                0,
              ),
          completed: row.appointments.filter(
            (appointment) => appointment.status === "completed",
          ).length,
          upcoming: row.appointments.filter(
            (appointment) =>
              appointment.startsAt >= new Date() &&
              ["confirmed", "requested"].includes(appointment.status),
          ).length,
        }));
      },
    );
  }

  @Get("services")
  async services(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    return this.cacheService.getOrSet(
      cacheKeys.dashboardServices(tenantId),
      CACHE_TTL_SECONDS.dashboard,
      async () => {
        const rows = await this.prisma.service.findMany({
          where: { tenantId },
          include: {
            appointments: {
              include: {
                sales: { select: { id: true } },
              },
            },
            saleItems: {
              where: {
                sale: { paymentStatus: { in: ["paid", "partial"] } },
              },
            },
          },
        });

        return rows.map((row) => ({
          serviceName: row.name,
          bookings: row.appointments.length,
          revenue:
            row.appointments
              .filter(
                (appointment) =>
                  appointment.status === "completed" &&
                  appointment.sales.length === 0,
              )
              .reduce(
                (total, appointment) =>
                  total +
                  Number(
                    appointment.finalPrice ?? appointment.estimatedPrice ?? 0,
                  ),
                0,
              ) +
            row.saleItems.reduce(
              (total, item) =>
                total + Number(item.lineTotal) + Number(item.taxTotal),
              0,
            ),
        }));
      },
    );
  }

  @Get("products")
  async products(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    return this.cacheService.getOrSet(
      cacheKeys.dashboardProducts(tenantId),
      CACHE_TTL_SECONDS.dashboard,
      async () => {
        const rows = await this.prisma.product.findMany({
          where: { tenantId },
          include: {
            saleItems: {
              where: {
                sale: { paymentStatus: { in: ["paid", "partial"] } },
              },
            },
          },
        });

        return rows.map((row) => ({
          productName: row.name,
          quantity: row.saleItems.reduce(
            (total, item) => total + item.quantity,
            0,
          ),
          revenue: row.saleItems.reduce(
            (total, item) =>
              total + Number(item.lineTotal) + Number(item.taxTotal),
            0,
          ),
        }));
      },
    );
  }
}
