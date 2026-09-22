import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AppCacheModule } from "../../cache/cache.module";
import { CUSTOMERS_ALIGNMENT_QUEUE } from "./customers.constants";
import { CustomersAlignmentService } from "./customers-alignment.service";
import { CustomersController } from "./customers.controller";
import { CustomersProcessor } from "./customers.processor";

@Module({
  imports: [
    AppCacheModule,
    BullModule.registerQueue({ name: CUSTOMERS_ALIGNMENT_QUEUE }),
  ],
  controllers: [CustomersController],
  providers: [CustomersAlignmentService, CustomersProcessor],
  exports: [CustomersAlignmentService],
})
export class CustomersModule {}
