import { resolveOperationalScope } from "../locations/operational-scope";
import { authorizeLocalOperation } from "../../common/local-policy.guard";
import {
  Body,
  BadRequestException,
  ForbiddenException,
  Controller,
  Get,
  MessageEvent,
  Param,
  Patch,
  Post,
  Req,
  Sse,
} from "@nestjs/common";
import { NotificationChannel } from "@prisma/client";
import { Observable, exhaustMap, map, timer } from "rxjs";
import { PrismaService } from "../../prisma/prisma.service";
import {
  requireTenantId,
  requireUser,
  resolveRequestSession,
} from "../../common/request-session";
import { NotificationsEventsService } from "./notifications.events.service";
import { NotificationsService } from "./notifications.service";
import { NotificationFlags } from "./notifications.types";

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsEventsService: NotificationsEventsService,
  ) {}

  private async readScope(
    session: import("../../common/request-session").RequestSession,
    request: { headers: { authorization?: string } },
  ) {
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const total = await this.prisma.sector.count({
      where: { tenantId: requireTenantId(session) },
    });
    return {
      sectorIds: scope.sectorIds,
      fullAccess: scope.sectorIds.length === total,
    };
  }

  private async requireTemplateScope(
    session: import("../../common/request-session").RequestSession,
    request: { headers: { authorization?: string } },
  ) {
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    const total = await this.prisma.sector.count({
      where: { tenantId: requireTenantId(session) },
    });
    if (scope.allowedSectorIds.length !== total)
      throw new ForbiddenException(
        "I template sono condivisi dall’attività: occorre accesso a tutti i settori",
      );
  }

  @Sse("stream")
  stream(
    @Req() request: { headers: { authorization?: string } },
  ): Observable<MessageEvent> {
    return timer(0, 15_000).pipe(
      exhaustMap(async () => {
        const session = await resolveRequestSession(
          this.prisma,
          request.headers.authorization,
        );
        authorizeLocalOperation(session, "NotificationsController", "stream");
        const tenantId = requireTenantId(session);
        const scope = await resolveOperationalScope(
          this.prisma,
          session,
          request.headers,
        );
        const now = new Date();
        const appointments =
          await this.notificationsService.listAppointmentsAwaitingOrder(
            tenantId,
            now,
            scope.sectorIds,
          );
        return { appointments, now };
      }),
      map(({ appointments, now }) => ({
        type: "appointment.awaiting_order",
        data: {
          appointments,
          generatedAt: now.toISOString(),
        },
      })),
    );
  }

  @Get("preferences")
  async preferences(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const user = requireUser(session);

    return this.notificationsService.listPreferences(tenantId, user.id);
  }

  @Patch("preferences/tenant")
  async updateTenantPreferences(
    @Req() request: { headers: { authorization?: string } },
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    return this.notificationsService.updateTenantPreferences(
      requireTenantId(session),
      body,
    );
  }

  @Patch("preferences/me")
  async updateMyPreferences(
    @Req() request: { headers: { authorization?: string } },
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const user = requireUser(session);

    return this.notificationsService.updateUserPreferences(
      tenantId,
      user.id,
      body,
    );
  }

  @Get("providers")
  async providers(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    return this.notificationsService.listProviders(requireTenantId(session));
  }

  @Patch("providers/:channel")
  async updateProvider(
    @Req() request: { headers: { authorization?: string } },
    @Param("channel") channel: NotificationChannel,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    if (
      channel === NotificationChannel.webhook &&
      !(await this.readScope(session, request)).fullAccess
    )
      throw new ForbiddenException(
        "Il webhook è condiviso dall’attività: occorre accesso a tutti i settori",
      );

    return this.notificationsService.upsertProvider(
      requireTenantId(session),
      channel,
      body,
    );
  }

  @Post("providers/:channel/test")
  async testProvider(
    @Req() request: { headers: { authorization?: string } },
    @Param("channel") channel: NotificationChannel,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);

    return this.notificationsEventsService.emit({
      eventType: `notifications.test.${channel}`,
      tenantId,
      entityType: "notification_provider",
      entityId: channel,
      eventData: body,
    });
  }

  @Get("templates")
  async templates(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    await this.requireTemplateScope(session, request);
    return this.notificationsService.listTemplates(requireTenantId(session));
  }

  @Post("templates/:eventType/:channel/preview")
  async previewTemplate(
    @Req() request: { headers: { authorization?: string } },
    @Param("eventType") eventType: string,
    @Param("channel") channel: NotificationChannel,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    await this.requireTemplateScope(session, request);
    return this.notificationsService.previewTemplate(eventType, channel, body);
  }

  @Patch("templates/:eventType/:channel")
  async updateTemplate(
    @Req() request: { headers: { authorization?: string } },
    @Param("eventType") eventType: string,
    @Param("channel") channel: NotificationChannel,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    await this.requireTemplateScope(session, request);
    return this.notificationsService.updateTemplate(
      requireTenantId(session),
      eventType,
      channel,
      body,
    );
  }

  @Get("inbox")
  async inbox(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const user = requireUser(session);

    return this.notificationsService.listInbox(
      tenantId,
      user.id,
      await this.readScope(session, request),
    );
  }

  @Get("inbox/unread-count")
  async unreadCount(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const user = requireUser(session);

    return this.notificationsService.unreadCount(
      tenantId,
      user.id,
      await this.readScope(session, request),
    );
  }

  @Patch("inbox/:id/read")
  async markRead(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const user = requireUser(session);

    return this.notificationsService.markInboxAsRead(tenantId, user.id, id);
  }

  @Patch("inbox/read-all")
  async markAllRead(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const user = requireUser(session);

    return this.notificationsService.markAllInboxAsRead(tenantId, user.id);
  }

  @Get("history")
  async history(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    return this.notificationsService.listHistory(
      requireTenantId(session),
      await this.readScope(session, request),
    );
  }

  @Post("events")
  async emitEvent(
    @Req() request: { headers: { authorization?: string } },
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    if (
      typeof body["eventType"] === "string" &&
      body["eventType"].startsWith("appointment.")
    )
      throw new BadRequestException(
        "Le notifiche di appuntamento si generano dall’operazione in agenda",
      );
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const user = requireUser(session);

    const scope = await this.readScope(session, request);
    if (
      body["entityType"] === "appointment" &&
      typeof body["entityId"] === "string"
    ) {
      if (
        !(await this.prisma.appointment.count({
          where: {
            id: body["entityId"],
            tenantId,
            sectorId: { in: scope.sectorIds },
          },
        }))
      )
        throw new ForbiddenException("Evento fuori sede o settore autorizzati");
    } else if (!scope.fullAccess)
      throw new ForbiddenException(
        "Evento aziendale: occorre accesso a tutti i settori",
      );

    return this.notificationsEventsService.emit({
      eventType: String(body["eventType"] ?? ""),
      tenantId,
      entityType:
        typeof body["entityType"] === "string" ? body["entityType"] : undefined,
      entityId:
        typeof body["entityId"] === "string" ? body["entityId"] : undefined,
      eventData:
        body["eventData"] && typeof body["eventData"] === "object"
          ? (body["eventData"] as Record<string, unknown>)
          : undefined,
      flags:
        body["flags"] && typeof body["flags"] === "object"
          ? (body["flags"] as NotificationFlags)
          : undefined,
      actor: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  }
}
