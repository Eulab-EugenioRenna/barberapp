import { customerCancellationAllowed } from "../orders/booking-cancellation";
import { beginAppointmentEvents } from "../notifications/appointment-events";
import {
  lockOperationalTenant,
  setOperationalActor,
} from "../../common/operational-lock";
import { BookingMutationService } from "../orders/booking-mutation.service";
import {
  BookingRevisionDto,
  BookingCancellationDto,
} from "../../common/booking-mutation.dto";
import { BookingCommandService } from "../orders/booking-command.service";
import { BookingAvailabilityService } from "../orders/booking-availability.service";
import { BookingAvailabilityDto } from "../../common/booking-availability.dto";
import { BookingCreateDto } from "../../common/booking-write.dto";
import {
  resolveOperationalScope,
  sectorFilter,
  serviceScopeFilter,
  collaboratorFilter,
} from "../locations/operational-scope";
import type { Prisma } from "@prisma/client";
import {
  PERSONAL_APPOINTMENT_SELECT,
  PERSONAL_STATUS_TRANSITIONS,
} from "../../common/personal-appointment";
import {
  canUseLocalFunction,
  requiresOwnAppointmentScope,
} from "../../common/function-catalog";
import {
  LegacyWriteDto,
  AppointmentStatusDto,
} from "../../common/legacy-write.dto";
import { assertTenantReferences } from "../../common/tenant-references";
import { personalBookingInput } from "../../common/personal-booking";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  SetMetadata,
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

type AppointmentPayload = Record<string, unknown>;

/** Lean agenda projection: names, colors, status, account link and price. */
export const AGENDA_APPOINTMENT_SELECT = {
  id: true,
  tenantId: true,
  locationId: true,
  sectorId: true,
  customerId: true,
  serviceId: true,
  collaboratorId: true,
  roomId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  source: true,
  estimatedPrice: true,
  finalPrice: true,
  customerNotes: true,
  internalNotes: true,
  orderItemId: true,
  orderIssue: true,
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
    },
  },
  service: {
    select: {
      id: true,
      name: true,
      color: true,
      durationMinutes: true,
      sectorId: true,
      basePrice: true,
      priceMode: true,
      vatRate: true,
    },
  },
  collaborator: {
    select: { id: true, firstName: true, lastName: true, calendarColor: true },
  },
  room: { select: { id: true, name: true } },
  orderItem: {
    select: {
      saleId: true,
      sale: { select: { revision: true, orderStatus: true } },
    },
  },
} as const;

@Controller("appointments")
export class AppointmentsController {
  constructor(
    private readonly bookings: BookingCommandService,
    private readonly bookingAvailability: BookingAvailabilityService,
    private readonly mutations: BookingMutationService,
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly cacheInvalidationService: CacheInvalidationService,
    private readonly customersAlignmentService: CustomersAlignmentService,
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
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const [services, collaborators] = await Promise.all([
      this.prisma.service.findMany({
        where: { tenantId, ...serviceScopeFilter(scope), isActive: true },
        select: {
          id: true,
          name: true,
          sectorId: true,
          activityId: true,
          sector: { select: { id: true, name: true, locationId: true } },
          requiresCollaborator: true,
          requiresRoom: true,
          durationMinutes: true,
          bufferBeforeMinutes: true,
          bufferAfterMinutes: true,
          basePrice: true,
          priceMode: true,
          vatRate: true,
        },
      }),
      this.prisma.collaborator.findMany({
        where: {
          tenantId,
          ...collaboratorFilter(scope),
          isActive: true,
          // «La mia agenda»: whoever books only for themselves sees only themselves.
          ...(requiresOwnAppointmentScope(session.user, "appointments.create")
            ? { id: session.user?.collaboratorId || "" }
            : {}),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          calendarColor: true,
          sectors: {
            where: { sectorId: { in: scope.sectorIds } },
            select: { sectorId: true },
          },
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
    // One location in scope: each service is shown in its activity's sector there.
    if (scope.locationIds.length !== 1) return { services, collaborators };
    const local = await this.prisma.sector.findMany({
      where: { tenantId, locationId: scope.locationIds[0], id: { in: scope.allowedSectorIds } },
      select: { id: true, name: true, locationId: true, activityId: true },
    });
    return {
      services: services.flatMap((service) => {
        const sector = local.find((row) => row.activityId === service.activityId);
        if (!sector) return [];
        const { activityId: _activity, ...placed } = sector;
        return [{ ...service, sectorId: sector.id, sector: placed }];
      }),
      collaborators,
    };
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
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const from = query["from"] ? new Date(query["from"]) : undefined;
    const to = query["to"] ? new Date(query["to"]) : undefined;
    const personal = requiresOwnAppointmentScope(
      session.user,
      "appointments.read.all",
    );
    const ownCollaboratorId = personal ? session.user?.collaboratorId : null;
    if (personal && !ownCollaboratorId)
      throw new ForbiddenException("Professionista non associato");
    const where = {
      tenantId,
      ...sectorFilter(scope),
      ...(ownCollaboratorId
        ? {
            collaboratorId: ownCollaboratorId,
            collaborator: {
              tenantId,
              userId: session.user!.id,
              isActive: true,
            },
            customer: { tenantId },
            service: { tenantId },
            OR: [{ roomId: null }, { room: { tenantId } }],
          }
        : {}),
      ...(from && !Number.isNaN(from.getTime())
        ? { startsAt: { gte: from } }
        : {}),
      ...(to && !Number.isNaN(to.getTime())
        ? { startsAt: { ...(from ? { gte: from } : {}), lte: to } }
        : {}),
    };
    const paginated = isPaginationRequested(query);
    // `view=agenda`: only what the calendar draws (backward compatible when omitted).
    const lean = query["view"] === "agenda";
    const { page, pageSize, skip, take } = parsePagination(query, {
      defaultPageSize: 50,
    });
    const cacheSuffix = paginated
      ? `:p${page}:s${pageSize}`
      : `:range:${from?.toISOString() ?? ""}:${to?.toISOString() ?? ""}`;

    return this.cacheService.getOrSet(
      `${cacheKeys.appointmentsList(tenantId)}:${ownCollaboratorId ? "ownv2:" + ownCollaboratorId : lean ? "agendav1" : "allv10"}${cacheSuffix}:${from?.toISOString() ?? ""}:${to?.toISOString() ?? ""}`,
      CACHE_TTL_SECONDS.appointments,
      async () => {
        const findAppointments = (args: Prisma.AppointmentFindManyArgs) =>
          this.prisma.appointment.findMany(args);
        const projection = personal
          ? { select: PERSONAL_APPOINTMENT_SELECT }
          : lean
            ? { select: AGENDA_APPOINTMENT_SELECT }
            : {
              include: {
                customer: true,
                service: true,
                collaborator: true,
                room: true,
                orderItem: {
                  select: {
                    saleId: true,
                    sale: { select: { revision: true, orderStatus: true } },
                  },
                },
              } as const,
            };

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

  @Post("availability")
  @SetMetadata("alora.readOnly", true)
  async previewAvailability(
    @Req() request: { headers: { authorization?: string } },
    @Body() body: BookingAvailabilityDto,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    if (
      body.appointmentId &&
      !canUseLocalFunction(requireUser(session), "appointments.update.all")
    )
      throw new ForbiddenException(
        "La riprogrammazione richiede il permesso di modifica agenda",
      );
    return this.bookingAvailability.read(
      {
        tenantId: requireTenantId(session),
        actorId: requireUser(session).id,
        source: "internal",
        scope,
      },
      personalBookingInput(requireUser(session), body),
    );
  }

  @Post(":id/availability")
  @SetMetadata("alora.readOnly", true)
  async reschedulingAvailability(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: BookingAvailabilityDto,
  ): Promise<unknown> {
    return this.bookingAvailability.read(await this.mutationContext(request), {
      ...body,
      appointmentId: id,
    });
  }

  @Post()
  async create(
    @Req() request: { headers: { authorization?: string } },
    @Body() body: BookingCreateDto,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const user = requireUser(session),
      tenantId = requireTenantId(session);
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const outcome = await this.bookings.execute(
      { tenantId, actorId: user.id, source: "internal", scope },
      personalBookingInput(user, body),
    );
    if (!outcome.replayed) {
      await this.customersAlignmentService.queueCustomerRefresh(
        tenantId,
        outcome.customerId,
        "appointment_created",
      );
    }
    await this.cacheInvalidationService.invalidateBookingReadModels(tenantId);
    return outcome.result;
  }

  private async mutationContext(request: {
    headers: { authorization?: string };
  }) {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    return {
      tenantId: requireTenantId(session),
      actorId: requireUser(session).id,
      source: "internal" as const,
      canReadEconomics: canUseLocalFunction(requireUser(session), "sales.read"),
      scope: await resolveOperationalScope(
        this.prisma,
        session,
        request.headers,
      ),
    };
  }
  @Get(":id/order")
  async bookingOrder(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
  ): Promise<unknown> {
    return this.mutations.read(await this.mutationContext(request), id);
  }
  @Post(":id/order/preview")
  @SetMetadata("alora.readOnly", true)
  async previewOrder(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: BookingRevisionDto,
  ): Promise<unknown> {
    const context = await this.mutationContext(request);
    return this.mutations.preview(context, id, body, context.canReadEconomics);
  }
  @Patch(":id/order")
  async reviseOrder(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: BookingRevisionDto,
  ): Promise<unknown> {
    const context = await this.mutationContext(request);
    const outcome = await this.mutations.revise(context, id, body);
    await this.cacheInvalidationService.invalidateBookingReadModels(
      context.tenantId,
    );
    return outcome.result;
  }
  @Post(":id/order/cancel")
  async cancelOrder(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: BookingCancellationDto,
  ): Promise<unknown> {
    const context = await this.mutationContext(request);
    const outcome = await this.mutations.cancel(context, id, body);
    await this.cacheInvalidationService.invalidateBookingReadModels(
      context.tenantId,
    );
    return outcome.result;
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
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const personal = requiresOwnAppointmentScope(
      session.user,
      "appointments.read.all",
    );
    if (personal && !session.user?.collaboratorId)
      throw new ForbiddenException("Professionista non associato");

    return this.cacheService.getOrSet(
      `${cacheKeys.appointmentDetail(tenantId, id)}:${personal ? "ownv2:" + session.user!.collaboratorId : "allv10"}`,
      CACHE_TTL_SECONDS.appointments,
      () => {
        const args: Prisma.AppointmentFindFirstArgs = {
          where: {
            id,
            tenantId,
            ...sectorFilter(scope),
            ...(personal
              ? {
                  collaboratorId: session.user!.collaboratorId!,
                  collaborator: {
                    tenantId,
                    userId: session.user!.id,
                    isActive: true,
                  },
                  customer: { tenantId },
                  service: { tenantId },
                  OR: [{ roomId: null }, { room: { tenantId } }],
                }
              : {}),
          },
          ...(personal
            ? { select: PERSONAL_APPOINTMENT_SELECT }
            : {
                include: {
                  customer: true,
                  service: true,
                  collaborator: true,
                  room: true,
                  orderItem: {
                    select: {
                      saleId: true,
                      sale: { select: { revision: true, orderStatus: true } },
                    },
                  },
                  cancellations: true,
                },
              }),
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
    // One save: status (cancellation included), time, people, notes and customer together.
    const context = await this.mutationContext(request);
    const outcome = await this.mutations.reviseLine(context, id, body);
    await this.afterLineRevision(context.tenantId, outcome);
    return outcome.result;
  }

  private async afterLineRevision(
    tenantId: string,
    outcome: {
      replayed: boolean;
      customerId: string | null;
      previousCustomerId: string | null;
    },
  ) {
    await this.cacheInvalidationService.invalidateBookingReadModels(tenantId);
    if (outcome.replayed) return;
    for (const customerId of new Set(
      [outcome.customerId, outcome.previousCustomerId].filter(
        (value): value is string => typeof value === "string",
      ),
    ))
      await this.customersAlignmentService.queueCustomerRefresh(
        tenantId,
        customerId,
        "appointment_created",
      );
  }

  @Delete(":id")
  async remove(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
  ): Promise<unknown> {
    return this.cancel(request, id, {});
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
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const personal = requiresOwnAppointmentScope(
      user,
      "appointments.update.all",
    );
    if (
      personal &&
      (!user.collaboratorId ||
        !canUseLocalFunction(user, "appointments.update.own"))
    )
      throw new ForbiddenException("Esecuzione personale non abilitata");
    const appointmentScope = {
      id,
      tenantId,
      ...sectorFilter(scope),
      ...(personal
        ? {
            collaboratorId: user.collaboratorId!,
            collaborator: { tenantId, userId: user.id, isActive: true },
            customer: { tenantId },
            service: { tenantId },
            OR: [{ roomId: null }, { room: { tenantId } }],
          }
        : {}),
    };
    let previousStatus: AppointmentStatus | undefined;
    if (personal) {
      const current = await this.prisma.appointment.findFirst({
        where: appointmentScope,
        select: { status: true },
      });
      if (!current) throw new ForbiddenException("Appuntamento non assegnato");
      if (!PERSONAL_STATUS_TRANSITIONS[current.status]?.includes(body.status))
        throw new ForbiddenException(
          "Questo stato richiede l’intervento del salone",
        );
      previousStatus = current.status as AppointmentStatus;
    }
    if (!personal) {
      // Staff correct any status (reactivation included) through the same path as the form.
      const context = await this.mutationContext(request);
      const outcome = await this.mutations.reviseLine(context, id, {
        status: body.status,
      });
      await this.afterLineRevision(context.tenantId, outcome);
      return {
        ...(typeof outcome.result === "object" ? outcome.result : {}),
        id,
        status: body.status,
      };
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockOperationalTenant(tx, tenantId);
      await setOperationalActor(tx, user.id);
      const recordEvents = await beginAppointmentEvents(
        tx,
        { tenantId, actorId: user.id, source: "internal" },
        { id },
      );
      const current = await tx.appointment.findFirst({
        where: appointmentScope,
        select: { status: true },
      });
      if (!current) throw new NotFoundException("Appuntamento non accessibile");
      const updated = await tx.appointment.update({
        where: {
          ...appointmentScope,
          ...(previousStatus ? { status: previousStatus } : {}),
        },
        data: { status: body.status, updatedById: user.id },
        ...(personal
          ? {
              select: canUseLocalFunction(user, "appointments.read.own")
                ? PERSONAL_APPOINTMENT_SELECT
                : { id: true, status: true },
            }
          : {}),
      });
      await tx.sale.updateMany({
        where: { tenantId, items: { some: { booking: { id } } } },
        data: { revision: { increment: 1 } },
      });
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      await recordEvents({ id });
      return updated;
    });

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
    const context = await this.mutationContext(request);
    const outcome = await this.mutations.cancel(
      context,
      id,
      {
        // A fixed key would replay an old cancellation after a reactivation.
        idempotencyKey: body.idempotencyKey,
        revision: body.revision ?? null,
        reason: typeof body.reason === "string" ? body.reason : null,
      },
      "line",
    );
    await this.cacheInvalidationService.invalidateBookingReadModels(
      context.tenantId,
    );
    return {
      ...(typeof outcome.result === "object" ? outcome.result : {}),
      id,
      status: AppointmentStatus.Cancelled,
    };
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
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const personal = requiresOwnAppointmentScope(
      session.user,
      "appointments.read.all",
    );
    if (personal && !session.user?.collaboratorId)
      throw new ForbiddenException("Professionista non associato");

    return this.cacheService.getOrSet(
      cacheKeys.appointmentCancellationPolicy(tenantId, id),
      CACHE_TTL_SECONDS.appointments,
      async () => {
        const appointment = await this.prisma.appointment.findFirst({
          where: {
            id,
            tenantId,
            ...sectorFilter(scope),
            ...(personal
              ? {
                  collaboratorId: session.user!.collaboratorId!,
                  collaborator: {
                    tenantId,
                    userId: session.user!.id,
                    isActive: true,
                  },
                }
              : {}),
          },
        });

        if (!appointment) {
          throw new BadRequestException("L'appuntamento non è stato trovato");
        }

        return {
          appointmentId: id,
          allowed: customerCancellationAllowed(appointment.startsAt),
          policy: "allowed_until_24h_before",
        };
      },
    );
  }
}
