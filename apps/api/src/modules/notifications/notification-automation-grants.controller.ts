import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { connectBrowser, type ConnectRequest } from "../../common/connect-http";
import { NotificationAutomationGrantsService } from "./notification-automation-grants.service";

@Controller("notifications/automation-grants")
export class NotificationAutomationGrantsController {
  constructor(private readonly grants: NotificationAutomationGrantsService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  list(@Req() request: ConnectRequest) {
    return this.grants.list(request.headers.authorization);
  }
  @Post()
  prepare(
    @Req() request: ConnectRequest,
    @Body() body: Record<string, unknown>,
  ) {
    connectBrowser(request);
    return this.grants.prepare(request.headers.authorization, body);
  }
  @Post(":id/recover")
  recover(
    @Req() request: ConnectRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    connectBrowser(request);
    return this.grants.recover(request.headers.authorization, id);
  }
  @Post(":id/revoke")
  revoke(
    @Req() request: ConnectRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    connectBrowser(request);
    return this.grants.revoke(request.headers.authorization, id);
  }
}
