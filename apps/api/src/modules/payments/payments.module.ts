import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { PaymentsController } from "./payments.controller";
import { PaymentLedgerController } from "./payment-ledger.controller";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [AppCacheModule],
  controllers: [PaymentsController, PaymentLedgerController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
