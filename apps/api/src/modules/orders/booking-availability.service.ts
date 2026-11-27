import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { BookingAvailabilityDto } from "../../common/booking-availability.dto";
import { AvailabilityService } from "../availability/availability.service";
import { BookingResourcesService } from "./booking-resources.service";
import { resolveBookingTimes } from "./booking-times";
import { saleFilter, sectorFilter } from "../locations/operational-scope";
import type { CommandContext } from "./order-command.service";
import { priceLine, type PriceMode, sumPricedLines } from "../pricing/money";
import { localizeServices } from "../locations/activity-sectors";
import { parseZonedDateTime, zonedDateKey } from "../../common/zoned-time";

/** Only for the lifetime of one repeatable-read preview, never across actors or requests. */
function readCalendar(tx: Prisma.TransactionClient) {
  const cache = new Map<string, Promise<unknown>>();
  const models = [
    "tenant",
    "service",
    "sector",
    "room",
    "collaborator",
    "appointment",
    "tenantHoliday",
    "collaboratorDayOverride",
    "collaboratorWeeklySchedule",
  ] as const;
  const calendar = Object.fromEntries(
    models.map((model) => [
      model,
      new Proxy(tx[model], {
        get(target, property) {
          if (
            ![
              "findMany",
              "findFirst",
              "findUnique",
              "count",
              "aggregate",
            ].includes(String(property))
          )
            throw new Error("Calendar preview only supports reads");
          return (args: unknown) => {
            const key =
              model + ":" + String(property) + ":" + JSON.stringify(args);
            if (!cache.has(key))
              cache.set(
                key,
                Promise.resolve(
                  Reflect.get(target, property).call(target, args),
                ),
              );
            return cache.get(key);
          };
        },
      }),
    ]),
  );
  return calendar as Pick<Prisma.TransactionClient, (typeof models)[number]>;
}
@Injectable()
export class BookingAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly resources: BookingResourcesService,
  ) {}
  async read(context: CommandContext, body: BookingAvailabilityDto) {
    const publicOnly = context.source === "public";
    if (
      !publicOnly &&
      (!context.actorId || context.scope?.tenantId !== context.tenantId)
    )
      throw new BadRequestException("Ambito aziendale non valido");
    if (
      !Array.isArray(body.lines) ||
      body.lines.length < 1 ||
      body.lines.length > 20
    )
      throw new BadRequestException("Indica da uno a venti servizi");
    if (
      publicOnly &&
      (body.appointmentId ||
        body.startsAt ||
        body.lines.some((row) => row.roomId))
    )
      throw new BadRequestException(
        "La disponibilità pubblica non accetta riferimenti interni",
      );
    if (body.startsAt && !body.appointmentId)
      throw new BadRequestException(
        "L'orario da conservare richiede un servizio esistente",
      );
    const day = (value: string | undefined) => {
      if (
        !value ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value + "T00:00:00Z")) ||
        new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
      )
        throw new BadRequestException("Data non valida");
      return Date.parse(value + "T00:00:00Z");
    };
    if (body.date && (body.from || body.to))
      throw new BadRequestException("Scegli un giorno oppure un intervallo");
    const from = day(body.date || body.from),
      to = day(body.date || body.to);
    if (to < from || (to - from) / 86400000 > 6)
      throw new BadRequestException(
        "Consulta al massimo sette giorni per richiesta",
      );
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const client = readCalendar(tx);
        const tenant = await client.tenant.findFirst({
          where: {
            id: context.tenantId,
            isActive: true,
            isSuspended: false,
            ...(publicOnly ? { publicEnabled: true } : {}),
          },
          select: { timezone: true, bookingMode: true },
        });
        if (!tenant) throw new NotFoundException("Attività non disponibile");
        if (publicOnly && tenant.bookingMode === "closed")
          throw new ConflictException(
            "Il salone non accetta prenotazioni online",
          );
        const ids = [...new Set(body.lines.map((row) => row.serviceId))];
        const catalog = await client.service.findMany({
          where: {
            tenantId: context.tenantId,
            id: { in: ids },
            isActive: true,
            activity: { isActive: true },
            ...(publicOnly ? { isPublic: true, isBookableOnline: true } : {}),
          },
          include: { sector: true },
        });
        if (catalog.length !== ids.length)
          throw new BadRequestException(
            "Servizi non disponibili nell'ambito scelto",
          );
        // Moving an existing appointment keeps its location.
        const existingLocation = body.appointmentId
          ? (
              await tx.appointment.findFirst({
                where: { id: body.appointmentId, tenantId: context.tenantId },
                select: { locationId: true },
              })
            )?.locationId
          : undefined;
        const target = existingLocation
          ? { locationId: existingLocation }
          : { locationId: body.locationId, sectorId: body.sectorId };
        const services = await localizeServices(client, context.tenantId, catalog, target, {
          publicOnly,
          scope: context.scope,
        });
        if (
          context.scope &&
          !context.scope.locationIds.includes(services[0].sector.locationId)
        )
          throw new BadRequestException(
            "Servizi non disponibili nell'ambito scelto",
          );
        let excludeAppointmentIds: string[] = [];
        let orderRevision: number | undefined;
        let orderId: string | undefined;
        let heldDuration: number | undefined;
        if (body.appointmentId) {
          if (!context.scope)
            throw new BadRequestException("Ambito non valido");
          const existing = await tx.appointment.findFirst({
            where: {
              id: body.appointmentId,
              tenantId: context.tenantId,
              ...sectorFilter(context.scope),
            },
            select: {
              id: true,
              status: true,
              orderIssue: true,
              serviceId: true,
              sectorId: true,
              locationId: true,
              startsAt: true,
              endsAt: true,
              orderItem: {
                select: {
                  saleId: true,
                  sale: { select: { revision: true, orderStatus: true } },
                },
              },
            },
          });
          if (!existing)
            throw new NotFoundException("Appuntamento non accessibile");
          if (body.lines.length !== 1)
            throw new BadRequestException(
              "Indica il servizio da riprogrammare",
            );
          // Any booking can be moved (closed accounts and historical rows too):
          // a missing account row is created when the move is saved.
          const account = existing.orderItem
            ? await tx.sale.findFirst({
                where: {
                  id: existing.orderItem.saleId,
                  tenantId: context.tenantId,
                  ...saleFilter(context.scope),
                },
                select: { id: true },
              })
            : null;
          if (existing.orderItem && !account)
            throw new NotFoundException(
              "Serve accesso a tutti i settori del conto",
            );
          if (
            services[0].sector.locationId !== existing.locationId ||
            (services[0].id === existing.serviceId &&
              services[0].sectorId !== existing.sectorId)
          )
            throw new ConflictException(
              "Lo spostamento conserva la sede e il settore storico del servizio",
            );
          orderId = account?.id;
          orderRevision = existing.orderItem?.sale.revision;
          if (existing.serviceId === body.lines[0].serviceId)
            heldDuration =
              existing.endsAt.getTime() - existing.startsAt.getTime();
          excludeAppointmentIds = [existing.id];
        }
        const days: Array<{ date: string; hasSlots: boolean }> = [];
        const slots: Array<{
          startsAt: string;
          label: string;
          endsAt: string;
          estimatedTotal: string;
          outsideHours?: boolean;
          lines: Array<{
            serviceId: string;
            name: string;
            startsAt: string;
            endsAt: string;
            collaboratorId: string | null;
            roomId: string | null;
          }>;
        }> = [];
        for (let cursor = from; cursor <= to; cursor += 86400000) {
          const date = new Date(cursor).toISOString().slice(0, 10);
          const first = body.lines[0];
          const candidates = await this.availability.buildAvailability(
            context.tenantId,
            first.serviceId,
            date,
            first.collaboratorId || undefined,
            {
              publicOnly,
              excludeAppointmentIds,
              durationMilliseconds: heldDuration,
              sectorId: services.find((row) => row.id === first.serviceId)?.sectorId,
              // Staff see the whole day; a range only marks days with
              // slots inside opening hours.
              includeOutsideHours: !publicOnly && !!body.date,
            },
            client,
          );
          const unique = [
            ...new Map(candidates.map((row) => [row.startsAt, row])).values(),
          ];
          if (body.startsAt) {
            const held = parseZonedDateTime(
              body.startsAt,
              tenant.timezone || "Europe/Rome",
            );
            if (!held)
              throw new BadRequestException("Orario da verificare non valido");
            if (
              zonedDateKey(held, tenant.timezone || "Europe/Rome") === date &&
              !unique.some((row) => row.startsAt === held.toISOString())
            )
              unique.unshift({
                startsAt: held.toISOString(),
                label: new Intl.DateTimeFormat("it-IT", {
                  timeZone: tenant.timezone || "Europe/Rome",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }).format(held),
                collaboratorId: body.lines[0].collaboratorId || null,
                collaboratorName: "",
              });
          }
          let hasSlots = false;
          for (const candidate of unique) {
            if (publicOnly && Date.parse(candidate.startsAt) <= Date.now())
              continue;
            try {
              const requests = await resolveBookingTimes(
                client,
                context.tenantId,
                tenant.timezone || "Europe/Rome",
                body.lines.map((line) => ({
                  ...line,
                  durationMilliseconds: heldDuration,
                })),
                candidate.startsAt,
              );
              const rows = await this.resources.plan(
                client,
                context.tenantId,
                tenant.timezone || "Europe/Rome",
                requests,
                {
                  publicOnly,
                  scope: context.scope,
                  excludeAppointmentIds,
                  target: { locationId: services[0].sector.locationId },
                },
              );
              hasSlots = true;
              if (!body.date) break;
              const outsideHours = rows.some((row) => row.outsideHours);
              const total = sumPricedLines(
                rows.map((row) =>
                  priceLine({
                    unitPrice: row.service.basePrice,
                    priceMode: row.service.priceMode as PriceMode,
                    vatRate: row.service.vatRate,
                  }),
                ),
              );
              slots.push({
                startsAt: candidate.startsAt,
                label: candidate.label,
                endsAt: new Date(
                  Math.max(...rows.map((row) => row.endsAt.getTime())),
                ).toISOString(),
                estimatedTotal: total.total,
                ...(outsideHours ? { outsideHours: true } : {}),
                lines: rows.map((row) => ({
                  serviceId: row.serviceId,
                  name: row.service.name,
                  startsAt: row.startsAt.toISOString(),
                  endsAt: row.endsAt.toISOString(),
                  collaboratorId: row.collaboratorId,
                  roomId: row.roomId,
                })),
              });
            } catch (error) {
              if (error instanceof ConflictException) {
                const response = error.getResponse();
                if (
                  typeof response === "object" &&
                  "code" in response &&
                  ["RESOURCES_UNAVAILABLE", "BOOKING_OUTSIDE_HOURS"].includes(
                    String(response.code),
                  )
                )
                  continue;
              }
              throw error;
            }
          }
          days.push({ date, hasSlots });
        }
        return body.date
          ? { date: body.date, slots, orderId, orderRevision }
          : { days, orderId, orderRevision };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
      },
    );
  }
}
