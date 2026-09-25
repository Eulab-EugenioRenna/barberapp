import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { hash, compare } from "bcrypt";
import { PrismaService } from "../../prisma/prisma.service";
import { UserRole } from "../../common/domain-types";
import {
  buildSessionToken,
  resolveRequestSession,
  requireUser,
} from "../../common/request-session";
import { NotificationsService } from "../notifications/notifications.service";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Post("login")
  async login(
    @Body() body: { email: string; password: string },
  ): Promise<{ accessToken: string; refreshToken: string; user: unknown }> {
    const user = await this.prisma.user.findUnique({
      where: { email: body.email.toLowerCase().trim() },
      include: {
        tenant: {
          select: {
            isActive: true,
            isSuspended: true,
          },
        },
      },
    });

    if (!user || !(await compare(body.password, user.passwordHash))) {
      throw new UnauthorizedException("Email o password non corretti");
    }

    if (!user.isActive) {
      throw new UnauthorizedException("Questo account non è attivo");
    }

    if (
      user.role !== UserRole.PlatformAdmin &&
      (!user.tenant || !user.tenant.isActive || user.tenant.isSuspended)
    ) {
      throw new ForbiddenException("L'accesso a questa attività è sospeso");
    }

    const token = buildSessionToken(user.id);

    return {
      accessToken: token,
      refreshToken: token,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }

  @Post("signup")
  async signup(
    @Body()
    body: {
      companyName: string;
      email: string;
      password: string;
      firstName: string;
      lastName: string;
    },
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    user: unknown;
    tenant: unknown;
  }> {
    const companyName = body.companyName?.trim();
    const email = body.email?.toLowerCase().trim();
    const password = body.password?.trim();
    const firstName = body.firstName?.trim();
    const lastName = body.lastName?.trim();

    if (!companyName || !email || !password || !firstName || !lastName) {
      throw new BadRequestException("Completa tutti i campi richiesti");
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new BadRequestException("Questa email è già associata a un account");
    }

    const baseSlug = slugify(companyName) || "atelier";
    const similarTenants = await this.prisma.tenant.count({
      where: { slug: { startsWith: baseSlug } },
    });
    const slug =
      similarTenants === 0 ? baseSlug : `${baseSlug}-${similarTenants + 1}`;
    const passwordHash = await hash(password, 10);

    const result = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
          slug,
          bookingMode: "hybrid",
          primaryColor: "#1c7c64",
          accentColor: "#f97316",
          publicEnabled: true,
        },
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
          firstName,
          lastName,
          role: UserRole.Owner,
          permissions: [
            "appointments.create",
            "appointments.update.all",
            "clients.read.full",
            "services.manage",
            "collaborators.manage",
            "products.manage",
            "dashboard.revenue.read",
            "settings.manage",
            "audit.read",
          ],
        },
      });

      const collaborator = await tx.collaborator.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          firstName,
          lastName,
          email,
          isPublic: true,
          isActive: true,
          calendarColor: "#1c7c64",
        },
      });

      const updatedTenant = await tx.tenant.update({
        where: { id: tenant.id },
        data: { defaultCollaboratorId: collaborator.id },
      });

      const starterPlan = await tx.subscriptionPlan.findFirst({
        where: { code: "starter", isActive: true },
      });

      if (starterPlan) {
        await tx.tenantSubscription.create({
          data: {
            tenantId: tenant.id,
            planId: starterPlan.id,
            status: "trialing",
            trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          },
        });
      }

      return { tenant: updatedTenant, user, collaborator };
    });

    await this.notificationsService.ensureTenantNotificationDefaults(
      result.tenant.id,
    );

    const token = buildSessionToken(result.user.id);

    return {
      accessToken: token,
      refreshToken: token,
      user: {
        id: result.user.id,
        tenantId: result.user.tenantId,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role,
      },
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        slug: result.tenant.slug,
        publicDomain: result.tenant.publicDomain,
        bookingMode: result.tenant.bookingMode,
        primaryColor: result.tenant.primaryColor,
        accentColor: result.tenant.accentColor,
      },
    };
  }

  @Post("refresh")
  refresh(@Body() body: { refreshToken: string }): { accessToken: string } {
    return { accessToken: body.refreshToken };
  }

  @Post("logout")
  logout(): { ok: true } {
    return { ok: true };
  }

  @Get("me")
  async me(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const user = requireUser(session);

    return user;
  }
}
