import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from "@nestjs/common";
import { connectBrowser, type ConnectRequest } from "../../common/connect-http";
import { NotificationAutomationWebhooksService } from "./notification-automation-webhooks.service";

@Controller("notifications/automation-webhooks")
export class NotificationAutomationWebhooksController {
  constructor(private readonly hooks: NotificationAutomationWebhooksService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  get(@Req() req: ConnectRequest) {
    return this.hooks.get(req.headers.authorization);
  }
  @Post()
  prepare(@Req() req: ConnectRequest, @Body() body: Record<string, unknown>) {
    connectBrowser(req);
    return this.hooks.prepare(req.headers.authorization, body);
  }
  @Post(":id/events")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  receive(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Req() req: { body: unknown; headers: Record<string, unknown> },
  ) {
    return this.hooks.receive(id, req.body, req.headers);
  }
}
