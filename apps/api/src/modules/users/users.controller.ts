import { Controller, Get, Req } from "@nestjs/common";
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
        include: {
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
}
