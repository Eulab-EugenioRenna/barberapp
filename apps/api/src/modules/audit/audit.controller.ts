import { Controller, Get, Query, Req } from "@nestjs/common";
import {
  requirePlatformAdmin,
  requireTenantId,
  resolveRequestSession,
} from "../../common/request-session";
import { PrismaService } from "../../prisma/prisma.service";

@Controller("audit-logs")
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll(
    @Req() request: { headers: { authorization?: string } },
    @Query("tenantId") tenantId?: string,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    if (session.user?.role === "platform_admin") {
      requirePlatformAdmin(session);
      return this.prisma.auditLog.findMany({
        where: { tenantId: tenantId || undefined },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
    }

    return this.prisma.auditLog.findMany({
      where: { tenantId: requireTenantId(session) },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }
}
