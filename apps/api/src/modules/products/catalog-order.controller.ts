import { Body, Controller, Post, Req } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import {
  requireTenantId,
  resolveRequestSession,
} from "../../common/request-session";
import { PrismaService } from "../../prisma/prisma.service";

export class CatalogOrderItemDto {
  @IsIn(["service", "product"]) kind!: "service" | "product";
  @IsString() @MaxLength(100) id!: string;
}

export class CatalogOrderDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => CatalogOrderItemDto)
  items!: CatalogOrderItemDto[];
}

/** Order of the till grid: services and products share one sequence. */
@Controller("catalog-order")
export class CatalogOrderController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheInvalidationService,
  ) {}

  @Post()
  async save(
    @Req() request: { headers: { authorization?: string } },
    @Body() body: CatalogOrderDto,
  ): Promise<{ saved: number }> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    // Each row is updated only inside this account; unknown ids change nothing.
    const writes = body.items.map((item, sortOrder) =>
      item.kind === "service"
        ? this.prisma.service.updateMany({
            where: { id: item.id, tenantId },
            data: { sortOrder },
          })
        : this.prisma.product.updateMany({
            where: { id: item.id, tenantId },
            data: { sortOrder },
          }),
    );
    const results = await this.prisma.$transaction(writes);
    await Promise.all([
      this.cache.invalidateServices(tenantId),
      this.cache.invalidateProducts(tenantId),
    ]);
    return { saved: results.reduce((sum, row) => sum + row.count, 0) };
  }
}
