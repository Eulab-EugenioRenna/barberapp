import { DashboardModule } from "../dashboard/dashboard.module";
import { Module } from "@nestjs/common";
import { LocationsController } from "./locations.controller";
@Module({ imports: [DashboardModule], controllers: [LocationsController] })
export class LocationsModule {}
