import { AutomationClock } from "../../common/automation-clock";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { lockOperationalTenant } from "../../common/operational-lock";
import { NotificationAutomationGrantsService } from "./notification-automation-grants.service";
import { NotificationAutomationCommandStore } from "./notification-automation-command-store.service";
import {
  automationRunIsCurrent,
  currentAutomationNotice,
  AutomationNoticeContext,
  stopAutomationCommands,
  currentAutomationPlan,
  stopAutomationRuns,
} from "./appointment-automation-state";
import { automationIsOpen } from "./appointment-automation-messages";
import { validateAutomationSettings } from "./appointment-automation-policy.service";
import type { NotificationsService } from "./notifications.service";
import type { DelegatedMessageStatus } from "@eulab/connect/server";
import type { NotificationHistory } from "@prisma/client";

@Injectable()
export class AppointmentAutomationDispatch {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: NotificationAutomationGrantsService,
    private readonly commands: NotificationAutomationCommandStore,
    private readonly clock: AutomationClock,
  ) {}
  async authorizeHistory(history: NotificationHistory) {
    const metadata = history.metadata as Record<string, unknown> | null,
      id = metadata?.["automationAuthorityGrantId"];
    if (typeof id !== "string") return true;
    const policy = await this.prisma.appointmentAutomationPolicy.findUnique({
      where: { tenantId: history.tenantId },
    });
    const grant = await this.prisma.notificationAutomationGrant.findFirst({
      where: {
        id,
        tenantId: history.tenantId,
        channel:
          history.channel === "in_app"
            ? "application_notification"
            : history.channel,
      },
    });
    return (
      !!policy?.enabled &&
      policy.revision === metadata?.["automationPolicyRevision"] &&
      !!grant &&
      (grant.request as Record<string, unknown>)["purpose"] ===
        "appointments.automation" &&
      (await this.grants.verifyForWorker(id)).allowed
    );
  }
  async dispatchIfKnown(
    id: string,
    notifications: Pick<NotificationsService, "claimHistory" | "finishHistory">,
  ): Promise<boolean> {
    const delivery = await this.prisma.appointmentAutomationDelivery.findUnique(
      { where: { historyId: id }, include: { run: true, history: true } },
    );
    if (!delivery) return false;
    const now = this.clock.now(),
      history = delivery.history,
      run = delivery.run;
    if (
      ["sent", "skipped", "failed"].includes(history.status) ||
      delivery.dueAt > now ||
      delivery.nextAttemptAt > now
    )
      return true;
    if (
      history.status === "dispatching" &&
      history.dispatchLeaseUntil &&
      history.dispatchLeaseUntil > now
    )
      return true;
    const tenantId = history.tenantId;
    const original = run ? null : await this.commands.find(tenantId, id);
    const grantId = run?.whatsappGrantId || original?.grantId;
    if (!grantId) return true;
    const waAllowed = (await this.grants.verifyForWorker(grantId)).allowed;
    const actionAllowed =
      !run?.actionGrantId ||
      (await this.grants.verifyForWorker(run.actionGrantId)).allowed;
    const actionable = await this.prisma.$transaction(async (tx) => {
      await lockOperationalTenant(tx, tenantId);
      if (!run) {
        const context =
          delivery.noticeContext as unknown as AutomationNoticeContext;
        const plan =
          waAllowed && context
            ? await currentAutomationNotice(tx, tenantId, context, now)
            : null;
        let valid = !!plan && now < delivery.validUntil;
        if (valid && plan) {
          const policy = await tx.appointmentAutomationPolicy.findUniqueOrThrow(
              { where: { tenantId } },
            ),
            settings = validateAutomationSettings(policy.settings);
          const holidays = (
            await tx.tenantHoliday.findMany({
              where: {
                tenantId,
                date: {
                  gte: new Date(now.getTime() - 86400000),
                  lte: new Date(now.getTime() + 86400000),
                },
              },
              select: { date: true },
            })
          ).map((h) => h.date.toISOString().slice(0, 10));
          valid = automationIsOpen(plan, settings, now, holidays);
        }
        if (!valid)
          await stopAutomationCommands(
            tx,
            tenantId,
            [id],
            "Avviso superato, non autorizzato o fuori apertura",
          );
        return valid;
      }
      const current = await tx.appointmentAutomationRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      let valid =
        current.status === "waiting" &&
        (await automationRunIsCurrent(tx, current, now)) &&
        waAllowed &&
        actionAllowed;
      const plan = valid
        ? await currentAutomationPlan(tx, tenantId, run.orderId, now)
        : null;
      if (valid && plan) {
        const policy = await tx.appointmentAutomationPolicy.findUniqueOrThrow({
            where: { tenantId: tenantId },
          }),
          settings = validateAutomationSettings(policy.settings);
        const holidays = (
          await tx.tenantHoliday.findMany({
            where: {
              tenantId: tenantId,
              date: {
                gte: new Date(now.getTime() - 86400000),
                lte: new Date(now.getTime() + 86400000),
              },
            },
            select: { date: true },
          })
        ).map((h) => h.date.toISOString().slice(0, 10));
        const inWindow =
          now < delivery.validUntil &&
          automationIsOpen(plan, settings, now, holidays);
        const newer = await tx.appointmentAutomationDelivery.count({
          where: {
            runId: run.id,
            sequence: { gt: delivery.sequence },
            dueAt: { lte: now },
            validUntil: { gt: now },
            history: { status: { notIn: ["skipped", "failed"] } },
          },
        });
        const command = await this.commands.find(tenantId, id);
        if (newer || !inWindow) {
          await tx.notificationAutomationCommand.updateMany({
            where: {
              tenantId: tenantId,
              commandId: id,
              withdrawRequestedAt: null,
            },
            data: { withdrawRequestedAt: now, nextAttemptAt: now },
          });
          await tx.notificationHistory.updateMany({
            where: { id, status: "pending" },
            data: {
              status: "skipped",
              error: newer
                ? "Promemoria precedente superato da uno più recente"
                : "Finestra di invio superata o chiusa",
            },
          });
          return false;
        }
        if (!command?.sendStartedAt) {
          const priorIds = (
            await tx.appointmentAutomationDelivery.findMany({
              where: { runId: run.id, sequence: { lt: delivery.sequence } },
              select: { historyId: true },
            })
          ).map((d) => d.historyId);
          const previous = await tx.notificationAutomationCommand.findFirst({
            where: {
              tenantId: tenantId,
              commandId: { in: priorIds },
              sendStartedAt: { not: null },
            },
            orderBy: { sendStartedAt: "desc" },
            select: { sendStartedAt: true },
          });
          if (
            previous?.sendStartedAt &&
            now.getTime() - previous.sendStartedAt.getTime() <
              settings.repeatIntervalMinutes * 60000
          ) {
            await tx.appointmentAutomationDelivery.update({
              where: { historyId: id },
              data: {
                nextAttemptAt: new Date(
                  previous.sendStartedAt.getTime() +
                    settings.repeatIntervalMinutes * 60000,
                ),
              },
            });
            return false;
          }
        }
      }
      if (!valid)
        await stopAutomationRuns(
          tx,
          tenantId,
          [run.id],
          "superseded",
          "Piano, consenso, orario o autorizzazione non più validi",
        );
      return valid;
    });
    const command = await this.commands.find(tenantId, id);
    if (!command) return true; // A missing original is never reconstructed with a new payload/key.
    let token = history.dispatchToken;
    if (actionable && history.status === "pending") {
      const claimed = await notifications.claimHistory(id);
      if (!claimed?.dispatchToken) return true;
      token = claimed.dispatchToken;
    }
    if (!actionable && !command.sendStartedAt) return true; // Local stop already closed the never-attempted history.
    if (!token) return true;
    try {
      let receipt: DelegatedMessageStatus;
      if (!actionable || command.withdrawRequestedAt)
        receipt = (
          await this.grants.withdrawForWorker(
            grantId,
            id,
            this.commands.payload(command),
          )
        ).message;
      else
        receipt = await this.grants.sendForWorker(
          grantId,
          id,
          this.commands.payload(command),
        );
      const status =
        receipt.state === "sent"
          ? "sent"
          : receipt.state === "cancelled"
            ? "skipped"
            : receipt.state === "failed"
              ? "failed"
              : receipt.state === "uncertain"
                ? "uncertain"
                : "queued";
      await notifications.finishHistory(id, token, {
        status,
        providerMessageId: receipt.id,
        reason:
          status === "uncertain"
            ? "Esito provider da verificare, nessun reinvio automatico"
            : status === "skipped"
              ? "Comando fermato prima dell’effetto"
              : undefined,
      });
    } catch {
      await notifications.finishHistory(id, token, {
        status: "uncertain",
        reason: "Ricevuta Connect da riconciliare con il comando originale",
      });
    } finally {
      await this.prisma.appointmentAutomationDelivery.update({
        where: { historyId: id },
        data: { nextAttemptAt: new Date(this.clock.now().getTime() + 30000) },
      });
    }
    return true;
  }
}
