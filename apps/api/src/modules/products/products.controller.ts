import { canUseLocalFunction } from "../../common/function-catalog";
import { PricingService } from "../pricing/pricing.service";
import { LegacyWriteDto } from "../../common/legacy-write.dto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
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
import { Prisma } from "@prisma/client";
import {
  requireTenantId,
  resolveRequestSession,
  requireUser,
} from "../../common/request-session";
import { buildPaginatedResult, parsePagination } from "../../common/pagination";
import { normalizeBarcode } from "../../common/barcode-validation";
import { resolveProductActivity } from "../locations/activity-sectors";

@Controller("products")
export class ProductsController {
  constructor(
    private readonly pricing: PricingService,
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
      `${cacheKeys.productsList(tenantId)}:activity-v1:p${page}:s${pageSize}`,
      CACHE_TTL_SECONDS.lists,
      async () => {
        const [items, total] = await Promise.all([
          this.prisma.product.findMany({
            where: { tenantId },
            orderBy: [{ isActive: "desc" }, { name: "asc" }],
            skip,
            take,
            include: { activity: { select: { id: true, name: true } } },
          }),
          this.prisma.product.count({ where: { tenantId } }),
        ]);

        return buildPaginatedResult(items, total, page, pageSize);
      },
    );
  }

  @Get(":id/prices")
  async priceHistory(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Query("page") page = "1",
  ) {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    return this.pricing.productHistory(tenantId, id, Number(page));
  }

  @Post()
  async create(
    @Req() request: { headers: { authorization?: string } },
    @Body() body: LegacyWriteDto,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    if (
      body["stockTracked"] !== undefined &&
      !canUseLocalFunction(requireUser(session), "inventory.manage")
    )
      throw new ForbiddenException(
        "Serve la gestione magazzino per configurare il tracciamento",
      );
    const tenantId = requireTenantId(session);
    // Default «Rivendita» (database) when no activity is chosen.
    const activityId = await resolveProductActivity(this.prisma, tenantId, body["activityId"]);
    let created;
    try {
      created = await this.pricing.write(
        tenantId,
        requireUser(session).id,
        body["priceChangeReason"],
        (tx) =>
          tx.product.create({
            data: {
              tenantId,
              ...(activityId ? { activityId } : {}),
              isActive:
                typeof body["isActive"] === "boolean"
                  ? body["isActive"]
                  : undefined,
              name: String(body["name"] ?? ""),
              description:
                typeof body["description"] === "string"
                  ? body["description"]
                  : undefined,
              imageUrl:
                typeof body["imageUrl"] === "string"
                  ? body["imageUrl"]
                  : undefined,
              sku: typeof body["sku"] === "string" ? body["sku"] : undefined,
              barcode: normalizeWriteBarcode(body["barcode"]),
              category:
                typeof body["category"] === "string"
                  ? body["category"]
                  : undefined,
              price:
                body["price"] === undefined || body["price"] === null
                  ? null
                  : Number(body["price"]),
              ...this.pricing.data(body, undefined, false),
            },
          }),
      );
    } catch (error) {
      if (isBarcodeDuplicate(error)) {
        throw new ConflictException(
          "Barcode già assegnato a un altro prodotto di questa attività",
        );
      }
      throw error;
    }

    await Promise.all([
      this.cacheInvalidationService.invalidateProducts(tenantId),
      this.cacheInvalidationService.invalidatePublicServices(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
    ]);

    return created;
  }

  @Get("by-barcode")
  async byBarcode(
    @Req() request: { headers: { authorization?: string } },
    @Query() query: { barcode?: string },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const barcode = normalizeBarcode(query.barcode);
    if (!barcode) throw new BadRequestException("Barcode mancante");

    const product = await this.prisma.product.findFirst({
      where: { tenantId, barcode },
    });
    if (!product)
      throw new NotFoundException(
        "Prodotto non trovato per questo barcode",
      );

    return product;
  }

  @Patch(":id")
  async update(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: LegacyWriteDto,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    if (
      body["stockTracked"] !== undefined &&
      !canUseLocalFunction(requireUser(session), "inventory.manage")
    )
      throw new ForbiddenException(
        "Serve la gestione magazzino per configurare il tracciamento",
      );
    const tenantId = requireTenantId(session);
    const activityId = await resolveProductActivity(this.prisma, tenantId, body["activityId"]);
    let updated;
    try {
      updated = await this.pricing.write(
        tenantId,
        requireUser(session).id,
        body["priceChangeReason"],
        async (tx) => {
          const previous = await tx.product.findFirst({
            where: { id, tenantId },
          });
          if (!previous) throw new BadRequestException("Articolo non trovato");
          return tx.product.update({
            where: { id, tenantId },
            data: {
              ...(activityId ? { activityId } : {}),
              name: typeof body["name"] === "string" ? body["name"] : undefined,
              description:
                typeof body["description"] === "string"
                  ? body["description"]
                  : undefined,
              imageUrl:
                typeof body["imageUrl"] === "string"
                  ? body["imageUrl"]
                  : undefined,
              sku: typeof body["sku"] === "string" ? body["sku"] : undefined,
              barcode: normalizeWriteBarcode(body["barcode"]),
              category:
                typeof body["category"] === "string"
                  ? body["category"]
                  : undefined,
              price:
                body["price"] === undefined
                  ? undefined
                  : body["price"] === null
                    ? null
                    : Number(body["price"]),
              isActive:
                typeof body["isActive"] === "boolean"
                  ? body["isActive"]
                  : undefined,
              ...this.pricing.data(body, previous, false),
            },
          });
        },
      );
    } catch (error) {
      if (isBarcodeDuplicate(error)) {
        throw new ConflictException(
          "Barcode già assegnato a un altro prodotto di questa attività",
        );
      }
      throw error;
    }

    await Promise.all([
      this.cacheInvalidationService.invalidateProducts(tenantId),
      this.cacheInvalidationService.invalidatePublicServices(tenantId),
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

    await this.prisma.product.update({
      where: { id, tenantId },
      data: { isActive: false },
    });

    await Promise.all([
      this.cacheInvalidationService.invalidateProducts(tenantId),
      this.cacheInvalidationService.invalidatePublicServices(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
    ]);

    return { id, removed: true };
  }
}

function isBarcodeDuplicate(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return (
    error.code === "P2002" &&
    String((error.meta as { target?: unknown } | undefined)?.["target"] ?? "")
      .includes("barcode")
  );
}

function normalizeWriteBarcode(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return normalizeBarcode(value) || null;
}
