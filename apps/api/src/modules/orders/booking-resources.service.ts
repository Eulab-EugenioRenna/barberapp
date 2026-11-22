import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { zonedDateKey, zonedDateParts } from "../../common/zoned-time";
import { CollaboratorScheduleService } from "../availability/collaborator-schedule.service";
import { sectorWorkingWindow } from "../locations/operational-hours";
import type { OperationalScope } from "../locations/operational-scope";
import { localizeServices, type SectorTarget } from "../locations/activity-sectors";
import {
  allocateBookingResources,
  ResourceSearchLimitError,
  type ResourceDemand,
  type ResourceReservation,
} from "./resource-allocation";

type Calendar = Pick<
  Prisma.TransactionClient,
  | "service"
  | "sector"
  | "tenantHoliday"
  | "appointment"
  | "collaborator"
  | "room"
  | "collaboratorWeeklySchedule"
  | "collaboratorDayOverride"
>;
export interface BookingResourceRequest {
  serviceId: string;
  startsAt: Date;
  endsAt?: Date;
  collaboratorId?: string | null;
  roomId?: string | null;
}
/** Preview and commit use the same planner. Commit must call it under the tenant lock. */
@Injectable()
export class BookingResourcesService {
  constructor(private readonly schedules: CollaboratorScheduleService) {}

  async plan(
    client: Calendar,
    tenantId: string,
    timezone: string,
    lines: BookingResourceRequest[],
    options: {
      publicOnly?: boolean;
      scope?: OperationalScope;
      excludeAppointmentIds?: string[];
      /** Location (or sector) of the booking: services resolve their activity there. */
      target?: SectorTarget;
    } = {},
  ) {
    if (
      !lines.length ||
      lines.length > 20 ||
      lines.some(
        (row) => !row.serviceId || !Number.isFinite(row.startsAt?.getTime()),
      )
    )
      throw new BadRequestException(
        "Indica da uno a venti servizi e i rispettivi orari",
      );
    if (options.scope && options.scope.tenantId !== tenantId)
      throw new BadRequestException("Ambito aziendale non valido");
    const ids = [...new Set(lines.map((row) => row.serviceId))];
    const catalog = await client.service.findMany({
      where: {
        id: { in: ids },
        tenantId,
        isActive: true,
        activity: { isActive: true },
        ...(options.publicOnly
          ? { isPublic: true, isBookableOnline: true }
          : {}),
      },
      include: { sector: true },
    });
    if (catalog.length !== ids.length)
      throw new BadRequestException(
        "Uno dei servizi non è disponibile nell'ambito scelto",
      );
    // Same service, any location of its activity: the sector is the one here.
    const services = await localizeServices(client, tenantId, catalog, options.target, {
      publicOnly: options.publicOnly,
      scope: options.scope,
    });
    if (
      options.scope &&
      services.some((row) => !options.scope!.locationIds.includes(row.sector.locationId))
    )
      throw new BadRequestException(
        "Uno dei servizi non è disponibile nell'ambito scelto",
      );
    if (new Set(services.map((row) => row.sector.locationId)).size !== 1)
      throw new BadRequestException(
        "I servizi del conto devono appartenere alla stessa sede",
      );
    if (
      options.scope &&
      !services.some((row) => options.scope!.sectorIds.includes(row.sectorId))
    )
      throw new BadRequestException(
        "Nessun servizio appartiene al settore selezionato",
      );
    const sectorIds = [...new Set(services.map((row) => row.sectorId))];
    const [collaborators, rooms, buffers] = await Promise.all([
      client.collaborator.findMany({
        where: {
          tenantId,
          isActive: true,
          sectors: { some: { sectorId: { in: sectorIds } } },
          ...(options.publicOnly ? { isPublic: true } : {}),
        },
        include: { sectors: { select: { sectorId: true } } },
        orderBy: { id: "asc" },
      }),
      client.room.findMany({
        where: {
          tenantId,
          sectorId: { in: sectorIds },
          isActive: true,
          ...(options.publicOnly ? { isPublic: true } : {}),
        },
        orderBy: { id: "asc" },
      }),
      client.service.aggregate({
        where: { tenantId },
        _max: { bufferBeforeMinutes: true, bufferAfterMinutes: true },
      }),
    ]);
    const rows = lines.map((line) => {
      const service = services.find((row) => row.id === line.serviceId)!;
      if (
        !Number.isInteger(service.durationMinutes) ||
        service.durationMinutes < 1 ||
        service.durationMinutes > 1440 ||
        service.bufferBeforeMinutes < 0 ||
        service.bufferAfterMinutes < 0
      )
        throw new BadRequestException(
          "Durata o buffer del servizio non validi",
        );
      if (
        line.endsAt &&
        (!Number.isFinite(line.endsAt.getTime()) ||
          line.endsAt.getTime() - line.startsAt.getTime() < 1000 ||
          line.endsAt.getTime() - line.startsAt.getTime() > 86400000)
      )
        throw new BadRequestException("Durata della prenotazione non valida");
      return {
        ...line,
        service,
        endsAt:
          line.endsAt ??
          new Date(line.startsAt.getTime() + service.durationMinutes * 60000),
      };
    });
    const minStart = Math.min(
      ...rows.map(
        (row) =>
          row.startsAt.getTime() - row.service.bufferBeforeMinutes * 60000,
      ),
    );
    const maxEnd = Math.max(
      ...rows.map(
        (row) => row.endsAt.getTime() + row.service.bufferAfterMinutes * 60000,
      ),
    );
    const existing = await client.appointment.findMany({
      where: {
        tenantId,
        ...(options.excludeAppointmentIds?.length
          ? { id: { notIn: options.excludeAppointmentIds } }
          : {}),
        status: { notIn: ["cancelled", "no_show"] },
        startsAt: {
          lt: new Date(
            maxEnd + (buffers._max.bufferBeforeMinutes || 0) * 60000,
          ),
        },
        endsAt: {
          gt: new Date(
            minStart - (buffers._max.bufferAfterMinutes || 0) * 60000,
          ),
        },
      },
      select: {
        startsAt: true,
        endsAt: true,
        sectorId: true,
        collaboratorId: true,
        roomId: true,
        service: {
          select: {
            bufferBeforeMinutes: true,
            bufferAfterMinutes: true,
            requiresCollaborator: true,
            requiresRoom: true,
          },
        },
      },
    });
    const reservations = existing.map((row) => ({
      ...row,
      start: row.startsAt.getTime() - row.service.bufferBeforeMinutes * 60000,
      end: row.endsAt.getTime() + row.service.bufferAfterMinutes * 60000,
    }));
    const windows = new Map<
      string,
      Awaited<ReturnType<CollaboratorScheduleService["resolveWorkingWindow"]>>
    >();
    const business = new Map<
      string,
      Awaited<ReturnType<typeof sectorWorkingWindow>>
    >();
    const demands: ResourceDemand[] = [];
    for (const row of rows) {
      const date = zonedDateKey(row.startsAt, timezone),
        start = zonedDateParts(row.startsAt, timezone),
        end = zonedDateParts(row.endsAt, timezone);
      const key = row.service.sectorId + ":" + date;
      if (!business.has(key))
        business.set(
          key,
          await sectorWorkingWindow(
            client,
            row.service.sectorId,
            date,
            options.publicOnly,
          ),
        );
      const window = business.get(key);
      const startMinutes =
        start.hour * 60 +
        start.minute +
        start.second / 60 +
        row.startsAt.getUTCMilliseconds() / 60000;
      const endMinutes =
        end.hour * 60 +
        end.minute +
        end.second / 60 +
        row.endsAt.getUTCMilliseconds() / 60000;
      if (
        !window ||
        zonedDateKey(row.endsAt, timezone) !== date ||
        startMinutes < window.startMinutes ||
        endMinutes > window.endMinutes
      )
        throw new ConflictException({
          code: "BOOKING_OUTSIDE_HOURS",
          message: "Uno dei servizi è fuori apertura della sede o del settore",
        });
      const needsStaff =
        row.service.requiresCollaborator || !!row.collaboratorId;
      const needsRoom = row.service.requiresRoom || !!row.roomId;
      const candidateRooms = needsRoom
        ? rooms
            .filter(
              (room) =>
                room.sectorId === row.service.sectorId &&
                (!row.roomId || room.id === row.roomId),
            )
            .map((room) => ({ id: room.id, capacity: room.capacity }))
        : [{ id: null, capacity: 0 }];
      if (row.roomId && !candidateRooms.length)
        throw new BadRequestException(
          "Risorsa richiesta non disponibile nel settore",
        );
      const candidates = needsStaff
        ? collaborators.filter(
            (person) =>
              person.sectors.some(
                (sector) => sector.sectorId === row.service.sectorId,
              ) &&
              (!row.collaboratorId || person.id === row.collaboratorId),
          )
        : [];
      if (row.collaboratorId && !candidates.length)
        throw new BadRequestException(
          "Professionista richiesto non disponibile nel settore",
        );
      const eligible: string[] = [];
      for (const person of candidates) {
        const personKey = person.id + ":" + date;
        if (!windows.has(personKey))
          windows.set(
            personKey,
            await this.schedules.resolveWorkingWindow(
              tenantId,
              person.id,
              new Date(start.year, start.month - 1, start.day),
              client,
            ),
          );
        const schedule = windows.get(personKey)!;
        if (
          schedule.isAvailable &&
          startMinutes >= schedule.startMinutes &&
          endMinutes <= schedule.endMinutes
        )
          eligible.push(person.id);
      }
      const demand = {
        start: row.startsAt.getTime() - row.service.bufferBeforeMinutes * 60000,
        end: row.endsAt.getTime() + row.service.bufferAfterMinutes * 60000,
        collaboratorIds: needsStaff ? eligible : [null],
        rooms: candidateRooms,
      };
      if (
        reservations.some(
          (old) =>
            old.start < demand.end &&
            old.end > demand.start &&
            ((needsStaff &&
              old.service.requiresCollaborator &&
              !old.collaboratorId) ||
              (needsRoom &&
                old.sectorId === row.service.sectorId &&
                old.service.requiresRoom &&
                !old.roomId)),
        )
      )
        throw new ConflictException({
          code: "LEGACY_RESOURCES_UNKNOWN",
          message:
            "Una prenotazione sovrapposta ha risorse storiche da riconciliare",
        });
      demands.push(demand);
    }
    let allocation: ResourceReservation[] | null;
    try {
      allocation = allocateBookingResources(demands, reservations);
    } catch (error) {
      if (error instanceof ResourceSearchLimitError)
        throw new ConflictException({
          code: "RESOURCE_PLAN_COMPLEXITY",
          message: error.message,
        });
      throw error;
    }
    if (!allocation)
      throw new ConflictException({
        code: "RESOURCES_UNAVAILABLE",
        message:
          "Le risorse per l'intera prenotazione non sono disponibili agli orari scelti",
      });
    return rows.map((row, index) => ({
      ...row,
      collaboratorId: allocation![index].collaboratorId,
      roomId: allocation![index].roomId,
    }));
  }
}
