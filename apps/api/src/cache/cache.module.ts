import { Global, Module } from "@nestjs/common";
import { CacheModule as NestCacheModule } from "@nestjs/cache-manager";
import { BullModule } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { REDIS_CACHE_CLIENT } from "./cache.constants";
import { AppCacheService } from "./cache.service";
import { CacheInvalidationService } from "./cache-invalidation.service";

@Global()
@Module({
  imports: [
    NestCacheModule.register({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>("REDIS_HOST") ?? "redis",
          port: Number(configService.get<string>("REDIS_PORT") ?? 6379),
          password: configService.get<string>("REDIS_PASSWORD") || undefined,
        },
      }),
    }),
  ],
  providers: [
    {
      provide: REDIS_CACHE_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new Redis({
          host: configService.get<string>("REDIS_HOST") ?? "redis",
          port: Number(configService.get<string>("REDIS_PORT") ?? 6379),
          password: configService.get<string>("REDIS_PASSWORD") || undefined,
          maxRetriesPerRequest: null,
        }),
    },
    AppCacheService,
    CacheInvalidationService,
  ],
  exports: [
    NestCacheModule,
    BullModule,
    AppCacheService,
    CacheInvalidationService,
  ],
})
export class AppCacheModule {}
