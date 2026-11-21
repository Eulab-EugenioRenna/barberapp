import { AutomationClock } from "../../common/automation-clock";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  lockOperationalTenant,
  setOperationalActor,
} from "../../common/operational-lock";
import { openConnect } from "../../common/connect-runtime";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import { OrderCommandService } from "../orders/order-command.service";
import {
  applyBookingCancellation,
  customerCancellationAllowed,
} from "../orders/booking-cancellation";
import { beginAppointmentEvents } from "./appointment-events";
import {
  automationHash,
  automationRunIsCurrent,
  currentAutomationPlan,
  stopAutomationRuns,
  whatsappParty,
} from "./appointment-automation-state";
import { NotificationAutomationGrantsService } from "./notification-automation-grants.service";

type ResponsePayload = {
  selectedButtonId: string;
  archiveId: string;
  chatId: string;
  senderId: string;
  recipientId: string;
  occurredAt: string;
  observedAt: string;
};
@Injectable()
export class AppointmentCustomerActions {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: NotificationAutomationGrantsService,
    private readonly commands: OrderCommandService,
    private readonly invalidation: CacheInvalidationService,
    private readonly clock: AutomationClock,
  ) {}
  async processOne(id: string) {
    const event =
      await this.prisma.notificationAutomationWebhookEvent.findUnique({
        where: { id },
      });
    if (!event || event.status !== "received" || !event.payloadCipher) return;
    let payload: ResponsePayload;
    try {
      payload = JSON.parse(openConnect(event.payloadCipher));
    } catch {
      await this.reject(id, "unreadable_action");
      return;
    }
    const action = await this.prisma.appointmentAutomationAction.findUnique({
      where: { tokenHash: automationHash(payload.selectedButtonId) },
      include: { run: true },
    });
    if (!action || action.run.tenantId !== event.tenantId) {
      await this.reject(id, "unknown_action");
      return;
    }
    const grant = action.run.actionGrantId
      ? await this.prisma.notificationAutomationGrant.findFirst({
          where: {
            id: action.run.actionGrantId,
            tenantId: event.tenantId,
            channel: "application_notification",
          },
        })
      : null;
    if (
      !grant ||
      !(await this.grants.verifyForWorker(grant.id)).allowed ||
      !(await this.grants.verifyForWorker(action.run.whatsappGrantId)).allowed
    ) {
      await this.reject(id, "customer_command_authorization_denied");
      return;
    }
    const result = await this.prisma.$transaction(
      async (tx) => {
        await lockOperationalTenant(tx, event.tenantId);
        const [receipt] = await tx.$queryRaw<
          Array<{ status: string }>
        >`SELECT status FROM "NotificationAutomationWebhookEvent" WHERE id=${id} FOR UPDATE`;
        if (!receipt || receipt.status !== "received") return null;
        const run = await tx.appointmentAutomationRun.findUniqueOrThrow({
            where: { id: action.runId },
          }),
          now = this.clock.now();
        const reject = async (reason: string) => {
          await tx.notificationAutomationWebhookEvent.update({
            where: { id },
            data: { status: "rejected", reason, processedAt: now },
          });
          return null;
        };
        if (run.status !== "waiting" || run.respondedAt)
          return reject("action_already_closed");
        if (!(await automationRunIsCurrent(tx, run, now)))
          return reject("stale_plan_policy_contact_or_deadline");
        if (
          payload.archiveId !== run.archiveId ||
          whatsappParty(payload.senderId) !==
            openConnect(run.recipientCipher) ||
          whatsappParty(payload.chatId) !== openConnect(run.recipientCipher) ||
          whatsappParty(payload.recipientId) !== run.businessNumber
        )
          return reject("recipient_or_archive_mismatch");
        const occurred = Date.parse(payload.occurredAt),
          observed = Date.parse(payload.observedAt);
        if (
          !Number.isFinite(occurred) ||
          !Number.isFinite(observed) ||
          occurred < run.createdAt.getTime() - 5000 ||
          occurred > run.expiresAt.getTime() ||
          observed < occurred - 5000
        )
          return reject("action_timestamp_invalid");
        const attempts = await tx.notificationAutomationCommand.findMany({
          where: {
            tenantId: run.tenantId,
            commandId: {
              in: (
                await tx.appointmentAutomationDelivery.findMany({
                  where: { runId: run.id },
                  select: { historyId: true },
                })
              ).map((d) => d.historyId),
            },
            sendStartedAt: { not: null },
          },
          select: { sendStartedAt: true },
        });
        if (
          !attempts.some((a) => a.sendStartedAt!.getTime() <= occurred + 5000)
        )
          return reject("reply_before_any_message_attempt");
        const plan = await currentAutomationPlan(
          tx,
          run.tenantId,
          run.orderId,
          now,
        );
        if (!plan) return reject("booking_not_actionable");
        const cancellation =
          action.kind === "cancel" &&
          customerCancellationAllowed(plan.appointments[0].startsAt, now);
        const kind =
          action.kind === "confirm"
            ? "confirm_booking"
            : cancellation
              ? "cancel_booking"
              : "request_booking_change";
        const context = {
          tenantId: run.tenantId,
          actorId: null,
          source: "customer" as const,
          customerId: run.customerId,
        };
        const command = this.commands.command(
          context,
          kind,
          "alora-response-" + run.id,
          { runId: run.id, action: action.kind, planHash: run.planHash },
        );
        await setOperationalActor(tx, null, "customer");
        const record = await beginAppointmentEvents(
          tx,
          { ...context, automationRunId: run.id },
          { orderItem: { saleId: run.orderId } },
        );
        const status: "confirmed" | "cancelled" | "change_requested" =
          action.kind === "confirm"
            ? "confirmed"
            : cancellation
              ? "cancelled"
              : "change_requested";
        if (action.kind === "confirm") {
          const changed = await tx.appointment.updateMany({
            where: {
              tenantId: run.tenantId,
              id: { in: plan.appointments.map((a) => a.id) },
              status: { in: ["draft", "requested", "rescheduled"] },
            },
            data: { status: "confirmed", updatedById: null },
          });
          if (changed.count)
            await tx.sale.update({
              where: { id: run.orderId },
              data: { revision: { increment: 1 } },
            });
        } else if (cancellation) {
          const everyBooked = plan.order.items.every(
            (line) =>
              line.booking &&
              plan.appointments.some((a) => a.id === line.booking!.id),
          );
          await applyBookingCancellation(tx, {
            orderId: run.orderId,
            appointmentIds: plan.appointments.map((a) => a.id),
            allStopped: everyBooked,
            actorId: null,
            cancelledByType: "customer",
            cancelledById: run.customerId,
            reason: "Annullamento richiesto tramite azione WhatsApp verificata",
            policyResult: "allowed_until_24h_before",
          });
        }
        const operation = await this.commands.save(tx, command, run.orderId, {
          orderId: run.orderId,
          status,
          action: action.kind,
          refund: "not_requested",
          stockReturn: "not_requested",
        });
        // Close response and stop all remaining commands in the same domain transaction.
        await tx.appointmentAutomationRun.update({
          where: { id: run.id },
          data: {
            status,
            responseAction: action.kind,
            responseEventId: event.eventId,
            respondedAt: now,
          },
        });
        await stopAutomationRuns(
          tx,
          run.tenantId,
          [run.id],
          status,
          "Risposta cliente ricevuta",
        );
        await record({ orderItem: { saleId: run.orderId } }, operation.id);
        await tx.auditLog.create({
          data: {
            tenantId: run.tenantId,
            actorRole: "customer",
            action: "appointment.customer." + action.kind,
            entityType: "Sale",
            entityId: run.orderId,
          },
        });
        await tx.notificationAutomationWebhookEvent.update({
          where: { id },
          data: { status: "processed", reason: status, processedAt: now },
        });
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        return run.tenantId;
      },
      { timeout: 15000 },
    );
    if (result) await this.invalidation.invalidateBookingReadModels(result);
  }
  private async reject(id: string, reason: string) {
    await this.prisma.notificationAutomationWebhookEvent.updateMany({
      where: { id, status: "received" },
      data: { status: "rejected", reason, processedAt: new Date() },
    });
  }
}
