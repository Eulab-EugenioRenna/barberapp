import type { Prisma } from "@prisma/client";
export type AvailabilityCalendar = Pick<
  Prisma.TransactionClient,
  | "service"
  | "room"
  | "tenant"
  | "sector"
  | "tenantHoliday"
  | "appointment"
  | "collaborator"
  | "collaboratorWeeklySchedule"
  | "collaboratorDayOverride"
>;
import { roomFits } from "../orders/resource-allocation";
import { sectorWorkingWindow } from "../locations/operational-hours";
import { BadRequestException, Injectable } from "@nestjs/common";
import { CACHE_TTL_SECONDS, cacheKeys } from "../../cache/cache.constants";
import { normalizeCacheToken } from "../../cache/cache.helpers";
import { AppCacheService } from "../../cache/cache.service";
import { resolveZonedDateKey, zonedTimeToUtc } from "../../common/zoned-time";
import { PrismaService } from "../../prisma/prisma.service";
import { CollaboratorScheduleService } from "./collaborator-schedule.service";
import { localizeServices } from "../locations/activity-sectors";

export type AvailabilitySlot = {
  startsAt: string;
  label: string;
  collaboratorId: string | null;
  collaboratorName: string;
  isWorkingSlot?: boolean;
  /** Staff only: outside opening or the collaborator's schedule. */
  outsideHours?: boolean;
  roomId?: string;
};

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly collaboratorScheduleService: CollaboratorScheduleService,
  ) {}

  private overlaps(
    leftStart: Date,
    leftEnd: Date,
    rightStart: Date,
    rightEnd: Date,
  ): boolean {
    return leftStart < rightEnd && leftEnd > rightStart;
  }

  async getCachedAvailability(
    tenantId: string,
    serviceId: string,
    dateInput?: string,
    collaboratorId?: string,
    options?: {
      requireExplicitCollaborator?: boolean;
      publicOnly?: boolean;
      /** Location of the booking; the service's activity is resolved there. */
      locationId?: string;
    },
  ): Promise<AvailabilitySlot[]> {
    const dateToken = normalizeCacheToken(
      dateInput ?? new Date().toISOString().slice(0, 10),
    );
    const collaboratorToken =
      collaboratorId ??
      (options?.requireExplicitCollaborator ? "required" : undefined);

    return this.cacheService.getOrSet(
      cacheKeys.publicAvailability(
        tenantId,
        serviceId,
        dateToken,
        collaboratorToken,
      ) +
        `:scope8:${options?.publicOnly ? "public" : "internal"}:${options?.requireExplicitCollaborator ? "explicit" : "auto"}:${normalizeCacheToken(options?.locationId ?? "home")}`,
      CACHE_TTL_SECONDS.publicAvailability,
      () =>
        this.buildAvailability(
          tenantId,
          serviceId,
          dateInput,
          collaboratorId,
          options,
        ),
    );
  }

  async buildAvailability(
    tenantId: string,
    serviceId: string,
    dateInput?: string,
    collaboratorId?: string,
    options?: {
      requireExplicitCollaborator?: boolean;
      publicOnly?: boolean;
      excludeAppointmentIds?: string[];
      durationMilliseconds?: number;
      /** Sector already resolved by the caller (activity at the location). */
      sectorId?: string;
      locationId?: string;
      /**
       * Staff only: list the whole day. Opening and working hours are for the
       * public; slots outside them are kept and flagged `outsideHours`.
       */
      includeOutsideHours?: boolean;
    },
    client: AvailabilityCalendar = this.prisma,
  ): Promise<AvailabilitySlot[]> {
    const found = await client.service.findFirst({
      where: {
        id: serviceId,
        tenantId,
        isActive: true,
        activity: { isActive: true },
        ...(options?.publicOnly
          ? { isPublic: true, isBookableOnline: true }
          : {}),
      },
      include: { sector: { select: { locationId: true } } },
    });

    if (!found) {
      throw new BadRequestException("Il servizio scelto non è disponibile");
    }
    // The sector is the one of the service's activity at the booking location.
    const [service] = await localizeServices(
      client,
      tenantId,
      [found],
      { sectorId: options?.sectorId, locationId: options?.locationId },
      { publicOnly: options?.publicOnly },
    );
    const duration =
      options?.durationMilliseconds ?? service.durationMinutes * 60000;
    if (!Number.isInteger(duration) || duration < 1000 || duration > 86400000)
      throw new BadRequestException("Durata della prenotazione non valida");

    if (options?.requireExplicitCollaborator && service.requiresCollaborator) {
      if (!collaboratorId) {
        return [];
      }

      const collaboratorExists = await client.collaborator.count({
        where: {
          tenantId,
          id: collaboratorId,
          sectors: { some: { sectorId: service.sectorId } },
          isActive: true,
          ...(options?.publicOnly ? { isPublic: true } : {}),
        },
      });
      if (!collaboratorExists) {
        throw new BadRequestException(
          "Il professionista scelto non è disponibile per questo servizio",
        );
      }
    }

    const rooms = service.requiresRoom
      ? await client.room.findMany({
          where: {
            tenantId,
            sectorId: service.sectorId,
            isActive: true,
            ...(options?.publicOnly ? { isPublic: true } : {}),
          },
          orderBy: { id: "asc" },
          select: { id: true, capacity: true },
        })
      : [];
    const roomCount = rooms.reduce((sum, room) => sum + room.capacity, 0);

    if (service.requiresRoom && roomCount === 0) {
      return [];
    }

    const tenant = await client.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const timezone = tenant?.timezone || "Europe/Rome";
    const dateKey = resolveZonedDateKey(dateInput, timezone);
    const businessWindow = await sectorWorkingWindow(
      client,
      service.sectorId,
      dateKey,
      options?.publicOnly,
    );
    const bypassHours = !!options?.includeOutsideHours && !options?.publicOnly;
    if (!businessWindow && !bypassHours) return [];
    const loopWindow = bypassHours
      ? { startMinutes: 0, endMinutes: 1440 }
      : businessWindow!;
    const outsideOpening = (start: number, end: number) =>
      !businessWindow ||
      start < businessWindow.startMinutes ||
      end > businessWindow.endMinutes;
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!dateMatch) {
      throw new BadRequestException("La data scelta non è valida");
    }
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const dayOfMonth = Number(dateMatch[3]);

    // Server-local date used only for weekday/schedule resolution.
    const localDay = new Date(year, month - 1, dayOfMonth);
    // Tenant day boundaries expressed as UTC instants for conflict queries.
    const dayStart = zonedTimeToUtc({ year, month, day: dayOfMonth }, timezone);
    const nextCalendarDay = new Date(Date.UTC(year, month - 1, dayOfMonth + 1));
    const nextDayStart = zonedTimeToUtc(
      {
        year: nextCalendarDay.getUTCFullYear(),
        month: nextCalendarDay.getUTCMonth() + 1,
        day: nextCalendarDay.getUTCDate(),
      },
      timezone,
    );
    const endOfDay = new Date(nextDayStart.getTime() - 1);
    const buffers = await client.service.aggregate({
      where: { tenantId },
      _max: { bufferBeforeMinutes: true, bufferAfterMinutes: true },
    });
    const conflictStart = new Date(
      dayStart.getTime() -
        (service.bufferBeforeMinutes + (buffers._max.bufferAfterMinutes || 0)) *
          60000,
    );
    const conflictEnd = new Date(
      endOfDay.getTime() +
        (service.bufferAfterMinutes + (buffers._max.bufferBeforeMinutes || 0)) *
          60000,
    );
    const appointments = await client.appointment.findMany({
      where: {
        tenantId,
        startsAt: { lte: conflictEnd },
        endsAt: { gte: conflictStart },
        status: { notIn: ["cancelled", "no_show"] },
        ...(options?.excludeAppointmentIds?.length
          ? { id: { notIn: options.excludeAppointmentIds } }
          : {}),
      },
      select: {
        sectorId: true,
        collaboratorId: true,
        roomId: true,
        startsAt: true,
        endsAt: true,
        service: {
          select: {
            bufferBeforeMinutes: true,
            bufferAfterMinutes: true,
            requiresRoom: true,
          },
        },
      },
    });

    const availableCollaborators = service.requiresCollaborator
      ? await client.collaborator.findMany({
          where: {
            tenantId,
            sectors: { some: { sectorId: service.sectorId } },
            isActive: true,
            ...(options?.publicOnly ? { isPublic: true } : {}),
            ...(collaboratorId ? { id: collaboratorId } : {}),
          },
        })
      : [
          {
            id: "any",
            firstName: "Qualsiasi",
            lastName: "disponibile",
            calendarColor: service.color,
            isActive: true,
            isPublic: true,
            tenantId,
            userId: null,
            email: null,
            phone: null,
          },
        ];

    const slots: AvailabilitySlot[] = [];
    const collaboratorWindows = new Map<
      string,
      Awaited<ReturnType<CollaboratorScheduleService["resolveWorkingWindow"]>>
    >();

    for (const collaborator of availableCollaborators) {
      if (!service.requiresCollaborator || collaborator.id === "any") {
        continue;
      }

      collaboratorWindows.set(
        collaborator.id,
        await this.collaboratorScheduleService.resolveWorkingWindow(
          tenantId,
          collaborator.id,
          localDay,
          client,
        ),
      );
    }

    for (
      let hour = Math.floor(loopWindow.startMinutes / 60);
      hour <= Math.floor(loopWindow.endMinutes / 60);
      hour += 1
    ) {
      for (const minute of [0, 30]) {
        const slotStartMinutes = hour * 60 + minute;
        const slotEndMinutes = slotStartMinutes + duration / 60000;

        if (
          slotStartMinutes < loopWindow.startMinutes ||
          slotEndMinutes > loopWindow.endMinutes
        ) {
          continue;
        }
        if (hour >= 24) continue;
        const slotOutsideOpening = outsideOpening(
          slotStartMinutes,
          slotEndMinutes,
        );

        const startsAt = zonedTimeToUtc(
          { year, month, day: dayOfMonth, hour, minute },
          timezone,
        );
        const endsAt = new Date(startsAt.getTime() + duration);

        const slotBlockedStart = new Date(
          startsAt.getTime() - service.bufferBeforeMinutes * 60000,
        );
        const slotBlockedEnd = new Date(
          endsAt.getTime() + service.bufferAfterMinutes * 60000,
        );

        for (const collaborator of availableCollaborators) {
          const workingWindow = collaboratorWindows.get(collaborator.id);
          let outsideSchedule = false;

          if (service.requiresCollaborator && collaborator.id !== "any") {
            outsideSchedule =
              !workingWindow?.isAvailable ||
              slotStartMinutes < workingWindow.startMinutes ||
              slotEndMinutes > workingWindow.endMinutes;
            if (outsideSchedule && !bypassHours) continue;
          }

          const collaboratorConflicts = appointments.some((appointment) => {
            if (
              !service.requiresCollaborator ||
              appointment.collaboratorId !== collaborator.id
            ) {
              return false;
            }

            const appointmentBlockedStart = new Date(
              appointment.startsAt.getTime() -
                appointment.service.bufferBeforeMinutes * 60000,
            );
            const appointmentBlockedEnd = new Date(
              appointment.endsAt.getTime() +
                appointment.service.bufferAfterMinutes * 60000,
            );

            return this.overlaps(
              appointmentBlockedStart,
              appointmentBlockedEnd,
              slotBlockedStart,
              slotBlockedEnd,
            );
          });

          if (collaboratorConflicts) {
            continue;
          }

          const overlappingAppointments = appointments.filter((appointment) => {
            const appointmentBlockedStart = new Date(
              appointment.startsAt.getTime() -
                appointment.service.bufferBeforeMinutes * 60000,
            );
            const appointmentBlockedEnd = new Date(
              appointment.endsAt.getTime() +
                appointment.service.bufferAfterMinutes * 60000,
            );

            return this.overlaps(
              appointmentBlockedStart,
              appointmentBlockedEnd,
              slotBlockedStart,
              slotBlockedEnd,
            );
          });

          // An unassigned historical room cannot be silently treated as free.
          if (
            service.requiresRoom &&
            overlappingAppointments.some(
              (appointment) =>
                appointment.sectorId === service.sectorId &&
                appointment.service.requiresRoom &&
                !appointment.roomId,
            )
          )
            continue;
          const roomReservations = overlappingAppointments.map(
            (appointment) => ({
              start:
                appointment.startsAt.getTime() -
                appointment.service.bufferBeforeMinutes * 60000,
              end:
                appointment.endsAt.getTime() +
                appointment.service.bufferAfterMinutes * 60000,
              collaboratorId: appointment.collaboratorId,
              roomId: appointment.roomId,
            }),
          );
          const room = rooms.find((room) =>
            roomFits(
              {
                start: slotBlockedStart.getTime(),
                end: slotBlockedEnd.getTime(),
              },
              room.id,
              room.capacity,
              roomReservations,
            ),
          );
          if (service.requiresRoom && !room) continue;

          slots.push({
            startsAt: startsAt.toISOString(),
            ...(room ? { roomId: room.id } : {}),
            label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
            collaboratorId: service.requiresCollaborator
              ? collaborator.id
              : null,
            collaboratorName:
              `${collaborator.firstName} ${collaborator.lastName}`.trim(),
            isWorkingSlot: true,
            ...(slotOutsideOpening || outsideSchedule
              ? { outsideHours: true }
              : {}),
          });
        }
      }
    }

    return slots;
  }
}
