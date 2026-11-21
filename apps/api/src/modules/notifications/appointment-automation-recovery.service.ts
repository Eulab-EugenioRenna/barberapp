import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AutomationClock } from "../../common/automation-clock";
import { lockOperationalTenant } from "../../common/operational-lock";
import {
  automationRunIsCurrent,
  stopAutomationRuns,
} from "./appointment-automation-state";
import { AppointmentCustomerActions } from "./appointment-customer-actions.service";
import { AppointmentAutomationStaffNotices } from "./appointment-automation-staff.service";

/** Called by the existing outbox poll. PostgreSQL remains the source for deadlines and callbacks. */
@Injectable()
export class AppointmentAutomationRecovery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: AutomationClock,
    private readonly actions: AppointmentCustomerActions,
    private readonly staff: AppointmentAutomationStaffNotices,
  ) {}
  async recover() {
    const events =
      await this.prisma.notificationAutomationWebhookEvent.findMany({
        where: { status: "received", nextAttemptAt: { lte: new Date() } },
        orderBy: { receivedAt: "asc" },
        take: 20,
        select: { id: true },
      });
    for (const event of events) {
      try {
        await this.actions.processOne(event.id);
      } catch {
        await this.prisma.notificationAutomationWebhookEvent.updateMany({
          where: { id: event.id, status: "received" },
          data: { nextAttemptAt: new Date(Date.now() + 30000) },
        });
      }
    }
    const runs = await this.prisma.appointmentAutomationRun.findMany({
      where: { status: "waiting" },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: 200,
    });
    for (const candidate of runs)
      await this.prisma.$transaction(async (tx) => {
        await lockOperationalTenant(tx, candidate.tenantId);
        const run = await tx.appointmentAutomationRun.findUniqueOrThrow({
            where: { id: candidate.id },
          }),
          now = this.clock.now();
        if (run.status !== "waiting") return;
        if (now >= run.expiresAt)
          await stopAutomationRuns(
            tx,
            run.tenantId,
            [run.id],
            "expired",
            "Scadenza della risposta raggiunta; prenotazione mantenuta",
          );
        else if (!(await automationRunIsCurrent(tx, run, now)))
          await stopAutomationRuns(
            tx,
            run.tenantId,
            [run.id],
            "superseded",
            "Piano, consenso o policy cambiati",
          );
      });
    const notices = await this.prisma.appointmentAutomationRun.findMany({
      where: {
        status: { in: ["change_requested", "expired"] },
        staffNoticeAt: null,
      },
      orderBy: { updatedAt: "asc" },
      take: 20,
      select: { id: true },
    });
    for (const notice of notices) {
      try {
        await this.staff.notify(notice.id);
      } catch {
        /* The next bounded poll retries the same transactional notice identity. */
      }
    }
  }
}
