import { DashboardModule } from "../dashboard/dashboard.module";
import { Module } from "@nestjs/common";
import { ActivitiesController } from "./activities.controller";
import { LocationsController } from "./locations.controller";
@Module({
  imports: [DashboardModule],
  controllers: [LocationsController, ActivitiesController],
})
export class LocationsModule {}
