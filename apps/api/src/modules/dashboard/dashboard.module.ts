import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { DashboardController } from "./dashboard.controller";

@Module({ imports: [AppCacheModule], controllers: [DashboardController] })
export class DashboardModule {}
