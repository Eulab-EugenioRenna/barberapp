import {
  BadRequestException, Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Post, Put, Req, Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConnectRequest, connectBrowser, type AuthResponse } from "../../common/connect-http";
import { ConnectAuthService } from "./connect-auth.service";
import { PersonalAccountService } from "./personal-account.service";

/**
 * Provider steps that need their own secure screen (no API can do them without
 * the person): a single focused page, then back to ALORA — not the account console.
 */
export const ACCOUNT_ACTIONS = ["UPDATE_PASSWORD", "CONFIGURE_TOTP", "VERIFY_EMAIL"] as const;

@Controller("account")
export class PersonalAccountController {
  constructor(
    private readonly account: PersonalAccountService,
    private readonly connect: ConnectAuthService,
  ) {}
  @Get() @Header("Cache-Control", "no-store")
  profile(@Req() request: ConnectRequest) { return this.account.profile(request.headers.authorization); }
  @Put("profile")
  updateProfile(@Req() request: ConnectRequest, @Body() body: Record<string, unknown>) {
    connectBrowser(request); return this.account.updateProfile(request.headers.authorization, body ?? {});
  }
  @Get("security") @Header("Cache-Control", "no-store")
  security(@Req() request: ConnectRequest) { return this.account.security(request.headers.authorization); }
  @Put("security/preferences")
  setMfaPreference(@Req() request: ConnectRequest, @Body() body: Record<string, unknown>) {
    connectBrowser(request); return this.account.setMfaPreference(request.headers.authorization, body?.["preferredMethod"]);
  }
  @Delete("authenticators/:id")
  removeAuthenticator(@Req() request: ConnectRequest, @Param("id") id: string) {
    if (typeof id !== "string" || !id || id.length > 200) throw new BadRequestException("App non valida");
    connectBrowser(request); return this.account.removeAuthenticator(request.headers.authorization, id);
  }
  /** Starts a provider action and returns where the browser must go. */
  @Post("actions")
  async startAction(
    @Req() request: ConnectRequest,
    @Res({ passthrough: true }) response: AuthResponse,
    @Body() body: Record<string, unknown>,
  ) {
    const action = body?.["action"];
    if (!ACCOUNT_ACTIONS.includes(action as (typeof ACCOUNT_ACTIONS)[number]))
      throw new BadRequestException("Operazione non prevista");
    const { email } = await this.account.actionIdentity(request.headers.authorization);
    const result: any = await this.connect.signIn({ email }, request, response);
    if (result?.status !== "connect_redirect" || typeof result.redirectUrl !== "string")
      throw new ServiceUnavailableException("Operazione non disponibile ora: riprova tra poco");
    const url = new URL(result.redirectUrl);
    url.searchParams.set("kc_action", String(action));
    return { redirectUrl: url.href };
  }
  @Get("sessions") @Header("Cache-Control", "no-store")
  sessions(@Req() request: ConnectRequest) { return this.account.sessions(request.headers.authorization); }
  @Get("notifications") @Header("Cache-Control", "no-store")
  notices(@Req() request: ConnectRequest) { return this.account.notices(request.headers.authorization); }
  @Post("sessions/logout-all")
  logoutAll(@Req() request: ConnectRequest) { connectBrowser(request); return this.account.logoutAll(request.headers.authorization); }
  @Post("sessions/:id/logout")
  logoutSession(@Req() request: ConnectRequest, @Param("id", new ParseUUIDPipe()) id: string) {
    connectBrowser(request); return this.account.logoutSession(request.headers.authorization, id);
  }
  @Delete("devices/:id")
  revokeDevice(@Req() request: ConnectRequest, @Param("id", new ParseUUIDPipe()) id: string) {
    connectBrowser(request); return this.account.revokeDevice(request.headers.authorization, id);
  }
}
