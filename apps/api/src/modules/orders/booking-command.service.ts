import { beginAppointmentEvents } from "../notifications/appointment-events";
import { resolveBookingTimes } from "./booking-times";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isEmail } from "class-validator";
import { PrismaService } from "../../prisma/prisma.service";
import {
  lockOperationalTenant,
  setOperationalActor,
} from "../../common/operational-lock";
import { publicBookingResult } from "../../common/public-booking-result";
import { resolveCustomerIdentity } from "../customers/customer-identity";
import { bookingContactAuthorization } from "../notifications/appointment-automation-state";
import { BookingResourcesService } from "./booking-resources.service";
import {
  OrderCommandService,
  type CommandContext,
} from "./order-command.service";
import { OperationalOrderService } from "./operational-order.service";
import type { BookingCreateDto } from "../../common/booking-write.dto";

@Injectable()
export class BookingCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: OrderCommandService,
    private readonly resources: BookingResourcesService,
    private readonly orders: OperationalOrderService,
  ) {}
  private normalize(body: BookingCreateDto, publicOnly: boolean) {
    const text = (value: unknown, max: number) => {
      if (value === undefined || value === null) return null;
      if (typeof value !== "string" || value.length > max)
        throw new BadRequestException("Campo della prenotazione non valido");
      return value.trim() || null;
    };
    if (
      publicOnly &&
      [
        "customerId",
        "status",
        "internalNotes",
        "finalPrice",
        "priceOverrideReason",
        "roomId",
        "locationId",
        "sectorId",
      ].some((key) => body[key] !== undefined && body[key] !== null)
    )
      throw new BadRequestException(
        "La prenotazione pubblica non accetta campi interni",
      );
    if (
      body.lines &&
      [
        "serviceId",
        "collaboratorId",
        "roomId",
        "finalPrice",
        "priceOverrideReason",
      ].some((key) => body[key] !== undefined && body[key] !== null)
    )
      throw new BadRequestException(
        "Usa le righe dei servizi oppure il formato singolo",
      );
    const input = body.lines ?? [
      {
        serviceId: body.serviceId || "",
        startsAt: body.startsAt,
        collaboratorId: body.collaboratorId,
        roomId: body.roomId,
        finalPrice: body.finalPrice,
        priceOverrideReason: body.priceOverrideReason,
      },
    ];
    if (!Array.isArray(input) || !input.length || input.length > 20)
      throw new BadRequestException("Indica da uno a venti servizi");
    const lines = input.map((row) => {
      if (
        !row ||
        Object.keys(row).some(
          (key) =>
            ![
              "serviceId",
              "startsAt",
              "collaboratorId",
              "roomId",
              "finalPrice",
              "priceOverrideReason",
            ].includes(key),
        )
      )
        throw new BadRequestException("Riga prenotazione non valida");
      if (
        publicOnly &&
        (row.finalPrice !== undefined ||
          row.priceOverrideReason !== undefined ||
          row.roomId !== undefined)
      )
        throw new BadRequestException(
          "La prenotazione pubblica non accetta prezzi o risorse imposti",
        );
      const serviceId = text(row.serviceId, 100);
      if (!serviceId) throw new BadRequestException("Scegli tutti i servizi");
      const rawPrice =
        row.finalPrice === undefined || row.finalPrice === null
          ? null
          : String(row.finalPrice);
      if (rawPrice !== null && !/^\d{1,8}(\.\d{1,2})?$/.test(rawPrice))
        throw new BadRequestException("Prezzo concordato non valido");
      return {
        serviceId,
        startsAt: text(row.startsAt, 64),
        collaboratorId: text(row.collaboratorId, 100),
        roomId: text(row.roomId, 100),
        finalPrice:
          rawPrice === null ? null : new Prisma.Decimal(rawPrice).toFixed(2),
        priceOverrideReason: text(row.priceOverrideReason, 500),
      };
    });
    const customerName = text(body.customerName, 240);
    if (
      body.appointmentWhatsAppConsent !== undefined &&
      typeof body.appointmentWhatsAppConsent !== "boolean"
    )
      throw new BadRequestException("Consenso WhatsApp non valido");
    const [firstName, ...rest] = (customerName || "").split(/\s+/);
    const email = text(body.email, 320)?.toLowerCase() || null,
      phone = text(body.phone, 50)?.replace(/\s+/g, "") || null;
    if (email && !isEmail(email))
      throw new BadRequestException("Indirizzo email non valido");
    const customerId = publicOnly ? null : text(body.customerId, 100);
    if (!customerId && !firstName)
      throw new BadRequestException("Indica il nome del cliente");
    const status = publicOnly ? null : body.status || "confirmed";
    if (
      status &&
      ![
        "draft",
        "requested",
        "confirmed",
        "checked_in",
        "rescheduled",
      ].includes(status)
    )
      throw new BadRequestException(
        "Stato iniziale della prenotazione non valido",
      );
    return {
      lines,
      startsAt: text(body.startsAt, 64),
      customerId,
      enteredName: {
        firstName: firstName || "",
        lastName: rest.join(" ") || "Cliente",
      },
      email,
      phone,
      appointmentWhatsAppConsent: body.appointmentWhatsAppConsent === true,
      customerNotes: text(body.customerNotes, 4000),
      internalNotes: publicOnly ? null : text(body.internalNotes, 4000),
      locationId: publicOnly ? null : text(body.locationId, 100),
      sectorId: publicOnly ? null : text(body.sectorId, 100),
      status,
    };
  }
  async execute(
    context: CommandContext,
    body: BookingCreateDto,
    onNewCommand?: () => Promise<void>,
  ) {
    const bookingSource = context.source;
    if (bookingSource === "customer")
      throw new BadRequestException(
        "Le risposte cliente non creano nuove prenotazioni",
      );
    const input = this.normalize(body, context.source === "public");
    const command = this.commands.command(
      context,
      "create_booking",
      body.idempotencyKey,
      input,
    );
    return this.prisma.$transaction(
      async (tx) => {
        await lockOperationalTenant(tx, context.tenantId);
        await setOperationalActor(
          tx,
          context.actorId,
          context.source === "public" ? "public_booking" : "application",
        );
        const tenant = await tx.tenant.findFirst({
          where: {
            id: context.tenantId,
            isActive: true,
            isSuspended: false,
            ...(context.source === "public" ? { publicEnabled: true } : {}),
          },
          select: { timezone: true, bookingMode: true },
        });
        if (!tenant) throw new NotFoundException("Attività non disponibile");
        if (context.source === "public" && tenant.bookingMode === "closed")
          throw new ConflictException(
            "Il salone non accetta nuove prenotazioni online",
          );
        const previous = await this.commands.replay(tx, command);
        if (previous)
          return {
            result: previous.result,
            replayed: true,
            saleId: previous.sale.id,
            customerId: previous.sale.customerId!,
            appointmentIds: [] as string[],
          };
        const recordEvents = await beginAppointmentEvents(tx, context);
        if (onNewCommand) await onNewCommand();
        const requests = await resolveBookingTimes(
          tx,
          context.tenantId,
          tenant.timezone || "Europe/Rome",
          input.lines,
          input.startsAt,
        );
        if (
          context.source === "public" &&
          requests.some((row) => row.startsAt.getTime() < Date.now())
        )
          throw new BadRequestException("Scegli un orario futuro");
        const planned = await this.resources.plan(
          tx,
          context.tenantId,
          tenant.timezone || "Europe/Rome",
          requests,
          {
            publicOnly: context.source === "public",
            scope: context.scope,
            target: { locationId: input.locationId, sectorId: input.sectorId },
          },
        );
        if (
          input.locationId &&
          planned[0].service.sector.locationId !== input.locationId
        )
          throw new BadRequestException("La sede non coincide con i servizi");
        if (input.sectorId && planned[0].service.sectorId !== input.sectorId)
          throw new BadRequestException(
            "Il primo servizio non appartiene all'attività scelta in questa sede",
          );
        const customer = input.customerId
          ? await tx.customer.findFirst({
              where: {
                id: input.customerId,
                tenantId: context.tenantId,
                isActive: true,
              },
            })
          : await resolveCustomerIdentity(
              tx,
              {
                tenantId: context.tenantId,
                firstName: input.enteredName.firstName,
                lastName: input.enteredName.lastName,
                email: input.email,
                phone: input.phone,
              },
              context.source !== "public",
            );
        if (!customer) throw new BadRequestException("Cliente non disponibile");
        const appointments = [];
        for (const [index, row] of planned.entries())
          appointments.push(
            await tx.appointment.create({
              data: {
                tenantId: context.tenantId,
                locationId: row.service.sector.locationId,
                sectorId: row.service.sectorId,
                customerId: customer.id,
                serviceId: row.serviceId,
                collaboratorId: row.collaboratorId,
                roomId: row.roomId,
                startsAt: row.startsAt,
                endsAt: row.endsAt,
                status:
                  context.source === "public"
                    ? tenant.bookingMode === "public"
                      ? "confirmed"
                      : "requested"
                    : (input.status ?? "confirmed"),
                source: bookingSource,
                estimatedPrice: row.service.basePrice,
                finalPrice: input.lines[index].finalPrice,
                customerNotes: input.customerNotes,
                internalNotes: input.internalNotes,
                createdById: context.actorId,
                updatedById: context.actorId,
              },
              include: { service: true, collaborator: true },
            }),
          );
        const order = await this.orders.attachOpenOrder(tx, appointments, {
          priceOverrideReasons: input.lines.map(
            (row) => row.priceOverrideReason,
          ),
        });
        if (input.appointmentWhatsAppConsent)
          await tx.sale.update({
            where: { id: order.id },
            data: {
              automationContact: bookingContactAuthorization(
                customer,
                true,
                context.actorId,
                context.source === "public" ? "public" : "internal",
              ) as unknown as Prisma.InputJsonValue,
            },
          });
        const name =
          context.source === "public"
            ? input.enteredName
            : { firstName: customer.firstName, lastName: customer.lastName };
        const acknowledgements = appointments.map((appointment, index) => ({
          ...publicBookingResult(appointment, name),
          ...(context.source === "internal"
            ? {
                customerId: customer.id,
                orderItemId: order.items[index].id,
                estimatedPrice: order.items[index].lineTotal
                  .plus(order.items[index].taxTotal)
                  .toFixed(2),
                finalPrice: appointment.finalPrice,
              }
            : {}),
        }));
        const result = JSON.parse(
          JSON.stringify({
            ...acknowledgements[0],
            appointments: acknowledgements,
            estimatedTotal: order.total.toFixed(2),
            ...(context.source === "internal"
              ? { orderId: order.id, orderRevision: order.revision }
              : {}),
          }),
        ) as Prisma.InputJsonObject;
        const operation = await this.commands.save(
          tx,
          command,
          order.id,
          result,
        );
        await recordEvents({ orderItem: { saleId: order.id } }, operation.id);
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        return {
          result,
          replayed: false,
          saleId: order.id,
          customerId: customer.id,
          appointmentIds: appointments.map((row) => row.id),
        };
      },
      { timeout: 15000 },
    );
  }
}
