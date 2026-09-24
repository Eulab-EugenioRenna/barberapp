import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
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
                  collaborator: true,
                },
              },
              customer: true,
              collaborator: true,
              appointment: {
                include: { customer: true, service: true, collaborator: true },
              },
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

    const [products, services, customer, collaborator, appointment, tenant] =
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
        this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { defaultCollaboratorId: true },
        }),
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

    normalizedItems = normalizedItems.map((item) => {
      const service = item.serviceId
        ? services.find((entry) => entry.id === item.serviceId)
        : undefined;
      return {
        ...item,
        collaboratorId:
          item.collaboratorId ||
          (service?.requiresCollaborator
            ? tenant?.defaultCollaboratorId ?? undefined
            : undefined),
      };
    });

    const serviceItemsWithoutCollaborator = normalizedItems.filter((item) => {
      const service = item.serviceId
        ? services.find((entry) => entry.id === item.serviceId)
        : undefined;
      return service?.requiresCollaborator && !item.collaboratorId;
    });
    if (serviceItemsWithoutCollaborator.length) {
      throw new BadRequestException(
        "Imposta un collaboratore per ogni servizio che lo richiede",
      );
    }

    const itemCollaboratorIds = [
      ...new Set(
        normalizedItems
          .map((item) => item.collaboratorId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (itemCollaboratorIds.length) {
      const validCollaborators = await this.prisma.collaborator.findMany({
        where: { tenantId, isActive: true, id: { in: itemCollaboratorIds } },
        select: { id: true },
      });
      if (validCollaborators.length !== itemCollaboratorIds.length) {
        throw new BadRequestException(
          "Collaboratore non valido in una riga servizio",
        );
      }
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
    const primaryCollaboratorId =
      serviceItems[0]?.collaboratorId ?? collaboratorId;

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
            collaboratorId: primaryCollaboratorId,
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

      if (resolvedAppointmentId) {
        const existingOrder = await transaction.sale.findFirst({
          where: { tenantId, appointmentId: resolvedAppointmentId },
          select: { id: true },
        });
        if (existingOrder) {
          throw new ConflictException(
            "Un ordine è già stato confermato per questa prenotazione",
          );
        }
      }

      const createdSale = await transaction.sale.create({
        data: {
          tenantId,
          customerId,
          collaboratorId: primaryCollaboratorId,
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
              collaborator: true,
            },
          },
          customer: true,
          collaborator: true,
          appointment: {
            include: { customer: true, service: true, collaborator: true },
          },
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
    }).catch((error: unknown) => {
      if (
        appointmentId &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "Un ordine è già stato confermato per questa prenotazione",
        );
      }
      throw error;
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
    const itemsInput = Array.isArray(body["items"])
      ? (body["items"] as Array<Record<string, unknown>>)
      : [];
    if (!itemsInput.length) {
      throw new BadRequestException("Aggiungi almeno un servizio o prodotto");
    }

    const sale = await this.prisma.sale.findFirst({
      where: { id, tenantId },
      select: { id: true, appointmentId: true, customerId: true },
    });
    if (!sale) {
      throw new NotFoundException("Ordine non trovato");
    }

    const customerId =
      typeof body["customerId"] === "string" && body["customerId"]
        ? body["customerId"]
        : undefined;
    const [products, services, customer, tenant] = await Promise.all([
      this.prisma.product.findMany({ where: { tenantId } }),
      this.prisma.service.findMany({ where: { tenantId } }),
      customerId
        ? this.prisma.customer.findFirst({
            where: { id: customerId, tenantId },
            select: { id: true },
          })
        : Promise.resolve(null),
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { defaultCollaboratorId: true },
      }),
    ]);
    if (customerId && !customer) {
      throw new BadRequestException("Cliente non valido");
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
    normalizedItems = normalizedItems.map((item) => {
      const service = item.serviceId
        ? services.find((entry) => entry.id === item.serviceId)
        : undefined;
      return {
        ...item,
        collaboratorId:
          item.collaboratorId ||
          (service?.requiresCollaborator
            ? tenant?.defaultCollaboratorId ?? undefined
            : undefined),
      };
    });

    const serviceItemsWithoutCollaborator = normalizedItems.filter((item) => {
      const service = item.serviceId
        ? services.find((entry) => entry.id === item.serviceId)
        : undefined;
      return service?.requiresCollaborator && !item.collaboratorId;
    });
    if (serviceItemsWithoutCollaborator.length) {
      throw new BadRequestException(
        "Imposta un collaboratore per ogni servizio che lo richiede",
      );
    }
    const itemCollaboratorIds = [
      ...new Set(
        normalizedItems
          .map((item) => item.collaboratorId)
          .filter((collaboratorId): collaboratorId is string =>
            Boolean(collaboratorId),
          ),
      ),
    ];
    if (itemCollaboratorIds.length) {
      const validCollaborators = await this.prisma.collaborator.findMany({
        where: { tenantId, id: { in: itemCollaboratorIds } },
        select: { id: true },
      });
      if (validCollaborators.length !== itemCollaboratorIds.length) {
        throw new BadRequestException(
          "Collaboratore non valido in una riga servizio",
        );
      }
    }

    const subtotal = normalizedItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );
    const discountTotal = normalizedItems.reduce(
      (sum, item) => sum + item.discount,
      0,
    );
    const taxTotal = normalizedItems.reduce(
      (sum, item) => sum + item.taxTotal,
      0,
    );
    const total = normalizedItems.reduce(
      (sum, item) => sum + item.lineTotal + item.taxTotal,
      0,
    );
    const primaryCollaboratorId =
      normalizedItems.find((item) => Boolean(item.serviceId))?.collaboratorId ??
      undefined;

    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.saleItem.deleteMany({ where: { saleId: id } });
      const updatedSale = await transaction.sale.update({
        where: { id },
        data: {
          customerId,
          collaboratorId: primaryCollaboratorId,
          subtotal,
          discountTotal,
          taxTotal,
          total,
          paymentStatus:
            typeof body["paymentStatus"] === "string" &&
            ["unpaid", "paid", "partial", "refunded", "cancelled"].includes(
              body["paymentStatus"],
            )
              ? (body["paymentStatus"] as never)
              : undefined,
          paymentMethod:
            typeof body["paymentMethod"] === "string"
              ? body["paymentMethod"]
              : undefined,
          items: { create: normalizedItems },
        },
        include: {
          items: {
            include: { product: true, service: true, collaborator: true },
          },
          customer: true,
          collaborator: true,
          appointment: {
            include: { customer: true, service: true, collaborator: true },
          },
        },
      });
      if (sale.appointmentId) {
        await transaction.appointment.update({
          where: { id: sale.appointmentId },
          data: { finalPrice: total },
        });
      }
      return updatedSale;
    });

    await Promise.all([
      this.cacheInvalidationService.invalidateSales(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
      this.cacheInvalidationService.invalidateCustomers(tenantId),
      ...(sale.appointmentId
        ? [this.cacheInvalidationService.invalidateAppointments(tenantId)]
        : []),
    ]);
    return resolveSaleLabels(updated);
  }

  @Patch(":id/link-appointment")
  async linkAppointment(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const appointmentId =
      typeof body["appointmentId"] === "string" && body["appointmentId"]
        ? body["appointmentId"]
        : "";
    if (!appointmentId) {
      throw new BadRequestException("Seleziona una prenotazione");
    }

    const [sale, appointment, existingOrder] = await Promise.all([
      this.prisma.sale.findFirst({
        where: { id, tenantId },
        select: { id: true, appointmentId: true },
      }),
      this.prisma.appointment.findFirst({
        where: { id: appointmentId, tenantId },
        select: { id: true },
      }),
      this.prisma.sale.findFirst({
        where: { tenantId, appointmentId, NOT: { id } },
        select: { id: true },
      }),
    ]);
    if (!sale) {
      throw new NotFoundException("Ordine non trovato");
    }
    if (!appointment) {
      throw new BadRequestException("Prenotazione non valida");
    }
    if (existingOrder) {
      throw new ConflictException(
        "Un ordine e gia collegato a questa prenotazione",
      );
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      if (sale.appointmentId && sale.appointmentId !== appointmentId) {
        await transaction.appointment.update({
          where: { id: sale.appointmentId },
          data: { finalPrice: null },
        });
      }
      const linked = await transaction.sale.update({
        where: { id },
        data: { appointmentId },
        include: {
          items: {
            include: { product: true, service: true, collaborator: true },
          },
          customer: true,
          collaborator: true,
          appointment: {
            include: { customer: true, service: true, collaborator: true },
          },
        },
      });
      await transaction.appointment.update({
        where: { id: appointmentId },
        data: { finalPrice: linked.total, status: "completed" },
      });
      return linked;
    });

    await Promise.all([
      this.cacheInvalidationService.invalidateSales(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
      this.cacheInvalidationService.invalidateCustomers(tenantId),
      this.cacheInvalidationService.invalidateAppointments(tenantId),
    ]);
    return resolveSaleLabels(updated);
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
    const sale = await this.prisma.sale.findFirst({
      where: { id, tenantId },
      select: { id: true, appointmentId: true, customerId: true },
    });
    if (!sale) {
      throw new NotFoundException("Ordine non trovato");
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.sale.delete({ where: { id } });
      if (sale.appointmentId) {
        await transaction.appointment.update({
          where: { id: sale.appointmentId },
          data: { finalPrice: null },
        });
      }
    });
    await Promise.all([
      this.cacheInvalidationService.invalidateSales(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
      this.cacheInvalidationService.invalidateCustomers(tenantId),
      ...(sale.appointmentId
        ? [this.cacheInvalidationService.invalidateAppointments(tenantId)]
        : []),
    ]);
    return { deleted: true };
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
                collaborator: true,
              },
            },
            customer: true,
            collaborator: true,
            appointment: {
              include: {
                customer: true,
                service: true,
                collaborator: true,
              },
            },
          },
        });

        return sale ? resolveSaleLabels(sale) : sale;
      },
    );
  }
}
