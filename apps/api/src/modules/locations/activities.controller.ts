import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import { requireTenantId, resolveRequestSession } from "../../common/request-session";
import { PrismaService } from "../../prisma/prisma.service";
import type { ScopeHeaders } from "./operational-scope";

/** Built-in catalogue: one tap to add, the name can be changed afterwards. */
export const ACTIVITY_PRESETS = [
  { preset: "barberia", name: "Barberia", color: "#1e3425" },
  { preset: "parrucchiere", name: "Parrucchiere", color: "#7c3aed" },
  { preset: "estetica", name: "Estetica", color: "#db2777" },
  { preset: "unghie", name: "Unghie", color: "#ea580c" },
  { preset: "benessere", name: "Benessere e spa", color: "#0891b2" },
  { preset: "rivendita", name: "Rivendita", color: "#65a30d" },
] as const;

type Request = { headers: ScopeHeaders };

function activityName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80)
    throw new BadRequestException("Inserisci un nome entro 80 caratteri");
  return value.trim();
}

function color(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value))
    throw new BadRequestException("Colore non valido");
  return value;
}

/**
 * What the business does (Barberia, Estetica, Rivendita…). Services and
 * products belong to an activity; a location runs some of them (Sector).
 */
@Controller("activities")
export class ActivitiesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invalidation: CacheInvalidationService,
  ) {}

  private async tenantFor(request: Request): Promise<string> {
    const session = await resolveRequestSession(this.prisma, request.headers.authorization);
    return requireTenantId(session);
  }

  private async invalidate(tenantId: string) {
    await Promise.all([
      this.invalidation.invalidateTenantSettings(tenantId),
      this.invalidation.invalidateServices(tenantId),
      this.invalidation.invalidatePublicServices(tenantId),
      this.invalidation.invalidateBookingReadModels(tenantId),
    ]);
  }

  /** Catalogue of the account, where each activity runs and what it sells. */
  @Get()
  async list(@Req() request: Request) {
    const tenantId = await this.tenantFor(request);
    const activities = await this.prisma.activity.findMany({
      where: { tenantId },
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: {
        sectors: {
          select: {
            id: true,
            locationId: true,
            isActive: true,
            location: { select: { name: true, isActive: true } },
          },
          orderBy: { location: { name: "asc" } },
        },
        _count: { select: { services: true, products: true } },
      },
    });
    const used = new Set(activities.map((row) => row.preset).filter(Boolean));
    return {
      activities: activities.map(({ _count, ...activity }) => ({
        ...activity,
        servicesCount: _count.services,
        productsCount: _count.products,
      })),
      presets: ACTIVITY_PRESETS.filter((row) => !used.has(row.preset)),
    };
  }

  @Post()
  async create(@Req() request: Request, @Body() body: Record<string, unknown>) {
    const tenantId = await this.tenantFor(request);
    const preset = ACTIVITY_PRESETS.find((row) => row.preset === body["preset"]);
    if (body["preset"] && !preset) throw new BadRequestException("Attività non prevista");
    try {
      const created = await this.prisma.activity.create({
        data: {
          tenantId,
          preset: preset?.preset ?? null,
          name: preset ? preset.name : activityName(body["name"]),
          color: preset ? preset.color : color(body["color"]),
        },
      });
      await this.invalidate(tenantId);
      return created;
    } catch (error) {
      throw this.duplicate(error);
    }
  }

  @Patch(":id")
  async update(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const tenantId = await this.tenantFor(request);
    const current = await this.prisma.activity.findFirst({ where: { id, tenantId } });
    if (!current) throw new BadRequestException("Attività non trovata");
    if ("isActive" in body && typeof body["isActive"] !== "boolean")
      throw new BadRequestException("Stato non valido");
    try {
      // The name is mirrored on every location (database trigger).
      const updated = await this.prisma.activity.update({
        where: { id },
        data: {
          ...("name" in body ? { name: activityName(body["name"]) } : {}),
          ...("color" in body ? { color: color(body["color"]) } : {}),
          ...("isActive" in body ? { isActive: body["isActive"] as boolean } : {}),
        },
      });
      await this.invalidate(tenantId);
      return updated;
    } catch (error) {
      throw this.duplicate(error);
    }
  }

  private duplicate(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return new ConflictException("Esiste già un'attività con questo nome");
    return error;
  }
}
