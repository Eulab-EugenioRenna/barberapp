import { Module } from "@nestjs/common";
import { NotificationAutomationGrantsController } from "./notification-automation-grants.controller";
import { NotificationAutomationGrantsService } from "./notification-automation-grants.service";
import { NotificationAutomationCommandStore } from "./notification-automation-command-store.service";
import { NotificationAutomationWithdrawalRecovery } from "./notification-automation-withdrawal-recovery.service";

@Module({
  controllers: [NotificationAutomationGrantsController],
  providers: [
    NotificationAutomationCommandStore,
    NotificationAutomationGrantsService,
    NotificationAutomationWithdrawalRecovery,
  ],
  exports: [NotificationAutomationGrantsService,NotificationAutomationCommandStore],
})
export class NotificationAutomationGrantsModule {}
