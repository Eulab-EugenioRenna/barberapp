import { RequestSessionInterceptor } from "./common/request-session.interceptor";
import { TeamModule } from "./modules/team/team.module";
import { AuthAttemptGuard } from "./modules/auth/auth-attempt.guard";
import { FunctionCatalogController } from "./modules/function-catalog/function-catalog.controller";
import { PrismaErrorFilter } from "./common/prisma-error.filter";
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from "@nestjs/core";
import { LocalPolicyGuard } from "./common/local-policy.guard";
import { SecurityAuditInterceptor } from "./common/security-audit.interceptor";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppCacheModule } from "./cache/cache.module";
import { PrismaModule } from "./prisma/prisma.module";
import { AppController } from "./app.controller";
import { AuditModule } from "./modules/audit/audit.module";
import { AppointmentsModule } from "./modules/appointments/appointments.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AvailabilityModule } from "./modules/availability/availability.module";
import { CollaboratorsModule } from "./modules/collaborators/collaborators.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { HealthModule } from "./modules/health/health.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { PlatformAdminModule } from "./modules/platform-admin/platform-admin.module";
import { ProductsModule } from "./modules/products/products.module";
import { PublicBookingModule } from "./modules/public-booking/public-booking.module";
import { SalesModule } from "./modules/sales/sales.module";
import { ServicesModule } from "./modules/services/services.module";
import { TenantModule } from "./modules/tenant/tenant.module";
import { UsersModule } from "./modules/users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AppCacheModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    TenantModule,
    UsersModule,
    TeamModule,
    CollaboratorsModule,
    ServicesModule,
    CustomersModule,
    AppointmentsModule,
    AvailabilityModule,
    ProductsModule,
    SalesModule,
    DashboardModule,
    AuditModule,
    NotificationsModule,
    PaymentsModule,
    PlatformAdminModule,
    PublicBookingModule,
  ],
  controllers: [AppController, FunctionCatalogController],
  providers: [
    { provide: APP_FILTER, useClass: PrismaErrorFilter },
    { provide: APP_GUARD, useClass: AuthAttemptGuard },
    { provide: APP_GUARD, useClass: LocalPolicyGuard },
    { provide: APP_INTERCEPTOR, useClass: RequestSessionInterceptor },
    { provide: APP_INTERCEPTOR, useClass: SecurityAuditInterceptor },
  ],
})
export class AppModule {}
