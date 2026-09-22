import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { ServicesController } from "./services.controller";

@Module({ imports: [AppCacheModule], controllers: [ServicesController] })
export class ServicesModule {}
