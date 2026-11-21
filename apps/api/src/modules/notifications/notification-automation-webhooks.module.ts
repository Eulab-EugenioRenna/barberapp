import { Module } from "@nestjs/common";
import { NotificationAutomationGrantsModule } from "./notification-automation-grants.module";
import { NotificationAutomationWebhooksController } from "./notification-automation-webhooks.controller";
import { NotificationAutomationWebhooksService } from "./notification-automation-webhooks.service";

@Module({
  imports: [NotificationAutomationGrantsModule],
  controllers: [NotificationAutomationWebhooksController],
  providers: [NotificationAutomationWebhooksService],
  exports: [NotificationAutomationWebhooksService],
})
export class NotificationAutomationWebhooksModule {}
