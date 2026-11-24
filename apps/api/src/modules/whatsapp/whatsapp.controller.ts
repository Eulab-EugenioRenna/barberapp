import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Post, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { WhatsAppService } from "./whatsapp.service";
import { BroadcastWhatsAppTextDto, SendWhatsAppTextDto, WhatsAppMessageQueryDto } from "./whatsapp.dto";
import { type ConnectRequest, connectBrowser } from "../../common/connect-http";
@Controller("whatsapp")
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}
  @Get("sessions") @Header("Cache-Control", "no-store")
  sessions(@Req() r: ConnectRequest) { return this.whatsapp.sessions(r.headers.authorization); }
  @Post("sessions")
  connect(@Req() r: ConnectRequest) { connectBrowser(r); return this.whatsapp.connect(r.headers.authorization); }
  @Get("sessions/:id/qr") @Header("Cache-Control", "no-store")
  qr(@Req() r: ConnectRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.whatsapp.qr(r.headers.authorization, id); }
  @Post("sessions/:id/reconnect")
  reconnect(@Req() r: ConnectRequest, @Param("id", new ParseUUIDPipe()) id: string) { connectBrowser(r); return this.whatsapp.reconnect(r.headers.authorization, id); }
  @Post("sessions/:id/disconnect")
  disconnect(@Req() r: ConnectRequest, @Param("id", new ParseUUIDPipe()) id: string) { connectBrowser(r); return this.whatsapp.disconnect(r.headers.authorization, id); }
  @Delete("sessions/:id")
  remove(@Req() r: ConnectRequest, @Param("id", new ParseUUIDPipe()) id: string) { connectBrowser(r); return this.whatsapp.remove(r.headers.authorization, id); }
  @Get("archives") @Header("Cache-Control", "no-store")
  archives(@Req() r: ConnectRequest) { return this.whatsapp.archives(r.headers.authorization); }
  @Get("archives/:id/conversations") @Header("Cache-Control", "no-store")
  conversations(@Req() r: ConnectRequest, @Param("id", new ParseUUIDPipe()) id: string) { return this.whatsapp.conversations(r.headers.authorization, id); }
  @Get("archives/:id/messages") @Header("Cache-Control", "no-store")
  messages(@Req() r: ConnectRequest, @Param("id", new ParseUUIDPipe()) id: string, @Query() query: WhatsAppMessageQueryDto) {
    return this.whatsapp.messages(r.headers.authorization, id, query.before, query.chat);
  }
  /** File of a message: 200 with the bytes, 204 while Connect is still recovering it. */
  @Get("archives/:id/messages/:messageId/media")
  async media(@Req() r: ConnectRequest, @Param("id", new ParseUUIDPipe()) id: string,
    @Param("messageId", new ParseUUIDPipe()) messageId: string, @Res() res: Response) {
    const file = await this.whatsapp.media(r.headers.authorization, id, messageId);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!file) { res.setHeader("Cache-Control", "no-store"); res.status(204).end(); return; }
    res.setHeader("Content-Type", file.mimetype);
    res.setHeader("Content-Disposition", "inline");
    res.status(200).end(file.data);
  }
  @Get("outbox") @Header("Cache-Control", "no-store")
  outbox(@Req() r: ConnectRequest) { return this.whatsapp.outbox(r.headers.authorization); }
  @Post("sessions/:id/messages")
  send(@Req() r: ConnectRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: SendWhatsAppTextDto) {
    connectBrowser(r); return this.whatsapp.send(r.headers.authorization, id, body);
  }
  @Get("audience") @Header("Cache-Control", "no-store")
  audience(@Req() r: ConnectRequest) { return this.whatsapp.audience(r.headers.authorization); }
  @Post("sessions/:id/broadcast")
  broadcast(@Req() r: ConnectRequest, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: BroadcastWhatsAppTextDto) {
    connectBrowser(r); return this.whatsapp.broadcast(r.headers.authorization, id, body);
  }
}
