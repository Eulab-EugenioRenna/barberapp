import {
  BadRequestException,
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

@Controller("collaborators")
export class CollaboratorsController {
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
      `${cacheKeys.collaboratorsList(tenantId)}:p${page}:s${pageSize}`,
      CACHE_TTL_SECONDS.lists,
      async () => {
        const [items, total] = await Promise.all([
          this.prisma.collaborator.findMany({
            where: { tenantId },
            orderBy: [{ isActive: "desc" }, { firstName: "asc" }],
            skip,
            take,
            include: {
              weeklySchedules: {
                orderBy: { weekday: "asc" },
              },
              dayOverrides: {
                orderBy: { date: "asc" },
              },
            },
          }),
          this.prisma.collaborator.count({ where: { tenantId } }),
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
    const weeklySchedules = Array.isArray(body["weeklySchedules"])
      ? (body["weeklySchedules"] as Array<Record<string, unknown>>)
      : [];
    const dayOverrides = Array.isArray(body["dayOverrides"])
      ? (body["dayOverrides"] as Array<Record<string, unknown>>)
      : [];

    const created = await this.prisma.collaborator.create({
      data: {
        tenantId,
        firstName: String(body["firstName"] ?? ""),
        lastName: String(body["lastName"] ?? ""),
        email: typeof body["email"] === "string" ? body["email"] : undefined,
        phone: typeof body["phone"] === "string" ? body["phone"] : undefined,
        calendarColor:
          typeof body["calendarColor"] === "string"
            ? body["calendarColor"]
            : "#1c7c64",
        isPublic: Boolean(body["isPublic"]),
        weeklySchedules: weeklySchedules.length
          ? {
              create: weeklySchedules.map((schedule) => ({
                weekday: Number(schedule["weekday"]),
                isWorkingDay: Boolean(schedule["isWorkingDay"]),
                startTime:
                  typeof schedule["startTime"] === "string"
                    ? schedule["startTime"]
                    : null,
                endTime:
                  typeof schedule["endTime"] === "string"
                    ? schedule["endTime"]
                    : null,
              })),
            }
          : undefined,
        dayOverrides: dayOverrides.length
          ? {
              create: dayOverrides.map((override) => ({
                date: new Date(String(override["date"])),
                isWorkingDay: Boolean(override["isWorkingDay"]),
                startTime:
                  typeof override["startTime"] === "string"
                    ? override["startTime"]
                    : null,
                endTime:
                  typeof override["endTime"] === "string"
                    ? override["endTime"]
                    : null,
                note:
                  typeof override["note"] === "string"
                    ? override["note"]
                    : null,
                isHoliday: Boolean(override["isHoliday"]),
              })),
            }
          : undefined,
      },
      include: {
        weeklySchedules: { orderBy: { weekday: "asc" } },
        dayOverrides: { orderBy: { date: "asc" } },
      },
    });

    await Promise.all([
      this.cacheInvalidationService.invalidateCollaborators(tenantId),
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
    const weeklySchedules = Array.isArray(body["weeklySchedules"])
      ? (body["weeklySchedules"] as Array<Record<string, unknown>>)
      : null;
    const dayOverrides = Array.isArray(body["dayOverrides"])
      ? (body["dayOverrides"] as Array<Record<string, unknown>>)
      : null;

    const updated = await this.prisma.collaborator.update({
      where: { id },
      data: {
        tenantId,
        firstName:
          typeof body["firstName"] === "string" ? body["firstName"] : undefined,
        lastName:
          typeof body["lastName"] === "string" ? body["lastName"] : undefined,
        email: typeof body["email"] === "string" ? body["email"] : undefined,
        phone: typeof body["phone"] === "string" ? body["phone"] : undefined,
        calendarColor:
          typeof body["calendarColor"] === "string"
            ? body["calendarColor"]
            : undefined,
        isPublic:
          typeof body["isPublic"] === "boolean" ? body["isPublic"] : undefined,
        isActive:
          typeof body["isActive"] === "boolean" ? body["isActive"] : undefined,
        weeklySchedules:
          weeklySchedules === null
            ? undefined
            : {
                deleteMany: {},
                create: weeklySchedules.map((schedule) => ({
                  weekday: Number(schedule["weekday"]),
                  isWorkingDay: Boolean(schedule["isWorkingDay"]),
                  startTime:
                    typeof schedule["startTime"] === "string"
                      ? schedule["startTime"]
                      : null,
                  endTime:
                    typeof schedule["endTime"] === "string"
                      ? schedule["endTime"]
                      : null,
                })),
              },
        dayOverrides:
          dayOverrides === null
            ? undefined
            : {
                deleteMany: {},
                create: dayOverrides.map((override) => ({
                  date: new Date(String(override["date"])),
                  isWorkingDay: Boolean(override["isWorkingDay"]),
                  startTime:
                    typeof override["startTime"] === "string"
                      ? override["startTime"]
                      : null,
                  endTime:
                    typeof override["endTime"] === "string"
                      ? override["endTime"]
                      : null,
                  note:
                    typeof override["note"] === "string"
                      ? override["note"]
                      : null,
                  isHoliday: Boolean(override["isHoliday"]),
                })),
              },
      },
      include: {
        weeklySchedules: { orderBy: { weekday: "asc" } },
        dayOverrides: { orderBy: { date: "asc" } },
      },
    });

    await Promise.all([
      this.cacheInvalidationService.invalidateCollaborators(tenantId),
      this.cacheInvalidationService.invalidatePublicServices(tenantId),
      this.cacheInvalidationService.invalidatePublicAvailability(tenantId),
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

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { defaultCollaboratorId: true },
    });

    if (tenant?.defaultCollaboratorId === id) {
      throw new BadRequestException(
        "Questo è il professionista di riferimento. Scegline un altro prima di eliminarlo.",
      );
    }

    await this.prisma.collaborator.delete({ where: { id } });

    await Promise.all([
      this.cacheInvalidationService.invalidateCollaborators(tenantId),
      this.cacheInvalidationService.invalidatePublicServices(tenantId),
      this.cacheInvalidationService.invalidatePublicAvailability(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
    ]);

    return { id, removed: true };
  }
}
