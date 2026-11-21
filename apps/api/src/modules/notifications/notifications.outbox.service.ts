import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { NotificationStatus } from "@prisma/client";
import type { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { NOTIFICATIONS_QUEUE } from "./notifications.constants";
import { NotificationsService } from "./notifications.service";
import type {
  NotificationDispatchTarget,
  NotificationEventPayload,
  NotificationQueueJob,
} from "./notifications.types";
import { AppointmentAutomationPlanner } from "./appointment-automation-planner.service";
import { AppointmentAutomationRecovery } from "./appointment-automation-recovery.service";
import { AutomationClock } from "../../common/automation-clock";

/** PostgreSQL owns work and delivery identity. Redis is a rebuildable wake-up index. */
@Injectable()
export class NotificationsOutboxService
  implements OnModuleInit, OnModuleDestroy
{
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly queue: Queue<NotificationQueueJob>,
    private readonly automations: AppointmentAutomationPlanner,
    private readonly automationRecovery: AppointmentAutomationRecovery,
    private readonly clock: AutomationClock,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.recover();
    }, 5000);
    this.timer.unref();
    void this.recover();
  }
  onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.timer);
  }
  private targetKey(target: NotificationDispatchTarget) {
    return createHash("sha256")
      .update(
        JSON.stringify([
          target.channel,
          target.channel === "in_app"
            ? target.recipientUserId
            : target.recipientEmail || target.recipientWebhookUrl,
        ]),
      )
      .digest("hex");
  }
  async materializeOne() {
    let eventId: string | null = null;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT id FROM "NotificationDomainEvent"
          WHERE "processedAt" IS NULL AND "nextAttemptAt" <= now()
          ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1`;
          if (!rows.length) return null;
          eventId = rows[0].id;
          const event = await tx.notificationDomainEvent.findUniqueOrThrow({
            where: { id: eventId },
          });
          const payload = event.payload as unknown as NotificationEventPayload;
          const plan = await this.notifications.resolveDispatchPlan(payload, {
            client: tx,
            snapshot: true,
          });
          const targets = await this.automations.authorizeTargets(
            tx,
            payload,
            plan.targets,
          );
          const unique = new Map(
            targets.map((target) => [this.targetKey(target), target]),
          );
          const histories: string[] = [];
          for (const [key, target] of unique) {
            const history = await this.notifications.createHistoryEntry(
              plan.payload,
              target,
              { client: tx, eventId: event.id, dispatchKey: key },
            );
            histories.push(history.id);
            if (
              payload.flags?.["customerOrigin"] &&
              target.channel === "in_app"
            )
              await tx.notificationHistory.update({
                where: { id: history.id },
                data: {
                  status: "sent",
                  sentAt: new Date(),
                  providerMessageId: "in-app:" + history.notificationInboxId,
                },
              });
          }
          histories.push(...(await this.automations.materialize(tx, event)));
          await tx.notificationDomainEvent.update({
            where: { id: event.id },
            data: {
              processedAt: new Date(),
              attemptCount: { increment: 1 },
              lastError: null,
            },
          });
          return { eventId: event.id, histories };
        },
        { timeout: 15000 },
      );
    } catch {
      if (eventId)
        await this.prisma.notificationDomainEvent.updateMany({
          where: { id: eventId, processedAt: null },
          data: {
            attemptCount: { increment: 1 },
            lastError:
              "Notification preparation failed; no external effect started",
            nextAttemptAt: new Date(Date.now() + 30000),
          },
        });
      return null;
    }
  }
  async recover() {
    if (this.running || this.stopped) return { prepared: 0, queued: 0 };
    this.running = true;
    let prepared = 0,
      queued = 0;
    try {
      await this.automationRecovery.recover();
      // An expired external attempt is uncertain. It is never made pending again by recovery.
      await this.prisma.notificationHistory.updateMany({
        where: {
          status: NotificationStatus.dispatching,
          dispatchLeaseUntil: { lte: new Date() },
        },
        data: {
          status: NotificationStatus.uncertain,
          retrySafe: false,
          nextRetryAt: null,
          error:
            "Dispatch interrupted or deadline exceeded; verify outcome before another send",
        },
      });
      for (let i = 0; i < 20 && !this.stopped; i++) {
        if (!(await this.materializeOne())) break;
        prepared++;
      }
      const pending = await this.prisma.notificationHistory.findMany({
        where: {
          domainEventId: { not: null },
          AND: [
            {
              OR: [
                { automationDelivery: null },
                {
                  automationDelivery: {
                    dueAt: { lte: this.clock.now() },
                    nextAttemptAt: { lte: this.clock.now() },
                  },
                },
              ],
            },
          ],
          OR: [
            { status: NotificationStatus.pending },
            {
              status: {
                in: [NotificationStatus.queued, NotificationStatus.uncertain],
              },
              automationDelivery: { isNot: null },
            },
            {
              status: NotificationStatus.failed,
              retrySafe: true,
              nextRetryAt: { lte: new Date() },
              attemptCount: { lt: 5 },
            },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 100,
        select: { id: true, attemptCount: true },
      });
      for (const history of pending) {
        try {
          await this.queue.add(
            NOTIFICATIONS_QUEUE,
            { notificationHistoryId: history.id },
            {
              jobId: `notification-${history.id}-${history.attemptCount}`,
              attempts: 1,
              removeOnComplete: true,
              removeOnFail: 200,
            },
          );
          queued++;
        } catch {
          break;
        } // Database work remains pending while Redis is unavailable.
      }
    } catch {
      /* Database and queue recovery are retried by the next bounded poll; no payload or secret in logs. */
    } finally {
      this.running = false;
    }
    return { prepared, queued };
  }
}
