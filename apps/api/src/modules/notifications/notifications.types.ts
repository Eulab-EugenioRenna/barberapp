import { NotificationChannel } from "@prisma/client";

export type NotificationRecipientTypeValue =
  | "user"
  | "collaborator"
  | "customer"
  | "webhook";

export interface NotificationActor {
  id?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
}

export interface NotificationFlags {
  sendEmailToCustomer?: boolean;
  sendEmailToAssignedCollaborator?: boolean;
  sendOwnerNotifications?: boolean;
  sendManagerNotifications?: boolean;
  sendReceptionNotifications?: boolean;
  createdFromPublicBooking?: boolean;
  [key: string]: boolean | string | number | null | undefined;
}

export interface NotificationEventPayload {
  eventType: string;
  tenantId: string;
  entityType?: string;
  entityId?: string;
  actor?: NotificationActor;
  flags?: NotificationFlags;
  eventData?: Record<string, unknown>;
  appointment?: Record<string, unknown> | null;
  service?: Record<string, unknown> | null;
  customer?: Record<string, unknown> | null;
  collaborator?: Record<string, unknown> | null;
  tenant?: Record<string, unknown> | null;
  occurredAt?: string;
}

export interface NotificationDispatchTarget {
  channel: NotificationChannel;
  providerKey: string;
  recipientType: NotificationRecipientTypeValue;
  recipientUserId?: string;
  customerId?: string;
  recipientEmail?: string;
  recipientWebhookUrl?: string;
  title?: string;
  subject?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationQueueJob {
  notificationHistoryId: string;
}

export interface NotificationProviderResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  readonly providerKey: string;
  send(input: {
    historyId: string;
    target: NotificationDispatchTarget;
    payload: NotificationEventPayload;
  }): Promise<NotificationProviderResult>;
}

export interface TenantNotificationPreference {
  [key: string]: unknown;
  eventType: string;
  channel: NotificationChannel;
  enabled: boolean;
  sendToCustomer: boolean;
  sendToAssignedCollaborator: boolean;
  sendToOwners: boolean;
  sendToManagers: boolean;
  sendToReception: boolean;
  options?: unknown;
}

export interface NotificationProviderConfigValue {
  channel: NotificationChannel;
  providerKey: string;
  enabled: boolean;
  config?: unknown;
}
