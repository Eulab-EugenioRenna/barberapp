import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { NOTIFICATIONS_QUEUE } from "./notifications.constants";
import { NotificationQueueJob } from "./notifications.types";
import { NotificationsDispatchService } from "./notifications.dispatch.service";

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  constructor(
    private readonly notificationsDispatchService: NotificationsDispatchService,
  ) {
    super();
  }

  async process(job: Job<NotificationQueueJob>): Promise<void> {
    await this.notificationsDispatchService.dispatchHistory(
      job.data.notificationHistoryId,
    );
  }
}
