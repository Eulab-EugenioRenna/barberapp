import { Body, Controller, Get, Param, Patch, Req } from "@nestjs/common";
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
import { AppointmentContactService } from "./appointment-contact.service";

@Controller("appointments/:id/notification-contact")
export class AppointmentContactController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: AppointmentContactService,
  ) {}
  private async context(request: { headers: ScopeHeaders }) {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    return {
      tenantId: requireTenantId(session),
      actorId: requireUser(session).id,
      source: "internal" as const,
      scope: await resolveOperationalScope(
        this.prisma,
        session,
        request.headers,
      ),
    };
  }
  @Get() async get(
    @Req() req: { headers: ScopeHeaders },
    @Param("id") id: string,
  ) {
    return this.contacts.get(await this.context(req), id);
  }
  @Patch() async save(
    @Req() req: { headers: ScopeHeaders },
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.contacts.save(await this.context(req), id, body);
  }
}
