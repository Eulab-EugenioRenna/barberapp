import { BookingMutationService } from "./booking-mutation.service";
import { Module } from "@nestjs/common";
import { AvailabilityModule } from "../availability/availability.module";
import { OperationalOrderService } from "./operational-order.service";
import { OrderCommandService } from "./order-command.service";
import { BookingResourcesService } from "./booking-resources.service";
import { BookingCommandService } from "./booking-command.service";
import { BookingAvailabilityService } from "./booking-availability.service";
@Module({
  imports: [AvailabilityModule],
  providers: [
    OperationalOrderService,
    OrderCommandService,
    BookingResourcesService,
    BookingCommandService,
    BookingAvailabilityService,
    BookingMutationService,
  ],
  exports: [
    OperationalOrderService,
    OrderCommandService,
    BookingCommandService,
    BookingAvailabilityService,
    BookingMutationService,
  ],
})
export class OrdersModule {}
