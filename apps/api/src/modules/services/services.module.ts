import { PricingModule } from "../pricing/pricing.module";
import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { ServicesController } from "./services.controller";

@Module({
  imports: [PricingModule, AppCacheModule],
  controllers: [ServicesController],
})
export class ServicesModule {}
