import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  requirePlatformAdmin,
  resolveRequestSession,
} from "../../common/request-session";
import { PrismaService } from "../../prisma/prisma.service";
import { PlatformAdminService } from "./platform-admin.service";

@Controller("platform-admin")
export class PlatformAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformAdminService: PlatformAdminService,
  ) {}

  private async verify(request: { headers: { authorization?: string } }) {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    requirePlatformAdmin(session);
  }

  @Get("tenants")
  async tenants(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    await this.verify(request);
    return this.platformAdminService.listTenants();
  }

  @Get("tenants/:id")
  async tenant(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
  ): Promise<unknown> {
    await this.verify(request);
    return this.platformAdminService.getTenant(id);
  }

  @Get("tenants/:id/health-check")
  async healthCheck(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
  ): Promise<unknown> {
    await this.verify(request);
    return this.platformAdminService.healthCheck(id);
  }

  @Patch("tenants/:id")
  async updateTenant(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    await this.verify(request);
    return this.platformAdminService.updateTenant(id, body);
  }

  @Post("tenants/:id/suspend")
  async suspendTenant(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    await this.verify(request);
    return this.platformAdminService.suspendTenant(
      id,
      typeof body["reason"] === "string" ? body["reason"] : undefined,
    );
  }

  @Post("tenants/:id/reactivate")
  async reactivateTenant(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
  ): Promise<unknown> {
    await this.verify(request);
    return this.platformAdminService.reactivateTenant(id);
  }

  @Post("tenants/:id/reset-data")
  async resetTenant(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
  ): Promise<unknown> {
    await this.verify(request);
    return this.platformAdminService.resetTenantData(id);
  }

  @Delete("tenants/:id")
  async deleteTenant(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
  ): Promise<unknown> {
    await this.verify(request);
    return this.platformAdminService.deleteTenant(id);
  }

  @Get("tenants/:id/export")
  async exportTenant(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Query("format") format?: "json" | "csv",
  ): Promise<unknown> {
    await this.verify(request);
    return format === "csv"
      ? this.platformAdminService.exportTenantCsv(id)
      : this.platformAdminService.exportTenant(id);
  }

  @Post("tenants/:id/import")
  async importTenant(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Query("format") format?: "json" | "csv",
    @Query("mode") mode: "replace" | "merge" = "replace",
    @Body() body: Record<string, any> = {},
  ): Promise<unknown> {
    await this.verify(request);
    return format === "csv"
      ? this.platformAdminService.importTenantCsv(
          id,
          body,
          mode === "merge" ? "merge" : "replace",
        )
      : this.platformAdminService.importTenant(
          id,
          body,
          mode === "merge" ? "merge" : "replace",
        );
  }

  @Get("plans")
  async plans(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    await this.verify(request);
    return this.platformAdminService.listPlans();
  }

  @Post("plans")
  async createPlan(
    @Req() request: { headers: { authorization?: string } },
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    await this.verify(request);
    return this.platformAdminService.createPlan(body);
  }

  @Patch("plans/:id")
  async updatePlan(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    await this.verify(request);
    return this.platformAdminService.updatePlan(id, body);
  }

  @Get("subscriptions")
  async subscriptions(
    @Req() request: { headers: { authorization?: string } },
  ): Promise<unknown> {
    await this.verify(request);
    return this.platformAdminService.listSubscriptions();
  }

  @Post("subscriptions")
  async createSubscription(
    @Req() request: { headers: { authorization?: string } },
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    await this.verify(request);
    return this.platformAdminService.assignSubscription(body);
  }

  @Patch("subscriptions/:id")
  async updateSubscription(
    @Req() request: { headers: { authorization?: string } },
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    await this.verify(request);
    return this.platformAdminService.updateSubscription(id, body);
  }
}
