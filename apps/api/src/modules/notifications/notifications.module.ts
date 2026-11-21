import { NotificationsOutboxService } from "./notifications.outbox.service";
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
import { AppointmentAutomationPolicyController } from "./appointment-automation-policy.controller";
import { AppointmentAutomationPolicyService } from "./appointment-automation-policy.service";
import { NotificationAutomationGrantsModule } from "./notification-automation-grants.module";
import { NotificationAutomationWebhooksModule } from "./notification-automation-webhooks.module";
import { AppointmentAutomationsModule } from "./appointment-automations.module";

@Module({
  imports: [
    AppointmentAutomationsModule,
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
    NotificationAutomationGrantsModule,
    NotificationAutomationWebhooksModule,
  ],
  controllers: [NotificationsController, AppointmentAutomationPolicyController],
  providers: [
    AppointmentAutomationPolicyService,
    NotificationsService,
    NotificationsEventsService,
    NotificationsOutboxService,
    NotificationsDispatchService,
    NotificationsProcessor,
    InAppNotificationProvider,
    EmailNotificationProvider,
    WebhookNotificationProvider,
  ],
  exports: [NotificationsEventsService, NotificationsService],
})
export class NotificationsModule {}
