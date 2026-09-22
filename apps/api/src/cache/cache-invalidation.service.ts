import { Injectable } from "@nestjs/common";
import { cacheKeys } from "./cache.constants";
import { AppCacheService } from "./cache.service";

@Injectable()
export class CacheInvalidationService {
  constructor(private readonly cacheService: AppCacheService) {}

  async invalidateTenantSettings(tenantId: string): Promise<void> {
    await Promise.all([
      this.cacheService.delByPrefix(cacheKeys.tenantSettings(tenantId)),
      this.cacheService.delByPrefix(cacheKeys.publicSettingsPrefix(tenantId)),
    ]);
  }

  async invalidatePublicTenantLookups(): Promise<void> {
    await Promise.all([
      this.cacheService.delByPrefix(cacheKeys.publicTenantBySlugPrefix),
      this.cacheService.delByPrefix(cacheKeys.publicTenantByDomainPrefix),
    ]);
  }

  async invalidatePublicServices(tenantId: string): Promise<void> {
    await this.cacheService.delByPrefix(
      cacheKeys.publicServicesPrefix(tenantId),
    );
  }

  async invalidatePublicAvailability(tenantId: string): Promise<void> {
    await this.cacheService.delByPrefix(
      cacheKeys.publicAvailabilityPrefix(tenantId),
    );
  }

  async invalidateDashboard(tenantId: string): Promise<void> {
    await Promise.all([
      this.cacheService.delByPrefix(cacheKeys.dashboardRevenuePrefix(tenantId)),
      this.cacheService.delByPrefix(
        cacheKeys.dashboardAppointmentsPrefix(tenantId),
      ),
      this.cacheService.delByPrefix(
        cacheKeys.dashboardCollaboratorsPrefix(tenantId),
      ),
      this.cacheService.delByPrefix(
        cacheKeys.dashboardServicesPrefix(tenantId),
      ),
      this.cacheService.delByPrefix(
        cacheKeys.dashboardProductsPrefix(tenantId),
      ),
    ]);
  }

  async invalidateServices(tenantId: string): Promise<void> {
    await this.cacheService.delByPrefix(cacheKeys.servicesListPrefix(tenantId));
  }

  async invalidateCollaborators(tenantId: string): Promise<void> {
    await this.cacheService.delByPrefix(
      cacheKeys.collaboratorsListPrefix(tenantId),
    );
  }

  async invalidateProducts(tenantId: string): Promise<void> {
    await this.cacheService.delByPrefix(cacheKeys.productsListPrefix(tenantId));
  }

  async invalidateSales(tenantId: string): Promise<void> {
    await Promise.all([
      this.cacheService.delByPrefix(cacheKeys.salesListPrefix(tenantId)),
      this.cacheService.delByPrefix(cacheKeys.saleDetailPrefix(tenantId)),
    ]);
  }

  async invalidateCustomers(tenantId: string): Promise<void> {
    await Promise.all([
      this.cacheService.delByPrefix(cacheKeys.customersListPrefix(tenantId)),
      this.cacheService.delByPrefix(cacheKeys.customerDetailPrefix(tenantId)),
      this.cacheService.delByPrefix(cacheKeys.customerHistoryPrefix(tenantId)),
    ]);
  }

  async invalidateAppointments(tenantId: string): Promise<void> {
    await Promise.all([
      this.cacheService.delByPrefix(cacheKeys.appointmentsListPrefix(tenantId)),
      this.cacheService.delByPrefix(
        cacheKeys.appointmentDetailPrefix(tenantId),
      ),
      this.cacheService.delByPrefix(
        cacheKeys.appointmentCancellationPolicyPrefix(tenantId),
      ),
    ]);
  }

  async invalidateBookingReadModels(tenantId: string): Promise<void> {
    await Promise.all([
      this.invalidateAppointments(tenantId),
      this.invalidatePublicAvailability(tenantId),
      this.invalidateDashboard(tenantId),
      this.invalidateCustomers(tenantId),
      this.invalidateSales(tenantId),
    ]);
  }

  async invalidatePlatformAdminTenants(): Promise<void> {
    await Promise.all([
      this.cacheService.del(cacheKeys.platformAdminTenants),
      this.cacheService.delByPrefix(cacheKeys.platformAdminTenantPrefix),
      this.cacheService.delByPrefix(cacheKeys.platformAdminHealthCheckPrefix),
      this.cacheService.del(cacheKeys.platformAdminSubscriptions),
    ]);
  }

  async invalidatePlatformAdminPlans(): Promise<void> {
    await Promise.all([
      this.cacheService.del(cacheKeys.platformAdminPlans),
      this.cacheService.del(cacheKeys.platformAdminSubscriptions),
    ]);
  }
}
