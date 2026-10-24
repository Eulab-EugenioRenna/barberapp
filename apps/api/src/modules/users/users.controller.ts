import { publicUserSelect } from "../../common/local-sessions";
import {
  Controller,
  Delete,
  Get,
  Req,
  Param,
  NotFoundException,
} from "@nestjs/common";
import {
  requirePlatformAdmin,
  requireTenantId,
  resolveRequestSession,
} from "../../common/request-session";
import { PrismaService } from "../../prisma/prisma.service";

@Controller("users")
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );

    if (session.user?.role === "platform_admin") {
      requirePlatformAdmin(session);
      return this.prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          ...publicUserSelect,
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
              isActive: true,
              isSuspended: true,
            },
          },
        },
      });
    }

    return this.prisma.user.findMany({
      where: { tenantId: requireTenantId(session) },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        tenantId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        permissions: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
  @Delete(":id/sessions")
  async revokeSessions(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const target = await this.prisma.user.findFirst({
      where: { id, tenantId },
    });
    if (!target) throw new NotFoundException();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"user:" + id}, 0))`;
      await tx.localSession.updateMany({
        where: { userId: id },
        data: { revokedAt: new Date() },
      });
    });
    return { ok: true };
  }
}
