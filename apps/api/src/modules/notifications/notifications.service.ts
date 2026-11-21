import {
  notificationReadScope,
  type NotificationReadScope,
} from "./notification-scope.sql";
import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  NotificationChannel,
  NotificationStatus,
  NotificationHistory,
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
import {
  TEMPLATE_PLACEHOLDERS,
  TEMPLATE_SAMPLE,
  validateTemplateInput,
} from "./notification-template-editor";

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
    sectorIds: string[] = [],
  ): Promise<unknown[]> {
    return this.prisma.appointment.findMany({
      where: {
        tenantId,
        sectorId: { in: sectorIds },
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
        OR: [
          { orderItem: { sale: { orderStatus: "open" } } },
          { orderItemId: null, sales: { none: {} } },
        ],
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
      select: {
        id: true,
        tenantId: true,
        channel: true,
        providerKey: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
      },
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

    const { config: _privateConfig, ...publicConfig } = config;
    return publicConfig;
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
    const data = validateTemplateInput(eventType, channel, body, true);
    await this.ensureTenantTemplates(tenantId);
    const template = await this.prisma.$transaction(async (tx) => {
      const result = await tx.notificationTemplate.updateMany({
        where: {
          tenantId,
          eventType,
          channel,
          updatedAt: new Date(String(body["expectedUpdatedAt"])),
        },
        data: {
          ...data,
          updatedAt: new Date(
            Math.max(
              Date.now(),
              Date.parse(String(body["expectedUpdatedAt"])) + 1,
            ),
          ),
        },
      });
      if (result.count !== 1)
        throw new ConflictException(
          "Il template è cambiato. Ricarica la versione corrente prima di salvare.",
        );
      return tx.notificationTemplate.findUniqueOrThrow({
        where: { tenantId_eventType_channel: { tenantId, eventType, channel } },
      });
    });

    await this.cacheManager.del(
      this.buildTemplateCacheKey(tenantId, eventType, channel),
    );

    return template;
  }

  previewTemplate(
    eventType: string,
    channel: NotificationChannel,
    body: Record<string, unknown>,
  ) {
    const template = validateTemplateInput(eventType, channel, body);
    return {
      ...this.renderResolvedTemplate(template, {
        eventType,
        tenantId: "sample",
        ...TEMPLATE_SAMPLE,
      }),
      placeholders: TEMPLATE_PLACEHOLDERS,
      sampleOnly: true,
    };
  }

  async listInbox(
    tenantId: string,
    userId: string,
    scope: NotificationReadScope = { sectorIds: [], fullAccess: false },
  ): Promise<unknown> {
    return this.prisma
      .$queryRaw`SELECT i.id,i."eventType",i.title,i.message,i."entityType",i."entityId",i."readAt",i."createdAt" FROM "NotificationInbox" i WHERE i."tenantId"=${tenantId}
      AND i."recipientUserId"=${userId} AND ${notificationReadScope("i", scope)} ORDER BY i."createdAt" DESC, i.id LIMIT 200`;
  }

  async unreadCount(
    tenantId: string,
    userId: string,
    scope: NotificationReadScope = { sectorIds: [], fullAccess: false },
  ): Promise<unknown> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ count: number }>
    >`SELECT count(*)::int AS count FROM "NotificationInbox" i
      WHERE i."tenantId"=${tenantId} AND i."recipientUserId"=${userId} AND i."readAt" IS NULL AND ${notificationReadScope("i", scope)}`;
    return { unreadCount: row.count };
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

    return { updated: result.count > 0 };
  }

  async markAllInboxAsRead(tenantId: string, userId: string): Promise<unknown> {
    const result = await this.prisma.notificationInbox.updateMany({
      where: { tenantId, recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { updated: result.count };
  }

  async listHistory(
    tenantId: string,
    scope: NotificationReadScope = { sectorIds: [], fullAccess: false },
  ): Promise<unknown> {
    // Delivery monitoring exposes state and identifiers, never CRM contacts or complete message payloads.
    return this.prisma
      .$queryRaw`SELECT h.id,h."domainEventId",h."eventType",h.channel,h.status,h."providerKey",h."recipientType",
      CASE WHEN h."domainEventId" IS NULL THEN 'legacy_unknown' ELSE 'durable_intent' END AS "deliveryBasis",
      h."createdAt",h."sentAt",h."lastAttemptAt",h."nextRetryAt",h."attemptCount",(h.error IS NOT NULL) AS "hasError"
      FROM "NotificationHistory" h WHERE h."tenantId"=${tenantId} AND ${notificationReadScope("h", scope)}
      ORDER BY h."createdAt" DESC,h.id LIMIT 200`;
  }

  async snapshotEventPayload(
    client: Prisma.TransactionClient,
    payload: NotificationEventPayload,
  ) {
    return this.enrichPayload(
      {
        eventType: payload.eventType,
        tenantId: payload.tenantId,
        entityType: payload.entityType,
        entityId: payload.entityId,
        actor: payload.actor,
        flags: payload.flags,
        eventData: payload.eventData,
        occurredAt: payload.occurredAt,
      },
      client,
    );
  }

  async resolveDispatchPlan(
    payload: NotificationEventPayload,
    options: { client?: Prisma.TransactionClient; snapshot?: boolean } = {},
  ): Promise<{
    payload: NotificationEventPayload;
    targets: NotificationDispatchTarget[];
  }> {
    const client = options.client || this.prisma;
    const resolvedPayload = options.snapshot
      ? payload
      : await this.enrichPayload(payload, client);
    await this.ensureTenantNotificationDefaults(
      resolvedPayload.tenantId,
      client,
    );

    const sectorId = this.optionalString(
      resolvedPayload.appointment?.["sectorId"],
    );
    const accountRows = resolvedPayload.eventData?.["accountAppointments"];
    const hasUnknownScope =
      !sectorId ||
      (Array.isArray(accountRows) &&
        accountRows.some((row) => !this.optionalString(row?.["sectorId"])));
    const requiredSectors = hasUnknownScope
      ? (
          await client.sector.findMany({
            where: { tenantId: resolvedPayload.tenantId },
            select: { id: true },
          })
        ).map((row) => row.id)
      : [
          ...new Set(
            [
              sectorId,
              ...(Array.isArray(accountRows)
                ? accountRows.map((row) =>
                    this.optionalString(row?.["sectorId"]),
                  )
                : []),
            ].filter((id): id is string => !!id),
          ),
        ];
    const staffPayload = this.staffPayload(resolvedPayload);
    const [tenantPreferences, providerConfigs, tenantUsers] = await Promise.all(
      [
        this.getTenantPreferences(resolvedPayload.tenantId, client),
        this.getProviderConfigs(resolvedPayload.tenantId, client),
        client.user.findMany({
          where: {
            tenantId: resolvedPayload.tenantId,
            isActive: true,
            OR: [
              { role: "owner" },
              {
                role: { in: ["manager", "reception"] },
                AND: requiredSectors.map((id) => ({
                  sectorAccess: { some: { sectorId: id } },
                })),
              },
              {
                role: "collaborator",
                collaborator: {
                  id:
                    this.optionalString(resolvedPayload.collaborator?.["id"]) ||
                    "",
                  isActive: true,
                  sectors: { some: { sectorId: sectorId || "" } },
                },
              },
            ],
          },
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

      if (!preference?.enabled) {
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
            payload: staffPayload,
            message: resolvedPayload.eventType,
          });
        }

        continue;
      }

      const template = await this.resolveTemplate(
        resolvedPayload.tenantId,
        resolvedPayload.eventType,
        channel,
        client,
      );

      for (const user of tenantUsers) {
        if (!this.matchesRolePreference(user.role, preference)) {
          continue;
        }

        const userPreference =
          await client.notificationPreferenceUser.findFirst({
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

        const rendered = this.renderResolvedTemplate(template, staffPayload);

        if (channel === NotificationChannel.in_app) {
          targets.push({
            channel,
            providerKey,
            recipientType: "user",
            recipientUserId: user.id,
            title: rendered.title,
            message: rendered.body,
            metadata: { role: user.role },
            payload: staffPayload,
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
            payload: staffPayload,
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
        typeof collaborator === "object" &&
        !!sectorId &&
        !!this.optionalString(collaborator["id"]) &&
        !!(await client.collaboratorSector.count({
          where: { collaboratorId: String(collaborator["id"]), sectorId },
        })) &&
        (!this.optionalString(collaborator["userId"]) ||
          tenantUsers.some((user) => user.id === collaborator["userId"])) &&
        (!this.optionalString(collaborator["userId"]) ||
          !(await client.notificationPreferenceUser.findFirst({
            where: {
              tenantId: resolvedPayload.tenantId,
              userId: String(collaborator["userId"]),
              eventType: resolvedPayload.eventType,
              channel,
              enabled: false,
            },
          })))
      ) {
        const targetUser = tenantUsers.find(
          (user) => user.id === collaborator["userId"],
        );
        const collaboratorPayload =
          targetUser && targetUser.role !== "collaborator"
            ? staffPayload
            : this.staffPayload(resolvedPayload, String(collaborator["id"]));
        const rendered = this.renderResolvedTemplate(
          template,
          collaboratorPayload,
        );
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
            payload: collaboratorPayload,
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
            payload: collaboratorPayload,
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
    options: {
      client: Prisma.TransactionClient;
      eventId: string;
      dispatchKey: string;
    },
  ) {
    const content = target.payload || payload;
    if (
      content.tenantId !== payload.tenantId ||
      content.eventType !== payload.eventType ||
      content.entityId !== payload.entityId
    )
      throw new NotFoundException("Contesto della notifica non coerente");
    const insert = async (client: Prisma.TransactionClient) => {
      if (options.eventId && options.dispatchKey) {
        const existing = await client.notificationHistory.findUnique({
          where: {
            domainEventId_dispatchKey: {
              domainEventId: options.eventId,
              dispatchKey: options.dispatchKey,
            },
          },
        });
        if (existing) return existing;
      }
      const inbox =
        target.channel === NotificationChannel.in_app && target.recipientUserId
          ? await client.notificationInbox.create({
              data: {
                tenantId: payload.tenantId,
                recipientUserId: target.recipientUserId,
                eventType: payload.eventType,
                title: target.title ?? "Notifica",
                message: target.message,
                payload: content as unknown as Prisma.InputJsonValue,
                entityType: payload.entityType,
                entityId: payload.entityId,
              },
            })
          : null;

      const history = await client.notificationHistory.create({
        data: {
          tenantId: payload.tenantId,
          domainEventId: options.eventId,
          dispatchKey: options.dispatchKey,
          recipientUserId: target.recipientUserId,
          customerId: target.customerId,
          channel: target.channel,
          providerKey: target.providerKey,
          recipientType: target.recipientType as never,
          recipientEmail: target.recipientEmail,
          recipientWebhookUrl: target.recipientWebhookUrl,
          eventType: payload.eventType,
          payload: {
            ...content,
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

      return history;
    };
    return insert(options.client);
  }

  async claimHistory(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM "NotificationHistory" WHERE id=${id} FOR UPDATE`;
      if (!rows.length) return null;
      const history = await tx.notificationHistory.findUniqueOrThrow({
        where: { id },
      });
      // Legacy external attempts have no durable intent and cannot be inferred safe to repeat.
      if (
        !history.domainEventId &&
        history.channel !== NotificationChannel.in_app
      )
        return null;
      if (
        history.status !== NotificationStatus.pending &&
        !(
          history.status === NotificationStatus.failed &&
          history.retrySafe &&
          history.nextRetryAt &&
          history.nextRetryAt <= new Date() &&
          history.attemptCount < 5
        )
      )
        return null;
      return tx.notificationHistory.update({
        where: { id },
        data: {
          status: NotificationStatus.dispatching,
          dispatchToken: randomUUID(),
          dispatchLeaseUntil: new Date(Date.now() + 60000),
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          retrySafe: false,
          nextRetryAt: null,
        },
      });
    });
  }

  async finishHistory(
    id: string,
    token: string,
    outcome: {
      status: "sent" | "failed" | "skipped" | "uncertain" | "queued";
      providerMessageId?: string;
      reason?: string;
      retrySafe?: boolean;
    },
  ) {
    const result = await this.prisma.notificationHistory.updateMany({
      where: {
        id,
        dispatchToken: token,
        status: {
          in: [NotificationStatus.dispatching, NotificationStatus.uncertain, NotificationStatus.queued],
        },
      },
      data: {
        status: outcome.status,
        providerMessageId: outcome.providerMessageId,
        sentAt: outcome.status === "sent" ? new Date() : undefined,
        error: outcome.reason || null,
        retrySafe: !!outcome.retrySafe,
        nextRetryAt: outcome.retrySafe ? new Date(Date.now() + 30000) : null,
        dispatchLeaseUntil: null,
      },
    });
    return result.count === 1;
  }

  async dispatchPolicyActive(history: NotificationHistory) {
    const [tenant, preference, provider] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: history.tenantId },
        select: { isActive: true, isSuspended: true },
      }),
      this.prisma.notificationPreferenceTenant.findUnique({
        where: {
          tenantId_eventType_channel: {
            tenantId: history.tenantId,
            eventType: history.eventType,
            channel: history.channel,
          },
        },
      }),
      this.prisma.notificationProviderConfig.findUnique({
        where: {
          tenantId_channel: {
            tenantId: history.tenantId,
            channel: history.channel,
          },
        },
      }),
    ]);
    if (
      !tenant?.isActive ||
      tenant.isSuspended ||
      !preference?.enabled ||
      !provider?.enabled ||
      provider.providerKey !== history.providerKey
    )
      return false;
    if (history.recipientUserId) {
      const user = await this.prisma.user.findFirst({
        where: {
          id: history.recipientUserId,
          tenantId: history.tenantId,
          isActive: true,
        },
        select: { role: true, email: true },
      });
      const payload = history.payload as Record<string, unknown> | null;
      const collaborator = payload?.["collaborator"] as Record<
        string,
        unknown
      > | null;
      const assigned =
        collaborator?.["userId"] === history.recipientUserId &&
        preference.sendToAssignedCollaborator;
      if (
        !user ||
        !(this.matchesRolePreference(user.role, preference) || assigned) ||
        (history.recipientEmail && history.recipientEmail !== user.email)
      )
        return false;
      const personal = await this.prisma.notificationPreferenceUser.findUnique({
        where: {
          tenantId_userId_eventType_channel: {
            tenantId: history.tenantId,
            userId: history.recipientUserId,
            eventType: history.eventType,
            channel: history.channel,
          },
        },
      });
      if (personal && !personal.enabled) return false;
    } else if (history.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: history.customerId, tenantId: history.tenantId },
        select: { email: true },
      });
      if (
        !customer ||
        !preference.sendToCustomer ||
        customer.email !== history.recipientEmail
      )
        return false;
    } else if (history.recipientType === "collaborator") {
      if (!preference.sendToAssignedCollaborator) return false;
      const payload = history.payload as Record<string, unknown> | null;
      const snapshot = payload?.["collaborator"] as Record<
        string,
        unknown
      > | null;
      if (typeof snapshot?.["id"] !== "string") return false;
      const collaborator = await this.prisma.collaborator.findFirst({
        where: {
          id: snapshot["id"],
          tenantId: history.tenantId,
          isActive: true,
        },
        select: { email: true },
      });
      if (!collaborator || collaborator.email !== history.recipientEmail)
        return false;
    }
    if (
      history.channel === NotificationChannel.webhook &&
      this.extractWebhookUrl(provider.config) !== history.recipientWebhookUrl
    )
      return false;
    const payload = history.payload as Record<string, unknown> | null;
    const data = payload?.["eventData"] as Record<string, unknown> | null;
    const snapshots =
      history.eventType === "appointment.cancelled"
        ? data?.["affectedAppointments"]
        : data?.["accountAppointments"];
    const rows = Array.isArray(snapshots)
      ? snapshots
      : payload?.["appointment"]
        ? [payload["appointment"]]
        : [];
    for (const snapshot of rows) {
      if (
        !snapshot ||
        typeof snapshot !== "object" ||
        typeof snapshot["id"] !== "string"
      )
        return false;
      const current = await this.prisma.appointment.findFirst({
        where: { id: snapshot["id"], tenantId: history.tenantId },
        select: {
          status: true,
          startsAt: true,
          endsAt: true,
          serviceId: true,
          collaboratorId: true,
          roomId: true,
          locationId: true,
          sectorId: true,
        },
      });
      if (!current) return false;
      for (const key of [
        "status",
        "startsAt",
        "endsAt",
        "serviceId",
        "collaboratorId",
        "roomId",
        "locationId",
        "sectorId",
      ] as const) {
        if (snapshot[key] === undefined) continue;
        const value =
          current[key] instanceof Date
            ? (current[key] as Date).toISOString()
            : current[key];
        if (snapshot[key] !== value) return false;
      }
    }
    return this.canDispatchInScope(history);
  }

  /** Recheck queued targets after operational access is revoked; never retarget an email. */
  async canDispatchInScope(history: {
    tenantId: string;
    recipientUserId?: string | null;
    recipientType: string | null;
    payload: unknown;
  }): Promise<boolean> {
    const payload = history.payload as Record<string, unknown> | null;
    if (
      payload?.["entityType"] !== "appointment" ||
      typeof payload["entityId"] !== "string"
    )
      return true;
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: payload["entityId"], tenantId: history.tenantId },
      select: { sectorId: true, collaboratorId: true },
    });
    if (!appointment) return false;
    const data = payload?.["eventData"] as Record<string, unknown> | null;
    const accountRows = data?.["accountAppointments"];
    const unknown =
      !appointment.sectorId ||
      (Array.isArray(accountRows) &&
        accountRows.some((row) => typeof row?.sectorId !== "string"));
    const requiredSectors = unknown
      ? (
          await this.prisma.sector.findMany({
            where: { tenantId: history.tenantId },
            select: { id: true },
          })
        ).map((row) => row.id)
      : [
          ...new Set([
            appointment.sectorId,
            ...(Array.isArray(accountRows)
              ? accountRows.map((row) => String(row.sectorId))
              : []),
          ]),
        ];
    if (history.recipientUserId)
      return !!(await this.prisma.user.count({
        where: {
          id: history.recipientUserId,
          tenantId: history.tenantId,
          isActive: true,
          OR: [
            { role: "owner" },
            {
              role: { in: ["manager", "reception"] },
              AND: requiredSectors.map((sectorId) => ({
                sectorAccess: { some: { sectorId } },
              })),
            },
            {
              role: "collaborator",
              collaborator: {
                id: appointment.collaboratorId || "",
                isActive: true,
                AND: requiredSectors.map((sectorId) => ({
                  sectors: { some: { sectorId } },
                })),
              },
            },
          ],
        },
      }));
    if (history.recipientType === "collaborator") {
      const collaborator = payload["collaborator"] as Record<
        string,
        unknown
      > | null;
      return (
        typeof collaborator?.["id"] === "string" &&
        !!(await this.prisma.collaborator.count({
          where: {
            id: collaborator["id"],
            tenantId: history.tenantId,
            isActive: true,
            AND: requiredSectors.map((sectorId) => ({
              sectors: { some: { sectorId } },
            })),
          },
        }))
      );
    }
    return true;
  }

  async ensureTenantTemplates(
    tenantId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await client.notificationTemplate.createMany({
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

  async ensureTenantNotificationDefaults(
    tenantId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await this.ensureTenantTemplates(tenantId, client);

    const defaults = DEFAULT_NOTIFICATION_TEMPLATES.map((template) => ({
      tenantId,
      eventType: template.eventType,
      channel: template.channel,
      enabled:
        template.defaultEnabled ??
        template.channel === NotificationChannel.in_app,
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

    await client.notificationPreferenceTenant.createMany({
      data: defaults,
      skipDuplicates: true,
    });
    await Promise.all([
      client.notificationProviderConfig.upsert({
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
          enabled: false,
        },
        update: {},
      }),
      client.notificationProviderConfig.upsert({
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
      client.notificationProviderConfig.upsert({
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

    if (client === this.prisma) await this.invalidateTenantCaches(tenantId);
  }

  private async enrichPayload(
    payload: NotificationEventPayload,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<NotificationEventPayload> {
    const tenant = payload.tenant
      ? payload.tenant
      : await client.tenant.findUnique({
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

    const appointment = await client.appointment.findFirst({
      where: { id: payload.entityId, tenantId: payload.tenantId },
      include: {
        customer: true,
        service: true,
        collaborator: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException(
        "L'appuntamento collegato alla comunicazione non è stato trovato",
      );
    }

    return {
      ...payload,
      appointment: {
        id: appointment.id,
        sectorId: appointment.sectorId,
        locationId: appointment.locationId,
        status: appointment.status,
        startsAt: appointment.startsAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
        source: appointment.source,
        serviceId: appointment.serviceId,
        collaboratorId: appointment.collaboratorId,
        roomId: appointment.roomId,
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
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<TenantNotificationPreference[]> {
    if (client !== this.prisma)
      return client.notificationPreferenceTenant.findMany({
        where: { tenantId },
      });
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
      NOTIFICATION_DEFAULT_TTL_SECONDS,
    );

    return preferences;
  }

  private async getProviderConfigs(
    tenantId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<NotificationProviderConfigValue[]> {
    if (client !== this.prisma)
      return client.notificationProviderConfig.findMany({
        where: { tenantId },
      });
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
      NOTIFICATION_DEFAULT_TTL_SECONDS,
    );

    return configs;
  }

  private async resolveTemplate(
    tenantId: string,
    eventType: string,
    channel: NotificationChannel,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const cacheKey = this.buildTemplateCacheKey(tenantId, eventType, channel);
    const cached =
      client === this.prisma
        ? await this.cacheManager.get<{
            subject?: string | null;
            title?: string | null;
            body: string;
          }>(cacheKey)
        : null;

    if (cached) {
      return cached;
    }

    const template = await client.notificationTemplate.findUnique({
      where: {
        tenantId_eventType_channel: { tenantId, eventType, channel },
      },
    });

    if (!template) {
      throw new NotFoundException("Il messaggio richiesto non è disponibile");
    }

    const normalized = {
      subject: template.subject,
      title: template.title,
      body: template.body,
    };

    if (client === this.prisma)
      await this.cacheManager.set(
        cacheKey,
        normalized,
        NOTIFICATION_DEFAULT_TTL_SECONDS,
      );

    return normalized;
  }

  private staffPayload(
    payload: NotificationEventPayload,
    professionalId?: string,
  ): NotificationEventPayload {
    const customer = payload.customer;
    const collaborator = payload.collaborator;
    const actor = payload.actor;
    const filtered = (rows: unknown) =>
      Array.isArray(rows)
        ? rows.filter(
            (row) => !professionalId || row?.collaboratorId === professionalId,
          )
        : [];
    const account = filtered(payload.eventData?.["accountAppointments"]);
    const affected = filtered(payload.eventData?.["affectedAppointments"]);
    const own = professionalId
      ? affected.find((row) => row.id === payload.entityId) ||
        affected[0] ||
        account[0]
      : null;
    return {
      ...payload,
      customer: customer
        ? {
            id: customer["id"],
            firstName: customer["firstName"],
            lastName: customer["lastName"],
          }
        : null,
      collaborator: collaborator
        ? {
            id: collaborator["id"],
            userId: collaborator["userId"],
            firstName: collaborator["firstName"],
            lastName: collaborator["lastName"],
          }
        : null,
      actor: actor
        ? {
            id: actor.id,
            firstName: actor.firstName,
            lastName: actor.lastName,
            role: actor.role,
          }
        : undefined,
      ...(own ? { appointment: { ...own }, service: own.service } : {}),
      ...(professionalId
        ? {
            eventData: {
              affectedAppointments: affected,
              accountAppointments: account,
              previousAppointments: filtered(
                payload.eventData?.["previousAppointments"],
              ),
            },
          }
        : {}),
    };
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

  private buildTemplateCacheKey(
    tenantId: string,
    eventType: string,
    channel: NotificationChannel,
  ): string {
    return `${NOTIFICATIONS_CACHE_PREFIX}:template:${tenantId}:${eventType}:${channel}`;
  }
}
