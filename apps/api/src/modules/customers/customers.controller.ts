import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    const tenantId = requireTenantId(session);

    await this.customersAlignmentService.ensureDailyAlignmentQueued(tenantId);

    return this.cacheService.getOrSet(
      cacheKeys.customersList(tenantId),
      CACHE_TTL_SECONDS.lists,
      () =>
        this.prisma.customer.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
        }),
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
        const [appointments, sales] = await Promise.all([
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
                  stations: { include: { station: true } },
                },
              },
            },
          }),
        ]);

        return {
          customerId: id,
          appointments,
          sales,
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

    await this.cacheInvalidationService.invalidateCustomers(tenantId);

    return { id, removed: true };
  }
}
