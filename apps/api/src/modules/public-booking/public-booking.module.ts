import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { AvailabilityModule } from "../availability/availability.module";
import { CustomersModule } from "../customers/customers.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PublicBookingController } from "./public-booking.controller";

@Module({
  imports: [
    AppCacheModule,
    AvailabilityModule,
    NotificationsModule,
    CustomersModule,
  ],
  controllers: [PublicBookingController],
})
export class PublicBookingModule {}
