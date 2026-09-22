import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { ProductsController } from "./products.controller";

@Module({ imports: [AppCacheModule], controllers: [ProductsController] })
export class ProductsModule {}
