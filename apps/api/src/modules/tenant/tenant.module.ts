import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { TenantController } from "./tenant.controller";

@Module({
  imports: [AppCacheModule],
  controllers: [TenantController],
})
export class TenantModule {}
