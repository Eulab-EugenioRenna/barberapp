import {
  BadGatewayException, BadRequestException, ConflictException, ForbiddenException,
  HttpException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { ConnectServer } from "@eulab/connect/server";
import { PrismaService } from "../../prisma/prisma.service";
import { connectApplication } from "../../common/connect-application";
import { connectHttpError } from "../../common/connect-http";
import { loadConnectConfig, openConnect } from "../../common/connect-runtime";
import { canUseLocalFunction, type FunctionKey } from "../../common/function-catalog";
import { requireTenantId, requireUser, resolveRequestSession } from "../../common/request-session";
import type {
  WhatsAppAcknowledgement, WhatsAppArchiveView, WhatsAppConnection,
  WhatsAppConversationView, WhatsAppMessageView, WhatsAppOutboxView, WhatsAppSendInput,
} from "../../common/whatsapp-contract";
import { resolveOperationalScope } from "../locations/operational-scope";

type Client = ReturnType<ConnectServer["whatsapp"]>;
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
function invalid(): never { throw new BadGatewayException("Risposta WhatsApp non valida. Aggiorna lo stato prima di operare."); }
function text(value: unknown, max = 16000): string {
  if (typeof value !== "string" || value.length > max) return invalid();
  return value;
}
function nullable(value: unknown, max = 16000): string | null { return value == null ? null : text(value, max); }
function id(value: unknown): string { const result = text(value, 36); if (!uuid.test(result)) return invalid(); return result; }
function date(value: unknown): string { const result = text(value, 80); if (!Number.isFinite(Date.parse(result))) return invalid(); return result; }
function direction(value: unknown): string {
  if (value === "out") return "outbound";
  if (value === "in") return "inbound";
  return invalid();
}
function rows<T>(value: T[]): T[] { if (!Array.isArray(value) || value.length > 10000) return invalid(); return value; }
function ack(value: WhatsAppAcknowledgement): WhatsAppAcknowledgement { return { id: id(value?.id), state: text(value?.state, 80) }; }

/** The existing SDK owns authentication, installation selection, refresh and provider sessions. */
@Injectable()
export class WhatsAppService {
  constructor(private readonly prisma: PrismaService) {}

  private async run<T>(authorization: string | undefined, permission: FunctionKey,
    operation: (client: Client, actor: { tenantId: string; userId: string }) => Promise<T>): Promise<T> {
    const session = await resolveRequestSession(this.prisma, authorization);
    const user = requireUser(session), tenantId = requireTenantId(session);
    if (user.technicalAccess || user.role === "platform_admin" || !canUseLocalFunction(user, permission))
      throw new ForbiddenException("Permesso WhatsApp esplicito richiesto");
    if (!session.connectSessionId) throw new UnauthorizedException("Accedi tramite Connect");
    const scope = await resolveOperationalScope(this.prisma, session);
    const total = await this.prisma.sector.count({ where: { tenantId } });
    if (scope.allowedSectorIds.length !== total)
      throw new ForbiddenException("WhatsApp è condiviso dall’attività: occorre accesso a tutti i settori");
    const linked = await this.prisma.connectSession.findFirst({
      where: { id: session.connectSessionId, userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { sdkSessionCipher: true, installationId: true },
    });
    if (!linked?.sdkSessionCipher) throw new UnauthorizedException("Ripeti l’accesso Connect");
    const binding = await loadConnectConfig(this.prisma, tenantId);
    if (!binding || binding.installationId !== linked.installationId)
      throw new ForbiddenException("Collegamento WhatsApp dell’attività da verificare");
    try {
      const application = await connectApplication(this.prisma);
      return await application.services(openConnect(linked.sdkSessionCipher), (client, token) =>
        operation(client.whatsapp(token), { tenantId, userId: user.id }));
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      if (status === 401) throw new UnauthorizedException("Ripeti l’accesso Connect");
      if (status === 403) throw new ForbiddenException("WhatsApp non autorizzato dalla delega o dalla licenza Connect");
      if (status === 404) throw new NotFoundException("Elemento WhatsApp non disponibile in questa attività");
      if (status === 400) throw new BadRequestException("Dati WhatsApp non validi");
      if (status === 409) throw new ConflictException("Stato WhatsApp cambiato. Aggiorna e verifica l’operazione precedente.");
      if (status === 429 || (typeof status === "number" && status >= 500))
        throw new ServiceUnavailableException("WhatsApp temporaneamente non disponibile. Verifica lo stato prima di riprovare.");
      return connectHttpError(error);
    }
  }

  sessions(auth?: string): Promise<WhatsAppConnection[]> {
    return this.run(auth, "whatsapp.read", async wa => rows(await wa.sessions()).map(s => {
      if (typeof s.runner_online !== "boolean" || !Number.isSafeInteger(s.sync_count) || s.sync_count < 0) return invalid();
      return { id: id(s.id), number: nullable(s.number, 100), state: text(s.state, 80), archiveId: s.archive_id == null ? null : id(s.archive_id),
        runnerOnline: s.runner_online, createdAt: date(s.created_at), closedAt: s.closed_at == null ? null : date(s.closed_at),
        syncStatus: text(s.sync_status, 80), syncCount: s.sync_count };
    }));
  }
  connect(auth?: string) { return this.run(auth, "whatsapp.manage", async wa => ack(await wa.connect())); }
  reconnect(auth: string | undefined, sessionId: string) { return this.run(auth, "whatsapp.manage", async wa => ack(await wa.reconnect(sessionId))); }
  disconnect(auth: string | undefined, sessionId: string) { return this.run(auth, "whatsapp.manage", async wa => ack(await wa.disconnect(sessionId))); }
  qr(auth: string | undefined, sessionId: string) {
    return this.run(auth, "whatsapp.manage", async wa => {
      const value = await wa.qr(sessionId), state = text(value?.state, 80), qr = nullable(value?.qr, 500000);
      if (qr !== null && (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qr) || state !== "pairing")) return invalid();
      return { state, qr };
    });
  }
  archives(auth?: string): Promise<WhatsAppArchiveView[]> {
    return this.run(auth, "whatsapp.read", async wa => rows(await wa.archives()).map(a => ({ id: id(a.id), number: text(a.number, 100) })));
  }
  conversations(auth: string | undefined, archiveId: string): Promise<WhatsAppConversationView[]> {
    return this.run(auth, "whatsapp.read", async wa => rows(await wa.conversations(archiveId)).map(c => {
      if (!Number.isSafeInteger(c.messages) || c.messages < 0) return invalid();
      return { chatId: text(c.chat_id, 100), messages: c.messages, lastMessageAt: date(c.last_message_at), preview: nullable(c.preview),
        name: nullable(c.contact?.name ?? c.contact?.pushName, 200), kind: text(c.kind, 80), direction: direction(c.direction) };
    }));
  }
  messages(auth: string | undefined, archiveId: string, before?: string, chat?: string): Promise<WhatsAppMessageView[]> {
    if (before !== undefined && (typeof before !== "string" || !uuid.test(before))) throw new BadRequestException("Cursore non valido");
    if (chat !== undefined && (typeof chat !== "string" || chat.length > 100)) throw new BadRequestException("Conversazione non valida");
    return this.run(auth, "whatsapp.read", async wa => rows(await wa.messages(archiveId, before, chat)).map(m => ({
      id: id(m.id), chatId: text(m.chat_id, 100), direction: direction(m.direction), kind: text(m.kind, 80), occurredAt: date(m.occurred_at),
      text: nullable(m.body?.text ?? (m.body?.interactive && "body" in m.body.interactive ? m.body.interactive.body : null)),
      selectedButtonId: nullable(m.body?.selectedButtonId, 200),
    })));
  }
  outbox(auth?: string): Promise<WhatsAppOutboxView[]> {
    return this.run(auth, "whatsapp.read", async wa => rows(await wa.outbox()).map(o => ({
      id: id(o.id), sessionId: id(o.session_id), state: text(o.state, 80), createdAt: date(o.created_at), hasError: o.error != null,
    })));
  }
  send(auth: string | undefined, sessionId: string, input: WhatsAppSendInput) {
    return this.run(auth, "whatsapp.send", async (wa, actor) => {
      // Connect's installation-wide key is namespaced by the authenticated local actor.
      const hash = createHash("sha256").update(JSON.stringify([actor.tenantId, actor.userId, input.idempotencyKey])).digest("hex");
      const key = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}` as const;
      return ack(await wa.sendText(sessionId, input.to, input.text, key));
    });
  }
}
