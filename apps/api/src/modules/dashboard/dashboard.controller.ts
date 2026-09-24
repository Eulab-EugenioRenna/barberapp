import { Controller, Get, Query, Req } from "@nestjs/common";
import { CACHE_TTL_SECONDS, cacheKeys } from "../../cache/cache.constants";
import { AppCacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  requireTenantId,
  resolveRequestSession,
} from "../../common/request-session";
import { parsePagination } from "../../common/pagination";
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
    const collaboratorId = filters["collaboratorId"] || undefined;
    const cacheToken = [
      period,
      reference ?? "now",
      customerId ?? "all",
      collaboratorId ?? "all",
      tenant?.timezone ?? "Europe/Rome",
    ].join(":");

    return this.cacheService.getOrSet(
      cacheKeys.dashboardRevenue(tenantId, cacheToken),
      CACHE_TTL_SECONDS.dashboard,
      async () => {
        const [
          sales,
          completedAppointments,
          appointmentCount,
          completedAppointmentCount,
          customerCount,
        ] = await Promise.all([
            this.prisma.sale.findMany({
              where: {
                tenantId,
                soldAt: rangeFilter,
                customerId,
                paymentStatus: { in: ["paid", "partial"] },
                ...(collaboratorId
                  ? {
                      OR: [
                        { collaboratorId },
                        { items: { some: { collaboratorId } } },
                      ],
                    }
                  : {}),
              },
              include: {
                customer: {
                  select: { id: true, firstName: true, lastName: true },
                },
                collaborator: {
                  select: { id: true, firstName: true, lastName: true },
                },
                appointment: {
                  select: {
                    collaborator: {
                      select: { id: true, firstName: true, lastName: true },
                    },
                  },
                },
                items: {
                  select: {
                    productId: true,
                    lineTotal: true,
                    taxTotal: true,
                    collaboratorId: true,
                    collaborator: {
                      select: { id: true, firstName: true, lastName: true },
                    },
                  },
                },
              },
            }),
            this.prisma.appointment.findMany({
              where: {
                tenantId,
                status: "completed",
                startsAt: rangeFilter,
                customerId,
                ...(collaboratorId ? { collaboratorId } : {}),
                // An appointment linked to any sale is represented by that
                // sale only. This prevents cancelled/refunded/unpaid orders
                // from falling back to appointment revenue.
                sales: { none: {} },
              },
              include: {
                customer: {
                  select: { id: true, firstName: true, lastName: true },
                },
                collaborator: {
                  select: { id: true, firstName: true, lastName: true },
                },
              },
            }),
            this.prisma.appointment.count({
              where: {
                tenantId,
                startsAt: rangeFilter,
                customerId,
                ...(collaboratorId ? { collaboratorId } : {}),
              },
            }),
            this.prisma.appointment.count({
              where: {
                tenantId,
                status: "completed",
                startsAt: rangeFilter,
                customerId,
                ...(collaboratorId ? { collaboratorId } : {}),
              },
            }),
            this.prisma.customer.count({ where: { tenantId } }),
          ]);

        const lineValue = (item: (typeof sales)[number]["items"][number]) =>
          Number(item.lineTotal) + Number(item.taxTotal);
        const saleRevenue = (sale: (typeof sales)[number]) =>
          collaboratorId
            ? sale.items
                .filter((item) => item.collaboratorId === collaboratorId)
                .reduce((sum, item) => sum + lineValue(item), 0)
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
                  (!collaboratorId || item.collaboratorId === collaboratorId),
              )
              .reduce(
                (sum, item) =>
                  sum + lineValue(item),
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
        const collaboratorRevenue = new Map<
          string,
          { id: string; label: string; revenue: number }
        >();
        const collaboratorLabel = (collaborator: {
          id: string;
          firstName: string;
          lastName: string;
        }) => `${collaborator.firstName} ${collaborator.lastName}`.trim();
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
          const serviceItemsWithCollaborator = sale.items.filter(
            (item) =>
              item.collaborator &&
              (!collaboratorId || item.collaboratorId === collaboratorId),
          );
          if (serviceItemsWithCollaborator.length) {
            for (const item of serviceItemsWithCollaborator) {
              if (!item.collaborator) continue;
              const collaborator = item.collaborator;
              const current = collaboratorRevenue.get(collaborator.id) ?? {
                id: collaborator.id,
                label: collaboratorLabel(collaborator) || "Collaboratore",
                revenue: 0,
              };
              current.revenue += lineValue(item);
              collaboratorRevenue.set(current.id, current);
            }
          } else {
            const collaborator = sale.collaborator ?? sale.appointment?.collaborator;
            if (!collaborator) continue;
            const current = collaboratorRevenue.get(collaborator.id) ?? {
              id: collaborator.id,
              label: collaboratorLabel(collaborator) || "Collaboratore",
              revenue: 0,
            };
            current.revenue += saleRevenue(sale);
            collaboratorRevenue.set(current.id, current);
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
          if (appointment.collaborator) {
            const collaborator = appointment.collaborator;
            const currentCollaborator = collaboratorRevenue.get(
              collaborator.id,
            ) ?? {
              id: collaborator.id,
              label: collaboratorLabel(collaborator) || "Collaboratore",
              revenue: 0,
            };
            currentCollaborator.revenue += value;
            collaboratorRevenue.set(
              currentCollaborator.id,
              currentCollaborator,
            );
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
              trend: `${completedAppointmentCount} completate`,
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
          byCollaborator: [...collaboratorRevenue.values()].sort(
            (a, b) => b.revenue - a.revenue,
          ),
        };
      },
    );
  }

  @Get("activity")
  async activity(
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
    const collaboratorId =
      filters["collaboratorId"] || undefined;
    const { page, pageSize } = parsePagination(filters, {
      defaultPageSize: 20,
    });
    const take = page * pageSize + 1;

    const [sales, appointments] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          tenantId,
          soldAt: rangeFilter,
          customerId,
          ...(collaboratorId ? { collaboratorId } : {}),
        },
        orderBy: { soldAt: "desc" },
        take,
        include: {
          customer: { select: { id: true, firstName: true, lastName: true } },
          collaborator: {
            select: { id: true, firstName: true, lastName: true },
          },
          items: { select: { id: true } },
        },
      }),
      this.prisma.appointment.findMany({
        where: {
          tenantId,
          startsAt: rangeFilter,
          customerId,
          ...(collaboratorId ? { collaboratorId } : {}),
        },
        orderBy: { startsAt: "desc" },
        take,
        include: {
          customer: { select: { id: true, firstName: true, lastName: true } },
          service: { select: { id: true, name: true } },
          collaborator: {
            select: { id: true, firstName: true, lastName: true },
          },
          sales: {
            select: {
              id: true,
              total: true,
              paymentStatus: true,
              items: { select: { id: true } },
            },
            orderBy: { soldAt: "desc" },
          },
        },
      }),
    ]);

    const nameOf = (value?: {
      firstName: string;
      lastName: string;
    } | null) =>
      value ? `${value.firstName} ${value.lastName}`.trim() : "";

    // Un ordine collegato a una prenotazione (chiave esterna appointmentId)
    // viene mostrato come un unico movimento, usando data/ora della
    // prenotazione (così si aggiorna se l'appuntamento viene spostato).
    const appointmentIds = new Set(
      appointments.map((appointment) => appointment.id),
    );
    const appointmentEntries = appointments.map((appointment) => {
      const linkedSales = appointment.sales;
      const serviceName = appointment.service?.name ?? "Prenotazione";
      if (linkedSales.length) {
        const latestSale = linkedSales[0];
        const articleCount = linkedSales.reduce(
          (total, sale) => total + sale.items.length,
          0,
        );
        const amount = linkedSales.reduce(
          (total, sale) => total + Number(sale.total),
          0,
        );
        return {
          kind: "combined" as const,
          id: appointment.id,
          occurredAt: appointment.startsAt,
          customerName: nameOf(appointment.customer) || "Cliente",
          collaboratorName: nameOf(appointment.collaborator),
          detail: `${serviceName} · ${articleCount} articoli`,
          amount,
          status: latestSale.paymentStatus,
          appointmentId: appointment.id,
        };
      }
      return {
        kind: "appointment" as const,
        id: appointment.id,
        occurredAt: appointment.startsAt,
        customerName: nameOf(appointment.customer) || "Cliente",
        collaboratorName: nameOf(appointment.collaborator),
        detail: serviceName,
        amount: Number(
          appointment.finalPrice ?? appointment.estimatedPrice ?? 0,
        ),
        status: appointment.status,
        appointmentId: appointment.id,
      };
    });
    const saleEntries = sales
      .filter(
        (sale) =>
          !sale.appointmentId || !appointmentIds.has(sale.appointmentId),
      )
      .map((sale) => ({
        kind: "sale" as const,
        id: sale.id,
        occurredAt: sale.soldAt,
        customerName: nameOf(sale.customer) || "Vendita senza cliente",
        collaboratorName: nameOf(sale.collaborator),
        detail: `${sale.items.length} articoli`,
        amount: Number(sale.total),
        status: sale.paymentStatus,
        appointmentId: sale.appointmentId ?? null,
      }));
    const merged = [...appointmentEntries, ...saleEntries].sort(
      (left, right) =>
        new Date(right.occurredAt).getTime() -
        new Date(left.occurredAt).getTime(),
    );

    const start = (page - 1) * pageSize;
    const items = merged.slice(start, start + pageSize);
    const hasMore = merged.length > start + pageSize;

    return { items, page, pageSize, hasMore };
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

  @Get("upcoming-appointments")
  async upcomingAppointments(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);

    return this.prisma.appointment.findMany({
      where: {
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
