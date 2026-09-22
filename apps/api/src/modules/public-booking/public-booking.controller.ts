import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { AppointmentStatus, BookingMode } from "../../common/domain-types";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import { CACHE_TTL_SECONDS, cacheKeys } from "../../cache/cache.constants";
import { normalizeCacheToken } from "../../cache/cache.helpers";
import { AppCacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AvailabilityService } from "../availability/availability.service";
import { CustomersAlignmentService } from "../customers/customers-alignment.service";
import { NotificationsEventsService } from "../notifications/notifications.events.service";

@Controller()
export class PublicBookingController {
  private static readonly PUBLIC_BOOKING_WINDOW_SECONDS = 15 * 60;
  private static readonly PUBLIC_BOOKING_MAX_BY_IP = 6;
  private static readonly PUBLIC_BOOKING_MAX_BY_EMAIL = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly cacheInvalidationService: CacheInvalidationService,
    private readonly availabilityService: AvailabilityService,
    private readonly notificationsEventsService: NotificationsEventsService,
    private readonly customersAlignmentService: CustomersAlignmentService,
  ) {}

  private getRequestIp(headers: { [key: string]: string | undefined }): string {
    const forwardedFor = headers["x-forwarded-for"];

    if (forwardedFor) {
      return forwardedFor.split(",")[0]?.trim().toLowerCase() || "unknown";
    }

    return headers["x-real-ip"]?.trim().toLowerCase() || "unknown";
  }

  private async enforcePublicBookingRateLimit(input: {
    tenantId: string;
    ip: string;
    email?: string;
  }): Promise<void> {
    const ipKey = `app:public-booking:rate:${input.tenantId}:ip:${input.ip}`;
    const ipAttempts = await this.cacheService.increment(
      ipKey,
      PublicBookingController.PUBLIC_BOOKING_WINDOW_SECONDS,
    );

    if (ipAttempts > PublicBookingController.PUBLIC_BOOKING_MAX_BY_IP) {
      throw new BadRequestException(
        "Too many booking attempts. Please wait a few minutes.",
      );
    }

    if (!input.email) {
      return;
    }

    const emailKey = `app:public-booking:rate:${input.tenantId}:email:${input.email}`;
    const emailAttempts = await this.cacheService.increment(
      emailKey,
      PublicBookingController.PUBLIC_BOOKING_WINDOW_SECONDS,
    );

    if (emailAttempts > PublicBookingController.PUBLIC_BOOKING_MAX_BY_EMAIL) {
      throw new BadRequestException(
        "Too many booking attempts for this contact. Please wait a few minutes.",
      );
    }
  }

  private normalizeHost(host?: string): string | null {
    if (!host) {
      return null;
    }

    return host.toLowerCase().split(":")[0] || null;
  }

  private async resolveTenant(tenantSlug?: string, host?: string) {
    const normalizedHost = this.normalizeHost(host);

    if (
      normalizedHost &&
      normalizedHost !== "localhost" &&
      normalizedHost !== "127.0.0.1"
    ) {
      const tenantByDomain = await this.cacheService.getOrSet(
        cacheKeys.publicTenantByDomain(normalizedHost),
        CACHE_TTL_SECONDS.publicSettings,
        () =>
          this.prisma.tenant.findFirst({
            where: {
              publicEnabled: true,
              isActive: true,
              isSuspended: false,
              OR: [{ publicDomain: normalizedHost }, { slug: normalizedHost }],
            },
          }),
      );

      if (tenantByDomain) {
        return tenantByDomain;
      }
    }

    const slugToken = normalizeCacheToken(tenantSlug);
    const tenant = await this.cacheService.getOrSet(
      cacheKeys.publicTenantBySlug(slugToken),
      CACHE_TTL_SECONDS.publicSettings,
      async () =>
        tenantSlug && tenantSlug !== "default"
          ? this.prisma.tenant.findFirst({
              where: {
                slug: tenantSlug,
                publicEnabled: true,
                isActive: true,
                isSuspended: false,
              },
            })
          : this.prisma.tenant.findFirst({
              where: {
                publicEnabled: true,
                isActive: true,
                isSuspended: false,
              },
              orderBy: { createdAt: "asc" },
            }),
    );

    if (!tenant) {
      throw new BadRequestException("Public tenant not found");
    }

    return tenant;
  }

  private async getSettingsResponse(tenantSlug?: string, host?: string) {
    const tenant = await this.resolveTenant(tenantSlug, host);

    return this.cacheService.getOrSet(
      cacheKeys.publicSettings(tenant.id),
      CACHE_TTL_SECONDS.publicSettings,
      async () => ({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        publicDomain: tenant.publicDomain,
        bookingMode: tenant.bookingMode,
        defaultCollaboratorId: tenant.defaultCollaboratorId,
        primaryColor: tenant.primaryColor,
        accentColor: tenant.accentColor,
        publicTitle: tenant.publicTitle,
        publicDescription: tenant.publicDescription,
        publicSteps: tenant.publicSteps,
        logoUrl: tenant.logoUrl,
        coverUrl: tenant.coverUrl,
        publicEnabled: tenant.publicEnabled,
        timezone: tenant.timezone,
        currency: tenant.currency,
        language: tenant.language,
      }),
    );
  }

  private async getServicesResponse(tenantSlug?: string, host?: string) {
    const tenant = await this.resolveTenant(tenantSlug, host);

    return this.cacheService.getOrSet(
      cacheKeys.publicServices(tenant.id),
      CACHE_TTL_SECONDS.publicServices,
      () =>
        this.prisma.service
          .findMany({
            where: {
              tenantId: tenant.id,
              isActive: true,
              isPublic: true,
              isBookableOnline: true,
            },
            orderBy: { name: "asc" },
            include: {
              serviceProducts: {
                include: {
                  product: {
                    select: {
                      id: true,
                      name: true,
                      category: true,
                      price: true,
                    },
                  },
                },
              },
            },
          })
          .then(async (services) => {
            const collaborators = await this.prisma.collaborator.findMany({
              where: { tenantId: tenant.id, isActive: true, isPublic: true },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                calendarColor: true,
              },
            });
            return services.map((service) => ({ ...service, collaborators }));
          }),
    );
  }

  private async getAvailabilityResponse(
    serviceId: string,
    date: string | undefined,
    collaboratorId: string | undefined,
    tenantSlug?: string,
    host?: string,
  ) {
    const tenant = await this.resolveTenant(tenantSlug, host);

    return {
      serviceId,
      date: date ?? new Date().toISOString().slice(0, 10),
      slots: await this.availabilityService.getCachedAvailability(
        tenant.id,
        serviceId,
        date,
        collaboratorId,
        { requireExplicitCollaborator: true, publicOnly: true },
      ),
    };
  }

  private async createBookingResponse(
    body: Record<string, unknown>,
    requestHeaders: { [key: string]: string | undefined },
    tenantSlug?: string,
    host?: string,
  ) {
    const tenant = await this.resolveTenant(tenantSlug, host);

    if (tenant.bookingMode === BookingMode.Closed) {
      throw new BadRequestException(
        "Public booking is disabled for this tenant",
      );
    }

    const serviceId = String(body["serviceId"] ?? "");
    const startsAt = new Date(String(body["startsAt"] ?? ""));
    const customerName = String(body["customerName"] ?? "").trim();
    const [firstName, ...rest] = customerName.split(" ").filter(Boolean);
    const lastName = rest.join(" ") || "Cliente";

    if (!serviceId || !firstName || Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException(
        "serviceId, startsAt and customerName are required",
      );
    }

    const service = await this.prisma.service.findFirst({
      where: {
        id: serviceId,
        tenantId: tenant.id,
        isActive: true,
        isBookableOnline: true,
      },
    });

    if (!service) {
      throw new BadRequestException("Service not found");
    }

    const email =
      typeof body["email"] === "string"
        ? body["email"].toLowerCase().trim()
        : undefined;
    const phone =
      typeof body["phone"] === "string" ? body["phone"].trim() : undefined;
    const requestedCollaboratorId =
      typeof body["collaboratorId"] === "string"
        ? body["collaboratorId"]
        : undefined;

    await this.enforcePublicBookingRateLimit({
      tenantId: tenant.id,
      ip: this.getRequestIp(requestHeaders),
      email,
    });

    if (service.requiresCollaborator && !requestedCollaboratorId) {
      throw new BadRequestException("collaboratorId is required");
    }

    const endsAt = new Date(
      startsAt.getTime() + service.durationMinutes * 60000,
    );

    const slots = await this.availabilityService.getCachedAvailability(
      tenant.id,
      serviceId,
      startsAt.toISOString(),
      requestedCollaboratorId,
      { requireExplicitCollaborator: true, publicOnly: true },
    );
    const matchedSlot = slots.find(
      (slot) =>
        slot.startsAt === startsAt.toISOString() &&
        (requestedCollaboratorId
          ? slot.collaboratorId === requestedCollaboratorId
          : true),
    );

    if (!matchedSlot) {
      throw new BadRequestException("Selected slot is not available anymore");
    }

    const collaboratorId =
      requestedCollaboratorId ?? matchedSlot.collaboratorId ?? undefined;

    const customer = await this.customersAlignmentService.findOrCreateCustomer({
      tenantId: tenant.id,
      firstName,
      lastName,
      email,
      phone,
    });

    const appointment = await this.prisma.appointment.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        serviceId,
        collaboratorId,
        startsAt,
        endsAt,
        source: "public",
        status:
          tenant.bookingMode === BookingMode.Public
            ? AppointmentStatus.Confirmed
            : AppointmentStatus.Requested,
        estimatedPrice: service.basePrice,
        customerNotes:
          typeof body["customerNotes"] === "string"
            ? body["customerNotes"]
            : undefined,
      },
      include: {
        customer: true,
        service: true,
        collaborator: true,
      },
    });

    await this.cacheInvalidationService.invalidateBookingReadModels(tenant.id);

    await this.customersAlignmentService.queueCustomerRefresh(
      tenant.id,
      customer.id,
      "appointment_created",
    );

    await this.notificationsEventsService.emit({
      eventType: "appointment.created.public",
      tenantId: tenant.id,
      entityType: "appointment",
      entityId: appointment.id,
      flags: {
        createdFromPublicBooking: true,
      },
    });
    await this.notificationsEventsService.emit({
      eventType:
        appointment.status === AppointmentStatus.Confirmed
          ? "appointment.confirmed"
          : "appointment.requested",
      tenantId: tenant.id,
      entityType: "appointment",
      entityId: appointment.id,
      flags: {
        createdFromPublicBooking: true,
      },
    });

    return appointment;
  }

  @Get("public/settings")
  getHostSettings(
    @Req() request: { headers: { host?: string } },
  ): Promise<unknown> {
    return this.getSettingsResponse(undefined, request.headers.host);
  }

  @Get("public/services")
  getHostServices(
    @Req() request: { headers: { host?: string } },
  ): Promise<unknown> {
    return this.getServicesResponse(undefined, request.headers.host);
  }

  @Get("public/availability")
  getHostAvailability(
    @Req() request: { headers: { host?: string } },
    @Query("serviceId") serviceId: string,
    @Query("date") date: string,
    @Query("collaboratorId") collaboratorId?: string,
  ): Promise<unknown> {
    return this.getAvailabilityResponse(
      serviceId,
      date,
      collaboratorId,
      undefined,
      request.headers.host,
    );
  }

  @Post("public/bookings")
  createHostBooking(
    @Req()
    request: {
      headers: {
        host?: string;
        "x-forwarded-for"?: string;
        "x-real-ip"?: string;
      };
    },
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.createBookingResponse(
      body,
      request.headers,
      undefined,
      request.headers.host,
    );
  }

  @Get("public/:tenantSlug/settings")
  getSettings(
    @Param("tenantSlug") tenantSlug: string,
    @Req() request: { headers: { host?: string } },
  ): Promise<unknown> {
    return this.getSettingsResponse(tenantSlug, request.headers.host);
  }

  @Get("public/:tenantSlug/services")
  getServices(
    @Param("tenantSlug") tenantSlug: string,
    @Req() request: { headers: { host?: string } },
  ): Promise<unknown> {
    return this.getServicesResponse(tenantSlug, request.headers.host);
  }

  @Get("public/:tenantSlug/availability")
  getAvailability(
    @Param("tenantSlug") tenantSlug: string,
    @Req() request: { headers: { host?: string } },
    @Query("serviceId") serviceId: string,
    @Query("date") date: string,
    @Query("collaboratorId") collaboratorId?: string,
  ): Promise<unknown> {
    return this.getAvailabilityResponse(
      serviceId,
      date,
      collaboratorId,
      tenantSlug,
      request.headers.host,
    );
  }

  @Post("public/:tenantSlug/bookings")
  createBooking(
    @Param("tenantSlug") tenantSlug: string,
    @Req()
    request: {
      headers: {
        host?: string;
        "x-forwarded-for"?: string;
        "x-real-ip"?: string;
      };
    },
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.createBookingResponse(
      body,
      request.headers,
      tenantSlug,
      request.headers.host,
    );
  }
}
