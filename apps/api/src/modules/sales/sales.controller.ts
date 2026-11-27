import { beginAppointmentEvents } from "../notifications/appointment-events";
import { SaleFulfilmentService } from "./sale-fulfilment.service";
import { randomUUID } from "node:crypto";
import { OrderCommandService } from "../orders/order-command.service";
import { saleCommandResult, SALE_COMMAND_INCLUDE } from "./sale-command-result";
import { PaymentsService } from "../payments/payments.service";
import { settledStatus } from "../payments/payment-balance";
import { applyBookingCancellation } from "../orders/booking-cancellation";
import { setOperationalActor } from "../../common/operational-lock";
import { InventoryService } from "../inventory/inventory.service";
import { sumPricedLines, decimalInput } from "../pricing/money";
import { OperationalOrderService } from "../orders/operational-order.service";
import { attributeOrder } from "../locations/order-attribution";
import type { Prisma } from "@prisma/client";
import {
  type OperationalScope,
  resolveOperationalScope,
  saleFilter,
  sectorFilter,
  serviceScopeFilter,
  collaboratorFilter,
} from "../locations/operational-scope";
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
  SetMetadata,
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
import { buildPaginatedResult, parsePagination } from "../../common/pagination";
import { CustomersAlignmentService } from "../customers/customers-alignment.service";
import { normalizeOrderItems, resolveSaleLabels } from "./sales.logic";
import { parseServicesStartAt, SaleScheduleWarningsService } from "./sale-schedule";

@Controller("sales")
export class SalesController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly fulfilment: SaleFulfilmentService,
    private readonly payments: PaymentsService,
    private readonly commands: OrderCommandService,
    private readonly orders: OperationalOrderService,
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly cacheInvalidationService: CacheInvalidationService,
    private readonly customersAlignmentService: CustomersAlignmentService,
    private readonly scheduleWarnings: SaleScheduleWarningsService,
  ) {}

  private totals(items: Parameters<typeof sumPricedLines>[0]) {
    try {
      return sumPricedLines(items);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Totale non valido",
      );
    }
  }

  @Post("quote")
  @SetMetadata("alora.readOnly", true)
  async quote(
    @Req() request: { headers: { authorization?: string } },
    @Body() body: Record<string, unknown>,
  ) {
    const session = await resolveRequestSession(
        this.prisma,
        request.headers.authorization,
      ),
      tenantId = requireTenantId(session);
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const sale =
      typeof body["saleId"] === "string"
        ? await this.prisma.sale.findFirst({
            where: { id: body["saleId"], tenantId, ...saleFilter(scope) },
            include: { items: true },
          })
        : null;
    if (body["saleId"] && !sale)
      throw new NotFoundException("Conto non accessibile");
    const input = Array.isArray(body["items"])
      ? (body["items"] as Array<Record<string, unknown>>)
      : [];
    const [products, services] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          tenantId,
          OR: [
            { isActive: true },
            {
              id: {
                in:
                  sale?.items.flatMap((row) =>
                    row.productId ? [row.productId] : [],
                  ) ?? [],
              },
            },
          ],
        },
      }),
      this.prisma.service.findMany({
        where: {
          tenantId,
          OR: [
            { ...serviceScopeFilter(scope), isActive: true },
            {
              id: {
                in:
                  sale?.items.flatMap((row) =>
                    row.serviceId ? [row.serviceId] : [],
                  ) ?? [],
              },
            },
          ],
        },
      }),
    ]);
    try {
      const items = normalizeOrderItems({
        items: input,
        products,
        services,
        existing: sale?.items,
        orderDiscount: body["orderDiscount"] ?? sale?.orderDiscount ?? 0,
      });
      const totals = sumPricedLines(items);
      const startAt = parseServicesStartAt(body["servicesStartAt"]);
      // Checks use the sector of each service's activity at the account's location.
      const quoteLocation =
        sale?.locationId ||
        (typeof body["locationId"] === "string" ? body["locationId"] : "");
      const localSectors = quoteLocation
        ? await this.prisma.sector.findMany({
            where: { tenantId, locationId: quoteLocation },
            select: { id: true, activityId: true },
          })
        : [];
      const booked = new Set(
        (sale?.items ?? []).filter((row) => row.serviceId).map((row) => row.id),
      );
      const warnings = startAt
        ? await this.scheduleWarnings.warnings(
            tenantId,
            startAt,
            items.map((row: any, index) => {
              const service = services.find((entry) => entry.id === row.serviceId);
              const raw = input[index] ?? {};
              return {
                serviceId: row.serviceId ?? null,
                sectorId:
                  row.sectorId ??
                  localSectors.find((sector) => sector.activityId === service?.activityId)?.id ??
                  service?.sectorId ??
                  null,
                collaboratorId:
                  row.collaboratorId ??
                  (typeof raw["collaboratorId"] === "string" ? raw["collaboratorId"] : null),
                durationMinutes: service?.durationMinutes ?? 0,
                label: service?.name ?? "Servizio",
                // Lines already in the agenda keep their slot.
                booked: typeof raw["id"] === "string" && booked.has(raw["id"]),
              };
            }),
            sale?.id,
          ).catch(() => [])
        : [];
      return { items, ...totals, warnings };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Conto non valido",
      );
    }
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
    const { page, pageSize, skip, take } = parsePagination(query);

    return this.cacheService.getOrSet(
      `${cacheKeys.salesList(tenantId)}:p${page}:s${pageSize}`,
      CACHE_TTL_SECONDS.lists,
      async () => {
        const [items, total] = await Promise.all([
          this.prisma.sale.findMany({
            where: { tenantId, orderStatus: "confirmed", ...saleFilter(scope) },
            orderBy: { soldAt: "desc" },
            skip,
            take,
            include: {
              items: {
                orderBy: [{ position: "asc" }, { id: "asc" }],
                include: {
                  product: true,
                  service: true,
                  collaborator: true,
                  booking: {
                    select: {
                      id: true,
                      status: true,
                      startsAt: true,
                      endsAt: true,
                      collaboratorId: true,
                    },
                  },
                },
              },
              customer: true,
              collaborator: true,
              appointment: {
                include: { customer: true, service: true, collaborator: true },
              },
            },
          }),
          this.prisma.sale.count({
            where: { tenantId, orderStatus: "confirmed", ...saleFilter(scope) },
          }),
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

  /**
   * Open accounts that belong to the till today: saved open at the counter or
   * booked for a time already reached. Future bookings stay in the agenda.
   */
  @Get("open")
  async findOpen(
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
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const items = await this.prisma.sale.findMany({
      where: {
        tenantId,
        orderStatus: "open",
        ...saleFilter(scope),
        OR: [{ orderOrigin: "cashier" }, { soldAt: { lte: endOfToday } }],
      },
      orderBy: { soldAt: "asc" },
      take: 100,
      include: {
        items: {
          orderBy: [{ position: "asc" }, { id: "asc" }],
          include: {
            product: true,
            service: true,
            collaborator: true,
            booking: {
              select: {
                id: true,
                status: true,
                startsAt: true,
                endsAt: true,
                collaboratorId: true,
              },
            },
          },
        },
        customer: true,
        collaborator: true,
        appointment: {
          include: { customer: true, service: true, collaborator: true },
        },
      },
    });
    return items.map((sale) => resolveSaleLabels(sale));
  }

  @Get("for-appointment/:appointmentId")
  async forAppointment(
    @Req() request: { headers: { authorization?: string } },
    @Param("appointmentId") appointmentId: string,
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
    const booking = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId, ...sectorFilter(scope) },
      select: { orderIssue: true, orderItem: { select: { saleId: true } } },
    });
    if (!booking) throw new NotFoundException("Appuntamento non trovato");
    if (booking.orderIssue || !booking.orderItem)
      throw new ConflictException(
        "Riconcilia prima il collegamento storico del conto",
      );
    const sale = await this.prisma.sale.findFirst({
      where: { id: booking.orderItem.saleId, tenantId, ...saleFilter(scope) },
      include: {
        items: {
          orderBy: [{ position: "asc" }, { id: "asc" }],
          include: {
            service: true,
            product: true,
            collaborator: true,
            booking: {
              select: {
                id: true,
                status: true,
                startsAt: true,
                endsAt: true,
                collaboratorId: true,
              },
            },
          },
        },
        customer: true,
      },
    });
    if (!sale) throw new NotFoundException("Conto non accessibile");
    return resolveSaleLabels(sale);
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
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
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
    if (appointmentId) {
      const booking = await this.prisma.appointment.findFirst({
        where: { id: appointmentId, tenantId, ...sectorFilter(scope) },
        select: {
          orderIssue: true,
          orderItem: {
            select: { saleId: true, sale: { select: { orderStatus: true } } },
          },
        },
      });
      if (!booking) throw new BadRequestException("Appuntamento non valido");
      if (booking.orderIssue || !booking.orderItem)
        throw new ConflictException(
          "Riconcilia prima il collegamento storico del conto",
        );
      if (booking.orderItem.sale.orderStatus !== "open") {
        const prior =
          typeof body["idempotencyKey"] === "string"
            ? await this.prisma.orderOperation.findUnique({
                where: {
                  tenantId_idempotencyKey: {
                    tenantId,
                    idempotencyKey: body["idempotencyKey"],
                  },
                },
              })
            : null;
        if (
          !prior ||
          prior.kind !== "update_sale" ||
          prior.saleId !== booking.orderItem.saleId
        )
          throw new ConflictException(
            "Il conto è già registrato. Aprilo per modificarlo",
          );
      }
      return this.update(request, booking.orderItem.saleId, {
        ...body,
        orderStatus: "confirmed",
      });
    }
    const command = this.commands.command(
      { tenantId, actorId: user.id, source: "internal", scope },
      "create_sale",
      body["idempotencyKey"],
      body,
    );
    const outcome = await this.prisma.$transaction(
      async (transaction) => {
        await this.orders.lock(transaction, tenantId);
        await setOperationalActor(transaction, user.id);
        const previous = await this.commands.replay(transaction, command);
        if (previous)
          return {
            result: previous.result,
            replayed: true,
            customerId: previous.sale.customerId,
            warnings: [] as string[],
          };
        const recordEvents = await beginAppointmentEvents(
          transaction,
          command.context,
          typeof body["appointmentId"] === "string"
            ? { id: body["appointmentId"] }
            : undefined,
        );
        const paymentStatus =
          typeof body["paymentStatus"] === "string" &&
          ["unpaid", "paid", "partial", "refunded", "cancelled"].includes(
            body["paymentStatus"],
          )
            ? body["paymentStatus"]
            : "unpaid";

        if (
          body["paymentStatus"] !== undefined &&
          body["paymentStatus"] !== paymentStatus
        )
          throw new BadRequestException("Stato pagamento non valido");
        if (!itemsInput.length) {
          throw new BadRequestException(
            "Aggiungi almeno un servizio o prodotto",
          );
        }

        const [products, services, customer, collaborator, appointment] =
          await Promise.all([
            transaction.product.findMany({
              where: { tenantId, isActive: true },
            }),
            transaction.service.findMany({
              where: { tenantId, ...serviceScopeFilter(scope), isActive: true },
            }),
            customerId
              ? transaction.customer.findFirst({
                  where: { id: customerId, tenantId, isActive: true },
                  select: { id: true },
                })
              : Promise.resolve(null),
            collaboratorId
              ? transaction.collaborator.findFirst({
                  where: {
                    id: collaboratorId,
                    tenantId,
                    ...collaboratorFilter(scope),
                    isActive: true,
                  },
                  select: { id: true },
                })
              : Promise.resolve(null),
            appointmentId
              ? transaction.appointment.findFirst({
                  where: {
                    id: appointmentId,
                    tenantId,
                    ...sectorFilter(scope),
                  },
                  select: {
                    id: true,
                    serviceId: true,
                    sectorId: true,
                    collaboratorId: true,
                  },
                })
              : Promise.resolve(null),
          ]);

        if (customerId && !customer) {
          throw new BadRequestException("Cliente non valido");
        }
        if (collaboratorId && !collaborator) {
          throw new BadRequestException("Professionista non valido");
        }
        if (appointmentId && !appointment) {
          throw new BadRequestException("Appuntamento non valido");
        }

        if (
          appointment &&
          !services.some((service) => service.id === appointment.serviceId)
        ) {
          const bookedService = await transaction.service.findFirst({
            where: { id: appointment.serviceId, tenantId },
          });
          if (bookedService) services.push(bookedService);
        }

        let normalizedItems;
        try {
          normalizedItems = normalizeOrderItems({
            items: itemsInput,
            products,
            services,
            orderDiscount: body["orderDiscount"] ?? 0,
          });
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error ? error.message : "Vendita non valida",
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
          const validCollaborators = await transaction.collaborator.findMany({
            where: {
              tenantId,
              OR: [
                { ...collaboratorFilter(scope), isActive: true },
                ...(appointment?.collaboratorId
                  ? [{ id: appointment.collaboratorId }]
                  : []),
              ],
              id: { in: itemCollaboratorIds },
            },
            select: { id: true },
          });
          if (validCollaborators.length !== itemCollaboratorIds.length) {
            throw new BadRequestException(
              "Il professionista scelto per un servizio non è valido",
            );
          }
        }

        const attribution = await attributeOrder(
          transaction,
          scope,
          normalizedItems,
          itemsInput,
          { locationId: body["locationId"], appointmentId },
        );
        normalizedItems = attribution.items;

        const { subtotal, discountTotal, taxTotal, total } =
          this.totals(normalizedItems);

        const soldAt = body["soldAt"]
          ? new Date(String(body["soldAt"]))
          : new Date();
        if (Number.isNaN(soldAt.getTime())) {
          throw new BadRequestException("Data vendita non valida");
        }
        // "Eseguito alle": services go in the agenda from that time, even in the past.
        const servicesStartAt = parseServicesStartAt(body["servicesStartAt"]);
        const serviceItems = normalizedItems.filter((row) => row.serviceId);
        const primaryCollaboratorId = serviceItems.length
          ? (serviceItems[0].collaboratorId ?? null)
          : collaboratorId;

        if (serviceItems.length && !customerId) {
          throw new BadRequestException(
            "Seleziona un cliente per registrare i servizi in calendario",
          );
        }

        if (serviceItems.some((item) => item.quantity !== 1))
          throw new BadRequestException(
            "Aggiungi ogni prestazione come riga separata",
          );
        const rowInputs = normalizedItems.map((item, position) => ({
          ...item,
          id: randomUUID(),
          stockState: "pending",
          position,
        }));
        const createdSale = await transaction.sale.create({
          data: {
            tenantId,
            locationId: attribution.locationId,
            customerId,
            collaboratorId: primaryCollaboratorId,
            appointmentId: null,
            orderDiscount: decimalInput(
              body["orderDiscount"] ?? 0,
              "Sconto complessivo",
            ).toFixed(2),
            subtotal,
            discountTotal,
            taxTotal,
            total,
            orderOrigin: "cashier",
            orderStatus: "confirmed",
            paymentBasis: "ledger",
            paymentStatus: "unpaid",
            paymentMethod: null,
            soldAt,
            createdById: user.id,
            items: {
              create: rowInputs,
            },
          },
          include: SALE_COMMAND_INCLUDE,
        });

        await this.fulfilment.confirm(transaction, createdSale.id, user.id, {
          orderStatus: "new",
          items: [],
          rowOrder: rowInputs.map((row) => row.id),
          servicesStartAt,
        });

        const warnings = await this.inventory.postOrder(
          transaction,
          createdSale.id,
          user.id,
        );
        await this.payments.cashierDeclaration(
          transaction,
          scope,
          user.id,
          createdSale.id,
          { ...body, paymentStatus },
        );
        const current = await transaction.sale.findFirstOrThrow({
          where: { id: createdSale.id, tenantId },
          include: SALE_COMMAND_INCLUDE,
        });
        const result = saleCommandResult({
          ...current,
          items: rowInputs.map(
            (input) => current.items.find((row) => row.id === input.id)!,
          ),
        });
        const operation = await this.commands.save(
          transaction,
          command,
          current.id,
          result,
        );
        await recordEvents({ orderItem: { saleId: current.id } }, operation.id);
        await transaction.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        return {
          result,
          replayed: false,
          customerId: current.customerId,
          warnings,
        };
      },
      { timeout: 15000 },
    );
    await Promise.all([
      this.cacheInvalidationService.invalidateSales(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
      this.cacheInvalidationService.invalidateCustomers(tenantId),
      this.cacheInvalidationService.invalidateAppointments(tenantId),
      ...(!outcome.replayed && outcome.customerId
        ? [
            this.customersAlignmentService.queueCustomerRefresh(
              tenantId,
              outcome.customerId,
              "sale_created",
            ),
          ]
        : []),
    ]);
    return outcome.warnings.length
      ? { ...(outcome.result as object), warnings: outcome.warnings }
      : outcome.result;
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
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const itemsInput = Array.isArray(body["items"])
      ? (body["items"] as Array<Record<string, unknown>>)
      : [];
    if (!itemsInput.length) {
      throw new BadRequestException("Aggiungi almeno un servizio o prodotto");
    }

    const command = this.commands.command(
      { tenantId, actorId: requireUser(session).id, source: "internal", scope },
      "update_sale",
      body["idempotencyKey"],
      { saleId: id, input: body },
    );
    const updated = await this.prisma.$transaction(
      async (transaction) => {
        await this.orders.lock(transaction, tenantId);
        await setOperationalActor(transaction, requireUser(session).id);
        const replay = await this.commands.replay(transaction, command);
        if (replay) return replay.result;
        const recordEvents = await beginAppointmentEvents(
          transaction,
          command.context,
          { orderItem: { saleId: id } },
        );
        const sale = await transaction.sale.findFirst({
          where: { id, tenantId, ...saleFilter(scope) },
          include: { items: true },
        });
        if (!sale) {
          throw new NotFoundException("Vendita non trovata");
        }

        if (sale.orderStatus === "cancelled")
          throw new ConflictException(
            "Il conto annullato conserva righe e valori. Registra gli eventuali rimborsi separatamente.",
          );
        const editScope = {
          ...scope,
          sectorIds: scope.allowedSectorIds,
          locationIds: [sale.locationId],
        };
        const customerId =
          typeof body["customerId"] === "string" && body["customerId"]
            ? body["customerId"]
            : undefined;
        const [products, services, customer] = await Promise.all([
          transaction.product.findMany({ where: { tenantId } }),
          transaction.service.findMany({
            where: {
              tenantId,
              OR: [
                serviceScopeFilter(scope),
                {
                  id: {
                    in: sale.items.flatMap((item) =>
                      item.serviceId ? [item.serviceId] : [],
                    ),
                  },
                },
              ],
            },
          }),
          customerId
            ? transaction.customer.findFirst({
                where: { id: customerId, tenantId },
                select: { id: true },
              })
            : Promise.resolve(null),
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
            existing: sale.items,
            orderDiscount: body["orderDiscount"] ?? sale.orderDiscount,
          });
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error ? error.message : "Vendita non valida",
          );
        }
        const attribution = await attributeOrder(
          transaction,
          editScope,
          normalizedItems,
          itemsInput,
          { existing: sale, locationId: body["locationId"] },
        );
        normalizedItems = attribution.items;
        const newlyAssignedIds = [
          ...new Set(
            attribution.items.flatMap((row) =>
              row.collaboratorId &&
              !sale.items.some(
                (old) =>
                  old.id === row.id &&
                  old.serviceId === row.serviceId &&
                  old.collaboratorId === row.collaboratorId,
              )
                ? [row.collaboratorId]
                : [],
            ),
          ),
        ];
        if (
          newlyAssignedIds.length &&
          (await transaction.collaborator.count({
            where: {
              tenantId,
              ...collaboratorFilter(editScope),
              isActive: true,
              id: { in: newlyAssignedIds },
            },
          })) !== newlyAssignedIds.length
        ) {
          throw new BadRequestException(
            "Il professionista scelto per una nuova prestazione non è valido",
          );
        }
        // A deactivated article can still be sold or moved between rows of an
        // existing account: deactivation only hides it from the catalogue.
        const { subtotal, discountTotal, taxTotal, total } =
          this.totals(normalizedItems);

        const keepOpen =
          body["orderStatus"] === "open" && sale.orderStatus === "open";
        const fresh = sale;
        this.orders.assertRevision(fresh, body["revision"] ?? sale.revision);
        let ledgerStatus:
          | "paid"
          | "unpaid"
          | "partial"
          | "refunded"
          | undefined;
        if (fresh.paymentBasis === "ledger") {
          // A total below what was paid is refunded by cashierDeclaration below.
          const receipts = await transaction.paymentEntry.findMany({
            where: { saleId: id, tenantId },
          });
          ledgerStatus = settledStatus(total, receipts);
        }
        const booked = await transaction.appointment.findMany({
          where: { tenantId, orderItem: { saleId: id } },
          select: {
            id: true,
            orderItemId: true,
            serviceId: true,
            sectorId: true,
            customerId: true,
            status: true,
          },
        });
        for (const booking of booked) {
          const row = attribution.items.find(
            (item) => item.id === booking.orderItemId,
          );
          if (
            !row ||
            row.serviceId !== booking.serviceId ||
            row.sectorId !== booking.sectorId ||
            row.quantity !== 1
          )
            throw new ConflictException(
              "Modifica o annulla il servizio prenotato dall'agenda prima di rimuoverlo dal conto",
            );
          if (customerId && customerId !== booking.customerId)
            throw new BadRequestException(
              "Il cliente del conto deve coincidere con la prenotazione",
            );
        }
        const stoppedRows = new Set(
          booked
            .filter((row) => ["cancelled", "no_show"].includes(row.status))
            .map((row) => row.orderItemId),
        );
        for (const item of attribution.items)
          if (
            item.nonPerformanceChargeReason &&
            !stoppedRows.has(item.id || "")
          )
            throw new BadRequestException(
              "La quota per mancata prestazione richiede un servizio già annullato o non presentato",
            );
        const primaryCollaboratorId =
          attribution.items.find(
            (item) => item.serviceId && !stoppedRows.has(item.id || ""),
          )?.collaboratorId ?? null;
        const rowOrder = attribution.items.map(
          (item) => item.id || randomUUID(),
        );
        await transaction.saleItem.deleteMany({
          where: {
            saleId: id,
            sale: { tenantId },
            id: {
              notIn: attribution.items.flatMap((item) =>
                item.id ? [item.id] : [],
              ),
            },
          },
        });
        for (const [position, item] of attribution.items.entries()) {
          if (item.id) {
            const { id: rowId, ...data } = item;
            await transaction.saleItem.update({
              where: { id: rowId, saleId: id },
              data: { ...data, collaboratorId: data.collaboratorId ?? null, position },
            });
          }
        }
        const updatedSale = await transaction.sale.update({
          where: { id, tenantId },
          data: {
            customerId: customerId ?? sale.customerId,
            collaboratorId: primaryCollaboratorId,
            revision: { increment: 1 },
            orderStatus: keepOpen ? "open" : "confirmed",
            orderDiscount: decimalInput(
              body["orderDiscount"] ?? sale.orderDiscount,
              "Sconto complessivo",
            ).toFixed(2),
            subtotal,
            discountTotal,
            taxTotal,
            total,
            paymentStatus:
              fresh.paymentBasis === "ledger"
                ? ledgerStatus
                : fresh.paymentStatus,
            paymentMethod: fresh.paymentMethod,
            items: {
              create: attribution.items.flatMap((item, index) =>
                item.id
                  ? []
                  : [{ ...item, id: rowOrder[index], stockState: "pending", position: index }],
              ),
            },
          },
          include: {
            items: {
              orderBy: [{ position: "asc" }, { id: "asc" }],
              include: {
                product: true,
                service: true,
                collaborator: true,
                booking: {
                  select: {
                    id: true,
                    status: true,
                    startsAt: true,
                    endsAt: true,
                    collaboratorId: true,
                  },
                },
              },
            },
            customer: true,
            collaborator: true,
            appointment: {
              include: { customer: true, service: true, collaborator: true },
            },
          },
        });
        await this.fulfilment.confirm(
          transaction,
          updatedSale.id,
          requireUser(session).id,
          {
            orderStatus: sale.orderStatus,
            items: sale.items,
            rowOrder,
            servicesStartAt: parseServicesStartAt(body["servicesStartAt"]),
          },
        );
        const warnings = await this.inventory.postOrder(
          transaction,
          updatedSale.id,
          requireUser(session).id,
        );
        await this.payments.cashierDeclaration(
          transaction,
          scope,
          requireUser(session).id,
          updatedSale.id,
          body,
        );
        const current = await transaction.sale.findUniqueOrThrow({
          where: { id },
          include: SALE_COMMAND_INCLUDE,
        });
        const result = saleCommandResult(current);
        const operation = await this.commands.save(
          transaction,
          command,
          id,
          result,
        );
        await recordEvents({ orderItem: { saleId: id } }, operation.id);
        await transaction.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        return warnings.length ? { ...result, warnings } : result;
      },
      { timeout: 15000 },
    );

    await Promise.all([
      this.cacheInvalidationService.invalidateSales(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
      this.cacheInvalidationService.invalidateCustomers(tenantId),
      this.cacheInvalidationService.invalidateAppointments(tenantId),
    ]);
    return updated;
  }

  /** Corregge il cliente sbagliato: conto e prenotazioni cambiano insieme, importi e incassi restano. */
  @Post(":id/customer")
  async changeCustomer(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
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
    const customerId =
      typeof body["customerId"] === "string" ? body["customerId"] : "";
    if (!customerId) throw new BadRequestException("Scegli il cliente giusto");
    const actorId = requireUser(session).id;
    const command = this.commands.command(
      { tenantId, actorId, source: "internal", scope },
      "update_sale",
      body["idempotencyKey"],
      { saleId: id, changeCustomer: customerId },
    );
    const outcome = await this.prisma.$transaction(
      async (transaction) => {
        await this.orders.lock(transaction, tenantId);
        await setOperationalActor(transaction, actorId);
        const replay = await this.commands.replay(transaction, command);
        if (replay)
          return { result: replay.result, previous: null, customerId: null };
        const sale = await transaction.sale.findFirst({
          where: { id, tenantId, ...saleFilter(scope) },
          select: { id: true, customerId: true, orderStatus: true, revision: true },
        });
        if (!sale) throw new NotFoundException("Vendita non trovata");
        this.orders.assertRevision(sale, body["revision"] ?? sale.revision);
        if (sale.orderStatus === "cancelled")
          throw new ConflictException(
            "Il conto annullato conserva il suo cliente",
          );
        if (sale.customerId === customerId)
          throw new BadRequestException("Il conto è già di questo cliente");
        const customer = await transaction.customer.findFirst({
          where: { id: customerId, tenantId, isActive: true },
          select: { id: true },
        });
        if (!customer) throw new BadRequestException("Cliente non valido");
        if (
          await transaction.appointmentAutomationRun.count({
            where: { tenantId, orderId: id, status: "waiting" },
          })
        )
          throw new ConflictException(
            "C'è un promemoria WhatsApp in attesa per il cliente attuale: annulla e ricrea la prenotazione",
          );
        const recordEvents = await beginAppointmentEvents(
          transaction,
          command.context,
          { orderItem: { saleId: id } },
        );
        await transaction.appointment.updateMany({
          where: { tenantId, orderItem: { saleId: id } },
          data: { customerId },
        });
        await transaction.sale.update({
          where: { id, tenantId },
          data: { customerId, revision: { increment: 1 } },
        });
        const current = await transaction.sale.findUniqueOrThrow({
          where: { id },
          include: SALE_COMMAND_INCLUDE,
        });
        const result = saleCommandResult(current);
        const operation = await this.commands.save(
          transaction,
          command,
          id,
          result,
        );
        await recordEvents({ orderItem: { saleId: id } }, operation.id);
        await transaction.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        return { result, previous: sale.customerId, customerId };
      },
      { timeout: 15000 },
    );
    await Promise.all([
      this.cacheInvalidationService.invalidateSales(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
      this.cacheInvalidationService.invalidateCustomers(tenantId),
      this.cacheInvalidationService.invalidateAppointments(tenantId),
      ...[outcome.previous, outcome.customerId].flatMap((customer) =>
        customer
          ? [
              this.customersAlignmentService.queueCustomerRefresh(
                tenantId,
                customer,
                "sale_created",
              ),
            ]
          : [],
      ),
    ]);
    return outcome.result;
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
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const appointmentId =
      typeof body["appointmentId"] === "string" && body["appointmentId"]
        ? body["appointmentId"]
        : "";
    if (!appointmentId) {
      throw new BadRequestException("Seleziona un appuntamento");
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      await this.orders.lock(transaction, tenantId);
      await setOperationalActor(transaction, requireUser(session).id);
      const recordEvents = await beginAppointmentEvents(
        transaction,
        { tenantId, actorId: requireUser(session).id, source: "internal" },
        { OR: [{ orderItem: { saleId: id } }, { id: appointmentId }] },
      );
      const sale = await transaction.sale.findFirst({
        where: { id, tenantId, ...saleFilter(scope) },
        include: { items: true },
      });
      const appointment = await transaction.appointment.findFirst({
        where: { id: appointmentId, tenantId, ...sectorFilter(scope) },
        include: {
          orderItem: { include: { sale: { include: { items: true } } } },
        },
      });
      if (!sale) throw new NotFoundException("Vendita non trovata");
      if (!appointment)
        throw new BadRequestException("Appuntamento non valido");
      const existing = appointment.orderItem?.sale;
      if (sale.orderStatus === "cancelled")
        throw new ConflictException(
          "Il conto annullato conserva il collegamento originale",
        );
      if (appointment.orderIssue)
        throw new ConflictException(
          "Riconcilia prima il collegamento storico del conto",
        );
      if (existing?.id === id) return sale;
      if (sale.appointmentId && sale.appointmentId !== appointmentId)
        throw new ConflictException(
          "Il conto è già collegato a un'altra prenotazione",
        );
      if (
        sale.locationId !== appointment.locationId ||
        sale.customerId !== appointment.customerId
      )
        throw new BadRequestException(
          "Cliente e sede del conto devono coincidere con la prenotazione",
        );
      const matches = sale.items.filter(
        (item) =>
          item.serviceId === appointment.serviceId &&
          item.sectorId === appointment.sectorId &&
          item.quantity === 1,
      );
      if (matches.length !== 1)
        throw new ConflictException(
          "Il conto deve contenere una sola riga compatibile con la prenotazione",
        );
      if (
        existing &&
        (existing.orderStatus !== "open" ||
          existing.revision !== 0 ||
          existing.items.length !== 1)
      )
        throw new ConflictException(
          "Il conto prenotato è già stato modificato: gestisci il collegamento esplicitamente",
        );
      if (
        existing &&
        ((await transaction.paymentOperation.count({
          where: { saleId: existing.id, tenantId },
        })) ||
          (await transaction.orderOperation.count({
            where: { saleId: existing.id, tenantId },
          })))
      )
        throw new ConflictException(
          "Il conto prenotato ha movimenti: conserva il collegamento originale",
        );
      if (existing)
        await transaction.sale.update({
          where: { id: existing.id },
          data: {
            appointmentId: null,
            orderStatus: "superseded",
            revision: { increment: 1 },
          },
        });
      const row = matches[0];
      await transaction.appointment.update({
        where: { id: appointmentId },
        data: {
          orderItemId: row.id,
          ...(sale.orderStatus === "confirmed"
            ? {
                finalPrice: row.lineTotal.plus(row.taxTotal),
                status: "completed",
              }
            : {}),
        },
      });
      const linked = await transaction.sale.update({
        where: { id },
        data: { appointmentId, revision: { increment: 1 } },
        include: {
          items: {
            orderBy: [{ position: "asc" }, { id: "asc" }],
            include: {
              service: true,
              product: true,
              collaborator: true,
              booking: {
                select: {
                  id: true,
                  status: true,
                  startsAt: true,
                  endsAt: true,
                  collaboratorId: true,
                },
              },
            },
          },
          customer: true,
        },
      });
      await transaction.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      await recordEvents({ orderItem: { saleId: id } });
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

  /**
   * «Elimina vendita»: a sale without stock movements (and without reminders
   * already sent) disappears with everything it created. Otherwise it is
   * cancelled instead, and the response says so.
   */
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
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const actorId = requireUser(session).id;
    const sale = await this.prisma.sale.findFirst({
      where: { id, tenantId, ...saleFilter(scope) },
      select: { id: true, customerId: true },
    });
    if (!sale) {
      throw new NotFoundException("Vendita non trovata");
    }

    const keep = await this.prisma.$transaction(
      async (transaction) => {
        await this.orders.lock(transaction, tenantId);
        await setOperationalActor(transaction, actorId);
        const reason = await this.deletionBlocker(transaction, tenantId, id);
        if (reason) return reason;
        await transaction.$queryRaw`SELECT alora_purge_sale(${tenantId}, ${id})::int AS purged`;
        await transaction.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        return null;
      },
      { timeout: 15000 },
    );
    if (keep) {
      const cancelled = await this.cancelSale(
        tenantId,
        scope,
        actorId,
        id,
        "Annullata dalla cassa",
      );
      return {
        deleted: false,
        cancelled: true,
        message: `${keep}: la vendita è stata annullata invece che eliminata. Incassi rimborsati e prodotti rientrati in magazzino.`,
        sale: cancelled,
      };
    }
    // Prisma can swallow a deferred database error at commit: check the outcome.
    if (await this.prisma.sale.count({ where: { id } }))
      throw new ConflictException("La vendita non è stata eliminata. Riprova.");
    await this.afterSaleChange(tenantId, sale.customerId);
    return { deleted: true };
  }

  /** Why a sale must be cancelled rather than deleted, or null. */
  private async deletionBlocker(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
  ) {
    if (await tx.stockMovement.count({ where: { tenantId, saleId: id } }))
      return "Ha movimenti di magazzino";
    if (
      await tx.appointmentAutomationDelivery.count({
        where: {
          run: { tenantId, orderId: id },
          history: { status: { in: ["sent", "dispatching", "uncertain"] } },
        },
      })
    )
      return "Al cliente sono già partiti dei messaggi";
    return null;
  }

  private async afterSaleChange(tenantId: string, customerId: string | null) {
    await Promise.all([
      this.cacheInvalidationService.invalidateSales(tenantId),
      this.cacheInvalidationService.invalidateDashboard(tenantId),
      this.cacheInvalidationService.invalidateCustomers(tenantId),
      this.cacheInvalidationService.invalidateAppointments(tenantId),
      ...(customerId
        ? [
            this.customersAlignmentService
              .queueCustomerRefresh(tenantId, customerId, "sale_created")
              .catch(() => undefined),
          ]
        : []),
    ]);
  }

  /** «Annulla vendita»: refunds, stock back, bookings cancelled, account cancelled. */
  @Post(":id/cancel")
  async cancel(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: Record<string, unknown> = {},
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
    const text =
      typeof body?.["reason"] === "string" ? body["reason"].trim() : "";
    return this.cancelSale(
      tenantId,
      scope,
      requireUser(session).id,
      id,
      text.length >= 3 ? text.slice(0, 500) : "Annullata dalla cassa",
      body?.["idempotencyKey"],
    );
  }

  private async cancelSale(
    tenantId: string,
    scope: OperationalScope,
    actorId: string,
    id: string,
    reason: string,
    key?: unknown,
  ) {
    const command = this.commands.command(
      { tenantId, actorId, source: "internal", scope },
      "cancel_sale",
      typeof key === "string" ? key : `cancel-sale:${id}`,
      { saleId: id },
    );
    const outcome = await this.prisma.$transaction(
      async (tx) => {
        await this.orders.lock(tx, tenantId);
        await setOperationalActor(tx, actorId);
        const replay = await this.commands.replay(tx, command);
        if (replay)
          return { result: replay.result, customerId: replay.sale.customerId };
        const sale = await tx.sale.findFirst({
          where: { id, tenantId, ...saleFilter(scope) },
          include: {
            items: {
              include: { booking: { select: { id: true, status: true } } },
            },
          },
        });
        if (!sale) throw new NotFoundException("Vendita non trovata");
        if (sale.orderStatus === "superseded")
          throw new ConflictException(
            "Questo conto è già stato sostituito da un altro",
          );
        if (sale.orderStatus === "cancelled") {
          const current = await tx.sale.findUniqueOrThrow({
            where: { id },
            include: SALE_COMMAND_INCLUDE,
          });
          return {
            result: saleCommandResult(current),
            customerId: sale.customerId,
          };
        }
        // Performed services stay in the agenda as history; the rest is cancelled.
        const active = sale.items.flatMap((row) =>
          row.booking &&
          !["cancelled", "no_show", "completed"].includes(row.booking.status)
            ? [row.booking.id]
            : [],
        );
        const recordEvents = await beginAppointmentEvents(
          tx,
          { tenantId, actorId, source: "internal" },
          { id: { in: active } },
        );
        await this.payments.refundAll(tx, scope, actorId, id, reason);
        const returned = await this.inventory.reverseOrder(
          tx,
          id,
          actorId,
          reason,
        );
        await applyBookingCancellation(tx, {
          orderId: id,
          appointmentIds: active,
          allStopped: true,
          actorId,
          cancelledByType: "staff",
          cancelledById: actorId,
          reason,
          policyResult: "operator_recorded",
        });
        const current = await tx.sale.findUniqueOrThrow({
          where: { id },
          include: SALE_COMMAND_INCLUDE,
        });
        const result = {
          ...saleCommandResult(current),
          cancelledAppointmentIds: active,
          stockReturned: returned > 0,
        };
        const operation = await this.commands.save(tx, command, id, result);
        await recordEvents({ id: { in: active } }, operation.id);
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        return { result, customerId: sale.customerId };
      },
      { timeout: 15000 },
    );
    // Prisma can swallow a deferred database error at commit: check the outcome.
    const check = await this.prisma.sale.findUnique({
      where: { id },
      select: { orderStatus: true },
    });
    if (check?.orderStatus !== "cancelled")
      throw new ConflictException("La vendita non è stata annullata. Riprova.");
    await this.afterSaleChange(tenantId, outcome.customerId);
    return outcome.result;
  }

  @Get(":id/price-history")
  async priceHistory(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Query("page") pageText = "1",
  ) {
    const session = await resolveRequestSession(
        this.prisma,
        request.headers.authorization,
      ),
      tenantId = requireTenantId(session);
    const scope = await resolveOperationalScope(
        this.prisma,
        session,
        request.headers,
      ),
      page = Number(pageText);
    if (!Number.isInteger(page) || page < 1 || page > 100000)
      throw new BadRequestException("Pagina non valida");
    if (
      !(await this.prisma.sale.findFirst({
        where: { id, tenantId, ...saleFilter(scope) },
        select: { id: true },
      }))
    )
      throw new NotFoundException("Conto non accessibile");
    const where = { tenantId, saleId: id };
    const [items, total] = await Promise.all([
      this.prisma.orderPriceRevision.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.orderPriceRevision.count({ where }),
    ]);
    return { items, total, page, pageSize: 50, hasMore: page * 50 < total };
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

    return this.cacheService.getOrSet(
      cacheKeys.saleDetail(tenantId, id),
      CACHE_TTL_SECONDS.lists,
      async () => {
        const sale = await this.prisma.sale.findFirst({
          where: { id, tenantId, ...saleFilter(scope) },
          include: {
            items: {
              orderBy: [{ position: "asc" }, { id: "asc" }],
              include: {
                product: true,
                service: true,
                collaborator: true,
                booking: {
                  select: {
                    id: true,
                    status: true,
                    startsAt: true,
                    endsAt: true,
                    collaboratorId: true,
                  },
                },
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
