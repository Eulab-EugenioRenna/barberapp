import {
  Body,
  BadRequestException,
  Query,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { AutomationNoticeContext } from "./appointment-automation-state";
import { PrismaService } from "../../prisma/prisma.service";
import {
  requireTenantId,
  requireUser,
  resolveRequestSession,
} from "../../common/request-session";
import {
  resolveOperationalScope,
  type ScopeHeaders,
} from "../locations/operational-scope";

@Controller("notifications/appointment-automations")
export class AppointmentAutomationMonitorController {
  constructor(private readonly prisma: PrismaService) {}
  private async session(req: { headers: ScopeHeaders }) {
    const session = await resolveRequestSession(
        this.prisma,
        req.headers.authorization,
      ),
      tenantId = requireTenantId(session),
      scope = await resolveOperationalScope(this.prisma, session, req.headers);
    if (
      scope.allowedSectorIds.length !==
      (await this.prisma.sector.count({ where: { tenantId } }))
    )
      throw new ForbiddenException(
        "Il monitor è condiviso dall’attività: occorre accesso a tutti i settori",
      );
    return { session, tenantId };
  }
  @Get() async list(
    @Req() req: { headers: ScopeHeaders },
    @Query("view") view?: string,
  ) {
    const { tenantId } = await this.session(req);
    if (view && !["recent", "open_requests"].includes(view))
      throw new BadRequestException("Vista delle richieste non valida");
    const openRequests = view === "open_requests";
    const runs = await this.prisma.appointmentAutomationRun.findMany({
      where: {
        tenantId,
        ...(openRequests
          ? { status: "change_requested", reviewedAt: null }
          : {}),
      },
      orderBy: openRequests
        ? [{ createdAt: "asc" }, { id: "asc" }]
        : [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      include: {
        deliveries: {
          include: {
            history: {
              select: { id: true, status: true, error: true, sentAt: true },
            },
          },
          orderBy: { sequence: "asc" },
        },
      },
    });
    const commands = await this.prisma.notificationAutomationCommand.findMany({
      where: {
        tenantId,
        commandId: {
          in: runs.flatMap((r) => r.deliveries.map((d) => d.historyId)),
        },
      },
      select: {
        commandId: true,
        lastReceipt: true,
        withdrawOutcome: true,
        withdrawRequestedAt: true,
      },
    });
    const plans = runs.map((run) => ({
      kind: "reminder_plan",
      id: run.id,
      orderId: run.orderId,
      appointmentId: run.anchorAppointmentId,
      status: run.status,
      startsAt: run.startsAt,
      expiresAt: run.expiresAt,
      responseAction: run.responseAction,
      respondedAt: run.respondedAt,
      reviewedAt: run.reviewedAt,
      updatedAt: run.updatedAt,
      staffNoticeReason: run.staffNoticeReason,
      plan: run.snapshot,
      deliveries: run.deliveries.map((d) => {
        const command = commands.find((c) => c.commandId === d.historyId),
          receipt = command?.lastReceipt as Record<string, unknown> | null;
        return {
          sequence: d.sequence,
          dueAt: d.dueAt,
          status: d.history.status,
          reason: d.history.error,
          providerState: receipt?.["state"] || null,
          withdrawOutcome: command?.withdrawOutcome || null,
          withdrawRequested: !!command?.withdrawRequestedAt,
        };
      }),
    }));
    if (openRequests) return plans;
    const notices = await this.prisma.appointmentAutomationDelivery.findMany({
      where: { runId: null, history: { tenantId } },
      include: {
        history: {
          select: { id: true, status: true, error: true, createdAt: true },
        },
      },
      orderBy: { history: { createdAt: "desc" } },
      take: 50,
    });
    const receipts = await this.prisma.notificationAutomationCommand.findMany({
      where: { tenantId, commandId: { in: notices.map((d) => d.historyId) } },
      select: {
        commandId: true,
        lastReceipt: true,
        withdrawOutcome: true,
        withdrawRequestedAt: true,
      },
    });
    const noticeViews = notices.map((d) => {
      const context = d.noticeContext as unknown as AutomationNoticeContext,
        command = receipts.find((c) => c.commandId === d.historyId),
        receipt = command?.lastReceipt as Record<string, unknown> | null;
      return {
        kind: "event_notice",
        eventType: context.eventType,
        id: d.historyId,
        orderId: context.orderId,
        appointmentId: context.targets[0],
        status: d.history.status,
        startsAt: context.snapshot.appointments[0].startsAt,
        expiresAt: context.expiresAt,
        responseAction: null,
        respondedAt: null,
        reviewedAt: null,
        updatedAt: d.history.createdAt,
        staffNoticeReason: null,
        plan: context.snapshot,
        deliveries: [
          {
            sequence: 0,
            dueAt: d.dueAt,
            status: d.history.status,
            reason: d.history.error,
            providerState: receipt?.["state"] || null,
            withdrawOutcome: command?.withdrawOutcome || null,
            withdrawRequested: !!command?.withdrawRequestedAt,
          },
        ],
      };
    });
    return [...plans, ...noticeViews]
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .slice(0, 50);
  }
  @Post(":id/review") async review(
    @Req() req: { headers: ScopeHeaders },
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { session, tenantId } = await this.session(req);
    if (
      !body ||
      Object.keys(body).some((k) => k !== "expectedUpdatedAt") ||
      typeof body["expectedUpdatedAt"] !== "string" ||
      !Number.isFinite(Date.parse(body["expectedUpdatedAt"]))
    )
      throw new ConflictException(
        "Ricarica la richiesta corrente prima di segnarla gestita",
      );
    const result = await this.prisma.appointmentAutomationRun.updateMany({
      where: {
        id,
        tenantId,
        status: "change_requested",
        reviewedAt: null,
        updatedAt: new Date(body["expectedUpdatedAt"]),
      },
      data: {
        reviewedAt: new Date(),
        reviewedByUserId: requireUser(session).id,
      },
    });
    if (!result.count)
      throw new ConflictException("La richiesta è cambiata o è già gestita");
    return { reviewed: true, calendarChanged: false };
  }
}
