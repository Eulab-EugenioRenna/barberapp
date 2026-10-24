import { MIGRATION_CONSENT_VERSION } from "./connect-auth.service";
import { connectReturnUrl } from "../../common/connect-runtime";
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  Header,
} from "@nestjs/common";
import {
  IsBoolean,
  IsString,
  Equals,
  Length,
  IsOptional,
} from "class-validator";
import { Transform } from "class-transformer";

import { AuthResponse, ConnectAuthService } from "./connect-auth.service";
import { ConnectRequest } from "../../common/connect-http";
class AcceptConnectDto {
  @IsBoolean() @Equals(true) accepted!: boolean;
  @IsString() @Equals(MIGRATION_CONSENT_VERSION) consentVersion!: string;
  @IsString() @Length(1, 512) password!: string;
  @IsOptional() @IsString() @Length(1, 512) newConnectPassword?: string;
  @IsString() @Length(43, 43) challenge!: string;
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 80)
  firstName!: string;
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 80)
  lastName!: string;
}
class ConnectExchangeDto {
  @IsString() @Length(43, 43) handoff!: string;
}
@Controller("auth/connect")
export class ConnectAuthController {
  constructor(private readonly connect: ConnectAuthService) {}
  @Post("accept")
  @Header("Cache-Control", "no-store")
  accept(@Body() body: AcceptConnectDto, @Req() request: ConnectRequest) {
    return this.connect.submit(body, request);
  }
  @Get("callback")
  async callback(
    @Query()
    query: { state?: string; code?: string; error?: string; iss?: string },
    @Req() request: ConnectRequest,
    @Res() response: AuthResponse,
  ) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    try {
      return response.redirect(
        303,
        await this.connect.callback(query, request, response),
      );
    } catch {
      // Fixed server configuration only. Never return provider errors or query-selected URLs.
      const url = new URL(connectReturnUrl());
      url.searchParams.set("connect_error", "access_failed");
      return response.redirect(303, url.href);
    }
  }
  @Post("exchange")
  @Header("Cache-Control", "no-store")
  async exchange(
    @Req() request: ConnectRequest,
    @Body() body: ConnectExchangeDto,
    @Res({ passthrough: true }) response: AuthResponse,
  ) {
    const result = await this.connect.exchange(body.handoff, request, response);
    return result;
  }
}
