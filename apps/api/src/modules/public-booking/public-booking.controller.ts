import { BookingCommandService } from "../orders/booking-command.service";
import { BookingAvailabilityService } from "../orders/booking-availability.service";
import { BookingAvailabilityDto } from "../../common/booking-availability.dto";
import { BookingCreateDto } from "../../common/booking-write.dto";
import { catalogGross } from "../pricing/pricing.service";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  SetMetadata,
} from "@nestjs/common";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import { CACHE_TTL_SECONDS, cacheKeys } from "../../cache/cache.constants";
import { normalizeCacheToken } from "../../cache/cache.helpers";
import { AppCacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import { AvailabilityService } from "../availability/availability.service";
import { CustomersAlignmentService } from "../customers/customers-alignment.service";
import { resolveZonedDateKey } from "../../common/zoned-time";

@Controller()
export class PublicBookingController {
  private static readonly PUBLIC_BOOKING_WINDOW_SECONDS = 15 * 60;
  private static readonly PUBLIC_BOOKING_MAX_BY_IP = 6;
  private static readonly PUBLIC_BOOKING_MAX_BY_EMAIL = 3;

  constructor(
    private readonly bookings: BookingCommandService,
    private readonly bookingAvailability: BookingAvailabilityService,
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly cacheInvalidationService: CacheInvalidationService,
    private readonly availabilityService: AvailabilityService,
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
        "Hai inviato troppe richieste. Attendi qualche minuto e riprova.",
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
        "Hai già inviato diverse richieste per questo contatto. Attendi qualche minuto e riprova.",
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
      throw new BadRequestException(
        "Questa pagina di prenotazione non è disponibile",
      );
    }

    return tenant;
  }

  private async getSettingsResponse(tenantSlug?: string, host?: string) {
    const tenant = await this.resolveTenant(tenantSlug, host);

    return this.cacheService.getOrSet(
      cacheKeys.publicSettings(tenant.id) + ":scope9-v1",
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
        locations: await this.prisma.location.findMany({
          where: {
            tenantId: tenant.id,
            isActive: true,
            isPublic: true,
            sectors: { some: { isActive: true, isPublic: true } },
          },
          select: {
            id: true,
            name: true,
            address: true,
            sectors: {
              where: { isActive: true, isPublic: true },
              select: { id: true, name: true },
            },
          },
          orderBy: { name: "asc" },
        }),
      }),
    );
  }

  private async getServicesResponse(tenantSlug?: string, host?: string) {
    const tenant = await this.resolveTenant(tenantSlug, host);

    return this.cacheService.getOrSet(
      cacheKeys.publicServices(tenant.id) + ":scope9-v1",
      CACHE_TTL_SECONDS.publicServices,
      () =>
        this.prisma.service
          .findMany({
            where: {
              tenantId: tenant.id,
              isActive: true,
              isPublic: true,
              isBookableOnline: true,
              sector: {
                isActive: true,
                isPublic: true,
                location: { isActive: true, isPublic: true },
              },
            },
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              publicDescription: true,
              durationMinutes: true,
              basePrice: true,
              priceMode: true,
              vatRate: true,
              category: true,
              color: true,
              requiresCollaborator: true,
              requiresRoom: true,
              bufferBeforeMinutes: true,
              bufferAfterMinutes: true,
              isActive: true,
              isPublic: true,
              isBookableOnline: true,
              sectorId: true,
              sector: {
                select: {
                  id: true,
                  name: true,
                  locationId: true,
                  location: { select: { id: true, name: true, address: true } },
                },
              },
              serviceProducts: {
                include: {
                  product: {
                    select: {
                      id: true,
                      name: true,
                      category: true,
                      price: true,
                      priceMode: true,
                      vatRate: true,
                    },
                  },
                },
              },
            },
          })
          .then(async (catalogServices) => {
            const services = catalogServices.map((service) => ({
              ...service,
              basePrice: catalogGross(service),
              priceMode: service.priceMode === "legacy" ? "legacy" : "gross",
              serviceProducts: service.serviceProducts.map((link) => ({
                ...link,
                product: {
                  ...link.product,
                  price:
                    link.product.price === null
                      ? null
                      : catalogGross({
                          ...link.product,
                          basePrice: link.product.price,
                        }),
                  priceMode:
                    link.product.priceMode === "legacy" ? "legacy" : "gross",
                },
              })),
            }));
            const collaborators = await this.prisma.collaborator.findMany({
              where: { tenantId: tenant.id, isActive: true, isPublic: true },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                calendarColor: true,
                sectors: { select: { sectorId: true } },
              },
            });
            return services.map((service) => ({
              ...service,
              collaborators: collaborators
                .filter((person) =>
                  person.sectors.some(
                    (membership) => membership.sectorId === service.sectorId,
                  ),
                )
                .map(({ sectors: _sectors, ...person }) => person),
            }));
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
    const tenantRecord = await this.prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: { timezone: true },
    });
    const timezone = tenantRecord?.timezone || "Europe/Rome";

    return {
      serviceId,
      date: resolveZonedDateKey(date, timezone),
      slots: await this.availabilityService.getCachedAvailability(
        tenant.id,
        serviceId,
        date,
        collaboratorId,
        { requireExplicitCollaborator: false, publicOnly: true },
      ),
    };
  }

  private async getAvailabilityRangeResponse(
    serviceId: string,
    from: string | undefined,
    to: string | undefined,
    collaboratorId: string | undefined,
    tenantSlug?: string,
    host?: string,
  ) {
    const tenant = await this.resolveTenant(tenantSlug, host);
    const start = this.parseDateKey(from);
    const end = this.parseDateKey(to);

    if (!start || !end) {
      throw new BadRequestException("Indica il periodo da consultare");
    }
    if (end < start) {
      throw new BadRequestException("Il periodo scelto non è valido");
    }

    const maxDays = 62;
    const days: Array<{ date: string; hasSlots: boolean }> = [];
    const cursor = new Date(start);

    while (cursor.getTime() <= end && days.length < maxDays) {
      const dateKey = this.formatDateKey(cursor);
      const slots = await this.availabilityService.buildAvailability(
        tenant.id,
        serviceId,
        dateKey,
        collaboratorId,
        { requireExplicitCollaborator: false, publicOnly: true },
      );
      days.push({ date: dateKey, hasSlots: slots.length > 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return { serviceId, days };
  }

  private parseDateKey(value?: string): number | null {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  }

  private formatDateKey(value: Date): string {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }

  private async createBookingResponse(
    body: BookingCreateDto,
    requestHeaders: { [key: string]: string | undefined },
    tenantSlug?: string,
    host?: string,
  ) {
    const tenant = await this.resolveTenant(tenantSlug, host);
    const outcome = await this.bookings.execute(
      { tenantId: tenant.id, actorId: null, source: "public" },
      body,
      () =>
        this.enforcePublicBookingRateLimit({
          tenantId: tenant.id,
          ip: this.getRequestIp(requestHeaders),
          email: body.email?.toLowerCase().trim(),
        }),
    );
    if (!outcome.replayed) {
      await this.customersAlignmentService.queueCustomerRefresh(
        tenant.id,
        outcome.customerId,
        "appointment_created",
      );
    }
    await this.cacheInvalidationService.invalidateBookingReadModels(tenant.id);
    return outcome.result;
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

  @Get("public/availability-range")
  getHostAvailabilityRange(
    @Req() request: { headers: { host?: string } },
    @Query("serviceId") serviceId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("collaboratorId") collaboratorId?: string,
  ): Promise<unknown> {
    return this.getAvailabilityRangeResponse(
      serviceId,
      from,
      to,
      collaboratorId,
      undefined,
      request.headers.host,
    );
  }

  @Post("public/availability")
  @SetMetadata("alora.readOnly", true)
  async previewHostAvailability(
    @Req() request: { headers: { host?: string } },
    @Body() body: BookingAvailabilityDto,
  ): Promise<unknown> {
    const tenant = await this.resolveTenant(undefined, request.headers.host);
    return this.bookingAvailability.read(
      { tenantId: tenant.id, actorId: null, source: "public" },
      body,
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
    @Body() body: BookingCreateDto,
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

  @Get("public/:tenantSlug/availability-range")
  getAvailabilityRange(
    @Param("tenantSlug") tenantSlug: string,
    @Req() request: { headers: { host?: string } },
    @Query("serviceId") serviceId: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("collaboratorId") collaboratorId?: string,
  ): Promise<unknown> {
    return this.getAvailabilityRangeResponse(
      serviceId,
      from,
      to,
      collaboratorId,
      tenantSlug,
      request.headers.host,
    );
  }

  @Post("public/:tenantSlug/availability")
  @SetMetadata("alora.readOnly", true)
  async previewAvailability(
    @Param("tenantSlug") tenantSlug: string,
    @Req() request: { headers: { host?: string } },
    @Body() body: BookingAvailabilityDto,
  ): Promise<unknown> {
    const tenant = await this.resolveTenant(tenantSlug, request.headers.host);
    return this.bookingAvailability.read(
      { tenantId: tenant.id, actorId: null, source: "public" },
      body,
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
    @Body() body: BookingCreateDto,
  ): Promise<unknown> {
    return this.createBookingResponse(
      body,
      request.headers,
      tenantSlug,
      request.headers.host,
    );
  }
}
