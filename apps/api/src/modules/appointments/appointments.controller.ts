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
          ? "Collaborator is not available due to holiday"
          : "Collaborator is not working on selected day",
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
        "Appointment is outside collaborator working hours",
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
      throw new BadRequestException("Selected slot is not available");
    }
  }

  private async resolveCustomer(
    tenantId: string,
    body: AppointmentPayload,
  ): Promise<string> {
    if (typeof body["customerId"] === "string" && body["customerId"]) {
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
      throw new BadRequestException("Customer name is required");
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
    const where = {
      tenantId,
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
      `${cacheKeys.appointmentsList(tenantId)}${cacheSuffix}`,
      CACHE_TTL_SECONDS.appointments,
      async () => {
        const include = {
          customer: true,
          service: true,
          collaborator: true,
          room: true,
        } as const;

        if (!paginated) {
          return this.prisma.appointment.findMany({
            where,
            orderBy: { startsAt: "asc" },
            include,
          });
        }

        const [items, total] = await Promise.all([
          this.prisma.appointment.findMany({
            where,
            orderBy: { startsAt: "desc" },
            skip,
            take,
            include,
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
    @Body() body: AppointmentPayload,
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
      throw new BadRequestException("serviceId and startsAt are required");
    }

    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
    });

    if (!service) {
      throw new BadRequestException("Service not found");
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

    return this.cacheService.getOrSet(
      cacheKeys.appointmentDetail(tenantId, id),
      CACHE_TTL_SECONDS.appointments,
      () =>
        this.prisma.appointment.findFirst({
          where: { id, tenantId },
          include: {
            customer: true,
            service: true,
            collaborator: true,
            room: true,
            cancellations: true,
          },
        }),
    );
  }

  @Patch(":id")
  async update(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: AppointmentPayload,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const user = requireUser(session);
    const current = await this.prisma.appointment.findUnique({ where: { id } });

    if (!current) {
      throw new BadRequestException("Appointment not found");
    }

    const serviceId =
      typeof body["serviceId"] === "string"
        ? body["serviceId"]
        : current.serviceId;
    const service = await this.prisma.service.findUnique({
      where: { id: serviceId },
    });

    if (!service) {
      throw new BadRequestException("Service not found");
    }

    const timezone = await this.resolveTenantTimezone(
      requireTenantId(session),
    );
    let startsAt = current.startsAt;
    if (body["startsAt"]) {
      const parsedStartsAt = parseZonedDateTime(
        String(body["startsAt"]),
        timezone,
      );
      if (!parsedStartsAt) {
        throw new BadRequestException("Invalid startsAt");
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
      where: { id },
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

    return this.prisma.appointment.update({
      where: { id },
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
    @Body() body: { status: AppointmentStatus },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const user = requireUser(session);

    const updated = await this.prisma.appointment.update({
      where: { id },
      data: {
        status: body.status,
        updatedById: user.id,
        finalPrice:
          body.status === AppointmentStatus.Completed ? undefined : undefined,
      },
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
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const user = requireUser(session);

    await this.prisma.appointment.update({
      where: { id },
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

    return this.cacheService.getOrSet(
      cacheKeys.appointmentCancellationPolicy(tenantId, id),
      CACHE_TTL_SECONDS.appointments,
      async () => {
        const appointment = await this.prisma.appointment.findFirst({
          where: { id, tenantId },
        });

        if (!appointment) {
          throw new BadRequestException("Appointment not found");
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
