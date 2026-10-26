import type { FunctionKey } from "./function-catalog";
/** Ogni handler HTTP deve essere censito esattamente. Il guard nega quelli sconosciuti. */
export type OperationDefinition =
  | { kind: "function"; key: FunctionKey; own?: FunctionKey }
  | { kind: "public" | "session" | "tenant-context" | "platform" | "disabled" };
export const OPERATIONS: Readonly<Record<string, OperationDefinition>> = {
  "PersonalDashboardController.overview": { kind: "function", key: "appointments.read.own", own: "appointments.read.own" },
  "TeamController.pendingAccounts": { kind: "function", key: "team.manage" },
  "TeamController.createAccount": { kind: "function", key: "team.manage" },
  "TeamController.resumeAccount": { kind: "function", key: "team.manage" },
  "TeamController.localUsers": { kind: "function", key: "users.manage" },
  "TeamController.associateSelf": { kind: "function", key: "team.manage" },
  "TeamController.saveLocalPolicy": { kind: "function", key: "team.manage" },
  "TeamController.overview": { kind: "function", key: "users.manage" },
  "TeamController.createRole": { kind: "function", key: "team.manage" },
  "TeamController.updateRole": { kind: "function", key: "team.manage" },
  "TeamController.removeRole": { kind: "function", key: "team.manage" },
  "TeamController.assignRoles": { kind: "function", key: "team.manage" },
  "TeamController.revoke": { kind: "function", key: "team.manage" },
  "TeamController.restore": { kind: "function", key: "team.manage" },

  "AuthController.method": { kind: "public" },
  "ConnectAuthController.accept": { kind: "public" },
  "ConnectAuthController.callback": { kind: "public" },
  "ConnectAuthController.exchange": { kind: "public" },
  "AppointmentsController.context": {
    kind: "function",
    key: "appointments.read.all",
  },
  "ServicesController.findAll": {
    kind: "function",
    key: "services.read",
  },
  "ServicesController.create": {
    kind: "function",
    key: "services.manage",
  },
  "ServicesController.update": {
    kind: "function",
    key: "services.manage",
  },
  "ServicesController.attachProduct": {
    kind: "function",
    key: "services.manage",
  },
  "ServicesController.detachProduct": {
    kind: "function",
    key: "services.manage",
  },
  "ServicesController.remove": {
    kind: "function",
    key: "services.manage",
  },
  "ProductsController.findAll": {
    kind: "function",
    key: "products.read",
  },
  "ProductsController.create": {
    kind: "function",
    key: "products.manage",
  },
  "ProductsController.update": {
    kind: "function",
    key: "products.manage",
  },
  "ProductsController.remove": {
    kind: "function",
    key: "products.manage",
  },
  "CollaboratorsController.findAll": {
    kind: "function",
    key: "collaborators.read",
  },
  "CollaboratorsController.create": {
    kind: "function",
    key: "collaborators.manage",
  },
  "CollaboratorsController.update": {
    kind: "function",
    key: "collaborators.manage",
  },
  "CollaboratorsController.remove": {
    kind: "function",
    key: "collaborators.manage",
  },
  "CustomersController.findAll": {
    kind: "function",
    key: "clients.read.full",
  },
  "CustomersController.findOne": {
    kind: "function",
    key: "clients.read.full",
  },
  "CustomersController.history": {
    kind: "function",
    key: "clients.read.full",
  },
  "CustomersController.create": {
    kind: "function",
    key: "clients.manage",
  },
  "CustomersController.update": {
    kind: "function",
    key: "clients.manage",
  },
  "CustomersController.remove": {
    kind: "function",
    key: "clients.manage",
  },
  "SalesController.findAll": {
    kind: "function",
    key: "sales.read",
  },
  "SalesController.findOne": {
    kind: "function",
    key: "sales.read",
  },
  "SalesController.create": {
    kind: "function",
    key: "sales.manage",
  },
  "SalesController.update": {
    kind: "function",
    key: "sales.manage",
  },
  "SalesController.linkAppointment": {
    kind: "function",
    key: "sales.manage",
  },
  "SalesController.remove": {
    kind: "function",
    key: "sales.manage",
  },
  "AppointmentsController.findAll": {
    kind: "function",
    key: "appointments.read.all",
    own: "appointments.read.own",
  },
  "AppointmentsController.findOne": {
    kind: "function",
    key: "appointments.read.all",
    own: "appointments.read.own",
  },
  "AppointmentsController.cancellationPolicy": {
    kind: "function",
    key: "appointments.read.all",
    own: "appointments.read.own",
  },
  "AppointmentsController.updateStatus": {
    kind: "function",
    key: "appointments.update.all",
    own: "appointments.update.own",
  },
  "AppointmentsController.create": {
    kind: "function",
    key: "appointments.create",
  },
  "AppointmentsController.update": {
    kind: "function",
    key: "appointments.update.all",
  },
  "AppointmentsController.remove": {
    kind: "function",
    key: "appointments.update.all",
  },
  "AppointmentsController.cancel": {
    kind: "function",
    key: "appointments.update.all",
  },
  "AvailabilityController.getAvailability": {
    kind: "function",
    key: "appointments.read.all",
  },
  "DashboardController.revenue": {
    kind: "function",
    key: "dashboard.revenue.read",
  },
  "DashboardController.activity": {
    kind: "function",
    key: "dashboard.revenue.read",
  },
  "DashboardController.appointments": {
    kind: "function",
    key: "dashboard.revenue.read",
  },
  "DashboardController.upcomingAppointments": {
    kind: "function",
    key: "dashboard.revenue.read",
  },
  "DashboardController.collaborators": {
    kind: "function",
    key: "dashboard.revenue.read",
  },
  "DashboardController.services": {
    kind: "function",
    key: "dashboard.revenue.read",
  },
  "DashboardController.products": {
    kind: "function",
    key: "dashboard.revenue.read",
  },
  "TenantController.getSettings": {
    kind: "function",
    key: "settings.manage",
  },
  "TenantController.updateSettings": {
    kind: "function",
    key: "settings.manage",
  },
  "TenantController.uploadLogo": {
    kind: "function",
    key: "settings.manage",
  },
  "TenantController.uploadCover": {
    kind: "function",
    key: "settings.manage",
  },
  "TenantController.deleteLogo": {
    kind: "function",
    key: "settings.manage",
  },
  "TenantController.deleteCover": {
    kind: "function",
    key: "settings.manage",
  },
  "UsersController.findAll": {
    kind: "function",
    key: "users.manage",
  },
  "UsersController.revokeSessions": {
    kind: "function",
    key: "users.manage",
  },
  "AuditController.findAll": {
    kind: "function",
    key: "audit.read",
  },
  "NotificationsController.stream": {
    kind: "function",
    key: "confirmations.read",
  },
  "NotificationsController.preferences": {
    kind: "function",
    key: "notifications.read",
  },
  "NotificationsController.updateMyPreferences": {
    kind: "function",
    key: "notifications.read",
  },
  "NotificationsController.inbox": {
    kind: "function",
    key: "notifications.read",
  },
  "NotificationsController.unreadCount": {
    kind: "function",
    key: "notifications.read",
  },
  "NotificationsController.markRead": {
    kind: "function",
    key: "notifications.read",
  },
  "NotificationsController.markAllRead": {
    kind: "function",
    key: "notifications.read",
  },
  "NotificationsController.updateTenantPreferences": {
    kind: "function",
    key: "notifications.manage",
  },
  "NotificationsController.providers": {
    kind: "function",
    key: "notifications.manage",
  },
  "NotificationsController.updateProvider": {
    kind: "function",
    key: "notifications.manage",
  },
  "NotificationsController.testProvider": {
    kind: "function",
    key: "notifications.manage",
  },
  "NotificationsController.templates": {
    kind: "function",
    key: "notifications.manage",
  },
  "NotificationsController.updateTemplate": {
    kind: "function",
    key: "notifications.manage",
  },
  "NotificationsController.history": {
    kind: "function",
    key: "notifications.manage",
  },
  "NotificationsController.emitEvent": {
    kind: "function",
    key: "notifications.manage",
  },
  "PaymentsController.settings": {
    kind: "disabled",
  },
  "PaymentsController.updateSettings": {
    kind: "disabled",
  },
  "PaymentsController.prepareIntent": {
    kind: "disabled",
  },
  "PlatformAdminController.tenants": {
    kind: "platform",
  },
  "PlatformAdminController.tenant": {
    kind: "platform",
  },
  "PlatformAdminController.healthCheck": {
    kind: "platform",
  },
  "PlatformAdminController.updateTenant": {
    kind: "platform",
  },
  "PlatformAdminController.suspendTenant": {
    kind: "platform",
  },
  "PlatformAdminController.reactivateTenant": {
    kind: "platform",
  },
  "PlatformAdminController.resetTenant": {
    kind: "platform",
  },
  "PlatformAdminController.deleteTenant": {
    kind: "platform",
  },
  "PlatformAdminController.exportTenant": {
    kind: "platform",
  },
  "PlatformAdminController.importTenant": {
    kind: "platform",
  },
  "PlatformAdminController.plans": {
    kind: "platform",
  },
  "PlatformAdminController.createPlan": {
    kind: "platform",
  },
  "PlatformAdminController.updatePlan": {
    kind: "platform",
  },
  "PlatformAdminController.subscriptions": {
    kind: "platform",
  },
  "PlatformAdminController.createSubscription": {
    kind: "platform",
  },
  "PlatformAdminController.updateSubscription": {
    kind: "platform",
  },
  "PublicBookingController.getHostSettings": {
    kind: "public",
  },
  "PublicBookingController.getHostServices": {
    kind: "public",
  },
  "PublicBookingController.getHostAvailability": {
    kind: "public",
  },
  "PublicBookingController.getHostAvailabilityRange": {
    kind: "public",
  },
  "PublicBookingController.createHostBooking": {
    kind: "public",
  },
  "PublicBookingController.getSettings": {
    kind: "public",
  },
  "PublicBookingController.getServices": {
    kind: "public",
  },
  "PublicBookingController.getAvailability": {
    kind: "public",
  },
  "PublicBookingController.getAvailabilityRange": {
    kind: "public",
  },
  "PublicBookingController.createBooking": {
    kind: "public",
  },
  "HealthController.check": {
    kind: "public",
  },
  "AppController.getRoot": {
    kind: "public",
  },
  "AuthController.login": {
    kind: "public",
  },
  "AuthController.signup": {
    kind: "public",
  },
  "AuthController.refresh": {
    kind: "public",
  },
  "AuthController.logout": {
    kind: "public",
  },
  "AuthController.me": {
    kind: "session",
  },
  "FunctionCatalogController.matrix": {
    kind: "public",
  },
  "TenantController.context": {
    kind: "tenant-context",
  },
};
export function operationDefinition(
  controller: string,
  operation: string,
): OperationDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(
    OPERATIONS,
    controller + "." + operation,
  )
    ? OPERATIONS[controller + "." + operation]
    : undefined;
}
