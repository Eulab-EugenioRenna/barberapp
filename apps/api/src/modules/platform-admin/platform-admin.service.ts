import { Injectable, NotFoundException } from "@nestjs/common";
import {
  BillingInterval,
  BookingMode,
  SubscriptionStatus,
} from "@prisma/client";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import { CACHE_TTL_SECONDS, cacheKeys } from "../../cache/cache.constants";
import { AppCacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";

type ImportMode = "replace" | "merge";

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly cacheInvalidationService: CacheInvalidationService,
  ) {}

  private stringifyCsvValue(value: unknown): string {
    if (value === null || value === undefined) return "";
    const raw =
      value instanceof Date
        ? value.toISOString()
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    const escaped = raw.replace(/"/g, '""');
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  }

  private rowsToCsv(rows: Array<Record<string, unknown>>): string {
    if (rows.length === 0) return "";
    const headers = Array.from(
      rows.reduce((set, row) => {
        Object.keys(row).forEach((key) => set.add(key));
        return set;
      }, new Set<string>()),
    );

    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(
        headers.map((header) => this.stringifyCsvValue(row[header])).join(","),
      );
    }
    return lines.join("\n");
  }

  private parseCsv(csv: string): Array<Record<string, string>> {
    const text = csv.trim();
    if (!text) return [];

    const rows: string[][] = [];
    let current = "";
    let row: string[] = [];
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        row.push(current);
        current = "";
      } else if (char === "\n" && !inQuotes) {
        row.push(current);
        rows.push(row);
        row = [];
        current = "";
      } else if (char !== "\r") {
        current += char;
      }
    }

    row.push(current);
    rows.push(row);

    const [headers, ...dataRows] = rows;
    return dataRows
      .filter((dataRow) => dataRow.some((cell) => cell.length > 0))
      .map((dataRow) =>
        headers.reduce<Record<string, string>>(
          (record, header, headerIndex) => {
            record[header] = dataRow[headerIndex] ?? "";
            return record;
          },
          {},
        ),
      );
  }

  private parseJsonCell(value: string): unknown {
    let trimmed = value.trim();
    if (!trimmed) return null;
    while (
      trimmed.length >= 2 &&
      trimmed.startsWith('"') &&
      trimmed.endsWith('"')
    ) {
      trimmed = trimmed.slice(1, -1).replace(/""/g, '"').trim();
    }
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  private async snapshotTenant(tenantId: string): Promise<Record<string, any>> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException("Attività non trovata");

    const [
      users,
      collaborators,
      customers,
      services,
      products,
      serviceProducts,
      appointments,
      cancellations,
      sales,
      saleItems,
      subscriptions,
    ] = await Promise.all([
      this.prisma.user.findMany({ where: { tenantId } }),
      this.prisma.collaborator.findMany({ where: { tenantId } }),
      this.prisma.customer.findMany({ where: { tenantId } }),
      this.prisma.service.findMany({ where: { tenantId } }),
      this.prisma.product.findMany({ where: { tenantId } }),
      this.prisma.serviceProduct.findMany({ where: { service: { tenantId } } }),
      this.prisma.appointment.findMany({ where: { tenantId } }),
      this.prisma.appointmentCancellation.findMany({
        where: { appointment: { tenantId } },
      }),
      this.prisma.sale.findMany({ where: { tenantId } }),
      this.prisma.saleItem.findMany({ where: { sale: { tenantId } } }),
      this.prisma.tenantSubscription.findMany({ where: { tenantId } }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      tenant,
      users,
      collaborators,
      customers,
      services,
      products,
      serviceProducts,
      appointments,
      cancellations,
      sales,
      saleItems,
      subscriptions,
    };
  }

  async listTenants(): Promise<unknown> {
    return this.cacheService.getOrSet(
      cacheKeys.platformAdminTenants,
      CACHE_TTL_SECONDS.dashboard,
      () =>
        this.prisma.tenant.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            users: {
              where: { role: "owner" },
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                isActive: true,
              },
            },
            subscriptions: {
              orderBy: { createdAt: "desc" },
              include: { plan: true },
              take: 1,
            },
            _count: {
              select: {
                users: true,
                collaborators: true,
                customers: true,
                services: true,
                appointments: true,
                sales: true,
              },
            },
          },
        }),
    );
  }

  async getTenant(tenantId: string): Promise<unknown> {
    const tenant = await this.cacheService.getOrSet(
      cacheKeys.platformAdminTenant(tenantId),
      CACHE_TTL_SECONDS.dashboard,
      () =>
        this.prisma.tenant.findUnique({
          where: { id: tenantId },
          include: {
            users: { orderBy: { createdAt: "asc" } },
            subscriptions: {
              orderBy: { createdAt: "desc" },
              include: { plan: true },
            },
          },
        }),
    );

    if (!tenant) throw new NotFoundException("Attività non trovata");
    return tenant;
  }

  async healthCheck(tenantId: string): Promise<unknown> {
    return this.cacheService.getOrSet(
      cacheKeys.platformAdminHealthCheck(tenantId),
      CACHE_TTL_SECONDS.dashboard,
      async () => {
        const tenant = await this.prisma.tenant.findUnique({
          where: { id: tenantId },
          include: {
            subscriptions: {
              orderBy: { createdAt: "desc" },
              include: { plan: true },
              take: 1,
            },
          },
        });

        if (!tenant) throw new NotFoundException("Attività non trovata");

        const [users, collaborators, customers, services, appointments, sales] =
          await Promise.all([
            this.prisma.user.count({ where: { tenantId } }),
            this.prisma.collaborator.count({ where: { tenantId } }),
            this.prisma.customer.count({ where: { tenantId } }),
            this.prisma.service.count({ where: { tenantId } }),
            this.prisma.appointment.count({ where: { tenantId } }),
            this.prisma.sale.count({ where: { tenantId } }),
          ]);

        return {
          tenantId,
          status: {
            isActive: tenant.isActive,
            isSuspended: tenant.isSuspended,
            latestSubscription: tenant.subscriptions[0] ?? null,
          },
          counts: {
            users,
            collaborators,
            customers,
            services,
            appointments,
            sales,
          },
        };
      },
    );
  }

  async updateTenant(
    tenantId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: typeof body["name"] === "string" ? body["name"] : undefined,
        slug: typeof body["slug"] === "string" ? body["slug"] : undefined,
        publicDomain:
          typeof body["publicDomain"] === "string"
            ? body["publicDomain"].trim().toLowerCase() || null
            : undefined,
        publicEnabled:
          typeof body["publicEnabled"] === "boolean"
            ? body["publicEnabled"]
            : undefined,
        bookingMode:
          typeof body["bookingMode"] === "string"
            ? (body["bookingMode"] as BookingMode)
            : undefined,
        primaryColor:
          typeof body["primaryColor"] === "string"
            ? body["primaryColor"]
            : undefined,
        accentColor:
          typeof body["accentColor"] === "string"
            ? body["accentColor"]
            : undefined,
        timezone:
          typeof body["timezone"] === "string" ? body["timezone"] : undefined,
        currency:
          typeof body["currency"] === "string" ? body["currency"] : undefined,
        language:
          typeof body["language"] === "string" ? body["language"] : undefined,
        notes: typeof body["notes"] === "string" ? body["notes"] : undefined,
        isActive:
          typeof body["isActive"] === "boolean" ? body["isActive"] : undefined,
      },
    });

    await this.cacheInvalidationService.invalidatePlatformAdminTenants();
    await this.cacheInvalidationService.invalidateTenantSettings(tenantId);
    await this.cacheInvalidationService.invalidatePublicTenantLookups();

    return updated;
  }

  async suspendTenant(tenantId: string, reason?: string): Promise<unknown> {
    const now = new Date();

    const tenant = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          isActive: false,
          isSuspended: true,
          suspendedAt: now,
          suspensionReason: reason ?? "Suspended by platform admin",
          publicEnabled: false,
        },
      });

      const latest = await tx.tenantSubscription.findFirst({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      });
      if (latest) {
        await tx.tenantSubscription.update({
          where: { id: latest.id },
          data: {
            status: "suspended",
            suspendedAt: now,
            cancellationReason: reason ?? undefined,
          },
        });
      }

      return tenant;
    });

    await this.cacheInvalidationService.invalidatePlatformAdminTenants();
    await this.cacheInvalidationService.invalidateTenantSettings(tenantId);
    await this.cacheInvalidationService.invalidatePublicTenantLookups();

    return tenant;
  }

  async reactivateTenant(tenantId: string): Promise<unknown> {
    const tenant = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          isActive: true,
          isSuspended: false,
          suspendedAt: null,
          suspensionReason: null,
        },
      });

      const latest = await tx.tenantSubscription.findFirst({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      });
      if (latest && latest.status === "suspended") {
        await tx.tenantSubscription.update({
          where: { id: latest.id },
          data: { status: "active", suspendedAt: null },
        });
      }

      return tenant;
    });

    await this.cacheInvalidationService.invalidatePlatformAdminTenants();
    await this.cacheInvalidationService.invalidateTenantSettings(tenantId);
    await this.cacheInvalidationService.invalidatePublicTenantLookups();

    return tenant;
  }

  async resetTenantData(tenantId: string): Promise<unknown> {
    await this.prisma.$transaction(async (tx) => {
      await tx.saleItem.deleteMany({ where: { sale: { tenantId } } });
      await tx.sale.deleteMany({ where: { tenantId } });
      await tx.appointmentCancellation.deleteMany({
        where: { appointment: { tenantId } },
      });
      await tx.appointment.deleteMany({ where: { tenantId } });
      await tx.serviceProduct.deleteMany({ where: { service: { tenantId } } });
      await tx.notificationHistory.deleteMany({ where: { tenantId } });
      await tx.notificationInbox.deleteMany({ where: { tenantId } });
      await tx.notificationPreferenceUser.deleteMany({ where: { tenantId } });
      await tx.notificationPreferenceTenant.deleteMany({ where: { tenantId } });
      await tx.notificationTemplate.deleteMany({ where: { tenantId } });
      await tx.notificationProviderConfig.deleteMany({ where: { tenantId } });
      await tx.product.deleteMany({ where: { tenantId } });
      await tx.room.deleteMany({ where: { tenantId } });
      await tx.service.deleteMany({ where: { tenantId } });
      await tx.customer.deleteMany({ where: { tenantId } });
      await tx.collaborator.deleteMany({ where: { tenantId } });
      await tx.auditLog.deleteMany({ where: { tenantId } });
    });

    await this.cacheInvalidationService.invalidatePlatformAdminTenants();
    await this.cacheInvalidationService.invalidateBookingReadModels(tenantId);
    await this.cacheInvalidationService.invalidateServices(tenantId);
    await this.cacheInvalidationService.invalidateCollaborators(tenantId);
    await this.cacheInvalidationService.invalidateProducts(tenantId);
    await this.cacheInvalidationService.invalidatePublicServices(tenantId);
    await this.cacheInvalidationService.invalidatePublicAvailability(tenantId);

    return this.healthCheck(tenantId);
  }

  async deleteTenant(tenantId: string): Promise<unknown> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException("Attività non trovata");

    await this.resetTenantData(tenantId);
    await this.prisma.$transaction(async (tx) => {
      await tx.tenantSubscription.deleteMany({ where: { tenantId } });
      await tx.user.deleteMany({ where: { tenantId } });
      await tx.tenant.delete({ where: { id: tenantId } });
    });
    await this.cacheInvalidationService.invalidatePlatformAdminTenants();
    await this.cacheInvalidationService.invalidatePublicTenantLookups();
    return { id: tenantId, removed: true };
  }

  async exportTenant(tenantId: string): Promise<unknown> {
    return this.snapshotTenant(tenantId);
  }

  async exportTenantCsv(tenantId: string): Promise<unknown> {
    const snapshot = await this.snapshotTenant(tenantId);
    const files: Record<string, string> = {};

    for (const [key, value] of Object.entries(snapshot)) {
      if (key === "tenant" && value && !Array.isArray(value)) {
        files["tenant.csv"] = this.rowsToCsv([
          value as Record<string, unknown>,
        ]);
        continue;
      }

      if (Array.isArray(value)) {
        files[`${key}.csv`] = this.rowsToCsv(
          value as Array<Record<string, unknown>>,
        );
      }
    }

    return {
      format: "csv",
      exportedAt: snapshot["exportedAt"],
      tenant: snapshot["tenant"],
      files,
    };
  }

  async importTenant(
    tenantId: string,
    snapshot: Record<string, any>,
    mode: ImportMode,
  ): Promise<unknown> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) throw new NotFoundException("Attività non trovata");

    if (mode === "replace") {
      await this.resetTenantData(tenantId);
    }

    await this.prisma.$transaction(async (tx) => {
      const tenantData = snapshot["tenant"];
      if (tenantData) {
        await tx.tenant.update({
          where: { id: tenantId },
          data: {
            name: tenantData.name,
            bookingMode: tenantData.bookingMode,
            timezone: tenantData.timezone,
            currency: tenantData.currency,
            language: tenantData.language,
            primaryColor: tenantData.primaryColor,
            accentColor: tenantData.accentColor,
            logoUrl: tenantData.logoUrl,
            coverUrl: tenantData.coverUrl,
            publicEnabled: tenantData.publicEnabled,
            notes: tenantData.notes,
          },
        });
      }

      // Users are intentionally not imported across tenants: emails are global
      // and the destination tenant must preserve its own access identities.
      for (const collaborator of snapshot["collaborators"] ?? []) {
        await tx.collaborator.upsert({
          where: { id: collaborator.id },
          update: { ...collaborator, tenantId },
          create: { ...collaborator, tenantId },
        });
      }
      for (const customer of snapshot["customers"] ?? []) {
        await tx.customer.upsert({
          where: { id: customer.id },
          update: { ...customer, tenantId },
          create: { ...customer, tenantId },
        });
      }
      for (const product of snapshot["products"] ?? []) {
        await tx.product.upsert({
          where: { id: product.id },
          update: { ...product, tenantId },
          create: { ...product, tenantId },
        });
      }
      for (const service of snapshot["services"] ?? []) {
        const { collaboratorIds: _legacyCollaboratorIds, ...serviceData } =
          service;
        await tx.service.upsert({
          where: { id: service.id },
          update: { ...serviceData, tenantId },
          create: { ...serviceData, tenantId },
        });
      }
      for (const serviceProduct of snapshot["serviceProducts"] ?? []) {
        await tx.serviceProduct.upsert({
          where: {
            serviceId_productId: {
              serviceId: serviceProduct.serviceId,
              productId: serviceProduct.productId,
            },
          },
          update: serviceProduct,
          create: serviceProduct,
        });
      }
      for (const appointment of snapshot["appointments"] ?? []) {
        await tx.appointment.upsert({
          where: { id: appointment.id },
          update: { ...appointment, tenantId },
          create: { ...appointment, tenantId },
        });
      }
      for (const cancellation of snapshot["cancellations"] ?? []) {
        await tx.appointmentCancellation.upsert({
          where: { id: cancellation.id },
          update: cancellation,
          create: cancellation,
        });
      }
      for (const sale of snapshot["sales"] ?? []) {
        await tx.sale.upsert({
          where: { id: sale.id },
          update: { ...sale, tenantId },
          create: { ...sale, tenantId },
        });
      }
      for (const item of snapshot["saleItems"] ?? []) {
        await tx.saleItem.upsert({
          where: { id: item.id },
          update: item,
          create: item,
        });
      }

      if (
        Array.isArray(snapshot["subscriptions"]) &&
        snapshot["subscriptions"].length > 0 &&
        mode === "replace"
      ) {
        await tx.tenantSubscription.deleteMany({ where: { tenantId } });
        for (const subscription of snapshot["subscriptions"]) {
          const plan = await tx.subscriptionPlan.findFirst({
            where: { id: subscription.planId },
            select: { id: true },
          });

          if (!plan) {
            continue;
          }

          await tx.tenantSubscription.create({
            data: {
              planId: plan.id,
              tenantId,
              status: subscription.status,
              startsAt: subscription.startsAt
                ? new Date(String(subscription.startsAt))
                : new Date(),
              trialEndsAt: subscription.trialEndsAt
                ? new Date(String(subscription.trialEndsAt))
                : undefined,
              endsAt: subscription.endsAt
                ? new Date(String(subscription.endsAt))
                : undefined,
              suspendedAt: subscription.suspendedAt
                ? new Date(String(subscription.suspendedAt))
                : undefined,
              cancellationReason: subscription.cancellationReason ?? undefined,
              externalReference: subscription.externalReference ?? undefined,
              metadata: subscription.metadata ?? undefined,
            },
          });
        }
      }
    });

    await this.cacheInvalidationService.invalidatePlatformAdminTenants();
    await this.cacheInvalidationService.invalidateBookingReadModels(tenantId);
    await this.cacheInvalidationService.invalidateServices(tenantId);
    await this.cacheInvalidationService.invalidateCollaborators(tenantId);
    await this.cacheInvalidationService.invalidateProducts(tenantId);
    await this.cacheInvalidationService.invalidatePublicServices(tenantId);
    await this.cacheInvalidationService.invalidatePublicAvailability(tenantId);

    return this.healthCheck(tenantId);
  }

  async importTenantCsv(
    tenantId: string,
    bundle: Record<string, any>,
    mode: ImportMode,
  ): Promise<unknown> {
    const files = bundle["files"] as Record<string, string> | undefined;
    if (!files) {
      throw new NotFoundException("La copia tabellare non contiene tutti i dati necessari");
    }

    const snapshot: Record<string, any> = {};

    for (const [fileName, csv] of Object.entries(files)) {
      const entityKey = fileName.replace(/\.csv$/, "");
      snapshot[entityKey] = this.parseCsv(csv).map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            this.parseJsonCell(value),
          ]),
        ),
      );
    }

    return this.importTenant(tenantId, snapshot, mode);
  }

  async listPlans(): Promise<unknown> {
    return this.cacheService.getOrSet(
      cacheKeys.platformAdminPlans,
      CACHE_TTL_SECONDS.dashboard,
      () =>
        this.prisma.subscriptionPlan.findMany({ orderBy: { price: "asc" } }),
    );
  }

  async createPlan(body: Record<string, unknown>): Promise<unknown> {
    const created = await this.prisma.subscriptionPlan.create({
      data: {
        code: String(body["code"] ?? ""),
        name: String(body["name"] ?? ""),
        description:
          typeof body["description"] === "string"
            ? body["description"]
            : undefined,
        price: Number(body["price"] ?? 0),
        currency:
          typeof body["currency"] === "string" ? body["currency"] : "EUR",
        billingInterval:
          typeof body["billingInterval"] === "string"
            ? (body["billingInterval"] as BillingInterval)
            : "monthly",
        maxUsers:
          body["maxUsers"] === undefined ? undefined : Number(body["maxUsers"]),
        maxCollaborators:
          body["maxCollaborators"] === undefined
            ? undefined
            : Number(body["maxCollaborators"]),
        maxAppointmentsPerMonth:
          body["maxAppointmentsPerMonth"] === undefined
            ? undefined
            : Number(body["maxAppointmentsPerMonth"]),
        isActive:
          body["isActive"] === undefined ? true : Boolean(body["isActive"]),
        isPublic: Boolean(body["isPublic"]),
        features: body["features"] ?? undefined,
      },
    });

    await this.cacheInvalidationService.invalidatePlatformAdminPlans();

    return created;
  }

  async updatePlan(
    id: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const updated = await this.prisma.subscriptionPlan.update({
      where: { id },
      data: {
        code: typeof body["code"] === "string" ? body["code"] : undefined,
        name: typeof body["name"] === "string" ? body["name"] : undefined,
        description:
          typeof body["description"] === "string"
            ? body["description"]
            : undefined,
        price: body["price"] === undefined ? undefined : Number(body["price"]),
        currency:
          typeof body["currency"] === "string" ? body["currency"] : undefined,
        billingInterval:
          typeof body["billingInterval"] === "string"
            ? (body["billingInterval"] as BillingInterval)
            : undefined,
        maxUsers:
          body["maxUsers"] === undefined ? undefined : Number(body["maxUsers"]),
        maxCollaborators:
          body["maxCollaborators"] === undefined
            ? undefined
            : Number(body["maxCollaborators"]),
        maxAppointmentsPerMonth:
          body["maxAppointmentsPerMonth"] === undefined
            ? undefined
            : Number(body["maxAppointmentsPerMonth"]),
        isActive:
          typeof body["isActive"] === "boolean" ? body["isActive"] : undefined,
        isPublic:
          typeof body["isPublic"] === "boolean" ? body["isPublic"] : undefined,
        features: body["features"] ?? undefined,
      },
    });

    await this.cacheInvalidationService.invalidatePlatformAdminPlans();

    return updated;
  }

  async listSubscriptions(): Promise<unknown> {
    return this.cacheService.getOrSet(
      cacheKeys.platformAdminSubscriptions,
      CACHE_TTL_SECONDS.dashboard,
      () =>
        this.prisma.tenantSubscription.findMany({
          orderBy: { createdAt: "desc" },
          include: { tenant: true, plan: true },
        }),
    );
  }

  async assignSubscription(body: Record<string, unknown>): Promise<unknown> {
    const created = await this.prisma.tenantSubscription.create({
      data: {
        tenantId: String(body["tenantId"] ?? ""),
        planId: String(body["planId"] ?? ""),
        status:
          typeof body["status"] === "string"
            ? (body["status"] as SubscriptionStatus)
            : "active",
        startsAt: body["startsAt"]
          ? new Date(String(body["startsAt"]))
          : new Date(),
        trialEndsAt: body["trialEndsAt"]
          ? new Date(String(body["trialEndsAt"]))
          : undefined,
        endsAt: body["endsAt"] ? new Date(String(body["endsAt"])) : undefined,
      },
      include: { tenant: true, plan: true },
    });

    await this.cacheInvalidationService.invalidatePlatformAdminTenants();

    return created;
  }

  async updateSubscription(
    id: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const updated = await this.prisma.tenantSubscription.update({
      where: { id },
      data: {
        planId: typeof body["planId"] === "string" ? body["planId"] : undefined,
        status:
          typeof body["status"] === "string"
            ? (body["status"] as SubscriptionStatus)
            : undefined,
        startsAt: body["startsAt"]
          ? new Date(String(body["startsAt"]))
          : undefined,
        trialEndsAt: body["trialEndsAt"]
          ? new Date(String(body["trialEndsAt"]))
          : undefined,
        endsAt: body["endsAt"] ? new Date(String(body["endsAt"])) : undefined,
        cancellationReason:
          typeof body["cancellationReason"] === "string"
            ? body["cancellationReason"]
            : undefined,
        externalReference:
          typeof body["externalReference"] === "string"
            ? body["externalReference"]
            : undefined,
      },
      include: { tenant: true, plan: true },
    });

    await this.cacheInvalidationService.invalidatePlatformAdminTenants();

    return updated;
  }
}
