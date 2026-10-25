import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { PersonalDashboardController } from "./personal-dashboard.controller";
import { DashboardController } from "./dashboard.controller";

@Module({ imports: [AppCacheModule], controllers: [DashboardController, PersonalDashboardController] })
export class DashboardModule {}
