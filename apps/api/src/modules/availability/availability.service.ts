import { BadRequestException, Injectable } from "@nestjs/common";
import { CACHE_TTL_SECONDS, cacheKeys } from "../../cache/cache.constants";
import { normalizeCacheToken } from "../../cache/cache.helpers";
import { AppCacheService } from "../../cache/cache.service";
import {
  resolveZonedDateKey,
  zonedTimeToUtc,
} from "../../common/zoned-time";
import { PrismaService } from "../../prisma/prisma.service";
import { CollaboratorScheduleService } from "./collaborator-schedule.service";

export type AvailabilitySlot = {
  startsAt: string;
  label: string;
  collaboratorId: string | null;
  collaboratorName: string;
  isWorkingSlot?: boolean;
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
      ),
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
    },
  ): Promise<AvailabilitySlot[]> {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, tenantId, isActive: true },
    });

    if (!service) {
      throw new BadRequestException("Il servizio scelto non è disponibile");
    }

    if (options?.requireExplicitCollaborator && service.requiresCollaborator) {
      if (!collaboratorId) {
        return [];
      }

      const collaboratorExists = await this.prisma.collaborator.count({
        where: {
          tenantId,
          id: collaboratorId,
          isActive: true,
          ...(options?.publicOnly ? { isPublic: true } : {}),
        },
      });
      if (!collaboratorExists) {
        throw new BadRequestException("Il professionista scelto non è disponibile per questo servizio");
      }
    }

    const roomCount = service.requiresRoom
      ? await this.prisma.room.count({ where: { tenantId, isActive: true } })
      : 0;

    if (service.requiresRoom && roomCount === 0) {
      return [];
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const timezone = tenant?.timezone || "Europe/Rome";
    const dateKey = resolveZonedDateKey(dateInput, timezone);
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
    const dayStart = zonedTimeToUtc(
      { year, month, day: dayOfMonth },
      timezone,
    );
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
    const appointments = await this.prisma.appointment.findMany({
      where: {
        tenantId,
        startsAt: { lte: endOfDay },
        endsAt: { gte: dayStart },
        status: { notIn: ["cancelled", "no_show"] },
      },
      select: {
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
      ? await this.prisma.collaborator.findMany({
          where: {
            tenantId,
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
        ),
      );
    }

    for (let hour = 9; hour < 19; hour += 1) {
      for (const minute of [0, 30]) {
        const slotStartMinutes = hour * 60 + minute;
        const slotEndMinutes = slotStartMinutes + service.durationMinutes;

        if (slotEndMinutes > 19 * 60) {
          continue;
        }

        const startsAt = zonedTimeToUtc(
          { year, month, day: dayOfMonth, hour, minute },
          timezone,
        );
        const endsAt = new Date(
          startsAt.getTime() + service.durationMinutes * 60000,
        );

        const slotBlockedStart = new Date(
          startsAt.getTime() - service.bufferBeforeMinutes * 60000,
        );
        const slotBlockedEnd = new Date(
          endsAt.getTime() + service.bufferAfterMinutes * 60000,
        );

        for (const collaborator of availableCollaborators) {
          const workingWindow = collaboratorWindows.get(collaborator.id);

          if (service.requiresCollaborator && collaborator.id !== "any") {
            if (!workingWindow?.isAvailable) {
              continue;
            }

            if (
              slotStartMinutes < workingWindow.startMinutes ||
              slotEndMinutes > workingWindow.endMinutes
            ) {
              continue;
            }
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

          const roomConflicts = overlappingAppointments.filter(
            (appointment) =>
              appointment.roomId || appointment.service.requiresRoom,
          ).length;

          if (service.requiresRoom && roomConflicts >= roomCount) {
            continue;
          }

          slots.push({
            startsAt: startsAt.toISOString(),
            label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
            collaboratorId: service.requiresCollaborator
              ? collaborator.id
              : null,
            collaboratorName:
              `${collaborator.firstName} ${collaborator.lastName}`.trim(),
            isWorkingSlot: true,
          });
        }
      }
    }

    return slots;
  }
}
