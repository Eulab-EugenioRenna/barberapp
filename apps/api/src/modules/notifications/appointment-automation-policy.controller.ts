import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
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
import { AppointmentAutomationPolicyService } from "./appointment-automation-policy.service";

@Controller("notifications/appointment-policy")
export class AppointmentAutomationPolicyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: AppointmentAutomationPolicyService,
  ) {}
  private async session(request: { headers: ScopeHeaders }) {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const scope = await resolveOperationalScope(
      this.prisma,
      session,
      request.headers,
    );
    if (
      scope.allowedSectorIds.length !==
      (await this.prisma.sector.count({
        where: { tenantId: requireTenantId(session) },
      }))
    )
      throw new ForbiddenException(
        "La policy è condivisa dall’attività: occorre accesso a tutti i settori",
      );
    return session;
  }
  @Get()
  async get(@Req() request: { headers: ScopeHeaders }) {
    return this.policies.get(requireTenantId(await this.session(request)));
  }
  @Patch()
  async save(
    @Req() request: { headers: ScopeHeaders },
    @Body() body: Record<string, unknown>,
  ) {
    const session = await this.session(request);
    return this.policies.save(
      requireTenantId(session),
      requireUser(session).id,
      body,
    );
  }
  @Post("preview")
  async preview(
    @Req() request: { headers: ScopeHeaders },
    @Body() body: Record<string, unknown>,
  ) {
    return this.policies.preview(
      requireTenantId(await this.session(request)),
      body,
    );
  }
  @Post("activate") async activate(
    @Req() request: { headers: ScopeHeaders },
    @Body() body: Record<string, unknown>,
  ) {
    const session = await this.session(request);
    return this.policies.activate(
      request.headers.authorization,
      requireTenantId(session),
      requireUser(session).id,
      body,
    );
  }
  @Post("deactivate") async deactivate(
    @Req() request: { headers: ScopeHeaders },
    @Body() body: Record<string, unknown>,
  ) {
    const session = await this.session(request);
    return this.policies.deactivate(
      requireTenantId(session),
      requireUser(session).id,
      body,
    );
  }
}
