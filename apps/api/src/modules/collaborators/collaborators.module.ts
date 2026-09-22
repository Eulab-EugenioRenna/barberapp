import { Module } from "@nestjs/common";
import { AppCacheModule } from "../../cache/cache.module";
import { CollaboratorsController } from "./collaborators.controller";

@Module({ imports: [AppCacheModule], controllers: [CollaboratorsController] })
export class CollaboratorsModule {}
