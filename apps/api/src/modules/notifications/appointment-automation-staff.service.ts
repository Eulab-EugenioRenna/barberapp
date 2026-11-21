import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { lockOperationalTenant } from "../../common/operational-lock";
import { canUseLocalFunction } from "../../common/function-catalog";
import { NotificationAutomationGrantsService } from "./notification-automation-grants.service";

@Injectable()
export class AppointmentAutomationStaffNotices {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: NotificationAutomationGrantsService,
  ) {}
  async notify(id: string) {
    const run = await this.prisma.appointmentAutomationRun.findUnique({
      where: { id },
    });
    if (
      !run ||
      run.staffNoticeAt ||
      !["change_requested", "expired"].includes(run.status)
    )
      return;
    const snapshot = run.snapshot as Record<string, unknown>;
    if (
      run.status === "expired" &&
      (!snapshot["requestResponse"] ||
        snapshot["noResponseAction"] !== "notify_staff")
    ) {
      await this.prisma.appointmentAutomationRun.updateMany({
        where: { id, staffNoticeAt: null },
        data: {
          staffNoticeAt: new Date(),
          staffNoticeReason: "booking_kept_without_notice",
        },
      });
      return;
    }
    if (!run.staffGrantId) {
      await this.prisma.appointmentAutomationRun.updateMany({
        where: { id, staffNoticeAt: null },
        data: {
          staffNoticeAt: new Date(),
          staffNoticeReason: "visible_in_monitor_no_notification_grant",
        },
      });
      return;
    }
    const grant = await this.prisma.notificationAutomationGrant.findFirst({
      where: {
        id: run.staffGrantId,
        tenantId: run.tenantId,
        channel: "application_notification",
      },
    });
    if (!grant || !(await this.grants.verifyForWorker(grant.id)).allowed)
      return; // No inbox effect until the separate notification authority permits it.
    await this.prisma.$transaction(async (tx) => {
      await lockOperationalTenant(tx, run.tenantId);
      const current = await tx.appointmentAutomationRun.findUniqueOrThrow({
        where: { id },
      });
      if (current.staffNoticeAt) return;
      const policy = await tx.appointmentAutomationPolicy.findUnique({
        where: { tenantId: run.tenantId },
      });
      if (!policy?.enabled || policy.revision !== run.policyRevision) {
        await tx.appointmentAutomationRun.update({
          where: { id },
          data: {
            staffNoticeAt: new Date(),
            staffNoticeReason: "automation_policy_no_longer_active",
          },
        });
        return;
      }
      const provider = await tx.notificationProviderConfig.findUnique({
        where: {
          tenantId_channel: { tenantId: run.tenantId, channel: "in_app" },
        },
        select: { enabled: true, providerKey: true },
      });
      if (
        provider &&
        (!provider.enabled || provider.providerKey !== "in_app.native")
      )
        return;
      const appointments = (snapshot["appointments"] || []) as Array<{
        id: string;
        sectorId: string;
        startsAt: string;
      }>;
      const sectors = [...new Set(appointments.map((a) => a.sectorId))];
      const eventType =
        run.status === "expired"
          ? "appointment.response_missing"
          : "appointment.customer_change_requested";
      const title =
        run.status === "expired"
          ? "Risposta cliente non pervenuta"
          : run.responseAction === "cancel"
            ? "Richiesta di annullamento da verificare"
            : "Cliente chiede una modifica";
      const message =
        run.status === "expired"
          ? "La prenotazione resta valida. Non è pervenuta una risposta verificata: controlla anche lo stato degli invii."
          : run.responseAction === "cancel"
            ? "Richiesta di annullamento oltre il termine automatico di 24 ore. Prenotazione e importi restano invariati finché lo staff non decide."
            : "Il cliente chiede una modifica. L’agenda resta invariata: contattalo e riprogramma dal conto.";
      const payload = {
        tenantId: run.tenantId,
        eventType,
        entityType: "appointment",
        entityId: run.anchorAppointmentId,
        appointment: appointments[0] || { id: run.anchorAppointmentId },
        customer: snapshot["customer"],
        eventData: {
          orderId: run.orderId,
          automationRunId: run.id,
          accountAppointments: appointments,
        },
      } as Prisma.InputJsonObject;
      const event = await tx.notificationDomainEvent.create({
        data: {
          tenantId: run.tenantId,
          eventKey: "automation-staff:" + run.id,
          eventType,
          entityType: "appointment",
          entityId: run.anchorAppointmentId,
          payload,
        },
      });
      const recipients = await tx.user.findMany({
        where: {
          tenantId: run.tenantId,
          isActive: true,
          role: { in: ["owner", "manager", "reception"] },
        },
        include: { sectorAccess: true },
      });
      let count = 0;
      for (const user of recipients) {
        if (
          !canUseLocalFunction(user, "notifications.read") ||
          (user.role !== "owner" &&
            !sectors.every((sector) =>
              user.sectorAccess.some((access) => access.sectorId === sector),
            ))
        )
          continue;
        const personal = await tx.notificationPreferenceUser.findUnique({
          where: {
            tenantId_userId_eventType_channel: {
              tenantId: run.tenantId,
              userId: user.id,
              eventType,
              channel: "in_app",
            },
          },
        });
        if (personal && !personal.enabled) continue;
        const inbox = await tx.notificationInbox.create({
          data: {
            tenantId: run.tenantId,
            recipientUserId: user.id,
            eventType,
            title,
            message,
            payload,
            entityType: "appointment",
            entityId: run.anchorAppointmentId,
          },
        });
        await tx.notificationHistory.create({
          data: {
            tenantId: run.tenantId,
            domainEventId: event.id,
            dispatchKey: "staff:" + user.id,
            recipientUserId: user.id,
            recipientType: "user",
            channel: "in_app",
            providerKey: "in_app.native",
            eventType,
            payload,
            notificationInboxId: inbox.id,
            status: "sent",
            sentAt: new Date(),
            providerMessageId: "in-app:" + inbox.id,
            metadata: { automationRunId: run.id, authorityGrantId: grant.id },
          },
        });
        count++;
      }
      await tx.notificationDomainEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
      await tx.appointmentAutomationRun.update({
        where: { id },
        data: {
          staffNoticeAt: new Date(),
          staffNoticeReason: count
            ? "native_inbox_created"
            : "no_current_authorized_recipient",
        },
      });
    });
  }
}
