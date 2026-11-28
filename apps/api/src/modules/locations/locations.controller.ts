import { FinancialReportService } from "../dashboard/financial-report.service";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  requireTenantId,
  requireUser,
  resolveRequestSession,
} from "../../common/request-session";
import { canUseLocalFunction } from "../../common/function-catalog";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import {
  collaboratorFilter,
  requireSector,
  resolveOperationalScope,
  ScopeHeaders,
} from "./operational-scope";
import { validateClosures, validateHours } from "./operational-hours";
type Request = { headers: ScopeHeaders };
function name(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120)
    throw new BadRequestException("Inserisci un nome entro 120 caratteri");
  return value.trim();
}
function roomCapacity(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 100
  )
    throw new BadRequestException(
      "La capienza deve essere un intero fra 1 e 100",
    );
  return value;
}
/**
 * Settings of a new sector. With an existing activity the name comes from the
 * activity: the key is dropped, not set to undefined (settings() would still
 * validate it as a name and refuse every «add activity» request).
 */
export function sectorSettingsFor(body: Record<string, unknown>, existingActivity: boolean) {
  const { name: _bodyName, ...withoutName } = body;
  const { name: _sectorName, ...rest } = settings(existingActivity ? withoutName : body);
  return rest;
}
function settings(body: Record<string, unknown>) {
  const result: {
    name?: string;
    isActive?: boolean;
    isPublic?: boolean;
    weeklyHours?: Prisma.InputJsonValue | typeof Prisma.DbNull;
    closures?: Prisma.InputJsonValue;
  } = {};
  if ("name" in body) result.name = name(body["name"]);
  for (const key of ["isActive", "isPublic"] as const)
    if (key in body) {
      if (typeof body[key] !== "boolean")
        throw new BadRequestException("Stato non valido");
      result[key] = body[key];
    }
  if ("weeklyHours" in body)
    result.weeklyHours =
      (validateHours(
        body["weeklyHours"],
      ) as unknown as Prisma.InputJsonValue) || Prisma.DbNull;
  if ("closures" in body) result.closures = validateClosures(body["closures"]);
  return result;
}
@Controller("locations")
export class LocationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invalidation: CacheInvalidationService,
    private readonly financialReport: FinancialReportService,
  ) {}
  private async contextFor(request: Request) {
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
    return { session, tenantId, scope };
  }
  private async invalidate(tenantId: string) {
    await Promise.all([
      this.invalidation.invalidateTenantSettings(tenantId),
      this.invalidation.invalidateServices(tenantId),
      this.invalidation.invalidateCollaborators(tenantId),
      this.invalidation.invalidatePublicServices(tenantId),
      this.invalidation.invalidateBookingReadModels(tenantId),
    ]);
  }
  // Selectors need no administrative capability and expose only granted scopes.
  @Get("context")
  async context(@Req() request: Request) {
    const { scope, tenantId } = await this.contextFor(request);
    return this.prisma.location.findMany({
      where: { tenantId, id: { in: scope.locationIds } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        address: true,
        isActive: true,
        sectors: {
          where: { id: { in: scope.sectorIds } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, isActive: true, activityId: true },
        },
      },
    });
  }
  @Get()
  async list(@Req() request: Request) {
    const { scope, tenantId } = await this.contextFor(request);
    return this.prisma.location.findMany({
      where: { tenantId, id: { in: scope.locationIds } },
      orderBy: { name: "asc" },
      include: {
        sectors: {
          where: { id: { in: scope.sectorIds } },
          orderBy: { name: "asc" },
          include: {
            collaborators: {
              include: {
                collaborator: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    isActive: true,
                  },
                },
              },
            },
            rooms: true,
          },
        },
      },
    });
  }
  @Get("totals")
  async totals(@Req() request: Request) {
    const { scope, tenantId } = await this.contextFor(request);
    const report = await this.financialReport.read(
      scope,
      { period: "all" },
      true,
    );
    const sectors = await this.prisma.sector.findMany({
      where: { tenantId, id: { in: scope.sectorIds } },
      select: { id: true, name: true, locationId: true },
    });
    const lines = sectors.map((sector) => {
      const row = report.bySector.find((row) => row.id === sector.id);
      return {
        ...sector,
        registeredLineTotal: row?.revenue || "0.00",
      };
    });
    return {
      basis: "confirmed-account-lines-gross-all-time",
      sectors: lines,
      registeredLineTotal: lines
        .reduce(
          (sum, row) => sum.plus(row.registeredLineTotal),
          new Prisma.Decimal(0),
        )
        .toFixed(2),
    };
  }
  @Post()
  async create(@Req() request: Request, @Body() body: Record<string, unknown>) {
    const { tenantId, session } = await this.contextFor(request);
    const result = await this.prisma.$transaction(async (tx) => {
      const location = await tx.location.create({
        data: {
          tenantId,
          ...settings(body),
          name: name(body["name"]),
          address:
            typeof body["address"] === "string"
              ? body["address"].slice(0, 500)
              : undefined,
        },
      });
      // The location runs the chosen activities of the account (at least one).
      const activityIds = Array.isArray(body["activityIds"])
        ? [...new Set(body["activityIds"].filter((id): id is string => typeof id === "string" && !!id))]
        : [];
      if (activityIds.length) {
        const found = await tx.activity.count({
          where: { tenantId, id: { in: activityIds } },
        });
        if (found !== activityIds.length)
          throw new BadRequestException("Attività non valida");
      }
      const sectors = [];
      for (const activityId of activityIds.length ? activityIds : [undefined]) {
        const sector = await tx.sector.create({
          data: {
            tenantId,
            locationId: location.id,
            ...(activityId
              ? { activityId, name: "" }
              : { name: name(body["sectorName"] || "Generale") }),
          },
        });
        // Explicit creator assignment: no other site or function is granted.
        await tx.userSectorAccess.create({
          data: { userId: requireUser(session).id, sectorId: sector.id },
        });
        sectors.push(sector);
      }
      return { ...location, sectors };
    });
    await this.invalidate(tenantId);
    return result;
  }
  @Patch(":id")
  async update(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { scope, tenantId } = await this.contextFor(request);
    // A partial sector grant cannot change the entire location's opening or status.
    const forbidden = await this.prisma.sector.count({
      where: { locationId: id, tenantId, id: { notIn: scope.sectorIds } },
    });
    if (!scope.locationIds.includes(id) || forbidden)
      throw new ForbiddenException(
        "Serve accesso a tutti i settori della sede",
      );
    const result = await this.prisma.location.update({
      where: { id, tenantId },
      data: {
        ...settings(body),
        ...(body["address"] !== undefined
          ? {
              address:
                typeof body["address"] === "string"
                  ? body["address"].slice(0, 500)
                  : null,
            }
          : {}),
      },
    });
    await this.invalidate(tenantId);
    return result;
  }
  @Post(":id/sectors")
  async createSector(
    @Req() request: Request,
    @Param("id") locationId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { scope, tenantId, session } = await this.contextFor(request);
    if (!scope.locationIds.includes(locationId)) throw new ForbiddenException();
    // An activity of the account brought to this location; a new name creates
    // the activity too (database), so old clients keep working.
    const activityId =
      typeof body["activityId"] === "string" && body["activityId"]
        ? body["activityId"]
        : undefined;
    if (activityId) {
      const activity = await this.prisma.activity.findFirst({
        where: { id: activityId, tenantId },
        select: { id: true },
      });
      if (!activity) throw new BadRequestException("Attività non valida");
    }
    const sectorSettings = sectorSettingsFor(body, !!activityId);
    const exists = await this.prisma.sector.findFirst({
      where: {
        tenantId,
        locationId,
        ...(activityId
          ? { activityId }
          : { name: { equals: name(body["name"]), mode: "insensitive" as const } }),
      },
      select: { id: true },
    });
    if (exists)
      throw new BadRequestException("Questa attività è già presente nella sede");
    const result = await this.prisma.$transaction(async (tx) => {
      const sector = await tx.sector.create({
        data: {
          tenantId,
          locationId,
          ...sectorSettings,
          ...(activityId ? { activityId, name: "" } : { name: name(body["name"]) }),
        },
      });
      await tx.userSectorAccess.create({
        data: { userId: requireUser(session).id, sectorId: sector.id },
      });
      return sector;
    });
    await this.invalidate(tenantId);
    return result;
  }
  @Patch("sectors/:id")
  async updateSector(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { scope, tenantId } = await this.contextFor(request);
    await requireSector(this.prisma, scope, id, false);
    // The name belongs to the activity (renamed from the activities list).
    const { name: _ignored, ...data } = settings(body);
    const result = await this.prisma.sector.update({
      where: { id, tenantId },
      data,
    });
    await this.invalidate(tenantId);
    return result;
  }
  @Post("professionals/:id/sectors")
  async professionalSectors(
    @Req() request: Request,
    @Param("id") collaboratorId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { scope, tenantId } = await this.contextFor(request);
    if (
      !Array.isArray(body["sectorIds"]) ||
      !body["sectorIds"].length ||
      body["sectorIds"].length > 100 ||
      body["sectorIds"].some(
        (id) => typeof id !== "string" || !scope.sectorIds.includes(id),
      )
    )
      throw new BadRequestException("Settori non validi");
    const ids = [...new Set(body["sectorIds"] as string[])];
    if (
      !(await this.prisma.collaborator.count({
        where: { id: collaboratorId, tenantId, ...collaboratorFilter(scope) },
      }))
    )
      throw new ForbiddenException();
    await this.prisma.$transaction(async (tx) => {
      // Shared with the appointment trigger: membership removal cannot race a booking.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId},7))`;
      const removed = await tx.collaboratorSector.findMany({
        where: {
          collaboratorId,
          sectorId: { in: scope.sectorIds, notIn: ids },
        },
        select: { sectorId: true },
      });
      if (
        removed.length &&
        (await tx.appointment.count({
          where: {
            tenantId,
            collaboratorId,
            sectorId: { in: removed.map((row) => row.sectorId) },
            endsAt: { gt: new Date() },
            status: { notIn: ["cancelled", "no_show", "completed"] },
          },
        }))
      )
        throw new BadRequestException(
          "Riassegna gli appuntamenti futuri prima di rimuovere il professionista dal settore",
        );
      await tx.collaboratorSector.deleteMany({
        where: { collaboratorId, sectorId: { in: scope.sectorIds } },
      });
      await tx.collaboratorSector.createMany({
        data: ids.map((sectorId) => ({ collaboratorId, sectorId })),
        skipDuplicates: true,
      });
    });
    await this.invalidate(tenantId);
    return { collaboratorId, sectorIds: ids };
  }
  @Get("access-context")
  async accessContext(@Req() request: Request) {
    const { scope, tenantId, session } = await this.contextFor(request);
    if (
      !canUseLocalFunction(session.user, "team.manage") ||
      !canUseLocalFunction(session.user, "users.manage")
    )
      throw new ForbiddenException("Serve la gestione della squadra");
    return this.prisma.user.findMany({
      where: { tenantId, role: { in: ["manager", "reception"] } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        sectorAccess: {
          where: { sectorId: { in: scope.sectorIds } },
          select: { sectorId: true },
        },
      },
      orderBy: { firstName: "asc" },
    });
  }

  @Post("access/:id")
  async access(
    @Req() request: Request,
    @Param("id") userId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { scope, tenantId, session } = await this.contextFor(request);
    if (!canUseLocalFunction(session.user, "team.manage"))
      throw new ForbiddenException(
        "Serve anche la gestione accessi della squadra",
      );
    if (
      !Array.isArray(body["sectorIds"]) ||
      body["sectorIds"].length > 100 ||
      body["sectorIds"].some(
        (id) => typeof id !== "string" || !scope.sectorIds.includes(id),
      )
    )
      throw new BadRequestException("Settori non validi");
    if (
      !(await this.prisma.user.count({
        where: {
          id: userId,
          tenantId,
          role: { in: ["manager", "reception"] },
        },
      }))
    )
      throw new BadRequestException("Profilo locale non disponibile");
    const ids = [...new Set(body["sectorIds"] as string[])];
    await this.prisma.$transaction([
      this.prisma.userSectorAccess.deleteMany({
        where: { userId, sectorId: { in: scope.sectorIds } },
      }),
      this.prisma.userSectorAccess.createMany({
        data: ids.map((sectorId) => ({ userId, sectorId })),
        skipDuplicates: true,
      }),
    ]);
    await this.invalidate(tenantId);
    return { userId, sectorIds: ids };
  }
  @Post("rooms")
  async createRoom(
    @Req() request: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const { scope, tenantId } = await this.contextFor(request);
    const sector = await requireSector(this.prisma, scope, body["sectorId"]);
    const room = await this.prisma.room.create({
      data: {
        tenantId,
        sectorId: sector.id,
        name: name(body["name"]),
        capacity: roomCapacity(body["capacity"]) ?? 1,
        isPublic: body["isPublic"] === true,
      },
    });
    await this.invalidate(tenantId);
    return room;
  }
  @Patch("rooms/:id")
  async updateRoom(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { scope, tenantId } = await this.contextFor(request);
    const capacity = roomCapacity(body["capacity"]);
    const current = await this.prisma.room.findFirst({
      where: { id, tenantId, sectorId: { in: scope.sectorIds } },
    });
    if (!current) throw new ForbiddenException();
    const sector = await requireSector(
      this.prisma,
      scope,
      body["sectorId"] || current.sectorId,
      false,
    );
    const room = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId},7))`;
      if (
        sector.id !== current.sectorId &&
        (await tx.appointment.count({
          where: {
            tenantId,
            endsAt: { gt: new Date() },
            status: { notIn: ["cancelled", "no_show", "completed"] },
            OR: [
              { roomId: id },
              {
                roomId: null,
                sectorId: current.sectorId,
                service: { requiresRoom: true },
              },
            ],
          },
        }))
      )
        throw new BadRequestException(
          "Riassegna le prenotazioni future prima di spostare la risorsa",
        );
      return tx.room.update({
        where: { id, tenantId, sectorId: current.sectorId },
        data: {
          ...(typeof body["name"] === "string"
            ? { name: name(body["name"]) }
            : {}),
          sectorId: sector.id,
          ...(capacity === undefined ? {} : { capacity }),
          ...(typeof body["isActive"] === "boolean"
            ? { isActive: body["isActive"] }
            : {}),
          ...(typeof body["isPublic"] === "boolean"
            ? { isPublic: body["isPublic"] }
            : {}),
        },
      });
    });
    await this.invalidate(tenantId);
    return room;
  }
}
