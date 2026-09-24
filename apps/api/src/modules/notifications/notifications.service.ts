import { Injectable, NotFoundException } from "@nestjs/common";
import {
  Prisma,
  NotificationChannel,
  NotificationStatus,
  UserRole,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AppCacheService } from "../../cache/cache.service";
import {
  NOTIFICATION_DEFAULT_TTL_SECONDS,
  NOTIFICATION_PROVIDER_KEYS,
  NOTIFICATIONS_CACHE_PREFIX,
} from "./notifications.constants";
import { DEFAULT_NOTIFICATION_TEMPLATES } from "./notifications.templates";
import {
  NotificationDispatchTarget,
  NotificationEventPayload,
  NotificationProviderConfigValue,
  TenantNotificationPreference,
} from "./notifications.types";
import { renderTemplate } from "./notifications.utils";

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" ? (value as JsonObject) : undefined;
}

function asJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value as Prisma.InputJsonValue;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheManager: AppCacheService,
  ) {}

  async listAppointmentsAwaitingOrder(
    tenantId: string,
    now = new Date(),
  ): Promise<unknown[]> {
    return this.prisma.appointment.findMany({
      where: {
        tenantId,
        startsAt: { lte: now },
        status: {
          in: [
            "requested",
            "confirmed",
            "checked_in",
            "rescheduled",
            "completed",
          ],
        },
        sales: { none: {} },
      },
      orderBy: { startsAt: "desc" },
      take: 20,
      select: {
        id: true,
        customerId: true,
        serviceId: true,
        collaboratorId: true,
        startsAt: true,
        endsAt: true,
        status: true,
        customer: {
          select: { id: true, firstName: true, lastName: true },
        },
        service: {
          select: {
            id: true,
            name: true,
            basePrice: true,
            durationMinutes: true,
          },
        },
        collaborator: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async listPreferences(tenantId: string, userId: string): Promise<unknown> {
    await this.ensureTenantNotificationDefaults(tenantId);

    const [tenant, user] = await Promise.all([
      this.prisma.notificationPreferenceTenant.findMany({
        where: { tenantId },
        orderBy: [{ eventType: "asc" }, { channel: "asc" }],
      }),
      this.prisma.notificationPreferenceUser.findMany({
        where: { tenantId, userId },
        orderBy: [{ eventType: "asc" }, { channel: "asc" }],
      }),
    ]);

    return { tenant, user };
  }

  async updateTenantPreferences(
    tenantId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const eventType = String(body["eventType"] ?? "");
    const channel = String(body["channel"] ?? "") as NotificationChannel;
    const options = asJsonValue(asJsonObject(body["options"]));

    const preference = await this.prisma.notificationPreferenceTenant.upsert({
      where: {
        tenantId_eventType_channel: { tenantId, eventType, channel },
      },
      create: {
        tenantId,
        eventType,
        channel,
        enabled:
          body["enabled"] === undefined ? true : Boolean(body["enabled"]),
        sendToCustomer: Boolean(body["sendToCustomer"]),
        sendToAssignedCollaborator: Boolean(body["sendToAssignedCollaborator"]),
        sendToOwners:
          body["sendToOwners"] === undefined
            ? true
            : Boolean(body["sendToOwners"]),
        sendToManagers:
          body["sendToManagers"] === undefined
            ? true
            : Boolean(body["sendToManagers"]),
        sendToReception:
          body["sendToReception"] === undefined
            ? true
            : Boolean(body["sendToReception"]),
        options,
      },
      update: {
        enabled:
          typeof body["enabled"] === "boolean"
            ? Boolean(body["enabled"])
            : undefined,
        sendToCustomer:
          typeof body["sendToCustomer"] === "boolean"
            ? Boolean(body["sendToCustomer"])
            : undefined,
        sendToAssignedCollaborator:
          typeof body["sendToAssignedCollaborator"] === "boolean"
            ? Boolean(body["sendToAssignedCollaborator"])
            : undefined,
        sendToOwners:
          typeof body["sendToOwners"] === "boolean"
            ? Boolean(body["sendToOwners"])
            : undefined,
        sendToManagers:
          typeof body["sendToManagers"] === "boolean"
            ? Boolean(body["sendToManagers"])
            : undefined,
        sendToReception:
          typeof body["sendToReception"] === "boolean"
            ? Boolean(body["sendToReception"])
            : undefined,
        options,
      },
    });

    await this.invalidateTenantCaches(tenantId);

    return preference;
  }

  async updateUserPreferences(
    tenantId: string,
    userId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const eventType = String(body["eventType"] ?? "");
    const channel = String(body["channel"] ?? "") as NotificationChannel;

    const preference = await this.prisma.notificationPreferenceUser.upsert({
      where: {
        tenantId_userId_eventType_channel: {
          tenantId,
          userId,
          eventType,
          channel,
        },
      },
      create: {
        tenantId,
        userId,
        eventType,
        channel,
        enabled:
          body["enabled"] === undefined ? true : Boolean(body["enabled"]),
      },
      update: {
        enabled:
          typeof body["enabled"] === "boolean"
            ? Boolean(body["enabled"])
            : undefined,
      },
    });

    await this.invalidateTenantCaches(tenantId);

    return preference;
  }

  async listProviders(tenantId: string): Promise<unknown> {
    await this.ensureTenantNotificationDefaults(tenantId);

    return this.prisma.notificationProviderConfig.findMany({
      where: { tenantId },
      orderBy: { channel: "asc" },
    });
  }

  async upsertProvider(
    tenantId: string,
    channel: NotificationChannel,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const configValue = asJsonValue(asJsonObject(body["config"]));

    const config = await this.prisma.notificationProviderConfig.upsert({
      where: { tenantId_channel: { tenantId, channel } },
      create: {
        tenantId,
        channel,
        providerKey: String(
          body["providerKey"] ?? this.getDefaultProviderKey(channel),
        ),
        enabled:
          body["enabled"] === undefined ? true : Boolean(body["enabled"]),
        config: configValue,
      },
      update: {
        providerKey:
          typeof body["providerKey"] === "string"
            ? String(body["providerKey"])
            : undefined,
        enabled:
          typeof body["enabled"] === "boolean"
            ? Boolean(body["enabled"])
            : undefined,
        config: configValue,
      },
    });

    await this.invalidateTenantCaches(tenantId);

    return config;
  }

  async listTemplates(tenantId: string): Promise<unknown> {
    await this.ensureTenantNotificationDefaults(tenantId);

    return this.prisma.notificationTemplate.findMany({
      where: { tenantId },
      orderBy: [{ eventType: "asc" }, { channel: "asc" }],
    });
  }

  async updateTemplate(
    tenantId: string,
    eventType: string,
    channel: NotificationChannel,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    await this.ensureTenantTemplates(tenantId);

    const template = await this.prisma.notificationTemplate.update({
      where: {
        tenantId_eventType_channel: { tenantId, eventType, channel },
      },
      data: {
        subject:
          typeof body["subject"] === "string"
            ? String(body["subject"])
            : undefined,
        title:
          typeof body["title"] === "string" ? String(body["title"]) : undefined,
        body:
          typeof body["body"] === "string" && String(body["body"]).trim()
            ? String(body["body"])
            : undefined,
      },
    });

    await this.cacheManager.del(
      this.buildTemplateCacheKey(tenantId, eventType, channel),
    );

    return template;
  }

  async listInbox(tenantId: string, userId: string): Promise<unknown> {
    return this.prisma.notificationInbox.findMany({
      where: { tenantId, recipientUserId: userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async unreadCount(tenantId: string, userId: string): Promise<unknown> {
    const cacheKey = this.buildUnreadCountCacheKey(tenantId, userId);
    const cached = await this.cacheManager.get<number>(cacheKey);

    if (typeof cached === "number") {
      return { unreadCount: cached };
    }

    const unreadCount = await this.prisma.notificationInbox.count({
      where: { tenantId, recipientUserId: userId, readAt: null },
    });

    await this.cacheManager.set(
      cacheKey,
      unreadCount,
      NOTIFICATION_DEFAULT_TTL_SECONDS * 1000,
    );

    return { unreadCount };
  }

  async markInboxAsRead(
    tenantId: string,
    userId: string,
    inboxId: string,
  ): Promise<unknown> {
    const result = await this.prisma.notificationInbox.updateMany({
      where: { id: inboxId, tenantId, recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });

    await this.invalidateUnreadCount(tenantId, userId);

    return { updated: result.count > 0 };
  }

  async markAllInboxAsRead(tenantId: string, userId: string): Promise<unknown> {
    const result = await this.prisma.notificationInbox.updateMany({
      where: { tenantId, recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });

    await this.invalidateUnreadCount(tenantId, userId);

    return { updated: result.count };
  }

  async listHistory(tenantId: string): Promise<unknown> {
    return this.prisma.notificationHistory.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async resolveDispatchPlan(payload: NotificationEventPayload): Promise<{
    payload: NotificationEventPayload;
    targets: NotificationDispatchTarget[];
  }> {
    const resolvedPayload = await this.enrichPayload(payload);
    await this.ensureTenantNotificationDefaults(resolvedPayload.tenantId);

    const [tenantPreferences, providerConfigs, tenantUsers] = await Promise.all(
      [
        this.getTenantPreferences(resolvedPayload.tenantId),
        this.getProviderConfigs(resolvedPayload.tenantId),
        this.prisma.user.findMany({
          where: { tenantId: resolvedPayload.tenantId, isActive: true },
          select: {
            id: true,
            email: true,
            role: true,
          },
        }),
      ],
    );

    const targets: NotificationDispatchTarget[] = [];
    const channels = [
      NotificationChannel.in_app,
      NotificationChannel.email,
      NotificationChannel.webhook,
    ];

    for (const channel of channels) {
      const preference = tenantPreferences.find(
        (item) =>
          item.eventType === resolvedPayload.eventType &&
          item.channel === channel,
      );

      if (preference && !preference.enabled) {
        continue;
      }

      const providerConfig = providerConfigs.find(
        (item) => item.channel === channel,
      );
      const providerKey =
        providerConfig?.providerKey ?? this.getDefaultProviderKey(channel);

      if (channel === NotificationChannel.webhook) {
        const webhookUrl = this.extractWebhookUrl(providerConfig?.config);

        if (webhookUrl) {
          targets.push({
            channel,
            providerKey,
            recipientType: "webhook",
            recipientWebhookUrl: webhookUrl,
            message: resolvedPayload.eventType,
          });
        }

        continue;
      }

      const template = await this.resolveTemplate(
        resolvedPayload.tenantId,
        resolvedPayload.eventType,
        channel,
      );

      for (const user of tenantUsers) {
        if (!this.matchesRolePreference(user.role, preference)) {
          continue;
        }

        const userPreference =
          await this.prisma.notificationPreferenceUser.findFirst({
            where: {
              tenantId: resolvedPayload.tenantId,
              userId: user.id,
              eventType: resolvedPayload.eventType,
              channel,
            },
          });

        if (userPreference && !userPreference.enabled) {
          continue;
        }

        const rendered = this.renderResolvedTemplate(template, resolvedPayload);

        if (channel === NotificationChannel.in_app) {
          targets.push({
            channel,
            providerKey,
            recipientType: "user",
            recipientUserId: user.id,
            title: rendered.title,
            message: rendered.body,
            metadata: { role: user.role },
          });
        }

        if (channel === NotificationChannel.email && user.email) {
          targets.push({
            channel,
            providerKey,
            recipientType: "user",
            recipientUserId: user.id,
            recipientEmail: user.email,
            subject: rendered.subject,
            message: rendered.body,
            metadata: { role: user.role },
          });
        }
      }

      const collaborator = resolvedPayload.collaborator;

      if (
        this.shouldSendToAssignedCollaborator(
          resolvedPayload.eventType,
          preference as Record<string, unknown> | undefined,
        ) &&
        collaborator &&
        typeof collaborator === "object"
      ) {
        const rendered = this.renderResolvedTemplate(template, resolvedPayload);
        const collaboratorUserId = this.optionalString(collaborator["userId"]);
        const collaboratorEmail = this.optionalString(collaborator["email"]);

        if (channel === NotificationChannel.in_app && collaboratorUserId) {
          targets.push({
            channel,
            providerKey,
            recipientType: "user",
            recipientUserId: collaboratorUserId,
            title: rendered.title,
            message: rendered.body,
          });
        }

        if (channel === NotificationChannel.email && collaboratorEmail) {
          targets.push({
            channel,
            providerKey,
            recipientType: collaboratorUserId ? "user" : "collaborator",
            recipientUserId: collaboratorUserId ?? undefined,
            recipientEmail: collaboratorEmail,
            subject: rendered.subject,
            message: rendered.body,
          });
        }
      }

      const customer = resolvedPayload.customer;

      if (
        this.shouldSendToCustomer(
          resolvedPayload.eventType,
          preference as Record<string, unknown> | undefined,
        ) &&
        channel === NotificationChannel.email &&
        customer &&
        typeof customer === "object"
      ) {
        const customerEmail = this.optionalString(customer["email"]);

        if (customerEmail) {
          const rendered = this.renderResolvedTemplate(
            template,
            resolvedPayload,
          );
          targets.push({
            channel,
            providerKey,
            recipientType: "customer",
            customerId: this.optionalString(customer["id"]) ?? undefined,
            recipientEmail: customerEmail,
            subject: rendered.subject,
            message: rendered.body,
          });
        }
      }
    }

    return { payload: resolvedPayload, targets };
  }

  async createHistoryEntry(
    payload: NotificationEventPayload,
    target: NotificationDispatchTarget,
  ) {
    const inbox =
      target.channel === NotificationChannel.in_app && target.recipientUserId
        ? await this.prisma.notificationInbox.create({
            data: {
              tenantId: payload.tenantId,
              recipientUserId: target.recipientUserId,
              eventType: payload.eventType,
              title: target.title ?? "Notifica",
              message: target.message,
              payload: payload as unknown as Prisma.InputJsonValue,
              entityType: payload.entityType,
              entityId: payload.entityId,
            },
          })
        : null;

    const history = await this.prisma.notificationHistory.create({
      data: {
        tenantId: payload.tenantId,
        recipientUserId: target.recipientUserId,
        customerId: target.customerId,
        channel: target.channel,
        providerKey: target.providerKey,
        recipientType: target.recipientType as never,
        recipientEmail: target.recipientEmail,
        recipientWebhookUrl: target.recipientWebhookUrl,
        eventType: payload.eventType,
        payload: {
          ...payload,
          providerKey: target.providerKey,
          recipientType: target.recipientType,
          recipientEmail: target.recipientEmail,
          recipientWebhookUrl: target.recipientWebhookUrl,
          renderedTitle: target.title,
          renderedSubject: target.subject,
          renderedMessage: target.message,
        } as unknown as Prisma.InputJsonValue,
        status: NotificationStatus.pending,
        metadata: asJsonValue(target.metadata),
        notificationInboxId: inbox?.id,
      },
    });

    if (target.recipientUserId) {
      await this.invalidateUnreadCount(
        payload.tenantId,
        target.recipientUserId,
      );
    }

    return history;
  }

  async markHistoryAsSent(
    notificationHistoryId: string,
    providerMessageId?: string,
  ): Promise<void> {
    await this.prisma.notificationHistory.update({
      where: { id: notificationHistoryId },
      data: {
        status: NotificationStatus.sent,
        providerMessageId,
        sentAt: new Date(),
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        error: null,
      },
    });
  }

  async markHistoryAsFailed(
    notificationHistoryId: string,
    error: string,
  ): Promise<void> {
    await this.prisma.notificationHistory.update({
      where: { id: notificationHistoryId },
      data: {
        status: NotificationStatus.failed,
        error,
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
        nextRetryAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
  }

  async markHistoryAsSkipped(
    notificationHistoryId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.notificationHistory.update({
      where: { id: notificationHistoryId },
      data: {
        status: NotificationStatus.skipped,
        error: reason,
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
  }

  async getHistoryById(notificationHistoryId: string) {
    const history = await this.prisma.notificationHistory.findUnique({
      where: { id: notificationHistoryId },
    });

    if (!history) {
      throw new NotFoundException("Notification history not found");
    }

    return history;
  }

  async ensureTenantTemplates(tenantId: string): Promise<void> {
    const count = await this.prisma.notificationTemplate.count({
      where: { tenantId },
    });

    if (count > 0) {
      return;
    }

    await this.prisma.notificationTemplate.createMany({
      data: DEFAULT_NOTIFICATION_TEMPLATES.map((template) => ({
        tenantId,
        eventType: template.eventType,
        channel: template.channel,
        subject: template.subject,
        title: template.title,
        body: template.body,
      })),
      skipDuplicates: true,
    });
  }

  async ensureTenantNotificationDefaults(tenantId: string): Promise<void> {
    await this.ensureTenantTemplates(tenantId);

    const preferenceCount =
      await this.prisma.notificationPreferenceTenant.count({
        where: { tenantId },
      });

    if (preferenceCount === 0) {
      const defaults = DEFAULT_NOTIFICATION_TEMPLATES.map((template) => ({
        tenantId,
        eventType: template.eventType,
        channel: template.channel,
        enabled: true,
        sendToCustomer: [
          "appointment.created.public",
          "appointment.requested",
          "appointment.confirmed",
          "appointment.cancelled",
        ].includes(template.eventType),
        sendToAssignedCollaborator: [
          "appointment.created.internal",
          "appointment.assigned",
          "appointment.reassigned",
          "appointment.cancelled",
        ].includes(template.eventType),
        sendToOwners: true,
        sendToManagers: true,
        sendToReception: true,
      }));

      await this.prisma.notificationPreferenceTenant.createMany({
        data: defaults,
        skipDuplicates: true,
      });
    }

    await Promise.all([
      this.prisma.notificationProviderConfig.upsert({
        where: {
          tenantId_channel: {
            tenantId,
            channel: NotificationChannel.email,
          },
        },
        create: {
          tenantId,
          channel: NotificationChannel.email,
          providerKey: NOTIFICATION_PROVIDER_KEYS.email,
          enabled: true,
        },
        update: {},
      }),
      this.prisma.notificationProviderConfig.upsert({
        where: {
          tenantId_channel: {
            tenantId,
            channel: NotificationChannel.in_app,
          },
        },
        create: {
          tenantId,
          channel: NotificationChannel.in_app,
          providerKey: NOTIFICATION_PROVIDER_KEYS.inApp,
          enabled: true,
        },
        update: {},
      }),
      this.prisma.notificationProviderConfig.upsert({
        where: {
          tenantId_channel: {
            tenantId,
            channel: NotificationChannel.webhook,
          },
        },
        create: {
          tenantId,
          channel: NotificationChannel.webhook,
          providerKey: NOTIFICATION_PROVIDER_KEYS.webhook,
          enabled: false,
          config: { url: "" } as Prisma.InputJsonValue,
        },
        update: {},
      }),
    ]);

    await this.invalidateTenantCaches(tenantId);
  }

  private async enrichPayload(
    payload: NotificationEventPayload,
  ): Promise<NotificationEventPayload> {
    const tenant = payload.tenant
      ? payload.tenant
      : await this.prisma.tenant.findUnique({
          where: { id: payload.tenantId },
          select: {
            id: true,
            name: true,
            slug: true,
            timezone: true,
            currency: true,
            language: true,
          },
        });

    if (!payload.entityId || payload.entityType !== "appointment") {
      return {
        ...payload,
        tenant: tenant as Record<string, unknown> | null,
        occurredAt: payload.occurredAt ?? new Date().toISOString(),
      };
    }

    const appointment = await this.prisma.appointment.findFirst({
      where: { id: payload.entityId, tenantId: payload.tenantId },
      include: {
        customer: true,
        service: true,
        collaborator: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException(
        "Appointment not found for notification event",
      );
    }

    return {
      ...payload,
      appointment: {
        id: appointment.id,
        status: appointment.status,
        startsAt: appointment.startsAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        source: appointment.source,
      },
      customer: {
        id: appointment.customer.id,
        firstName: appointment.customer.firstName,
        lastName: appointment.customer.lastName,
        email: appointment.customer.email,
        phone: appointment.customer.phone,
      },
      service: {
        id: appointment.service.id,
        name: appointment.service.name,
      },
      collaborator: appointment.collaborator
        ? {
            id: appointment.collaborator.id,
            userId: appointment.collaborator.userId,
            firstName: appointment.collaborator.firstName,
            lastName: appointment.collaborator.lastName,
            email: appointment.collaborator.email,
          }
        : null,
      tenant: tenant as Record<string, unknown> | null,
      occurredAt: payload.occurredAt ?? new Date().toISOString(),
    };
  }

  private async getTenantPreferences(
    tenantId: string,
  ): Promise<TenantNotificationPreference[]> {
    const cacheKey = `${NOTIFICATIONS_CACHE_PREFIX}:tenant-preferences:${tenantId}`;
    const cached =
      await this.cacheManager.get<TenantNotificationPreference[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const preferences = await this.prisma.notificationPreferenceTenant.findMany(
      {
        where: { tenantId },
      },
    );

    await this.cacheManager.set(
      cacheKey,
      preferences,
      NOTIFICATION_DEFAULT_TTL_SECONDS * 1000,
    );

    return preferences;
  }

  private async getProviderConfigs(
    tenantId: string,
  ): Promise<NotificationProviderConfigValue[]> {
    const cacheKey = `${NOTIFICATIONS_CACHE_PREFIX}:provider-configs:${tenantId}`;
    const cached =
      await this.cacheManager.get<NotificationProviderConfigValue[]>(cacheKey);

    if (cached) {
      return cached;
    }

    const configs = await this.prisma.notificationProviderConfig.findMany({
      where: { tenantId },
    });

    await this.cacheManager.set(
      cacheKey,
      configs,
      NOTIFICATION_DEFAULT_TTL_SECONDS * 1000,
    );

    return configs;
  }

  private async resolveTemplate(
    tenantId: string,
    eventType: string,
    channel: NotificationChannel,
  ) {
    const cacheKey = this.buildTemplateCacheKey(tenantId, eventType, channel);
    const cached = await this.cacheManager.get<{
      subject?: string | null;
      title?: string | null;
      body: string;
    }>(cacheKey);

    if (cached) {
      return cached;
    }

    const template = await this.prisma.notificationTemplate.findUnique({
      where: {
        tenantId_eventType_channel: { tenantId, eventType, channel },
      },
    });

    if (!template) {
      throw new NotFoundException(
        `Template not found for ${eventType}/${channel}`,
      );
    }

    const normalized = {
      subject: template.subject,
      title: template.title,
      body: template.body,
    };

    await this.cacheManager.set(
      cacheKey,
      normalized,
      NOTIFICATION_DEFAULT_TTL_SECONDS * 1000,
    );

    return normalized;
  }

  private renderResolvedTemplate(
    template: { subject?: string | null; title?: string | null; body: string },
    payload: NotificationEventPayload,
  ) {
    const context = payload as unknown as Record<string, unknown>;

    return {
      subject: template.subject
        ? renderTemplate(template.subject, context)
        : undefined,
      title: template.title
        ? renderTemplate(template.title, context)
        : undefined,
      body: renderTemplate(template.body, context),
    };
  }

  private matchesRolePreference(
    role: UserRole,
    preference?: Record<string, unknown>,
  ): boolean {
    if (role === UserRole.owner) {
      return preference?.["sendToOwners"] === undefined
        ? true
        : Boolean(preference["sendToOwners"]);
    }

    if (role === UserRole.manager) {
      return preference?.["sendToManagers"] === undefined
        ? true
        : Boolean(preference["sendToManagers"]);
    }

    if (role === UserRole.reception) {
      return preference?.["sendToReception"] === undefined
        ? true
        : Boolean(preference["sendToReception"]);
    }

    return false;
  }

  private shouldSendToAssignedCollaborator(
    eventType: string,
    preference?: Record<string, unknown>,
  ): boolean {
    if (typeof preference?.["sendToAssignedCollaborator"] === "boolean") {
      return Boolean(preference["sendToAssignedCollaborator"]);
    }

    return [
      "appointment.created.internal",
      "appointment.assigned",
      "appointment.reassigned",
      "appointment.cancelled",
    ].includes(eventType);
  }

  private shouldSendToCustomer(
    eventType: string,
    preference?: Record<string, unknown>,
  ): boolean {
    if (typeof preference?.["sendToCustomer"] === "boolean") {
      return Boolean(preference["sendToCustomer"]);
    }

    return [
      "appointment.created.public",
      "appointment.requested",
      "appointment.confirmed",
      "appointment.cancelled",
    ].includes(eventType);
  }

  private extractWebhookUrl(config: unknown): string | undefined {
    if (!config || typeof config !== "object") {
      return undefined;
    }

    const value = (config as Record<string, unknown>)["url"];
    return typeof value === "string" && value ? value : undefined;
  }

  private getDefaultProviderKey(channel: NotificationChannel): string {
    if (channel === NotificationChannel.email) {
      return NOTIFICATION_PROVIDER_KEYS.email;
    }

    if (channel === NotificationChannel.webhook) {
      return NOTIFICATION_PROVIDER_KEYS.webhook;
    }

    return NOTIFICATION_PROVIDER_KEYS.inApp;
  }

  private optionalString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value : null;
  }

  private async invalidateUnreadCount(
    tenantId: string,
    userId: string,
  ): Promise<void> {
    await this.cacheManager.del(
      this.buildUnreadCountCacheKey(tenantId, userId),
    );
  }

  private async invalidateTenantCaches(tenantId: string): Promise<void> {
    await Promise.all([
      this.cacheManager.del(
        `${NOTIFICATIONS_CACHE_PREFIX}:tenant-preferences:${tenantId}`,
      ),
      this.cacheManager.del(
        `${NOTIFICATIONS_CACHE_PREFIX}:provider-configs:${tenantId}`,
      ),
    ]);
  }

  private buildUnreadCountCacheKey(tenantId: string, userId: string): string {
    return `${NOTIFICATIONS_CACHE_PREFIX}:inbox:${tenantId}:${userId}:unread-count`;
  }

  private buildTemplateCacheKey(
    tenantId: string,
    eventType: string,
    channel: NotificationChannel,
  ): string {
    return `${NOTIFICATIONS_CACHE_PREFIX}:template:${tenantId}:${eventType}:${channel}`;
  }
}
