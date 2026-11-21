import { BadRequestException } from "@nestjs/common";
import { Prisma, type AppointmentAutomationRun } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";

export const automationHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function appointmentPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let phone = value.trim().replace(/[\s().-]/g, "");
  if (phone.startsWith("00")) phone = "+" + phone.slice(2);
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone.slice(1) : null;
}
export function whatsappParty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const direct = /^([1-9]\d{6,14})(?::\d+)?@(?:c\.us|s\.whatsapp\.net)$/.exec(
    value,
  );
  return direct
    ? direct[1]
    : appointmentPhone(value.startsWith("+") ? value : "+" + value);
}
export interface BookingContactAuthorization {
  authorizationId: string;
  customerId: string;
  phoneHash: string;
  authorizedAt: string;
  source: "internal" | "public";
  recordedByUserId: string | null;
}
export function bookingContactAuthorization(
  customer: { id: string; phone: string | null },
  authorized: boolean,
  actorId: string | null,
  source: "internal" | "public",
  previous?: unknown,
): BookingContactAuthorization | null {
  if (!authorized) return null;
  const phone = appointmentPhone(customer.phone);
  if (!phone)
    throw new BadRequestException(
      "Per autorizzare WhatsApp indica un numero con prefisso internazionale, ad esempio +39.",
    );
  const phoneHash = automationHash(phone),
    old = previous as BookingContactAuthorization | null;
  if (
    old?.customerId === customer.id &&
    old.phoneHash === phoneHash &&
    old.authorizationId &&
    old.authorizedAt
  )
    return old;
  return {
    authorizationId: randomUUID(),
    customerId: customer.id,
    phoneHash,
    authorizedAt: new Date().toISOString(),
    source,
    recordedByUserId: actorId,
  };
}
export const automationPlanSelect = {
  id: true,
  tenantId: true,
  customerId: true,
  orderStatus: true,
  revision: true,
  automationContact: true,
  tenant: {
    select: { name: true, timezone: true, isActive: true, isSuspended: true },
  },
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      isActive: true,
    },
  },
  items: {
    select: {
      id: true,
      booking: {
        select: {
          id: true,
          customerId: true,
          startsAt: true,
          endsAt: true,
          status: true,
          serviceId: true,
          collaboratorId: true,
          roomId: true,
          locationId: true,
          sectorId: true,
          service: { select: { name: true } },
          collaborator: { select: { firstName: true, lastName: true } },
          sector: {
            select: { isActive: true, weeklyHours: true, closures: true },
          },
          location: {
            select: { isActive: true, weeklyHours: true, closures: true },
          },
        },
      },
    },
  },
} as const;
export async function currentAutomationPlan(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderId: string,
  now = new Date(),
  noticeTargets?: string[],
) {
  const order = await tx.sale.findFirst({
    where: { id: orderId, tenantId },
    select: automationPlanSelect,
  });
  if (
    !order?.customer ||
    !order.customer.isActive ||
    !order.tenant.isActive ||
    order.tenant.isSuspended ||
    order.orderStatus === "superseded" ||
    (!noticeTargets && order.orderStatus === "cancelled")
  )
    return null;
  const appointments = order.items
    .flatMap((line) =>
      line.booking &&
      [
        "requested",
        "confirmed",
        "rescheduled",
        ...(noticeTargets ? ["cancelled"] : []),
      ].includes(line.booking.status) &&
      (!noticeTargets || noticeTargets.includes(line.booking.id)) &&
      line.booking.startsAt > now
        ? [line.booking]
        : [],
    )
    .sort(
      (a, b) =>
        a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id),
    );
  if (
    !appointments.length ||
    (noticeTargets && appointments.length !== noticeTargets.length) ||
    appointments.some(
      (row) =>
        ![
          "draft",
          "requested",
          "confirmed",
          "rescheduled",
          ...(noticeTargets ? ["cancelled"] : []),
        ].includes(row.status) ||
        row.customerId !== order.customerId ||
        !row.sector.isActive ||
        !row.location.isActive,
    )
  )
    return null;
  const phone = appointmentPhone(order.customer.phone),
    contact =
      order.automationContact as unknown as BookingContactAuthorization | null;
  if (
    !phone ||
    !contact?.authorizationId ||
    !contact.authorizedAt ||
    contact.customerId !== order.customerId ||
    contact.phoneHash !== automationHash(phone)
  )
    return null;
  return {
    order,
    appointments,
    phone,
    authorizationId: contact.authorizationId,
    planHash: automationAppointmentHash(appointments),
    contactHash: automationHash([
      contact.authorizationId,
      contact.customerId,
      contact.phoneHash,
    ]),
  };
}
export type AutomationCalendarRow = {
  id: string;
  customerId: string;
  startsAt: Date | string;
  endsAt: Date | string;
  serviceId: string;
  collaboratorId: string | null;
  roomId: string | null;
  locationId: string;
  sectorId: string;
};
export function automationAppointmentHash(rows: AutomationCalendarRow[]) {
  return automationHash(
    [...rows]
      .sort(
        (a, b) =>
          new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
          a.id.localeCompare(b.id),
      )
      .map((row) => [
        row.id,
        row.customerId,
        new Date(row.startsAt).toISOString(),
        new Date(row.endsAt).toISOString(),
        row.serviceId,
        row.collaboratorId,
        row.roomId,
        row.locationId,
        row.sectorId,
      ]),
  );
}
/** Caller holds the operational tenant lock. Local stop and original-command withdrawals commit together. */
export async function stopAutomationRuns(
  tx: Prisma.TransactionClient,
  tenantId: string,
  ids: string[],
  status:
    | "confirmed"
    | "change_requested"
    | "cancelled"
    | "expired"
    | "superseded",
  reason: string,
) {
  if (!ids.length) return;
  await tx.appointmentAutomationRun.updateMany({
    where: { tenantId, id: { in: ids }, status: "waiting" },
    data: { status },
  });
  const deliveries = await tx.appointmentAutomationDelivery.findMany({
    where: { runId: { in: ids }, run: { tenantId } },
    select: { historyId: true },
  });
  await stopAutomationCommands(
    tx,
    tenantId,
    deliveries.map((row) => row.historyId),
    reason,
  );
}
export async function stopAutomationCommands(
  tx: Prisma.TransactionClient,
  tenantId: string,
  commands: string[],
  reason: string,
) {
  if (!commands.length) return;
  await tx.$executeRaw`UPDATE "NotificationAutomationCommand" SET "withdrawRequestedAt"=now(),"nextAttemptAt"=now(),"updatedAt"=now() WHERE "tenantId"=${tenantId} AND "commandId" IN (${Prisma.join(commands)}) AND "withdrawRequestedAt" IS NULL AND ("lastReceipt" IS NULL OR "lastReceipt"->>'state' NOT IN ('sent','failed','cancelled'))`;
  const untouched = await tx.notificationAutomationCommand.findMany({
    where: {
      tenantId,
      commandId: { in: commands },
      sendStartedAt: null,
      withdrawRequestedAt: { not: null },
    },
    select: { commandId: true },
  });
  await tx.notificationHistory.updateMany({
    where: {
      tenantId,
      id: { in: untouched.map((c) => c.commandId) },
      status: "pending",
    },
    data: { status: "skipped", error: reason },
  });
  await tx.appointmentAutomationDelivery.updateMany({
    where: { historyId: { in: commands } },
    data: { nextAttemptAt: new Date() },
  });
}
export async function automationRunIsCurrent(
  tx: Prisma.TransactionClient,
  run: AppointmentAutomationRun,
  now = new Date(),
) {
  const policy = await tx.appointmentAutomationPolicy.findUnique({
    where: { tenantId: run.tenantId },
  });
  if (
    !policy?.enabled ||
    policy.revision !== run.policyRevision ||
    policy.whatsappGrantId !== run.whatsappGrantId ||
    now >= run.expiresAt
  )
    return false;
  const ids = [
    run.whatsappGrantId,
    ...(run.actionGrantId ? [run.actionGrantId] : []),
  ];
  const authorities = await tx.$queryRaw<
    Array<{ id: string; status: string; expiresAt: Date }>
  >`SELECT id,status,(request->>'expiresAt')::timestamptz AS "expiresAt" FROM "NotificationAutomationGrant" WHERE "tenantId"=${run.tenantId} AND id IN (${Prisma.join(ids)}) FOR SHARE`;
  if (
    authorities.length !== ids.length ||
    authorities.some((g) => g.status !== "ready" || g.expiresAt <= now)
  )
    return false;
  const plan = await currentAutomationPlan(tx, run.tenantId, run.orderId, now);
  return (
    !!plan &&
    plan.planHash === run.planHash &&
    plan.contactHash === run.contactHash &&
    plan.appointments[0].startsAt > now
  );
}
export async function invalidateAutomationAccounts(
  tx: Prisma.TransactionClient,
  tenantId: string,
  orderIds: string[],
) {
  const runs = await tx.appointmentAutomationRun.findMany({
    where: { tenantId, orderId: { in: orderIds }, status: "waiting" },
  });
  for (const run of runs)
    if (!(await automationRunIsCurrent(tx, run)))
      await stopAutomationRuns(
        tx,
        tenantId,
        [run.id],
        "superseded",
        "Piano, recapito o policy superati",
      );
  if (orderIds.length) {
    const notices = await tx.$queryRaw<
      Array<{ historyId: string; noticeContext: AutomationNoticeContext }>
    >`SELECT d."historyId",d."noticeContext" FROM "AppointmentAutomationDelivery" d JOIN "NotificationHistory" h ON h.id=d."historyId" WHERE h."tenantId"=${tenantId} AND d."runId" IS NULL AND d."noticeContext"->>'orderId' IN (${Prisma.join(orderIds)}) AND h.status NOT IN ('sent','skipped','failed')`;
    for (const notice of notices)
      if (!(await currentAutomationNotice(tx, tenantId, notice.noticeContext)))
        await stopAutomationCommands(
          tx,
          tenantId,
          [notice.historyId],
          "Evento o recapito superato",
        );
  }
}

export type AutomationNoticeContext = {
  orderId: string;
  customerId: string;
  policyRevision: number;
  grantId: string;
  eventType: "appointment.confirmed" | "appointment.cancelled";
  targets: string[];
  planHash: string;
  contactHash: string;
  expiresAt: string;
  snapshot: {
    customer: { firstName: string; lastName: string };
    appointments: Array<{
      id: string;
      service: string;
      startsAt: string;
      endsAt: string;
    }>;
  };
};
export async function currentAutomationNotice(
  tx: Prisma.TransactionClient,
  tenantId: string,
  context: AutomationNoticeContext,
  now = new Date(),
) {
  const policy = await tx.appointmentAutomationPolicy.findUnique({
    where: { tenantId },
  });
  if (
    !policy?.enabled ||
    policy.revision !== context.policyRevision ||
    policy.whatsappGrantId !== context.grantId ||
    now >= new Date(context.expiresAt)
  )
    return null;
  const authorities = await tx.$queryRaw<
    Array<{ status: string; expiresAt: Date }>
  >`SELECT status,(request->>'expiresAt')::timestamptz AS "expiresAt" FROM "NotificationAutomationGrant" WHERE id=${context.grantId} AND "tenantId"=${tenantId} FOR SHARE`;
  if (
    authorities.length !== 1 ||
    authorities[0].status !== "ready" ||
    authorities[0].expiresAt <= now
  )
    return null;
  const plan = await currentAutomationPlan(
    tx,
    tenantId,
    context.orderId,
    now,
    context.targets,
  );
  const expected =
    context.eventType === "appointment.cancelled" ? "cancelled" : "confirmed";
  return plan &&
    plan.order.customerId === context.customerId &&
    plan.planHash === context.planHash &&
    plan.contactHash === context.contactHash &&
    plan.appointments.every((a) => a.status === expected)
    ? plan
    : null;
}
export async function stopAutomationNotices(
  tx: Prisma.TransactionClient,
  tenantId: string,
  reason: string,
  customerId?: string,
) {
  const deliveries = await tx.appointmentAutomationDelivery.findMany({
    where: {
      runId: null,
      history: {
        tenantId,
        ...(customerId ? { customerId } : {}),
        status: { notIn: ["sent", "skipped", "failed"] },
      },
    },
    select: { historyId: true },
  });
  await stopAutomationCommands(
    tx,
    tenantId,
    deliveries.map((d) => d.historyId),
    reason,
  );
}
