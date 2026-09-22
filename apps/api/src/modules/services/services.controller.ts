import {
  BadRequestException,
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

function readCollaboratorIds(
  body: Record<string, unknown>,
): string[] | undefined {
  const input = body["collaboratorIds"];

  if (!Array.isArray(input)) {
    return undefined;
  }

  return input
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

@Controller("services")
export class ServicesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly cacheInvalidationService: CacheInvalidationService,
  ) {}

  private async validateCollaboratorIds(
    tenantId: string,
    collaboratorIds?: string[],
  ): Promise<string[] | undefined> {
    if (!collaboratorIds) {
      return undefined;
    }

    if (collaboratorIds.length === 0) {
      return [];
    }

    const existingCollaborators = await this.prisma.collaborator.findMany({
      where: {
        tenantId,
        id: { in: collaboratorIds },
      },
      select: { id: true },
    });

    if (existingCollaborators.length !== collaboratorIds.length) {
      throw new BadRequestException("One or more collaborators are invalid");
    }

    return collaboratorIds;
  }

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
      cacheKeys.servicesList(tenantId),
      CACHE_TTL_SECONDS.lists,
      () =>
        this.prisma.service.findMany({
          where: { tenantId },
          orderBy: [{ isActive: "desc" }, { name: "asc" }],
          include: {
            collaborators: {
              select: { id: true, firstName: true, lastName: true },
            },
            serviceProducts: {
              include: {
                product: true,
              },
            },
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
    const collaboratorIds = await this.validateCollaboratorIds(
      tenantId,
      readCollaboratorIds(body),
    );
    const created = await this.prisma.service.create({
      data: {
        tenantId,
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
        color: typeof body["color"] === "string" ? body["color"] : "#1c7c64",
        isPublic: Boolean(body["isPublic"]),
        isBookableOnline: Boolean(body["isBookableOnline"]),
        requiresCollaborator:
          body["requiresCollaborator"] === undefined
            ? true
            : Boolean(body["requiresCollaborator"]),
        collaborators: collaboratorIds?.length
          ? {
              connect: collaboratorIds.map((id) => ({ id })),
            }
          : undefined,
      },
    });

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
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    const tenantId = requireTenantId(session);
    const collaboratorIds = await this.validateCollaboratorIds(
      tenantId,
      readCollaboratorIds(body),
    );
    const updated = await this.prisma.service.update({
      where: { id },
      data: {
        tenantId,
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
        color: typeof body["color"] === "string" ? body["color"] : undefined,
        isPublic:
          typeof body["isPublic"] === "boolean" ? body["isPublic"] : undefined,
        isBookableOnline:
          typeof body["isBookableOnline"] === "boolean"
            ? body["isBookableOnline"]
            : undefined,
        isActive:
          typeof body["isActive"] === "boolean" ? body["isActive"] : undefined,
        collaborators: collaboratorIds
          ? {
              set: collaboratorIds.map((collaboratorId) => ({
                id: collaboratorId,
              })),
            }
          : undefined,
      },
    });

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
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const updated = await this.prisma.serviceProduct.upsert({
      where: {
        serviceId_productId: {
          serviceId: id,
          productId: String(body["productId"] ?? ""),
        },
      },
      update: {
        mode: typeof body["mode"] === "string" ? body["mode"] : "optional",
        quantity: Number(body["quantity"] ?? 1),
        priceLocked: Boolean(body["priceLocked"]),
      },
      create: {
        serviceId: id,
        productId: String(body["productId"] ?? ""),
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

    await this.prisma.service.delete({ where: { id } });

    await Promise.all([
      this.cacheInvalidationService.invalidateServices(tenantId),
      this.cacheInvalidationService.invalidatePublicServices(tenantId),
      this.cacheInvalidationService.invalidatePublicAvailability(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
    ]);

    return { id, removed: true };
  }
}
