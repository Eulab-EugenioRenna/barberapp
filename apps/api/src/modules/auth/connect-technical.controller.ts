import {
  Body,
  Controller,
  Header,
  Logger,
  Post,
  Query,
  Res,
} from "@nestjs/common";

import { AuthResponse } from "../../common/connect-http";
import { ConnectTechnicalService } from "./connect-technical.service";

/**
 * Browser entry point for the Connect ticket form. It intentionally lives at
 * the conventional installation path, outside the JSON API prefix.
 */
@Controller("eulab/connect")
export class ConnectTechnicalController {
  private readonly logger = new Logger(ConnectTechnicalController.name);
  constructor(private readonly technical: ConnectTechnicalService) {}

  @Post("technical")
  @Header("Cache-Control", "no-store")
  async start(
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
    @Res() response: AuthResponse,
  ) {
    const ticket = typeof body["ticket"] === "string" ? body["ticket"] : "";
    const installation =
      typeof query["installation"] === "string" ? query["installation"] : "";
    try {
      return response.redirect(
        303,
        await this.technical.start(ticket, installation),
      );
    } catch {
      // No ticket, operator token or provider detail is reflected to the page.
      this.logger.warn("Accesso come profilo non avviato");
      return response.redirect(303, this.technical.failureUrl());
    }
  }
}
