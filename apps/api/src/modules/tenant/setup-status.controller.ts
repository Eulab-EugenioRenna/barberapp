import { Controller, Get, Header, Req } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { requireTenantId, resolveRequestSession } from "../../common/request-session";
import { setupSteps, type SetupStatusView } from "./setup-status";

/** What the business has already set up, for the «Primi passi» card. */
@Controller("tenant/setup-status")
export class SetupStatusController {
  constructor(private readonly prisma: PrismaService) {}

  @Get() @Header("Cache-Control", "no-store")
  async read(@Req() request: { headers: { authorization?: string } }): Promise<SetupStatusView> {
    const session = await resolveRequestSession(this.prisma, request.headers.authorization);
    const tenantId = requireTenantId(session);
    const [tenant, locations, services, collaborators, scheduledCollaborators, customers, whatsapp, policy] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { bookingMode: true, publicEnabled: true } }),
      this.prisma.location.count({ where: { tenantId, isActive: true } }),
      this.prisma.service.count({ where: { tenantId, isActive: true } }),
      this.prisma.collaborator.count({ where: { tenantId, isActive: true } }),
      this.prisma.collaborator.count({
        where: { tenantId, isActive: true, weeklySchedules: { some: { isWorkingDay: true } } },
      }),
      this.prisma.customer.count({ where: { tenantId, isActive: true } }),
      this.prisma.whatsAppLink.count({ where: { tenantId, removedAt: null } }),
      this.prisma.appointmentAutomationPolicy.findUnique({ where: { tenantId }, select: { enabled: true } }),
    ]);
    return setupSteps({
      locations, services, collaborators, scheduledCollaborators, customers,
      whatsapp: whatsapp > 0,
      remindersActive: !!policy?.enabled,
      online: !!tenant && tenant.bookingMode !== "closed" && tenant.publicEnabled,
    });
  }
}
