import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import { CACHE_TTL_SECONDS, cacheKeys } from "../../cache/cache.constants";
import { AppCacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  requireTenantId,
  requireUser,
  resolveRequestSession,
} from "../../common/request-session";
import { CustomersAlignmentService } from "../customers/customers-alignment.service";

@Controller("sales")
export class SalesController {
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

    return this.cacheService.getOrSet(
      cacheKeys.salesList(tenantId),
      CACHE_TTL_SECONDS.lists,
      () =>
        this.prisma.sale.findMany({
          where: { tenantId },
          orderBy: { soldAt: "desc" },
          include: {
            items: { include: { product: true } },
            customer: true,
            collaborator: true,
            appointment: true,
          },
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
    const user = requireUser(session);
    const itemsInput = Array.isArray(body["items"])
      ? (body["items"] as Array<Record<string, unknown>>)
      : [];

    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        id: { in: itemsInput.map((item) => String(item["productId"] ?? "")) },
      },
    });

    const normalizedItems = itemsInput
      .map((item) => {
        const productId = String(item["productId"] ?? "");
        const product = products.find((entry) => entry.id === productId);

        if (!product) {
          return null;
        }

        const quantity = Number(item["quantity"] ?? 1);
        const unitPrice = Number(item["unitPrice"] ?? product.price);
        const discount = Number(item["discount"] ?? 0);
        const lineTotal = quantity * unitPrice - discount;

        return {
          productId,
          quantity,
          unitPrice,
          discount,
          taxTotal: Number(item["taxTotal"] ?? 0),
          lineTotal,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const subtotal = normalizedItems.reduce(
      (total, item) => total + item.quantity * item.unitPrice,
      0,
    );
    const discountTotal = normalizedItems.reduce(
      (total, item) => total + item.discount,
      0,
    );
    const taxTotal = normalizedItems.reduce(
      (total, item) => total + item.taxTotal,
      0,
    );
    const total = normalizedItems.reduce(
      (sum, item) => sum + item.lineTotal + item.taxTotal,
      0,
    );

    const created = await this.prisma.sale.create({
      data: {
        tenantId,
        customerId:
          typeof body["customerId"] === "string"
            ? body["customerId"]
            : undefined,
        collaboratorId:
          typeof body["collaboratorId"] === "string"
            ? body["collaboratorId"]
            : undefined,
        appointmentId:
          typeof body["appointmentId"] === "string"
            ? body["appointmentId"]
            : undefined,
        subtotal,
        discountTotal,
        taxTotal,
        total,
        paymentStatus:
          typeof body["paymentStatus"] === "string"
            ? (body["paymentStatus"] as never)
            : "paid",
        paymentMethod:
          typeof body["paymentMethod"] === "string"
            ? body["paymentMethod"]
            : undefined,
        soldAt: body["soldAt"] ? new Date(String(body["soldAt"])) : new Date(),
        createdById: user.id,
        items: {
          create: normalizedItems,
        },
      },
      include: {
        items: { include: { product: true } },
        customer: true,
        collaborator: true,
        appointment: true,
      },
    });

    await Promise.all([
      this.cacheInvalidationService.invalidateSales(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
      this.cacheInvalidationService.invalidateCustomers(tenantId),
      ...(created.customerId
        ? [
            this.customersAlignmentService.queueCustomerRefresh(
              tenantId,
              created.customerId,
              "sale_created",
            ),
          ]
        : []),
    ]);

    return created;
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
      cacheKeys.saleDetail(tenantId, id),
      CACHE_TTL_SECONDS.lists,
      () =>
        this.prisma.sale.findFirst({
          where: { id, tenantId },
          include: {
            items: { include: { product: true } },
            customer: true,
            collaborator: true,
            appointment: true,
          },
        }),
    );
  }
}
