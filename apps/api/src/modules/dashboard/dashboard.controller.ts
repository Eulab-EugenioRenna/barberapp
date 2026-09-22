import { Controller, Get, Query, Req } from "@nestjs/common";
import { CACHE_TTL_SECONDS, cacheKeys } from "../../cache/cache.constants";
import { AppCacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  requireTenantId,
  resolveRequestSession,
} from "../../common/request-session";

@Controller("dashboard")
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
  ) {}

  private getMonthRange(reference?: string): { start: Date; end: Date } {
    const value = reference ? new Date(reference) : new Date();
    const start = new Date(
      value.getFullYear(),
      value.getMonth(),
      1,
      0,
      0,
      0,
      0,
    );
    const end = new Date(
      value.getFullYear(),
      value.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    return { start, end };
  }

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
    const range = this.getMonthRange(filters["month"]);
    const monthToken =
      filters["month"] ?? range.start.toISOString().slice(0, 7);

    return this.cacheService.getOrSet(
      cacheKeys.dashboardRevenue(tenantId, monthToken),
      CACHE_TTL_SECONDS.dashboard,
      async () => {
        const [sales, completedAppointments, appointmentCount, customerCount] =
          await Promise.all([
            this.prisma.sale.findMany({
              where: { tenantId, soldAt: { gte: range.start, lte: range.end } },
              include: { items: true },
            }),
            this.prisma.appointment.findMany({
              where: {
                tenantId,
                status: "completed",
                startsAt: { gte: range.start, lte: range.end },
                sales: { none: {} },
              },
            }),
            this.prisma.appointment.count({
              where: {
                tenantId,
                startsAt: { gte: range.start, lte: range.end },
              },
            }),
            this.prisma.customer.count({ where: { tenantId } }),
          ]);

        const salesRevenue = sales.reduce(
          (total, sale) => total + Number(sale.total),
          0,
        );
        const appointmentRevenue = completedAppointments.reduce(
          (total, appointment) =>
            total +
            Number(appointment.finalPrice ?? appointment.estimatedPrice ?? 0),
          0,
        );
        const totalRevenue = salesRevenue + appointmentRevenue;
        const averageTicket =
          appointmentCount > 0 ? totalRevenue / appointmentCount : 0;

        return {
          filters,
          metrics: [
            {
              label: "Fatturato mese",
              value: `EUR ${totalRevenue.toFixed(2)}`,
              trend: `${sales.length} vendite`,
            },
            {
              label: "Prenotazioni",
              value: String(appointmentCount),
              trend: `${completedAppointments.length} completate`,
            },
            {
              label: "Ticket medio",
              value: `EUR ${averageTicket.toFixed(2)}`,
              trend: `${customerCount} clienti`,
            },
            {
              label: "Ricavi da prodotti",
              value: `EUR ${salesRevenue.toFixed(2)}`,
              trend: `${sales.reduce((sum, sale) => sum + sale.items.length, 0)} righe`,
            },
          ],
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
    const range = this.getMonthRange();

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
            appointments: true,
            sales: true,
          },
        });

        return rows.map((row) => ({
          collaboratorName: `${row.firstName} ${row.lastName}`,
          revenue:
            row.sales.reduce((total, sale) => total + Number(sale.total), 0) +
            row.appointments
              .filter(
                (appointment) =>
                  appointment.status === "completed" && !appointment.finalPrice,
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
          include: { appointments: true },
        });

        return rows.map((row) => ({
          serviceName: row.name,
          bookings: row.appointments.length,
          revenue: row.appointments.reduce(
            (total, appointment) =>
              total +
              Number(appointment.finalPrice ?? appointment.estimatedPrice ?? 0),
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
            saleItems: true,
          },
        });

        return rows.map((row) => ({
          productName: row.name,
          quantity: row.saleItems.reduce(
            (total, item) => total + item.quantity,
            0,
          ),
          revenue: row.saleItems.reduce(
            (total, item) => total + Number(item.lineTotal),
            0,
          ),
        }));
      },
    );
  }
}
