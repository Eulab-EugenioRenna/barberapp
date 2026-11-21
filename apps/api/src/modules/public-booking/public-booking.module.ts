import { OrdersModule } from "../orders/orders.module";
import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { AvailabilityModule } from "../availability/availability.module";
import { CustomersModule } from "../customers/customers.module";
import { PublicBookingController } from "./public-booking.controller";

@Module({
  imports: [
    OrdersModule,
    AppCacheModule,
    AvailabilityModule,
    CustomersModule,
  ],
  controllers: [PublicBookingController],
})
export class PublicBookingModule {}
