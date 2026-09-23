import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Customer } from "@prisma/client";
import { Queue } from "bullmq";
import { AppCacheService } from "../../cache/cache.service";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CUSTOMERS_ALIGNMENT_QUEUE,
  CUSTOMERS_ALIGNMENT_TTL_SECONDS,
  CUSTOMER_LOYALTY_TIERS,
} from "./customers.constants";
import { CustomerAlignmentJob, CustomerIdentityInput } from "./customers.types";

@Injectable()
export class CustomersAlignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: AppCacheService,
    private readonly cacheInvalidationService: CacheInvalidationService,
    @InjectQueue(CUSTOMERS_ALIGNMENT_QUEUE)
    private readonly customersQueue: Queue<CustomerAlignmentJob>,
  ) {}

  async ensureDailyAlignmentQueued(tenantId: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = `customers:alignment:${tenantId}:${today}`;
    const alreadyQueued = await this.cacheService.get<string>(cacheKey);

    if (alreadyQueued) {
      return;
    }

    await this.customersQueue.add(
      CUSTOMERS_ALIGNMENT_QUEUE,
      { tenantId, reason: "daily_get" },
      {
        // BullMQ rejects custom job IDs containing ':'. This runs in the
        // customer read/create path, so a rejected job must never turn a
        // successfully persisted customer into an HTTP 500.
        jobId: `customers-alignment-${tenantId}-${today}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    await this.cacheService.set(cacheKey, "1", CUSTOMERS_ALIGNMENT_TTL_SECONDS);
  }

  async queueCustomerRefresh(
    tenantId: string,
    customerId: string,
    reason: CustomerAlignmentJob["reason"],
  ): Promise<void> {
    await this.customersQueue.add(
      CUSTOMERS_ALIGNMENT_QUEUE,
      { tenantId, customerId, reason },
      {
        jobId: `customers-alignment-${tenantId}-${customerId}-${reason}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }

  async findOrCreateCustomer(input: CustomerIdentityInput): Promise<Customer> {
    const normalized = this.normalizeIdentity(input);

    const candidates = await this.prisma.customer.findMany({
      where: {
        tenantId: input.tenantId,
        firstName: normalized.firstName,
        lastName: normalized.lastName,
      },
      orderBy: { createdAt: "asc" },
    });

    const matched = candidates.find((candidate) =>
      this.matchesIdentity(candidate, normalized),
    );

    if (matched) {
      return this.prisma.customer.update({
        where: { id: matched.id },
        data: {
          email: matched.email || normalized.email || undefined,
          phone: matched.phone || normalized.phone || undefined,
        },
      });
    }

    return this.prisma.customer.create({
      data: {
        tenantId: input.tenantId,
        firstName: normalized.firstName,
        lastName: normalized.lastName,
        email: normalized.email || undefined,
        phone: normalized.phone || undefined,
        privacyConsent: true,
      },
    });
  }

  async alignTenant(tenantId: string): Promise<void> {
    const customers = await this.prisma.customer.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      include: {
        appointments: {
          select: { id: true, status: true, startsAt: true },
          orderBy: { startsAt: "desc" },
        },
        sales: {
          where: { paymentStatus: { in: ["paid", "partial"] } },
          select: { total: true, soldAt: true },
          orderBy: { soldAt: "desc" },
        },
      },
    });

    const duplicateGroups = this.collectDuplicateGroups(customers);

    for (const group of duplicateGroups) {
      if (group.length > 1) {
        await this.mergeCustomerGroup(group);
      }
    }

    const alignedCustomers = await this.prisma.customer.findMany({
      where: { tenantId },
      include: {
        appointments: {
          select: { id: true, status: true },
        },
        sales: {
          where: { paymentStatus: { in: ["paid", "partial"] } },
          select: { total: true },
        },
      },
    });

    for (const customer of alignedCustomers) {
      const visitsCount = customer.appointments.length;
      const completedVisitsCount = customer.appointments.filter(
        (appointment) => appointment.status === "completed",
      ).length;
      const totalSpent = customer.sales.reduce(
        (sum, sale) => sum + Number(sale.total),
        0,
      );
      const loyaltyTier = this.resolveLoyaltyTier({
        completedVisitsCount,
        totalSpent,
      });
      const autoTags = this.buildAutoTags({
        loyaltyTier,
        visitsCount,
        completedVisitsCount,
        totalSpent,
      });

      await this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          visitsCount,
          completedVisitsCount,
          totalSpent,
          loyaltyTier,
          autoTags,
          lastAlignedAt: new Date(),
        },
      });
    }

    await this.cacheInvalidationService.invalidateCustomers(tenantId);
  }

  async alignCustomer(tenantId: string, customerId: string): Promise<void> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
    });

    if (!customer) {
      return;
    }

    await this.alignTenant(tenantId);
  }

  private normalizeIdentity(input: CustomerIdentityInput) {
    return {
      firstName: input.firstName.trim().toLowerCase(),
      lastName: input.lastName.trim().toLowerCase(),
      email: input.email?.trim().toLowerCase() || null,
      phone: input.phone?.replace(/\s+/g, "") || null,
    };
  }

  private matchesIdentity(
    customer: Customer,
    identity: ReturnType<typeof this.normalizeIdentity>,
  ): boolean {
    const customerEmail = customer.email?.trim().toLowerCase() || null;
    const customerPhone = customer.phone?.replace(/\s+/g, "") || null;

    if (identity.email && customerEmail && identity.email !== customerEmail) {
      return false;
    }

    if (identity.phone && customerPhone && identity.phone !== customerPhone) {
      return false;
    }

    if (!identity.email && !identity.phone) {
      return !customerEmail && !customerPhone;
    }

    return Boolean(
      (identity.email && customerEmail && identity.email === customerEmail) ||
      (identity.phone && customerPhone && identity.phone === customerPhone),
    );
  }

  private collectDuplicateGroups(
    customers: Array<Customer>,
  ): Array<Array<Customer>> {
    const visited = new Set<string>();
    const groups: Array<Array<Customer>> = [];

    for (const customer of customers) {
      if (visited.has(customer.id)) {
        continue;
      }

      const group: Array<Customer> = [];
      const stack = [customer];

      while (stack.length > 0) {
        const current = stack.pop();

        if (!current || visited.has(current.id)) {
          continue;
        }

        visited.add(current.id);
        group.push(current);

        for (const candidate of customers) {
          if (visited.has(candidate.id)) {
            continue;
          }

          if (this.shouldMergeCustomers(current, candidate)) {
            stack.push(candidate);
          }
        }
      }

      groups.push(group);
    }

    return groups;
  }

  private shouldMergeCustomers(left: Customer, right: Customer): boolean {
    const leftFirstName = left.firstName.trim().toLowerCase();
    const leftLastName = left.lastName.trim().toLowerCase();
    const rightFirstName = right.firstName.trim().toLowerCase();
    const rightLastName = right.lastName.trim().toLowerCase();

    if (leftFirstName !== rightFirstName || leftLastName !== rightLastName) {
      return false;
    }

    const leftEmail = left.email?.trim().toLowerCase() || null;
    const rightEmail = right.email?.trim().toLowerCase() || null;
    const leftPhone = left.phone?.replace(/\s+/g, "") || null;
    const rightPhone = right.phone?.replace(/\s+/g, "") || null;

    if (leftEmail && rightEmail && leftEmail !== rightEmail) {
      return false;
    }

    if (leftPhone && rightPhone && leftPhone !== rightPhone) {
      return false;
    }

    if (!leftEmail && !leftPhone) {
      return !rightEmail && !rightPhone;
    }

    if (!rightEmail && !rightPhone) {
      return !leftEmail && !leftPhone;
    }

    return Boolean(
      (leftEmail && rightEmail && leftEmail === rightEmail) ||
      (leftPhone && rightPhone && leftPhone === rightPhone) ||
      (leftEmail &&
        !rightEmail &&
        leftPhone &&
        rightPhone &&
        leftPhone === rightPhone) ||
      (rightEmail &&
        !leftEmail &&
        rightPhone &&
        leftPhone &&
        rightPhone === leftPhone),
    );
  }

  private async mergeCustomerGroup(customers: Array<Customer>): Promise<void> {
    const [primary, ...duplicates] = customers;

    if (!duplicates.length) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const duplicate of duplicates) {
        await tx.appointment.updateMany({
          where: { customerId: duplicate.id },
          data: { customerId: primary.id },
        });
        await tx.sale.updateMany({
          where: { customerId: duplicate.id },
          data: { customerId: primary.id },
        });
        await tx.customer.delete({ where: { id: duplicate.id } });
      }
    });
  }

  private resolveLoyaltyTier(input: {
    completedVisitsCount: number;
    totalSpent: number;
  }): string {
    if (input.completedVisitsCount >= 8 || input.totalSpent >= 350) {
      return CUSTOMER_LOYALTY_TIERS.vip;
    }

    if (input.completedVisitsCount >= 5 || input.totalSpent >= 200) {
      return CUSTOMER_LOYALTY_TIERS.regular;
    }

    if (input.completedVisitsCount >= 2 || input.totalSpent >= 80) {
      return CUSTOMER_LOYALTY_TIERS.returning;
    }

    return CUSTOMER_LOYALTY_TIERS.new;
  }

  private buildAutoTags(input: {
    loyaltyTier: string;
    visitsCount: number;
    completedVisitsCount: number;
    totalSpent: number;
  }): string[] {
    const tags = [input.loyaltyTier];

    if (input.visitsCount >= 1) {
      tags.push(`sedute:${input.visitsCount}`);
    }

    if (input.completedVisitsCount >= 1) {
      tags.push(`completate:${input.completedVisitsCount}`);
    }

    if (input.totalSpent > 0) {
      tags.push(`spesa:${Math.round(input.totalSpent)}`);
    }

    return tags;
  }
}
