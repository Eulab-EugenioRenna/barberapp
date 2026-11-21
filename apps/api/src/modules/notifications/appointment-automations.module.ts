import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { AutomationClock } from "../../common/automation-clock";
import { NotificationAutomationGrantsModule } from "./notification-automation-grants.module";
import { AppointmentContactController } from "./appointment-contact.controller";
import { AppointmentContactService } from "./appointment-contact.service";
import { AppointmentAutomationPlanner } from "./appointment-automation-planner.service";
import { AppointmentAutomationDispatch } from "./appointment-automation-dispatch.service";
import { AppointmentAutomationRecovery } from "./appointment-automation-recovery.service";
import { AppointmentCustomerActions } from "./appointment-customer-actions.service";
import { AppointmentAutomationStaffNotices } from "./appointment-automation-staff.service";
import { AppointmentAutomationMonitorController } from "./appointment-automation-monitor.controller";

@Module({
  imports: [OrdersModule, NotificationAutomationGrantsModule],
  controllers: [
    AppointmentContactController,
    AppointmentAutomationMonitorController,
  ],
  providers: [
    AutomationClock,
    AppointmentContactService,
    AppointmentAutomationPlanner,
    AppointmentAutomationDispatch,
    AppointmentAutomationRecovery,
    AppointmentCustomerActions,
    AppointmentAutomationStaffNotices,
  ],
  exports: [
    AutomationClock,
    AppointmentAutomationPlanner,
    AppointmentAutomationDispatch,
    AppointmentAutomationRecovery,
  ],
})
export class AppointmentAutomationsModule {}
