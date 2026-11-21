import { SaleFulfilmentService } from "./sale-fulfilment.service";
import { PaymentsModule } from "../payments/payments.module";
import { InventoryModule } from "../inventory/inventory.module";
import { OrdersModule } from "../orders/orders.module";
import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { CustomersModule } from "../customers/customers.module";
import { SalesController } from "./sales.controller";

@Module({
  imports: [
    PaymentsModule,
    InventoryModule,
    OrdersModule,
    AppCacheModule,
    CustomersModule,
  ],
  controllers: [SalesController],
  providers: [SaleFulfilmentService],
})
export class SalesModule {}
