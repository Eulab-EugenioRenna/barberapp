import { OrdersModule } from "../orders/orders.module";
import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { AvailabilityModule } from "../availability/availability.module";
import { CustomersModule } from "../customers/customers.module";
import { AppointmentsController } from "./appointments.controller";

@Module({
  imports: [
    OrdersModule,
    AppCacheModule,
    AvailabilityModule,
    CustomersModule,
  ],
  controllers: [AppointmentsController],
})
export class AppointmentsModule {}
