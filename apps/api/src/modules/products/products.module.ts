import { PricingModule } from "../pricing/pricing.module";
import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { ProductsController } from "./products.controller";
import { ProductBrandsController } from "./product-brands.controller";

@Module({
  imports: [PricingModule, AppCacheModule],
  controllers: [ProductsController, ProductBrandsController],
})
export class ProductsModule {}
