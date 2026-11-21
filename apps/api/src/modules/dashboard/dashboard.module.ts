import { FinancialReportService } from "./financial-report.service";
import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { PersonalDashboardController } from "./personal-dashboard.controller";
import { DashboardController } from "./dashboard.controller";

@Module({
  providers: [FinancialReportService],
  exports: [FinancialReportService],
  imports: [AppCacheModule],
  controllers: [DashboardController, PersonalDashboardController],
})
export class DashboardModule {}
