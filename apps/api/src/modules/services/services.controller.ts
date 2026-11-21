import { decimalInput } from "../pricing/money";
import { canUseLocalFunction } from "../../common/function-catalog";
import { PricingService } from "../pricing/pricing.service";
import {
  resolveOperationalScope,
  sectorFilter,
  requireSector,
} from "../locations/operational-scope";
import { LegacyWriteDto } from "../../common/legacy-write.dto";
import { assertTenantReferences } from "../../common/tenant-references";
import {
  BadRequestException,
  ForbiddenException,
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
  requireUser,
} from "../../common/request-session";
import { buildPaginatedResult, parsePagination } from "../../common/pagination";

@Controller("services")
export class ServicesController {
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
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const { page, pageSize, skip, take } = parsePagination(query, {
      defaultPageSize: 50,
    });

    return this.cacheService.getOrSet(
      `${cacheKeys.servicesList(tenantId)}:p${page}:s${pageSize}`,
      CACHE_TTL_SECONDS.lists,
      async () => {
        const [items, total] = await Promise.all([
          this.prisma.service.findMany({
            where: { tenantId, ...sectorFilter(scope) },
            orderBy: [{ isActive: "desc" }, { name: "asc" }],
            skip,
            take,
            include: {
              sector: { include: { location: true } },
              serviceProducts: {
                include: {
                  product: {
                    select: {
                      id: true,
                      name: true,
                      price: true,
                      priceMode: true,
                      vatRate: true,
                      isActive: true,
                    },
                  },
                },
              },
            },
          }),
          this.prisma.service.count({
            where: { tenantId, ...sectorFilter(scope) },
          }),
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
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    return this.pricing.serviceHistory(
      tenantId,
      id,
      scope.sectorIds,
      Number(page),
    );
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

    const tenantId = requireTenantId(session);
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const sector = await requireSector(this.prisma, scope, body["sectorId"]);
    const created = await this.pricing.write(
      tenantId,
      requireUser(session).id,
      body["priceChangeReason"],
      (tx) =>
        tx.service.create({
          data: {
            tenantId,
            sectorId: sector.id,
            name: String(body["name"] ?? ""),
            publicDescription:
              typeof body["publicDescription"] === "string"
                ? body["publicDescription"]
                : undefined,
            internalDescription:
              typeof body["internalDescription"] === "string"
                ? body["internalDescription"]
                : undefined,
            durationMinutes: Number(body["durationMinutes"] ?? 30),
            basePrice: Number(body["basePrice"] ?? 0),
            color:
              typeof body["color"] === "string" ? body["color"] : "#1c7c64",
            isPublic: Boolean(body["isPublic"]),
            isBookableOnline: Boolean(body["isBookableOnline"]),
            isActive:
              typeof body["isActive"] === "boolean"
                ? body["isActive"]
                : undefined,
            requiresRoom: body["requiresRoom"] === true,
            requiresCollaborator:
              body["requiresCollaborator"] === undefined
                ? true
                : Boolean(body["requiresCollaborator"]),
            ...this.pricing.data(body, undefined, true),
          },
        }),
    );

    await Promise.all([
      this.cacheInvalidationService.invalidateServices(tenantId),
      this.cacheInvalidationService.invalidatePublicServices(tenantId),
      this.cacheInvalidationService.invalidatePublicAvailability(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
    ]);

    return created;
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

    const tenantId = requireTenantId(session);
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const current = await this.prisma.service.findFirst({
      where: { id, tenantId, ...sectorFilter(scope) },
    });
    if (!current) throw new BadRequestException("Servizio non disponibile");
    const sector = await requireSector(
      this.prisma,
      scope,
      body["sectorId"] || current.sectorId,
      false,
    );
    const updated = await this.pricing.write(
      tenantId,
      requireUser(session).id,
      body["priceChangeReason"],
      async (tx) => {
        const previous = await tx.service.findFirst({
          where: { id, tenantId },
        });
        if (!previous) throw new BadRequestException("Articolo non trovato");
        return tx.service.update({
          where: { id, tenantId },
          data: {
            sectorId: sector.id,
            name: typeof body["name"] === "string" ? body["name"] : undefined,
            publicDescription:
              typeof body["publicDescription"] === "string"
                ? body["publicDescription"]
                : undefined,
            internalDescription:
              typeof body["internalDescription"] === "string"
                ? body["internalDescription"]
                : undefined,
            durationMinutes:
              body["durationMinutes"] === undefined
                ? undefined
                : Number(body["durationMinutes"]),
            basePrice:
              body["basePrice"] === undefined
                ? undefined
                : Number(body["basePrice"]),
            color:
              typeof body["color"] === "string" ? body["color"] : undefined,
            isPublic:
              typeof body["isPublic"] === "boolean"
                ? body["isPublic"]
                : undefined,
            isBookableOnline:
              typeof body["isBookableOnline"] === "boolean"
                ? body["isBookableOnline"]
                : undefined,
            requiresRoom:
              typeof body["requiresRoom"] === "boolean"
                ? body["requiresRoom"]
                : undefined,
            requiresCollaborator:
              typeof body["requiresCollaborator"] === "boolean"
                ? body["requiresCollaborator"]
                : undefined,
            isActive:
              typeof body["isActive"] === "boolean"
                ? body["isActive"]
                : undefined,
            ...this.pricing.data(body, previous, true),
          },
        });
      },
    );

    await Promise.all([
      this.cacheInvalidationService.invalidateServices(tenantId),
      this.cacheInvalidationService.invalidatePublicServices(tenantId),
      this.cacheInvalidationService.invalidatePublicAvailability(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
    ]);

    return updated;
  }

  @Post(":id/products")
  async attachProduct(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: LegacyWriteDto,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    if (
      body["consumptionUnits"] !== undefined &&
      !canUseLocalFunction(requireUser(session), "inventory.manage")
    )
      throw new ForbiddenException(
        "Serve la gestione magazzino per configurare i consumi",
      );
    let consumptionUnits: string | null | undefined;
    if (body["consumptionUnits"] !== undefined) {
      try {
        consumptionUnits =
          body["consumptionUnits"] === null || body["consumptionUnits"] === ""
            ? null
            : decimalInput(
                body["consumptionUnits"],
                "Consumo fisico",
                3,
              ).toFixed(3);
        if (consumptionUnits !== null && Number(consumptionUnits) <= 0)
          throw Error("Il consumo deve essere positivo");
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : "Consumo non valido",
        );
      }
    }
    const tenantId = requireTenantId(session);
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    await assertTenantReferences(this.prisma, tenantId, {
      serviceId: id,
      sectorIds: scope.sectorIds,
      productId: String(body["productId"] ?? ""),
    });
    const updated = await this.prisma.serviceProduct.upsert({
      where: {
        serviceId_productId: {
          serviceId: id,
          productId: String(body["productId"] ?? ""),
        },
      },
      update: {
        consumptionUnits,
        mode: typeof body["mode"] === "string" ? body["mode"] : undefined,
        quantity:
          body["quantity"] === undefined ? undefined : Number(body["quantity"]),
        priceLocked:
          typeof body["priceLocked"] === "boolean"
            ? body["priceLocked"]
            : undefined,
      },
      create: {
        serviceId: id,
        productId: String(body["productId"] ?? ""),
        consumptionUnits,
        mode: typeof body["mode"] === "string" ? body["mode"] : "optional",
        quantity: Number(body["quantity"] ?? 1),
        priceLocked: Boolean(body["priceLocked"]),
      },
    });

    await Promise.all([
      this.cacheInvalidationService.invalidateServices(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
    ]);

    return updated;
  }

  @Delete(":id/products/:productId")
  async detachProduct(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Param("productId") productId: string,
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
    await assertTenantReferences(this.prisma, tenantId, {
      serviceId: id,
      sectorIds: scope.sectorIds,
      productId: productId,
    });

    await this.prisma.serviceProduct.delete({
      where: {
        serviceId_productId: {
          serviceId: id,
          productId,
        },
      },
    });

    await Promise.all([
      this.cacheInvalidationService.invalidateServices(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
    ]);

    return { serviceId: id, productId, removed: true };
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
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );

    await this.prisma.service.update({
      where: { id, tenantId, ...sectorFilter(scope) },
      data: { isActive: false },
    });

    await Promise.all([
      this.cacheInvalidationService.invalidateServices(tenantId),
      this.cacheInvalidationService.invalidatePublicServices(tenantId),
      this.cacheInvalidationService.invalidatePublicAvailability(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
    ]);

    return { id, removed: true };
  }
}
