import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { memoryStorage } from "multer";
import { join } from "path";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import { CACHE_TTL_SECONDS, cacheKeys } from "../../cache/cache.constants";
import { AppCacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  requireTenantId,
  resolveRequestSession,
} from "../../common/request-session";

@Controller("tenant")
export class TenantController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly cacheInvalidationService: CacheInvalidationService,
  ) {}

  private saveTenantImage(
    tenantId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer },
    prefix: "logo" | "cover",
  ): string {
    const extension = file.originalname.includes(".")
      ? file.originalname.split(".").pop()
      : file.mimetype.split("/")[1] || "png";
    const directory = join(process.cwd(), "uploads", "tenants", tenantId);
    mkdirSync(directory, { recursive: true });

    const fileName = `${prefix}-${Date.now()}.${extension}`;
    const absolutePath = join(directory, fileName);
    writeFileSync(absolutePath, file.buffer);

    return `/uploads/tenants/${tenantId}/${fileName}`;
  }

  @Get("settings")
  async getSettings(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    const tenantId = requireTenantId(session);

    return this.cacheService.getOrSet(
      cacheKeys.tenantSettings(tenantId),
      CACHE_TTL_SECONDS.tenantSettings,
      () =>
        this.prisma.tenant.findUnique({
          where: { id: tenantId },
          include: {
            collaborators: {
              where: { isActive: true },
              orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
              select: {
                id: true,
                firstName: true,
                lastName: true,
                isPublic: true,
              },
            },
            holidays: {
              orderBy: { date: "asc" },
            },
            stations: {
              where: { isActive: true },
              orderBy: { name: "asc" },
              include: { room: { select: { id: true, name: true } } },
            },
          },
        }),
    );
  }

  @Patch("settings")
  async updateSettings(
    @Req() request: { headers: { authorization?: string } },
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    const tenantId = requireTenantId(session);
    const defaultCollaboratorId =
      typeof body["defaultCollaboratorId"] === "string"
        ? body["defaultCollaboratorId"].trim() || null
        : body["defaultCollaboratorId"] === null
          ? null
          : undefined;

    if (defaultCollaboratorId !== undefined && defaultCollaboratorId !== null) {
      const collaborator = await this.prisma.collaborator.findFirst({
        where: {
          id: defaultCollaboratorId,
          tenantId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!collaborator) {
        return { error: "Invalid default collaborator" };
      }
    }

    let newSlug: string | undefined = undefined;
    if (typeof body["name"] === "string" && body["name"].trim()) {
      const baseSlug =
        body["name"]
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40) || "tenant";

      const existing = await this.prisma.tenant.findFirst({
        where: { slug: baseSlug, id: { not: tenantId } },
      });
      newSlug = existing ? `${baseSlug}-${Date.now()}` : baseSlug;
    }

    const updated = await this.prisma.tenant.update({
      where: { id: requireTenantId(session) },
      data: {
        name: typeof body["name"] === "string" ? body["name"] : undefined,
        slug: newSlug,
        primaryColor:
          typeof body["primaryColor"] === "string"
            ? body["primaryColor"]
            : undefined,
        accentColor:
          typeof body["accentColor"] === "string"
            ? body["accentColor"]
            : undefined,
        publicDomain:
          typeof body["publicDomain"] === "string"
            ? body["publicDomain"].trim().toLowerCase() || null
            : undefined,
        bookingMode:
          typeof body["bookingMode"] === "string"
            ? (body["bookingMode"] as never)
            : undefined,
        publicTitle:
          typeof body["publicTitle"] === "string"
            ? body["publicTitle"]
            : undefined,
        publicDescription:
          typeof body["publicDescription"] === "string"
            ? body["publicDescription"]
            : undefined,
        publicSteps: Array.isArray(body["publicSteps"])
          ? body["publicSteps"].filter(
              (item): item is string => typeof item === "string",
            )
          : undefined,
        defaultCollaboratorId,
        logoUrl:
          typeof body["logoUrl"] === "string"
            ? body["logoUrl"].trim() || null
            : body["logoUrl"] === null
              ? null
              : undefined,
        coverUrl:
          typeof body["coverUrl"] === "string"
            ? body["coverUrl"].trim() || null
            : body["coverUrl"] === null
              ? null
              : undefined,
        publicEnabled:
          typeof body["publicEnabled"] === "boolean"
            ? body["publicEnabled"]
            : undefined,
        timezone:
          typeof body["timezone"] === "string" ? body["timezone"] : undefined,
        currency:
          typeof body["currency"] === "string" ? body["currency"] : undefined,
        language:
          typeof body["language"] === "string" ? body["language"] : undefined,
        holidays: Array.isArray(body["holidays"])
          ? {
              deleteMany: {},
              create: (body["holidays"] as Array<Record<string, unknown>>)
                .filter(
                  (holiday) =>
                    typeof holiday["date"] === "string" &&
                    typeof holiday["name"] === "string",
                )
                .map((holiday) => ({
                  date: new Date(String(holiday["date"])),
                  name: String(holiday["name"]),
                })),
            }
          : undefined,
      },
      include: {
        holidays: { orderBy: { date: "asc" } },
      },
    });

    await this.cacheInvalidationService.invalidateTenantSettings(tenantId);
    await this.cacheInvalidationService.invalidatePublicTenantLookups();

    return updated;
  }

  @Post("logo")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage() }))
  async uploadLogo(
    @Req() request: { headers: { authorization?: string } },
    @UploadedFile()
    file?: {
      originalname: string;
      mimetype: string;
      buffer: Buffer;
    },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    const tenantId = requireTenantId(session);

    if (!file?.buffer || !file.mimetype.startsWith("image/")) {
      throw new BadRequestException("File immagine non valido per il logo");
    }

    const relativeUrl = this.saveTenantImage(tenantId, file, "logo");
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { logoUrl: relativeUrl },
    });

    await this.cacheInvalidationService.invalidateTenantSettings(tenantId);
    await this.cacheInvalidationService.invalidatePublicTenantLookups();

    return updated;
  }

  @Post("cover")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage() }))
  async uploadCover(
    @Req() request: { headers: { authorization?: string } },
    @UploadedFile()
    file?: {
      originalname: string;
      mimetype: string;
      buffer: Buffer;
    },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    const tenantId = requireTenantId(session);

    if (!file?.buffer || !file.mimetype.startsWith("image/")) {
      throw new BadRequestException("File immagine non valido per la cover");
    }

    const relativeUrl = this.saveTenantImage(tenantId, file, "cover");
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { coverUrl: relativeUrl },
    });

    await this.cacheInvalidationService.invalidateTenantSettings(tenantId);
    await this.cacheInvalidationService.invalidatePublicTenantLookups();

    return updated;
  }

  @Delete("logo")
  async deleteLogo(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    const tenantId = requireTenantId(session);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { logoUrl: true },
    });

    if (tenant?.logoUrl && !tenant.logoUrl.startsWith("http")) {
      const absolutePath = join(process.cwd(), tenant.logoUrl);
      if (existsSync(absolutePath)) {
        rmSync(absolutePath, { force: true });
      }
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { logoUrl: null },
    });

    await this.cacheInvalidationService.invalidateTenantSettings(tenantId);
    await this.cacheInvalidationService.invalidatePublicTenantLookups();

    return updated;
  }

  @Delete("cover")
  async deleteCover(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    const tenantId = requireTenantId(session);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { coverUrl: true },
    });

    if (tenant?.coverUrl && !tenant.coverUrl.startsWith("http")) {
      const absolutePath = join(process.cwd(), tenant.coverUrl);
      if (existsSync(absolutePath)) {
        rmSync(absolutePath, { force: true });
      }
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { coverUrl: null },
    });

    await this.cacheInvalidationService.invalidateTenantSettings(tenantId);
    await this.cacheInvalidationService.invalidatePublicTenantLookups();

    return updated;
  }
}
