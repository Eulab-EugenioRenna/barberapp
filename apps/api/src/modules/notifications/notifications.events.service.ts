import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationEventPayload } from "./notifications.types";
import { NotificationsService } from "./notifications.service";

/** Explicit generic notifications also persist before queueing; operational writers use their own transaction. */
@Injectable()
export class NotificationsEventsService {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}
  async emit(payload: NotificationEventPayload): Promise<unknown> {
    if (!payload.eventType || payload.eventType.length > 120)
      throw new BadRequestException("Evento non valido");
    const event = await this.prisma.$transaction(async (tx) => {
      const snapshot = await this.notificationsService.snapshotEventPayload(
        tx,
        payload,
      );
      return tx.notificationDomainEvent.create({
        data: {
          tenantId: payload.tenantId,
          eventKey: randomUUID(),
          eventType: payload.eventType,
          entityType: payload.entityType || "notification",
          entityId: payload.entityId || null,
          actorUserId: payload.actor?.id || null,
          payload: JSON.parse(
            JSON.stringify({
              ...snapshot,
              entityType: payload.entityType || "notification",
              entityId: payload.entityId || null,
            }),
          ) as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
    });
    return { persisted: true, eventId: event.id, queued: 0, ids: [] };
  }
}
