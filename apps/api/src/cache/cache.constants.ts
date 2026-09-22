export const REDIS_CACHE_CLIENT = "REDIS_CACHE_CLIENT";

export const CACHE_TTL_SECONDS = {
  tenantSettings: 300,
  publicSettings: 300,
  publicServices: 300,
  publicAvailability: 30,
  dashboard: 90,
  lists: 180,
  appointments: 30,
  notifications: 60,
} as const;

export const cacheKeys = {
  tenantSettings: (tenantId: string) => `app:tenant-settings:${tenantId}`,
  tenantSettingsPrefix: "app:tenant-settings:",
  publicTenantBySlug: (slug: string) => `app:public-tenant:slug:${slug}`,
  publicTenantByDomain: (domain: string) =>
    `app:public-tenant:domain:${domain}`,
  publicTenantBySlugPrefix: "app:public-tenant:slug:",
  publicTenantByDomainPrefix: "app:public-tenant:domain:",
  publicSettings: (tenantId: string) => `app:public-settings:${tenantId}`,
  publicSettingsPrefix: (tenantId: string) => `app:public-settings:${tenantId}`,
  publicServices: (tenantId: string) => `app:public-services:${tenantId}`,
  publicServicesPrefix: (tenantId: string) => `app:public-services:${tenantId}`,
  publicAvailability: (
    tenantId: string,
    serviceId: string,
    date: string,
    collaboratorId?: string,
  ) =>
    `app:public-availability:${tenantId}:${serviceId}:${date}:${collaboratorId ?? "any"}`,
  publicAvailabilityPrefix: (tenantId: string) =>
    `app:public-availability:${tenantId}:`,
  dashboardRevenue: (tenantId: string, month: string) =>
    `app:dashboard:revenue:${tenantId}:${month}`,
  dashboardRevenuePrefix: (tenantId: string) =>
    `app:dashboard:revenue:${tenantId}:`,
  dashboardAppointments: (tenantId: string, month: string) =>
    `app:dashboard:appointments:${tenantId}:${month}`,
  dashboardAppointmentsPrefix: (tenantId: string) =>
    `app:dashboard:appointments:${tenantId}:`,
  dashboardCollaborators: (tenantId: string) =>
    `app:dashboard:collaborators:${tenantId}`,
  dashboardCollaboratorsPrefix: (tenantId: string) =>
    `app:dashboard:collaborators:${tenantId}`,
  dashboardServices: (tenantId: string) => `app:dashboard:services:${tenantId}`,
  dashboardServicesPrefix: (tenantId: string) =>
    `app:dashboard:services:${tenantId}`,
  dashboardProducts: (tenantId: string) => `app:dashboard:products:${tenantId}`,
  dashboardProductsPrefix: (tenantId: string) =>
    `app:dashboard:products:${tenantId}`,
  servicesList: (tenantId: string) => `app:services:list:${tenantId}`,
  servicesListPrefix: (tenantId: string) => `app:services:list:${tenantId}`,
  collaboratorsList: (tenantId: string) => `app:collaborators:list:${tenantId}`,
  collaboratorsListPrefix: (tenantId: string) =>
    `app:collaborators:list:${tenantId}`,
  productsList: (tenantId: string) => `app:products:list:${tenantId}`,
  productsListPrefix: (tenantId: string) => `app:products:list:${tenantId}`,
  salesList: (tenantId: string) => `app:sales:list:${tenantId}`,
  salesListPrefix: (tenantId: string) => `app:sales:list:${tenantId}`,
  saleDetail: (tenantId: string, saleId: string) =>
    `app:sales:detail:${tenantId}:${saleId}`,
  saleDetailPrefix: (tenantId: string) => `app:sales:detail:${tenantId}:`,
  customersList: (tenantId: string) => `app:customers:list:${tenantId}`,
  customersListPrefix: (tenantId: string) => `app:customers:list:${tenantId}`,
  customerDetail: (tenantId: string, customerId: string) =>
    `app:customers:detail:${tenantId}:${customerId}`,
  customerDetailPrefix: (tenantId: string) =>
    `app:customers:detail:${tenantId}:`,
  customerHistory: (tenantId: string, customerId: string) =>
    `app:customers:history:${tenantId}:${customerId}`,
  customerHistoryPrefix: (tenantId: string) =>
    `app:customers:history:${tenantId}:`,
  appointmentsList: (tenantId: string) => `app:appointments:list:${tenantId}`,
  appointmentsListPrefix: (tenantId: string) =>
    `app:appointments:list:${tenantId}`,
  appointmentDetail: (tenantId: string, appointmentId: string) =>
    `app:appointments:detail:${tenantId}:${appointmentId}`,
  appointmentDetailPrefix: (tenantId: string) =>
    `app:appointments:detail:${tenantId}:`,
  appointmentCancellationPolicy: (tenantId: string, appointmentId: string) =>
    `app:appointments:cancellation-policy:${tenantId}:${appointmentId}`,
  appointmentCancellationPolicyPrefix: (tenantId: string) =>
    `app:appointments:cancellation-policy:${tenantId}:`,
  platformAdminTenants: "app:platform-admin:tenants",
  platformAdminTenant: (tenantId: string) =>
    `app:platform-admin:tenant:${tenantId}`,
  platformAdminTenantPrefix: "app:platform-admin:tenant:",
  platformAdminHealthCheck: (tenantId: string) =>
    `app:platform-admin:health-check:${tenantId}`,
  platformAdminHealthCheckPrefix: "app:platform-admin:health-check:",
  platformAdminPlans: "app:platform-admin:plans",
  platformAdminSubscriptions: "app:platform-admin:subscriptions",
} as const;
