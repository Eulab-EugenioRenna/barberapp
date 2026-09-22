import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { PlatformAdminController } from "./platform-admin.controller";
import { PlatformAdminService } from "./platform-admin.service";

@Module({
  imports: [AppCacheModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService],
})
export class PlatformAdminModule {}
