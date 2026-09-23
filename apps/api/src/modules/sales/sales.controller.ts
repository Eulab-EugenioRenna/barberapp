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
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import { CACHE_TTL_SECONDS, cacheKeys } from "../../cache/cache.constants";
import { AppCacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  requireTenantId,
  requireUser,
  resolveRequestSession,
} from "../../common/request-session";
import {
  buildPaginatedResult,
  parsePagination,
} from "../../common/pagination";
import { CustomersAlignmentService } from "../customers/customers-alignment.service";
import {
  calculateRetroactiveAppointment,
  normalizeOrderItems,
  resolveSaleLabels,
} from "./sales.logic";

@Controller("sales")
export class SalesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly cacheInvalidationService: CacheInvalidationService,
    private readonly customersAlignmentService: CustomersAlignmentService,
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
    const { page, pageSize, skip, take } = parsePagination(query);

    return this.cacheService.getOrSet(
      `${cacheKeys.salesList(tenantId)}:p${page}:s${pageSize}`,
      CACHE_TTL_SECONDS.lists,
      async () => {
        const [items, total] = await Promise.all([
          this.prisma.sale.findMany({
            where: { tenantId },
            orderBy: { soldAt: "desc" },
            skip,
            take,
            include: {
              items: {
                include: {
                  product: true,
                  service: true,
                },
              },
              customer: true,
              collaborator: true,
              appointment: true,
            },
          }),
          this.prisma.sale.count({ where: { tenantId } }),
        ]);

        return buildPaginatedResult(
          items.map((sale) => resolveSaleLabels(sale)),
          total,
          page,
          pageSize,
        );
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
    const user = requireUser(session);
    const itemsInput = Array.isArray(body["items"])
      ? (body["items"] as Array<Record<string, unknown>>)
      : [];
    const customerId =
      typeof body["customerId"] === "string" && body["customerId"]
        ? body["customerId"]
        : undefined;
    const collaboratorId =
      typeof body["collaboratorId"] === "string" && body["collaboratorId"]
        ? body["collaboratorId"]
        : undefined;
    const appointmentId =
      typeof body["appointmentId"] === "string" && body["appointmentId"]
        ? body["appointmentId"]
        : undefined;
    const paymentStatus =
      typeof body["paymentStatus"] === "string" &&
      ["unpaid", "paid", "partial", "refunded", "cancelled"].includes(
        body["paymentStatus"],
      )
        ? body["paymentStatus"]
        : "paid";

    if (!itemsInput.length) {
      throw new BadRequestException("Aggiungi almeno un servizio o prodotto");
    }

    const [products, services, customer, collaborator, appointment] =
      await Promise.all([
        this.prisma.product.findMany({ where: { tenantId, isActive: true } }),
        this.prisma.service.findMany({ where: { tenantId, isActive: true } }),
        customerId
          ? this.prisma.customer.findFirst({
              where: { id: customerId, tenantId, isActive: true },
              select: { id: true },
            })
          : Promise.resolve(null),
        collaboratorId
          ? this.prisma.collaborator.findFirst({
              where: { id: collaboratorId, tenantId, isActive: true },
              select: { id: true },
            })
          : Promise.resolve(null),
        appointmentId
          ? this.prisma.appointment.findFirst({
              where: { id: appointmentId, tenantId },
              select: { id: true },
            })
          : Promise.resolve(null),
      ]);

    if (customerId && !customer) {
      throw new BadRequestException("Cliente non valido");
    }
    if (collaboratorId && !collaborator) {
      throw new BadRequestException("Collaboratore non valido");
    }
    if (appointmentId && !appointment) {
      throw new BadRequestException("Prenotazione non valida");
    }

    let normalizedItems;
    try {
      normalizedItems = normalizeOrderItems({
        items: itemsInput,
        products,
        services,
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Ordine non valido",
      );
    }

    const subtotal = normalizedItems.reduce(
      (total, item) => total + item.quantity * item.unitPrice,
      0,
    );
    const discountTotal = normalizedItems.reduce(
      (total, item) => total + item.discount,
      0,
    );
    const taxTotal = normalizedItems.reduce(
      (total, item) => total + item.taxTotal,
      0,
    );
    const total = normalizedItems.reduce(
      (sum, item) => sum + item.lineTotal + item.taxTotal,
      0,
    );
    const soldAt = body["soldAt"]
      ? new Date(String(body["soldAt"]))
      : new Date();
    if (Number.isNaN(soldAt.getTime())) {
      throw new BadRequestException("Data vendita non valida");
    }
    const retroactiveAppointment = calculateRetroactiveAppointment({
      soldAt,
      items: normalizedItems,
      services,
    });
    const serviceItems = retroactiveAppointment.serviceItems;

    if (serviceItems.length && !customerId) {
      throw new BadRequestException(
        "Seleziona un cliente per registrare i servizi in calendario",
      );
    }

    const created = await this.prisma.$transaction(async (transaction) => {
      let resolvedAppointmentId = appointmentId;

      if (!resolvedAppointmentId && serviceItems.length && customerId) {
        const firstServiceItem = serviceItems[0];
        const generatedAppointment = await transaction.appointment.create({
          data: {
            tenantId,
            customerId,
            serviceId: firstServiceItem.serviceId as string,
            collaboratorId,
            startsAt: retroactiveAppointment.startsAt,
            endsAt: retroactiveAppointment.endsAt,
            status: "completed",
            source: "internal",
            estimatedPrice: retroactiveAppointment.serviceTotal,
            finalPrice: retroactiveAppointment.serviceTotal,
            internalNotes:
              serviceItems.length > 1
                ? `Ordine rapido con ${serviceItems.length} servizi; durata totale ${retroactiveAppointment.durationMinutes} minuti.`
                : "Ordine rapido registrato a consuntivo.",
            createdById: user.id,
            updatedById: user.id,
          },
        });
        resolvedAppointmentId = generatedAppointment.id;
      }

      const createdSale = await transaction.sale.create({
        data: {
          tenantId,
          customerId,
          collaboratorId,
          appointmentId: resolvedAppointmentId,
          subtotal,
          discountTotal,
          taxTotal,
          total,
          paymentStatus: paymentStatus as never,
          paymentMethod:
            typeof body["paymentMethod"] === "string"
              ? body["paymentMethod"]
              : undefined,
          soldAt,
          createdById: user.id,
          items: {
            create: normalizedItems,
          },
        },
        include: {
          items: {
            include: {
              product: true,
              service: true,
            },
          },
          customer: true,
          collaborator: true,
          appointment: true,
        },
      });

      if (resolvedAppointmentId) {
        await transaction.appointment.updateMany({
          where: {
            id: resolvedAppointmentId,
            status: { notIn: ["cancelled", "no_show"] },
          },
          data: { finalPrice: total, status: "completed" },
        });
      }

      return createdSale;
    });

    await Promise.all([
      this.cacheInvalidationService.invalidateSales(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
      this.cacheInvalidationService.invalidateCustomers(tenantId),
      ...(serviceItems.length
        ? [this.cacheInvalidationService.invalidateAppointments(tenantId)]
        : []),
      ...(created.customerId
        ? [
            this.customersAlignmentService.queueCustomerRefresh(
              tenantId,
              created.customerId,
              "sale_created",
            ),
          ]
        : []),
    ]);

    return created;
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
      cacheKeys.saleDetail(tenantId, id),
      CACHE_TTL_SECONDS.lists,
      async () => {
        const sale = await this.prisma.sale.findFirst({
          where: { id, tenantId },
          include: {
            items: {
              include: {
                product: true,
                service: true,
              },
            },
            customer: true,
            collaborator: true,
            appointment: true,
          },
        });

        return sale ? resolveSaleLabels(sale) : sale;
      },
    );
  }
}
