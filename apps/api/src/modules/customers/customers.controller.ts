import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import { CACHE_TTL_SECONDS, cacheKeys } from "../../cache/cache.constants";
import { AppCacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  requireTenantId,
  resolveRequestSession,
} from "../../common/request-session";
import {
  buildPaginatedResult,
  parsePagination,
} from "../../common/pagination";
import { resolveSaleItemLabels } from "../sales/sales.logic";
import { CustomersAlignmentService } from "./customers-alignment.service";

@Controller("customers")
export class CustomersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly cacheInvalidationService: CacheInvalidationService,
    private readonly customersAlignmentService: CustomersAlignmentService,
  ) {}

  @Get()
  async findAll(
    @Req() request: { headers: { authorization?: string } },
    @Query() query: Record<string, string> = {},
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    const tenantId = requireTenantId(session);

    await this.customersAlignmentService.ensureDailyAlignmentQueued(tenantId);

    const { page, pageSize, skip, take } = parsePagination(query);
    const search = (query["search"] ?? query["q"] ?? "").trim();
    const where = {
      tenantId,
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" as const } },
              { lastName: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    return this.cacheService.getOrSet(
      `${cacheKeys.customersList(tenantId)}:p${page}:s${pageSize}:q${search.toLowerCase()}`,
      CACHE_TTL_SECONDS.lists,
      async () => {
        const [items, total] = await Promise.all([
          this.prisma.customer.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take,
          }),
          this.prisma.customer.count({ where }),
        ]);

        return buildPaginatedResult(items, total, page, pageSize);
      },
    );
  }

  @Post()
  async create(
    @Req() request: { headers: { authorization?: string } },
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    const tenantId = requireTenantId(session);
    const created = await this.prisma.customer.create({
      data: {
        tenantId,
        firstName: String(body["firstName"] ?? ""),
        lastName: String(body["lastName"] ?? ""),
        email: typeof body["email"] === "string" ? body["email"] : undefined,
        phone: typeof body["phone"] === "string" ? body["phone"] : undefined,
        notes: typeof body["notes"] === "string" ? body["notes"] : undefined,
        tags: Array.isArray(body["tags"]) ? body["tags"].map(String) : [],
        privacyConsent:
          body["privacyConsent"] === undefined
            ? true
            : Boolean(body["privacyConsent"]),
        marketingConsent: Boolean(body["marketingConsent"]),
      },
    });
    await this.cacheInvalidationService.invalidateDashboard(tenantId);

    await this.customersAlignmentService.alignCustomer(tenantId, created.id);

    await this.customersAlignmentService.queueCustomerRefresh(
      tenantId,
      created.id,
      "customer_updated",
    );
    return this.prisma.customer.findUnique({ where: { id: created.id } });
  }

  @Get(":id")
  async findOne(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);

    return this.cacheService.getOrSet(
      cacheKeys.customerDetail(tenantId, id),
      CACHE_TTL_SECONDS.lists,
      () =>
        this.prisma.customer.findFirst({
          where: { id, tenantId },
        }),
    );
  }

  @Patch(":id")
  async update(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        firstName:
          typeof body["firstName"] === "string" ? body["firstName"] : undefined,
        lastName:
          typeof body["lastName"] === "string" ? body["lastName"] : undefined,
        email: typeof body["email"] === "string" ? body["email"] : undefined,
        phone: typeof body["phone"] === "string" ? body["phone"] : undefined,
        notes: typeof body["notes"] === "string" ? body["notes"] : undefined,
        tags: Array.isArray(body["tags"])
          ? body["tags"].map(String)
          : undefined,
        isActive:
          typeof body["isActive"] === "boolean" ? body["isActive"] : undefined,
      },
    });
    await this.cacheInvalidationService.invalidateDashboard(tenantId);

    await this.customersAlignmentService.alignCustomer(tenantId, updated.id);

    await this.customersAlignmentService.queueCustomerRefresh(
      tenantId,
      updated.id,
      "customer_updated",
    );
    return this.prisma.customer.findUnique({ where: { id: updated.id } });
  }

  @Get(":id/history")
  async history(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);

    return this.cacheService.getOrSet(
      cacheKeys.customerHistory(tenantId, id),
      CACHE_TTL_SECONDS.lists,
      async () => {
        const [appointments, salesRaw] = await Promise.all([
          this.prisma.appointment.findMany({
            where: { customerId: id, tenantId },
            orderBy: { startsAt: "desc" },
            include: {
              service: true,
              collaborator: true,
            },
          }),
          this.prisma.sale.findMany({
            where: { customerId: id, tenantId },
            orderBy: { soldAt: "desc" },
            include: {
              items: {
                include: {
                  product: true,
                  service: true,
                },
              },
            },
          }),
        ]);

        const sales = salesRaw.map((sale) => ({
          ...sale,
          items: resolveSaleItemLabels(sale.items),
        }));

        return {
          customerId: id,
          appointments,
          sales,
          timeline: buildCustomerTimeline(appointments, sales),
          salesTotal: sales.reduce(
            (total, sale) =>
              ["paid", "partial"].includes(sale.paymentStatus)
                ? total + Number(sale.total)
                : total,
            0,
          ),
        };
      },
    );
  }

  @Delete(":id")
  async remove(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);

    await this.prisma.customer.delete({ where: { id } });

    await Promise.all([
      this.cacheInvalidationService.invalidateCustomers(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
    ]);

    return { id, removed: true };
  }
}

function dayKey(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function buildCustomerTimeline(
  appointments: Array<Record<string, any>>,
  sales: Array<Record<string, any>>,
): Array<{
  date: string;
  appointments: Array<Record<string, any>>;
  sales: Array<Record<string, any>>;
  salesTotal: number;
}> {
  const groups = new Map<
    string,
    {
      date: string;
      appointments: Array<Record<string, any>>;
      sales: Array<Record<string, any>>;
      salesTotal: number;
    }
  >();

  const ensureGroup = (date: string) => {
    const existing = groups.get(date);
    if (existing) {
      return existing;
    }

    const created = { date, appointments: [], sales: [], salesTotal: 0 };
    groups.set(date, created);
    return created;
  };

  for (const appointment of appointments) {
    ensureGroup(dayKey(appointment["startsAt"])).appointments.push(appointment);
  }

  for (const sale of sales) {
    const group = ensureGroup(dayKey(sale["soldAt"]));
    group.sales.push(sale);
    if (["paid", "partial"].includes(sale["paymentStatus"])) {
      group.salesTotal += Number(sale["total"] ?? 0);
    }
  }

  return [...groups.values()].sort((left, right) =>
    right.date.localeCompare(left.date),
  );
}
