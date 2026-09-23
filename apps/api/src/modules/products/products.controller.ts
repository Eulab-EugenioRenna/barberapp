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

@Controller("products")
export class ProductsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly cacheInvalidationService: CacheInvalidationService,
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
    const { page, pageSize, skip, take } = parsePagination(query, {
      defaultPageSize: 50,
    });

    return this.cacheService.getOrSet(
      `${cacheKeys.productsList(tenantId)}:p${page}:s${pageSize}`,
      CACHE_TTL_SECONDS.lists,
      async () => {
        const [items, total] = await Promise.all([
          this.prisma.product.findMany({
            where: { tenantId },
            orderBy: [{ isActive: "desc" }, { name: "asc" }],
            skip,
            take,
            include: { saleItems: true, serviceProducts: true },
          }),
          this.prisma.product.count({ where: { tenantId } }),
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
    const created = await this.prisma.product.create({
      data: {
        tenantId,
        name: String(body["name"] ?? ""),
        description:
          typeof body["description"] === "string"
            ? body["description"]
            : undefined,
        imageUrl:
          typeof body["imageUrl"] === "string" ? body["imageUrl"] : undefined,
        sku: typeof body["sku"] === "string" ? body["sku"] : undefined,
        category:
          typeof body["category"] === "string" ? body["category"] : undefined,
        price:
          body["price"] === undefined ||
          body["price"] === null ||
          body["price"] === ""
            ? null
            : Number(body["price"]),
      },
    });

    await Promise.all([
      this.cacheInvalidationService.invalidateProducts(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
    ]);

    return created;
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
    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        tenantId,
        name: typeof body["name"] === "string" ? body["name"] : undefined,
        description:
          typeof body["description"] === "string"
            ? body["description"]
            : undefined,
        imageUrl:
          typeof body["imageUrl"] === "string" ? body["imageUrl"] : undefined,
        sku: typeof body["sku"] === "string" ? body["sku"] : undefined,
        category:
          typeof body["category"] === "string" ? body["category"] : undefined,
        price:
          body["price"] === undefined
            ? undefined
            : body["price"] === null || body["price"] === ""
              ? null
              : Number(body["price"]),
        isActive:
          typeof body["isActive"] === "boolean" ? body["isActive"] : undefined,
      },
    });

    await Promise.all([
      this.cacheInvalidationService.invalidateProducts(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
    ]);

    return updated;
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

    await this.prisma.product.delete({ where: { id } });

    await Promise.all([
      this.cacheInvalidationService.invalidateProducts(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
    ]);

    return { id, removed: true };
  }
}
