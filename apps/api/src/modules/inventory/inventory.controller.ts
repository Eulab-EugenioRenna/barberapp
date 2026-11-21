import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  requireTenantId,
  requireUser,
  resolveRequestSession,
} from "../../common/request-session";
import {
  resolveOperationalScope,
  ScopeHeaders,
} from "../locations/operational-scope";
import { InventoryCommandDto } from "./inventory-command.dto";
import { InventoryService } from "./inventory.service";
@Controller("inventory")
export class InventoryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}
  private async context(headers: ScopeHeaders) {
    const session = await resolveRequestSession(
      this.prisma,
      headers.authorization,
    );
    requireTenantId(session);
    return {
      scope: await resolveOperationalScope(this.prisma, session, headers),
      actor: requireUser(session),
    };
  }
  @Get("balances")
  async balances(
    @Req() req: { headers: ScopeHeaders },
    @Query("locationId") locationId: string,
  ) {
    if (!locationId) throw new BadRequestException("Seleziona una sede");
    return this.inventory.balances(
      (await this.context(req.headers)).scope,
      locationId,
    );
  }
  @Get("movements")
  async movements(
    @Req() req: { headers: ScopeHeaders },
    @Query() query: Record<string, string>,
  ) {
    if (!query["locationId"])
      throw new BadRequestException("Seleziona una sede");
    const page = Number(query["page"] || 1);
    if (!Number.isInteger(page) || page < 1 || page > 100000)
      throw new BadRequestException("Pagina non valida");
    return this.inventory.movements(
      (await this.context(req.headers)).scope,
      query["locationId"],
      page,
      query["productId"],
    );
  }
  @Post("operations")
  async execute(
    @Req() req: { headers: ScopeHeaders },
    @Body() body: InventoryCommandDto,
  ) {
    const { scope, actor } = await this.context(req.headers);
    return this.inventory.execute(scope, actor.id, body);
  }
}
