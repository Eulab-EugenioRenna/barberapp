import { Controller, Delete, Get, Header, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { ConnectRequest, connectBrowser } from "../../common/connect-http";
import { PersonalAccountService } from "./personal-account.service";

@Controller("account")
export class PersonalAccountController {
  constructor(private readonly account: PersonalAccountService) {}
  @Get() @Header("Cache-Control", "no-store")
  profile(@Req() request: ConnectRequest) { return this.account.profile(request.headers.authorization); }
  @Get("security") @Header("Cache-Control", "no-store")
  security(@Req() request: ConnectRequest) { return this.account.security(request.headers.authorization); }
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
