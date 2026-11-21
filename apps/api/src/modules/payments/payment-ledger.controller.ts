import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  requireUser,
  resolveRequestSession,
} from "../../common/request-session";
import { CacheInvalidationService } from "../../cache/cache-invalidation.service";
import {
  resolveOperationalScope,
  type ScopeHeaders,
} from "../locations/operational-scope";
import { PaymentCommandDto } from "./payment-command.dto";
import { PaymentsService } from "./payments.service";

@Controller("sales/:id/payments")
export class PaymentLedgerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly invalidation: CacheInvalidationService,
  ) {}
  private async context(headers: ScopeHeaders) {
    const session = await resolveRequestSession(
      this.prisma,
      headers.authorization,
    );
    return {
      scope: await resolveOperationalScope(this.prisma, session, headers),
      actor: requireUser(session),
    };
  }
  @Get()
  async read(
    @Req() req: { headers: ScopeHeaders },
    @Param("id") id: string,
    @Query("page") page?: string,
  ) {
    const { scope } = await this.context(req.headers);
    return this.payments.read(scope, id, page === undefined ? 1 : Number(page));
  }
  @Post()
  async record(
    @Req() req: { headers: ScopeHeaders },
    @Param("id") id: string,
    @Body() body: PaymentCommandDto,
  ) {
    const { scope, actor } = await this.context(req.headers);
    const result = await this.payments.execute(scope, actor.id, id, body);
    await Promise.all([
      this.invalidation.invalidateSales(scope.tenantId),
      this.invalidation.invalidateDashboard(scope.tenantId),
      this.invalidation.invalidateCustomers(scope.tenantId),
      this.invalidation.invalidateAppointments(scope.tenantId),
    ]);
    return result;
  }
}
