import type { Prisma } from "@prisma/client";
import { PERSONAL_APPOINTMENT_SELECT, PERSONAL_STATUS_TRANSITIONS } from "../../common/personal-appointment";
import { canUseLocalFunction, requiresOwnAppointmentScope } from "../../common/function-catalog";
import {
  LegacyWriteDto,
  AppointmentStatusDto,
} from "../../common/legacy-write.dto";
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
import { AppointmentStatus } from "../../common/domain-types";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import { CACHE_TTL_SECONDS, cacheKeys } from "../../cache/cache.constants";
import { AppCacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  requireTenantId,
  resolveRequestSession,
  requireUser,
} from "../../common/request-session";
import {
  buildPaginatedResult,
  isPaginationRequested,
  parsePagination,
} from "../../common/pagination";
import { CustomersAlignmentService } from "../customers/customers-alignment.service";
import { NotificationsEventsService } from "../notifications/notifications.events.service";
import { CollaboratorScheduleService } from "../availability/collaborator-schedule.service";
import { parseZonedDateTime } from "../../common/zoned-time";

type AppointmentPayload = Record<string, unknown>;

@Controller("appointments")
export class AppointmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly cacheInvalidationService: CacheInvalidationService,
    private readonly notificationsEventsService: NotificationsEventsService,
    private readonly customersAlignmentService: CustomersAlignmentService,
    private readonly collaboratorScheduleService: CollaboratorScheduleService,
  ) {}

  // Projection required by agenda rendering, independent of catalog administration.
  @Get("context")
  async context(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const [services, collaborators] = await Promise.all([
      this.prisma.service.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          name: true,
          durationMinutes: true,
          bufferBeforeMinutes: true,
          bufferAfterMinutes: true,
          basePrice: true,
        },
      }),
      this.prisma.collaborator.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          calendarColor: true,
          weeklySchedules: {
            select: {
              weekday: true,
              isWorkingDay: true,
              startTime: true,
              endTime: true,
            },
          },
          dayOverrides: {
            select: {
              date: true,
              isHoliday: true,
              isWorkingDay: true,
              startTime: true,
              endTime: true,
            },
          },
        },
      }),
    ]);
    return { services, collaborators };
  }

  private async resolveTenantTimezone(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });

    return tenant?.timezone || "Europe/Rome";
  }

  private async ensureWorkingWindow(input: {
    tenantId: string;
    collaboratorId?: string | null;
    startsAt: Date;
    endsAt: Date;
  }): Promise<void> {
    if (!input.collaboratorId) {
      return;
    }

    const window = await this.collaboratorScheduleService.resolveWorkingWindow(
      input.tenantId,
      input.collaboratorId,
      input.startsAt,
    );

    if (!window.isAvailable) {
      throw new BadRequestException(
        window.isHoliday
          ? "Il professionista non è disponibile per una chiusura programmata"
          : "Il professionista non lavora nel giorno scelto",
      );
    }

    const slotStartMinutes =
      input.startsAt.getHours() * 60 + input.startsAt.getMinutes();
    const slotEndMinutes =
      input.endsAt.getHours() * 60 + input.endsAt.getMinutes();

    if (
      slotStartMinutes < window.startMinutes ||
      slotEndMinutes > window.endMinutes
    ) {
      throw new BadRequestException(
        "L'appuntamento è fuori dall'orario di lavoro del professionista",
      );
    }
  }

  private async ensureNoConflicts(
    tenantId: string,
    input: {
      startsAt: Date;
      endsAt: Date;
      collaboratorId?: string | null;
      roomId?: string | null;
      excludeId?: string;
    },
  ): Promise<void> {
    const resourceClauses: Array<Record<string, string>> = [];

    if (input.collaboratorId) {
      resourceClauses.push({ collaboratorId: input.collaboratorId });
    }

    if (input.roomId) {
      resourceClauses.push({ roomId: input.roomId });
    }

    const overlapping = await this.prisma.appointment.findFirst({
      where: {
        tenantId,
        id: input.excludeId ? { not: input.excludeId } : undefined,
        status: { notIn: ["cancelled", "no_show"] },
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
        OR: resourceClauses,
      },
      select: { id: true },
    });

    if (overlapping) {
      throw new BadRequestException("L'orario scelto non è disponibile");
    }
  }

  private async resolveCustomer(
    tenantId: string,
    body: AppointmentPayload,
  ): Promise<string> {
    if (typeof body["customerId"] === "string" && body["customerId"]) {
      await assertTenantReferences(this.prisma, tenantId, {
        customerId: body["customerId"],
      });
      return body["customerId"];
    }

    const fullName =
      typeof body["customerName"] === "string"
        ? body["customerName"].trim()
        : "";
    const [firstName, ...rest] = fullName.split(" ").filter(Boolean);
    const lastName = rest.join(" ") || "Cliente";
    const email =
      typeof body["email"] === "string"
        ? body["email"].trim().toLowerCase()
        : undefined;
    const phone =
      typeof body["phone"] === "string" ? body["phone"].trim() : undefined;

    if (!firstName) {
      throw new BadRequestException("Indica il nome del cliente");
    }

    const customer = await this.customersAlignmentService.findOrCreateCustomer({
      tenantId,
      firstName,
      lastName,
      email,
      phone,
    });

    return customer.id;
  }

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
    const from = query["from"] ? new Date(query["from"]) : undefined;
    const to = query["to"] ? new Date(query["to"]) : undefined;
    const personal = requiresOwnAppointmentScope(session.user, "appointments.read.all");
    const ownCollaboratorId = personal ? session.user?.collaboratorId : null;
    if (personal && !ownCollaboratorId) throw new ForbiddenException("Professionista non associato");
    const where = {
      tenantId,
      ...(ownCollaboratorId ? { collaboratorId: ownCollaboratorId, collaborator: { tenantId, userId: session.user!.id, isActive: true }, customer: { tenantId }, service: { tenantId }, OR: [{ roomId: null }, { room: { tenantId } }] } : {}),
      ...(from && !Number.isNaN(from.getTime())
        ? { startsAt: { gte: from } }
        : {}),
      ...(to && !Number.isNaN(to.getTime())
        ? { startsAt: { ...(from ? { gte: from } : {}), lte: to } }
        : {}),
    };
    const paginated = isPaginationRequested(query);
    const { page, pageSize, skip, take } = parsePagination(query, {
      defaultPageSize: 50,
    });
    const cacheSuffix = paginated
      ? `:p${page}:s${pageSize}`
      : `:range:${from?.toISOString() ?? ""}:${to?.toISOString() ?? ""}`;

    return this.cacheService.getOrSet(
      `${cacheKeys.appointmentsList(tenantId)}:${ownCollaboratorId ? "ownv2:" + ownCollaboratorId : "all"}${cacheSuffix}:${from?.toISOString() ?? ""}:${to?.toISOString() ?? ""}`,
      CACHE_TTL_SECONDS.appointments,
      async () => {
        const findAppointments = (args: Prisma.AppointmentFindManyArgs) => this.prisma.appointment.findMany(args);
        const projection = personal ? { select: PERSONAL_APPOINTMENT_SELECT } : { include: { customer: true, service: true, collaborator: true, room: true } as const };

        if (!paginated) {
          return findAppointments({
            where,
            orderBy: { startsAt: "asc" },
            ...projection,
          });
        }

        const [items, total] = await Promise.all([
          findAppointments({
            where,
            orderBy: { startsAt: "desc" },
            skip,
            take,
            ...projection,
          }),
          this.prisma.appointment.count({ where }),
        ]);

        return buildPaginatedResult(items, total, page, pageSize);
      },
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
    const user = requireUser(session);
    const tenantId = requireTenantId(session);
    const serviceId = String(body["serviceId"] ?? "");
    const timezone = await this.resolveTenantTimezone(tenantId);
    const startsAt = parseZonedDateTime(
      String(body["startsAt"] ?? ""),
      timezone,
    );

    if (!serviceId || !startsAt) {
      throw new BadRequestException("Scegli servizio e orario");
    }

    const service = await this.prisma.service.findUnique({
      where: { id: serviceId, tenantId: requireTenantId(session) },
    });

    if (!service) {
      throw new BadRequestException("Il servizio scelto non è disponibile");
    }

    const endsAt = new Date(
      startsAt.getTime() + service.durationMinutes * 60000,
    );
    const collaboratorId =
      typeof body["collaboratorId"] === "string"
        ? body["collaboratorId"]
        : undefined;
    const roomId =
      typeof body["roomId"] === "string" ? body["roomId"] : undefined;

    await assertTenantReferences(this.prisma, requireTenantId(session), {
      collaboratorId,
      roomId,
    });
    await this.ensureNoConflicts(tenantId, {
      startsAt,
      endsAt,
      collaboratorId,
      roomId,
    });
    await this.ensureWorkingWindow({
      tenantId,
      collaboratorId,
      startsAt,
      endsAt,
    });
    const customerId = await this.resolveCustomer(tenantId, body);

    const appointment = await this.prisma.appointment.create({
      data: {
        tenantId,
        customerId,
        serviceId,
        collaboratorId,
        roomId,
        startsAt,
        endsAt,
        status:
          typeof body["status"] === "string"
            ? (body["status"] as AppointmentStatus)
            : AppointmentStatus.Confirmed,
        source: "internal",
        estimatedPrice: service.basePrice,
        finalPrice:
          body["finalPrice"] === undefined
            ? undefined
            : Number(body["finalPrice"]),
        customerNotes:
          typeof body["customerNotes"] === "string"
            ? body["customerNotes"]
            : undefined,
        internalNotes:
          typeof body["internalNotes"] === "string"
            ? body["internalNotes"]
            : undefined,
        createdById: user.id,
        updatedById: user.id,
      },
      include: {
        customer: true,
        service: true,
        collaborator: true,
      },
    });

    await this.notificationsEventsService.emit({
      eventType: "appointment.created.internal",
      tenantId,
      entityType: "appointment",
      entityId: appointment.id,
      actor: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });

    if (appointment.collaboratorId) {
      await this.notificationsEventsService.emit({
        eventType: "appointment.assigned",
        tenantId,
        entityType: "appointment",
        entityId: appointment.id,
        actor: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      });
    }

    await this.cacheInvalidationService.invalidateBookingReadModels(tenantId);

    await this.customersAlignmentService.queueCustomerRefresh(
      tenantId,
      appointment.customerId,
      "appointment_created",
    );

    return appointment;
  }

  @Get(":id")
  async findOne(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const personal = requiresOwnAppointmentScope(session.user, "appointments.read.all");
    if (personal && !session.user?.collaboratorId) throw new ForbiddenException("Professionista non associato");

    return this.cacheService.getOrSet(
      `${cacheKeys.appointmentDetail(tenantId, id)}:${personal ? "ownv2:" + session.user!.collaboratorId : "all"}`,
      CACHE_TTL_SECONDS.appointments,
      () => {
        const args: Prisma.AppointmentFindFirstArgs = {
          where: { id, tenantId, ...(personal ? { collaboratorId: session.user!.collaboratorId!, collaborator: { tenantId, userId: session.user!.id, isActive: true }, customer: { tenantId }, service: { tenantId }, OR: [{ roomId: null }, { room: { tenantId } }] } : {}) },
          ...(personal ? { select: PERSONAL_APPOINTMENT_SELECT } : { include: { customer: true, service: true, collaborator: true, room: true, cancellations: true } }),
        };
        return this.prisma.appointment.findFirst(args);
      },
    );
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
    const user = requireUser(session);
    const current = await this.prisma.appointment.findUnique({
      where: { id, tenantId: requireTenantId(session) },
    });

    if (!current) {
      throw new BadRequestException("L'appuntamento non è stato trovato");
    }

    const serviceId =
      typeof body["serviceId"] === "string"
        ? body["serviceId"]
        : current.serviceId;
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId, tenantId: requireTenantId(session) },
    });

    if (!service) {
      throw new BadRequestException("Il servizio scelto non è disponibile");
    }

    const timezone = await this.resolveTenantTimezone(requireTenantId(session));
    let startsAt = current.startsAt;
    if (body["startsAt"]) {
      const parsedStartsAt = parseZonedDateTime(
        String(body["startsAt"]),
        timezone,
      );
      if (!parsedStartsAt) {
        throw new BadRequestException("L'orario indicato non è valido");
      }
      startsAt = parsedStartsAt;
    }
    const endsAt = new Date(
      startsAt.getTime() + service.durationMinutes * 60000,
    );
    const collaboratorId =
      typeof body["collaboratorId"] === "string"
        ? body["collaboratorId"]
        : current.collaboratorId;
    const roomId =
      typeof body["roomId"] === "string" ? body["roomId"] : current.roomId;

    await assertTenantReferences(this.prisma, requireTenantId(session), {
      collaboratorId,
      roomId,
    });
    await this.ensureNoConflicts(requireTenantId(session), {
      startsAt,
      endsAt,
      collaboratorId,
      roomId,
      excludeId: id,
    });
    await this.ensureWorkingWindow({
      tenantId: requireTenantId(session),
      collaboratorId,
      startsAt,
      endsAt,
    });

    const previousCollaboratorId = current.collaboratorId;
    const updated = await this.prisma.appointment.update({
      where: { id, tenantId: requireTenantId(session) },
      data: {
        serviceId,
        collaboratorId,
        roomId,
        startsAt,
        endsAt,
        status:
          typeof body["status"] === "string"
            ? (body["status"] as AppointmentStatus)
            : undefined,
        finalPrice:
          body["finalPrice"] === undefined
            ? undefined
            : Number(body["finalPrice"]),
        customerNotes:
          typeof body["customerNotes"] === "string"
            ? body["customerNotes"]
            : undefined,
        internalNotes:
          typeof body["internalNotes"] === "string"
            ? body["internalNotes"]
            : undefined,
        updatedById: user.id,
      },
      include: {
        customer: true,
        service: true,
        collaborator: true,
      },
    });

    if (collaboratorId && collaboratorId !== previousCollaboratorId) {
      await this.notificationsEventsService.emit({
        eventType: previousCollaboratorId
          ? "appointment.reassigned"
          : "appointment.assigned",
        tenantId: requireTenantId(session),
        entityType: "appointment",
        entityId: updated.id,
        actor: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      });
    }

    await this.cacheInvalidationService.invalidateBookingReadModels(
      requireTenantId(session),
    );

    await this.customersAlignmentService.queueCustomerRefresh(
      requireTenantId(session),
      updated.customerId,
      "appointment_created",
    );

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
    const user = requireUser(session);

    await this.cacheInvalidationService.invalidateBookingReadModels(
      requireTenantId(session),
    );
    return this.prisma.appointment.update({
      where: { id, tenantId: requireTenantId(session) },
      data: {
        status: AppointmentStatus.Cancelled,
        updatedById: user.id,
      },
    });
  }

  @Post(":id/status")
  async updateStatus(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: AppointmentStatusDto,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const user = requireUser(session);

    const tenantId = requireTenantId(session);
    const personal = requiresOwnAppointmentScope(user, "appointments.update.all");
    if (personal && (!user.collaboratorId || !canUseLocalFunction(user, "appointments.update.own"))) throw new ForbiddenException("Esecuzione personale non abilitata");
    const scope = { id, tenantId, ...(personal ? { collaboratorId: user.collaboratorId!, collaborator: { tenantId, userId: user.id, isActive: true }, customer: { tenantId }, service: { tenantId }, OR: [{ roomId: null }, { room: { tenantId } }] } : {}) };
    let previousStatus: AppointmentStatus | undefined;
    if (personal) {
      const current = await this.prisma.appointment.findFirst({ where: scope, select: { status: true } });
      if (!current) throw new ForbiddenException("Appuntamento non assegnato");
      if (!PERSONAL_STATUS_TRANSITIONS[current.status]?.includes(body.status)) throw new ForbiddenException("Questo stato richiede l’intervento del salone");
      previousStatus = current.status as AppointmentStatus;
    }
    const updated = await this.prisma.appointment.update({
      where: { ...scope, ...(previousStatus ? { status: previousStatus } : {}) },
      data: { status: body.status, updatedById: user.id },
      ...(personal ? { select: canUseLocalFunction(user, "appointments.read.own") ? PERSONAL_APPOINTMENT_SELECT : { id: true, status: true } } : {}),
    });

    if (body.status === AppointmentStatus.Confirmed) {
      await this.notificationsEventsService.emit({
        eventType: "appointment.confirmed",
        tenantId: requireTenantId(session),
        entityType: "appointment",
        entityId: updated.id,
        actor: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      });
    }

    await this.cacheInvalidationService.invalidateBookingReadModels(
      requireTenantId(session),
    );

    return updated;
  }

  @Post(":id/cancel")
  async cancel(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: LegacyWriteDto,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const user = requireUser(session);

    await this.prisma.appointment.update({
      where: { id, tenantId: requireTenantId(session) },
      data: {
        status: AppointmentStatus.Cancelled,
        updatedById: user.id,
      },
    });

    const cancellation = await this.prisma.appointmentCancellation.create({
      data: {
        appointmentId: id,
        cancelledByType: session.user?.role ?? "owner",
        cancelledById: user.id,
        reason: typeof body["reason"] === "string" ? body["reason"] : undefined,
        policyResult: "allowed_until_24h_before",
      },
    });

    await this.notificationsEventsService.emit({
      eventType: "appointment.cancelled",
      tenantId: requireTenantId(session),
      entityType: "appointment",
      entityId: id,
      actor: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      eventData: {
        reason: typeof body["reason"] === "string" ? body["reason"] : undefined,
      },
    });

    await this.cacheInvalidationService.invalidateBookingReadModels(
      requireTenantId(session),
    );

    return { id, status: AppointmentStatus.Cancelled, cancellation };
  }

  @Get(":id/cancellation-policy")
  async cancellationPolicy(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const personal = requiresOwnAppointmentScope(session.user, "appointments.read.all");
    if (personal && !session.user?.collaboratorId) throw new ForbiddenException("Professionista non associato");

    return this.cacheService.getOrSet(
      cacheKeys.appointmentCancellationPolicy(tenantId, id),
      CACHE_TTL_SECONDS.appointments,
      async () => {
        const appointment = await this.prisma.appointment.findFirst({
          where: {
            id,
            tenantId,
            ...(personal
              ? { collaboratorId: session.user!.collaboratorId!, collaborator: { tenantId, userId: session.user!.id, isActive: true } }
              : {}),
          },
        });

        if (!appointment) {
          throw new BadRequestException("L'appuntamento non è stato trovato");
        }

        const diffHours =
          (appointment.startsAt.getTime() - Date.now()) / 3600000;

        return {
          appointmentId: id,
          allowed: diffHours >= 24,
          policy: "allowed_until_24h_before",
        };
      },
    );
  }
}
