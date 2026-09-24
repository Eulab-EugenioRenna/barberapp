import {
  Body,
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
import {
  Observable,
  exhaustMap,
  map,
  timer,
} from "rxjs";
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
        const tenantId = requireTenantId(session);
        const now = new Date();
        const appointments =
          await this.notificationsService.listAppointmentsAwaitingOrder(
            tenantId,
            now,
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

    return this.notificationsService.listTemplates(requireTenantId(session));
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

    return this.notificationsService.listInbox(tenantId, user.id);
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

    return this.notificationsService.unreadCount(tenantId, user.id);
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

    return this.notificationsService.listHistory(requireTenantId(session));
  }

  @Post("events")
  async emitEvent(
    @Req() request: { headers: { authorization?: string } },
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const user = requireUser(session);

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
