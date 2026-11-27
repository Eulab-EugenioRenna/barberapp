import { PICK_LIST_ACCESS, type FunctionKey } from "./function-catalog";
/** Ogni handler HTTP deve essere censito esattamente. Il guard nega quelli sconosciuti. */
export type OperationDefinition =
  | {
      kind: "function";
      key: FunctionKey;
      own?: FunctionKey;
      /** Alternative functions that also allow the operation (pick lists). */
      anyOf?: readonly FunctionKey[];
    }
  | { kind: "public" | "session" | "tenant-context" | "platform" | "disabled" };
export const OPERATIONS: Readonly<Record<string, OperationDefinition>> = {
  "WhatsAppController.sessions": { kind: "function", key: "whatsapp.read" },
  "WhatsAppController.archives": { kind: "function", key: "whatsapp.read" },
  "WhatsAppController.conversations": { kind: "function", key: "whatsapp.read" },
  "WhatsAppController.messages": { kind: "function", key: "whatsapp.read" },
  "WhatsAppController.outbox": { kind: "function", key: "whatsapp.read" },
  "WhatsAppController.media": { kind: "function", key: "whatsapp.read" },
  "WhatsAppController.qr": { kind: "function", key: "whatsapp.manage" },
  "WhatsAppController.connect": { kind: "function", key: "whatsapp.manage" },
  "WhatsAppController.relink": { kind: "function", key: "whatsapp.manage" },
  "WhatsAppController.reconnect": { kind: "function", key: "whatsapp.manage" },
  "WhatsAppController.disconnect": { kind: "function", key: "whatsapp.manage" },
  "WhatsAppController.send": { kind: "function", key: "whatsapp.send" },
  "WhatsAppController.audience": { kind: "function", key: "whatsapp.send" },
  "WhatsAppController.customerNumber": { kind: "function", key: "whatsapp.send" },
  "WhatsAppController.broadcast": { kind: "function", key: "whatsapp.send" },
  "WhatsAppController.latestBroadcast": { kind: "function", key: "whatsapp.send" },
  "WhatsAppController.activeBroadcasts": { kind: "function", key: "whatsapp.send" },
  "WhatsAppController.listBroadcasts": { kind: "function", key: "whatsapp.send" },
  "WhatsAppController.broadcastDetail": { kind: "function", key: "whatsapp.send" },
  "WhatsAppController.broadcastStatus": { kind: "function", key: "whatsapp.send" },
  "WhatsAppController.cancelBroadcast": { kind: "function", key: "whatsapp.send" },
  "WhatsAppController.resumeBroadcast": { kind: "function", key: "whatsapp.send" },
  "WhatsAppController.retryBroadcast": { kind: "function", key: "whatsapp.send" },
  "WhatsAppController.retryRecipient": { kind: "function", key: "whatsapp.send" },
  "WhatsAppController.cancelRecipient": { kind: "function", key: "whatsapp.send" },
  "LocationsController.context": { kind: "session" },
  "LocationsController.totals": {
    kind: "function",
    key: "dashboard.revenue.read",
  },
  "LocationsController.list": { kind: "function", key: "locations.read" },
  "LocationsController.create": { kind: "function", key: "locations.manage" },
  "LocationsController.update": { kind: "function", key: "locations.manage" },
  "LocationsController.createSector": {
    kind: "function",
    key: "locations.manage",
  },
  "LocationsController.updateSector": {
    kind: "function",
    key: "locations.manage",
  },
  "LocationsController.professionalSectors": {
    kind: "function",
    key: "locations.manage",
  },
  "LocationsController.accessContext": {
    kind: "function",
    key: "locations.manage",
  },
  "LocationsController.access": { kind: "function", key: "locations.manage" },
  "LocationsController.createRoom": {
    kind: "function",
    key: "locations.manage",
  },
  "LocationsController.updateRoom": {
    kind: "function",
    key: "locations.manage",
  },
  // Catalogue metadata used by agenda, till and catalogue forms.
  "ActivitiesController.list": { kind: "session" },
  "ActivitiesController.create": { kind: "function", key: "locations.manage" },
  "ActivitiesController.update": { kind: "function", key: "locations.manage" },

  "PersonalAccountController.profile": { kind: "session" },
  "PersonalAccountController.security": { kind: "session" },
  "PersonalAccountController.sessions": { kind: "session" },
  "PersonalAccountController.notices": { kind: "session" },
  "PersonalAccountController.logoutAll": { kind: "session" },
  "PersonalAccountController.logoutSession": { kind: "session" },
  "PersonalAccountController.revokeDevice": { kind: "session" },
  "PersonalAccountController.updateProfile": { kind: "session" },
  "PersonalAccountController.setMfaPreference": { kind: "session" },
  "PersonalAccountController.removeAuthenticator": { kind: "session" },
  "PersonalAccountController.startAction": { kind: "session" },
  "PersonalDashboardController.overview": {
    kind: "function",
    key: "appointments.read.all",
    own: "appointments.read.own",
  },
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
  "TeamController.passwordReset": {
    kind: "function",
    key: "team.password.reset",
  },
  "TeamController.restore": { kind: "function", key: "team.manage" },

  "AuthController.method": { kind: "public" },
  "ConnectAuthController.accept": { kind: "public" },
  "ConnectAuthController.callback": { kind: "public" },
  "ConnectAuthController.exchange": { kind: "public" },
  "ConnectAuthController.exchangeTechnical": { kind: "public" },
  "ConnectTechnicalController.start": { kind: "public" },
  "AppointmentsController.context": { kind: "function", key: "appointments.read.all", own: "appointments.update.own", anyOf: PICK_LIST_ACCESS.agenda },
  "ServicesController.findAll": { kind: "function", key: "services.read", anyOf: PICK_LIST_ACCESS.services },
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
  "InventoryController.balances": { kind: "function", key: "inventory.read" },
  "InventoryController.movements": { kind: "function", key: "inventory.read" },
  "InventoryController.execute": { kind: "function", key: "inventory.manage" },
  "ProductsController.priceHistory": { kind: "function", key: "services.read" },
  "ProductsController.byBarcode": { kind: "function", key: "services.read", anyOf: PICK_LIST_ACCESS.products },
  "ServicesController.priceHistory": { kind: "function", key: "services.read" },
  "ProductsController.findAll": { kind: "function", key: "services.read", anyOf: PICK_LIST_ACCESS.products },
  "ProductsController.create": { kind: "function", key: "services.manage" },
  "ProductBrandsController.list": { kind: "function", key: "services.read", anyOf: PICK_LIST_ACCESS.products },
  "ProductBrandsController.create": { kind: "function", key: "services.manage" },
  "ProductBrandsController.rename": { kind: "function", key: "services.manage" },
  "ProductBrandsController.remove": { kind: "function", key: "services.manage" },
  "ProductsController.update": { kind: "function", key: "services.manage" },
  "ProductsController.remove": { kind: "function", key: "services.manage" },
  "CatalogOrderController.save": { kind: "function", key: "services.manage" },
  "CollaboratorsController.findOne": {
    kind: "function",
    key: "collaborators.read",
  },
  "CollaboratorsController.findAll": {
    kind: "function",
    key: "collaborators.read",
  },
  "CollaboratorsController.options": { kind: "function", key: "collaborators.read", anyOf: PICK_LIST_ACCESS.collaborators },
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
  "CustomersController.options": { kind: "function", key: "clients.read.full", own: "appointments.update.own", anyOf: PICK_LIST_ACCESS.customers },
  "CustomersController.findAll": { kind: "function", key: "clients.read.full", anyOf: PICK_LIST_ACCESS.customers },
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
  "SalesController.quote": { kind: "function", key: "sales.manage" },
  "SalesController.priceHistory": { kind: "function", key: "sales.read" },
  "SalesController.findAll": {
    kind: "function",
    key: "sales.read",
  },
  "SalesController.forAppointment": { kind: "function", key: "sales.manage" },
  "SalesController.findOpen": { kind: "function", key: "sales.read" },
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
  "SalesController.cancel": {
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
  "AppointmentsController.bookingOrder": {
    kind: "function",
    key: "appointments.read.all",
  },
  "AppointmentsController.previewOrder": {
    kind: "function",
    key: "appointments.update.all",
  },
  "AppointmentsController.reschedulingAvailability": {
    kind: "function",
    key: "appointments.update.all",
  },
  "AppointmentsController.reviseOrder": {
    kind: "function",
    key: "appointments.update.all",
  },
  "AppointmentsController.cancelOrder": {
    kind: "function",
    key: "appointments.update.all",
  },
  // «La mia agenda»: a professional books only for themselves (personalBookingInput).
  "AppointmentsController.create": {
    kind: "function",
    key: "appointments.create",
    own: "appointments.update.own",
  },
  "AppointmentsController.previewAvailability": {
    kind: "function",
    key: "appointments.create",
    own: "appointments.update.own",
  },
  "PublicBookingController.previewAvailability": { kind: "public" },
  "PublicBookingController.previewHostAvailability": { kind: "public" },
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
  "SetupStatusController.read": {
    kind: "function",
    key: "settings.manage",
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
  "NotificationsController.stream": { kind: "function", key: "sales.read" },
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
  "NotificationAutomationGrantsController.list": { kind: "function", key: "notifications.manage" },
  "NotificationAutomationWebhooksController.get": { kind: "function", key: "notifications.manage" },
  "NotificationAutomationWebhooksController.prepare": { kind: "function", key: "notifications.manage" },
  "NotificationAutomationWebhooksController.receive": { kind: "public" },
  "NotificationAutomationGrantsController.prepare": { kind: "function", key: "notifications.manage" },
  "NotificationAutomationGrantsController.recover": { kind: "function", key: "notifications.manage" },
  "NotificationAutomationGrantsController.revoke": { kind: "function", key: "notifications.manage" },
  "AppointmentAutomationPolicyController.get": { kind: "function", key: "notifications.manage" },
  "AppointmentAutomationPolicyController.save": { kind: "function", key: "notifications.manage" },
  "AppointmentAutomationPolicyController.preview": { kind: "function", key: "notifications.manage" },
  "AppointmentAutomationPolicyController.activate": { kind: "function", key: "notifications.manage" },
  "AppointmentAutomationPolicyController.deactivate": { kind: "function", key: "notifications.manage" },
  "AppointmentAutomationMonitorController.list": { kind: "function", key: "notifications.manage" },
  "AppointmentAutomationMonitorController.review": { kind: "function", key: "notifications.manage" },
  "AppointmentContactController.get": { kind: "function", key: "appointments.update.all" },
  "AppointmentContactController.save": { kind: "function", key: "appointments.update.all" },
  "NotificationsController.updateTemplate": {
    kind: "function",
    key: "notifications.manage",
  },
  "NotificationsController.previewTemplate": {
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
  "PaymentLedgerController.read": { kind: "function", key: "sales.read" },
  "PaymentLedgerController.record": { kind: "function", key: "sales.manage" },
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
