import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { TenantController } from "./tenant.controller";
import { SetupStatusController } from "./setup-status.controller";

@Module({
  imports: [AppCacheModule],
  controllers: [TenantController, SetupStatusController],
})
export class TenantModule {}
