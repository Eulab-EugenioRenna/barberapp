import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { NOTIFICATIONS_QUEUE } from "./notifications.constants";
import {
  NotificationEventPayload,
  NotificationQueueJob,
} from "./notifications.types";
import { NotificationsService } from "./notifications.service";

@Injectable()
export class NotificationsEventsService {
  constructor(
    private readonly notificationsService: NotificationsService,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notificationsQueue: Queue<NotificationQueueJob>,
  ) {}

  async emit(payload: NotificationEventPayload): Promise<unknown> {
    const plan = await this.notificationsService.resolveDispatchPlan(payload);
    const ids: string[] = [];

    for (const target of plan.targets) {
      const history = await this.notificationsService.createHistoryEntry(
        plan.payload,
        target,
      );

      ids.push(history.id);

      await this.notificationsQueue.add(
        NOTIFICATIONS_QUEUE,
        { notificationHistoryId: history.id },
        {
          attempts: 5,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
          removeOnComplete: 200,
          removeOnFail: 200,
        },
      );
    }

    return {
      queued: ids.length,
      ids,
    };
  }
}
