import { Controller, Get, Query, Req } from "@nestjs/common";
import {
  requireTenantId,
  resolveRequestSession,
} from "../../common/request-session";
import { resolveZonedDateKey } from "../../common/zoned-time";
import { PrismaService } from "../../prisma/prisma.service";
import { AvailabilityService } from "./availability.service";

@Controller("availability")
export class AvailabilityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availabilityService: AvailabilityService,
  ) {}

  @Get()
  async getAvailability(
    @Req() request: { headers: { authorization?: string } },
    @Query("serviceId") serviceId: string,
    @Query("date") date?: string,
    @Query("collaboratorId") collaboratorId?: string,
  ): Promise<unknown> {
    const session = await resolveRequestSession(
      this.prisma,
      request.headers.authorization,
    );
    const tenantId = requireTenantId(session);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const timezone = tenant?.timezone || "Europe/Rome";

    return {
      serviceId,
      date: resolveZonedDateKey(date, timezone),
      slots: await this.availabilityService.getCachedAvailability(
        tenantId,
        serviceId,
        date,
        collaboratorId,
      ),
      conflictChecks: ["collaborator", "room", "buffers"],
    };
  }
}
