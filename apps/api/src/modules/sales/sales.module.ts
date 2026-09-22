import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { CustomersModule } from "../customers/customers.module";
import { SalesController } from "./sales.controller";

@Module({
  imports: [AppCacheModule, CustomersModule],
  controllers: [SalesController],
})
export class SalesModule {}
