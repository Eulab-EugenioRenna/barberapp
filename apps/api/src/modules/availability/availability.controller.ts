import { Controller, Get, Query, Req } from "@nestjs/common";
import {
  requireTenantId,
  resolveRequestSession,
} from "../../common/request-session";
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

    return {
      serviceId,
      date: date ?? new Date().toISOString().slice(0, 10),
      slots: await this.availabilityService.getCachedAvailability(
        tenantId,
        serviceId,
        date,
        collaboratorId,
      ),
      conflictChecks: ["collaborator", "room", "station", "buffers"],
    };
  }
}
