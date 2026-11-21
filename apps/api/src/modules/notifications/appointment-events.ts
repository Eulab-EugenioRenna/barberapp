import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type { NotificationEventPayload } from "./notifications.types";
import { invalidateAutomationAccounts } from "./appointment-automation-state";

const select = {
  id: true,
  tenantId: true,
  locationId: true,
  sectorId: true,
  customerId: true,
  serviceId: true,
  collaboratorId: true,
  roomId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  source: true,
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  },
  service: { select: { id: true, name: true } },
  collaborator: {
    select: {
      id: true,
      userId: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  },
  tenant: {
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      currency: true,
      language: true,
    },
  },
  location: { select: { id: true, name: true } },
  sector: { select: { id: true, name: true } },
  orderItem: {
    select: {
      saleId: true,
      sale: {
        select: {
          revision: true,
          orderStatus: true,
          appointmentId: true,
          automationContact: true,
        },
      },
    },
  },
} as const;
type Snapshot = Prisma.AppointmentGetPayload<{ select: typeof select }>;
export interface AppointmentEventContext {
  tenantId: string;
  automationRunId?: string;
  actorId: string | null;
  source: "internal" | "public" | "customer";
}
const stopped = new Set(["completed", "cancelled", "no_show"]);
const scheduleFields = [
  "startsAt",
  "endsAt",
  "serviceId",
  "roomId",
  "locationId",
  "sectorId",
] as const;
function same(left: unknown, right: unknown) {
  return (
    (left instanceof Date ? left.toISOString() : left) ===
    (right instanceof Date ? right.toISOString() : right)
  );
}
function appointment(row: Snapshot) {
  return {
    id: row.id,
    sectorId: row.sectorId,
    locationId: row.locationId,
    customerId: row.customerId,
    serviceId: row.serviceId,
    collaboratorId: row.collaboratorId,
    roomId: row.roomId,
    status: row.status,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    source: row.source,
  };
}
function line(row: Snapshot) {
  return {
    ...appointment(row),
    service: row.service,
    location: row.location,
    sector: row.sector,
    collaborator: row.collaborator
      ? {
          id: row.collaborator.id,
          firstName: row.collaborator.firstName,
          lastName: row.collaborator.lastName,
        }
      : null,
  };
}

/** Capture before writes under the operational tenant lock; record once before the same transaction commits.
 * No queue, provider or cache operation is performed here. Failed domain work leaves no event.
 */
export async function beginAppointmentEvents(
  tx: Prisma.TransactionClient,
  context: AppointmentEventContext,
  beforeWhere?: Prisma.AppointmentWhereInput,
) {
  const before = beforeWhere
    ? await tx.appointment.findMany({
        where: { AND: [{ tenantId: context.tenantId }, beforeWhere] },
        select,
      })
    : [];
  return async (
    afterWhere: Prisma.AppointmentWhereInput,
    operationId: string = randomUUID(),
    forcedType?: "appointment.contact_authorized",
  ) => {
    const after = await tx.appointment.findMany({
      where: {
        tenantId: context.tenantId,
        OR: [afterWhere, { id: { in: before.map((row) => row.id) } }],
      },
      select,
    });
    const old = new Map(before.map((row) => [row.id, row]));
    const groups = new Map<string, { type: string; rows: Snapshot[] }>();
    function add(type: string, row: Snapshot) {
      const key = JSON.stringify([
        type,
        ["appointment.assigned", "appointment.reassigned"].includes(type)
          ? row.id
          : row.orderItem?.saleId || row.id,
      ]);
      const group = groups.get(key) || { type, rows: [] };
      if (!group.rows.some((item) => item.id === row.id)) group.rows.push(row);
      groups.set(key, group);
    }
    for (const row of after) {
      if (forcedType && !stopped.has(row.status)) add(forcedType, row);
      const previous = old.get(row.id);
      if (!previous) {
        if (stopped.has(row.status)) {
          add(`appointment.${row.status}`, row);
          continue;
        }
        add(
          before.length
            ? "appointment.rescheduled"
            : `appointment.created.${context.source}`,
          row,
        );
        if (!before.length && context.source === "public")
          add(`appointment.${row.status}`, row);
        if (row.collaboratorId) add("appointment.assigned", row);
        continue;
      }
      if (previous.status !== row.status) {
        const types: Record<string, string> = {
          confirmed: "appointment.confirmed",
          requested: "appointment.requested",
          cancelled: "appointment.cancelled",
          completed: "appointment.completed",
          no_show: "appointment.no_show",
          checked_in: "appointment.checked_in",
          rescheduled: "appointment.rescheduled",
        };
        if (types[row.status]) add(types[row.status], row);
      }
      if (
        !stopped.has(row.status) &&
        scheduleFields.some((key) => !same(row[key], previous[key]))
      )
        add("appointment.rescheduled", row);
      if (
        !stopped.has(row.status) &&
        row.collaboratorId !== previous.collaboratorId
      )
        add(
          previous.collaboratorId
            ? "appointment.reassigned"
            : "appointment.assigned",
          row,
        );
    }
    await invalidateAutomationAccounts(tx, context.tenantId, [
      ...new Set(
        [...before, ...after].flatMap((row) =>
          row.orderItem?.saleId ? [row.orderItem.saleId] : [],
        ),
      ),
    ]);
    if (!groups.size) return [];
    const actor = context.actorId
      ? await tx.user.findFirst({
          where: { id: context.actorId, tenantId: context.tenantId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        })
      : null;
    if (context.actorId && !actor)
      throw new BadRequestException("Autore dell’evento fuori attività");
    const ids: string[] = [];
    for (const [groupKey, group] of groups) {
      const row =
        group.rows.find(
          (item) => item.id === item.orderItem?.sale.appointmentId,
        ) || group.rows[0];
      const saleId = row.orderItem?.saleId;
      const payload: NotificationEventPayload = {
        eventType: group.type,
        tenantId: context.tenantId,
        entityType: "appointment",
        entityId: row.id,
        ...(actor ? { actor } : {}),
        flags: {
          createdFromPublicBooking: context.source === "public",
          customerOrigin: context.source === "customer",
        },
        appointment: appointment(row),
        customer: row.customer,
        service: row.service,
        collaborator: row.collaborator,
        tenant: row.tenant,
        occurredAt: new Date().toISOString(),
        eventData: {
          operationId,
          contactAuthorizationId:
            (
              row.orderItem?.sale.automationContact as {
                authorizationId?: string;
              } | null
            )?.authorizationId || null,
          ...(context.automationRunId
            ? { automationRunId: context.automationRunId }
            : {}),
          orderId: saleId || null,
          orderRevision: row.orderItem?.sale.revision ?? null,
          affectedAppointments: group.rows.map(line),
          accountAppointments: after
            .filter((item) =>
              saleId ? item.orderItem?.saleId === saleId : item.id === row.id,
            )
            .map(line),
          previousAppointments: group.rows.flatMap((item) =>
            old.has(item.id) ? [line(old.get(item.id)!)] : [],
          ),
        },
      };
      const event = await tx.notificationDomainEvent.create({
        data: {
          tenantId: context.tenantId,
          eventKey: createHash("sha256")
            .update(JSON.stringify([context.tenantId, operationId, groupKey]))
            .digest("hex"),
          eventType: group.type,
          entityType: "appointment",
          entityId: row.id,
          actorUserId: context.actorId,
          createdAt: new Date(),
          payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      ids.push(event.id);
    }
    return ids;
  };
}
