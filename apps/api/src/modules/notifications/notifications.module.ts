import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { NotificationsController } from "./notifications.controller";
import { NotificationsDispatchService } from "./notifications.dispatch.service";
import { NotificationsEventsService } from "./notifications.events.service";
import { NotificationsProcessor } from "./notifications.processor";
import {
  EmailNotificationProvider,
  InAppNotificationProvider,
  WebhookNotificationProvider,
} from "./notifications.providers";
import { NOTIFICATIONS_QUEUE } from "./notifications.constants";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsEventsService,
    NotificationsDispatchService,
    NotificationsProcessor,
    InAppNotificationProvider,
    EmailNotificationProvider,
    WebhookNotificationProvider,
  ],
  exports: [NotificationsEventsService, NotificationsService],
})
export class NotificationsModule {}
