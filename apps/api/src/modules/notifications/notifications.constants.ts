export const NOTIFICATIONS_QUEUE = "notifications";

export const NOTIFICATIONS_CACHE_PREFIX = "notifications";

export const NOTIFICATION_DEFAULT_TTL_SECONDS = 60;

export const NOTIFICATION_PROVIDER_KEYS = {
  email: "email.smtp",
  inApp: "in_app.native",
  webhook: "webhook.http",
} as const;

export const NOTIFICATION_EVENT_TYPES = {
  appointmentCreatedInternal: "appointment.created.internal",
  appointmentCreatedPublic: "appointment.created.public",
  appointmentRequested: "appointment.requested",
  appointmentConfirmed: "appointment.confirmed",
  appointmentAssigned: "appointment.assigned",
  appointmentReassigned: "appointment.reassigned",
  appointmentCancelled: "appointment.cancelled",
} as const;

export type NotificationEventType =
  (typeof NOTIFICATION_EVENT_TYPES)[keyof typeof NOTIFICATION_EVENT_TYPES];
