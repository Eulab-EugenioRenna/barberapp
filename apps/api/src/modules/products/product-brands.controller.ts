import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Req } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import { requireTenantId, resolveRequestSession } from "../../common/request-session";
import { PrismaService } from "../../prisma/prisma.service";

export class ProductBrandDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value))
  @IsString()
  @MinLength(1, { message: "Scrivi il nome del brand" })
  @MaxLength(80)
  name!: string;
}

type Request = { headers: { authorization?: string } };

/** Brands group products: one list per account, shared by catalogue and Panoramica. */
@Controller("product-brands")
export class ProductBrandsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheInvalidationService,
  ) {}

  @Get()
  async list(@Req() request: Request) {
    const tenantId = await this.tenant(request);
    const rows = await this.prisma.productBrand.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { products: true } } },
    });
    return rows.map(({ _count, ...row }) => ({ ...row, products: _count.products }));
  }

  @Post()
  async create(@Req() request: Request, @Body() body: ProductBrandDto) {
    const tenantId = await this.tenant(request);
    const existing = await this.prisma.productBrand.findFirst({
      where: { tenantId, name: { equals: body.name, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    // Creating a brand that exists returns it: two people typing «Davines» get one brand.
    if (existing) return { ...existing, products: 0 };
    const created = await this.prisma.productBrand.create({
      data: { tenantId, name: body.name },
      select: { id: true, name: true },
    });
    return { ...created, products: 0 };
  }

  @Patch(":id")
  async rename(@Req() request: Request, @Param("id") id: string, @Body() body: ProductBrandDto) {
    const tenantId = await this.tenant(request);
    await this.owned(tenantId, id);
    try {
      const updated = await this.prisma.productBrand.update({ where: { id }, data: { name: body.name }, select: { id: true, name: true } });
      await this.invalidate(tenantId);
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new ConflictException("Esiste già un brand con questo nome");
      throw error;
    }
  }

  /** Products keep existing, without a brand. */
  @Delete(":id")
  async remove(@Req() request: Request, @Param("id") id: string) {
    const tenantId = await this.tenant(request);
    await this.owned(tenantId, id);
    await this.prisma.productBrand.delete({ where: { id } });
    await this.invalidate(tenantId);
    return { id, removed: true };
  }

  private async tenant(request: Request) {
    return requireTenantId(await resolveRequestSession(this.prisma, request.headers.authorization));
  }
  private async owned(tenantId: string, id: string) {
    const brand = await this.prisma.productBrand.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!brand) throw new NotFoundException("Brand non trovato");
  }
  private invalidate(tenantId: string) {
    return Promise.all([this.cache.invalidateProducts(tenantId), this.cache.invalidateDashboard(tenantId)]);
  }
}
