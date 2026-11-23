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
  WhatsAppAudienceView, WhatsAppBroadcastInput, WhatsAppBroadcastResult,
} from "../../common/whatsapp-contract";
import { appointmentPhone } from "../notifications/appointment-automation-state";

/** Most recipients per «Invia a tutti»: larger lists risk the number being blocked. */
export const BROADCAST_LIMIT = 500;
/**
 * Customer phone in international form. Numbers saved without prefix are
 * Italian (the salon's country), e.g. «333 1234567» → +393331234567.
 */
export function customerWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const compact = phone.trim().replace(/[\s().-]/g, "");
  const international = compact.startsWith("+") || compact.startsWith("00") ? compact : `+39${compact}`;
  const digits = appointmentPhone(international);
  return digits ? `+${digits}` : null;
}
function actorKey(parts: unknown[]) {
  const hash = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}` as const;
}

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

type Actor = { tenantId: string; userId: string };
type RawSession = Awaited<ReturnType<Client["sessions"]>>[number];
/**
 * States in which the WhatsApp device is no longer linked. "failed" is not
 * here: it can be a transient runner error that "Riconnetti" recovers.
 */
const UNLINKED_STATES = new Set(["disconnected", "logged_out", "loggedout", "unpaired", "closed", "expired", "revoked"]);
const endedOutsideAlora = (s: RawSession) =>
  s.closed_at != null || UNLINKED_STATES.has(String(s.state ?? "").toLowerCase());
const notMine = () => new NotFoundException("Collegamento WhatsApp non disponibile per il tuo account");

/**
 * The SDK owns authentication, installation selection, refresh and provider
 * sessions. Ownership rule: an account sees and manages only the WhatsApp
 * connections it created from ALORA (table WhatsAppLink). Connections opened
 * elsewhere (e.g. in Connect) or by colleagues are never listed or usable here.
 */
@Injectable()
export class WhatsAppService {
  constructor(private readonly prisma: PrismaService) {}

  private async run<T>(authorization: string | undefined, permission: FunctionKey,
    operation: (client: Client, actor: Actor) => Promise<T>): Promise<T> {
    const session = await resolveRequestSession(this.prisma, authorization);
    const user = requireUser(session), tenantId = requireTenantId(session);
    if (user.technicalAccess || user.role === "platform_admin" || !canUseLocalFunction(user, permission))
      throw new ForbiddenException("Permesso WhatsApp esplicito richiesto");
    if (!session.connectSessionId) throw new UnauthorizedException("Accedi tramite Connect");
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

  /**
   * Active ALORA links of this account, reconciled with what Connect still has.
   * A connection ended outside ALORA (device unlinked from the phone, session
   * closed by Connect) can never work again: it is removed here, so the account
   * sees "Nessun numero collegato" and can pair a new QR. A disconnect requested
   * from ALORA stays listed and reconnectable.
   */
  private async mine(wa: Client, actor: Actor): Promise<RawSession[]> {
    const links = await this.prisma.whatsAppLink.findMany({
      where: { tenantId: actor.tenantId, userId: actor.userId, removedAt: null },
      select: { sessionId: true, disconnectRequestedAt: true },
    });
    if (!links.length) return [];
    const byId = new Map(links.map((link) => [link.sessionId, link]));
    const all = rows(await wa.sessions());
    const present = all.filter((item) => byId.has(item.id));
    const gone = [...byId.keys()].filter((id) => !present.some((item) => item.id === id));
    const endedOutside = present.filter(
      (item) => !byId.get(item.id)?.disconnectRequestedAt && endedOutsideAlora(item),
    );
    for (const item of endedOutside) {
      // Best effort: free the slot in Connect (one open connection per activity).
      try {
        await wa.deleteConnection(item.id);
      } catch {
        /* already gone or not deletable: the local link is removed anyway */
      }
    }
    const removed = [...gone, ...endedOutside.map((item) => item.id)];
    if (removed.length)
      await this.prisma.whatsAppLink.updateMany({ where: { sessionId: { in: removed } }, data: { removedAt: new Date() } });
    return present.filter((item) => !endedOutside.includes(item));
  }

  private async ownedSession(wa: Client, actor: Actor, sessionId: string): Promise<RawSession> {
    const session = (await this.mine(wa, actor)).find((item) => item.id === sessionId);
    if (!session) throw notMine();
    return session;
  }

  private async ownedArchive(wa: Client, actor: Actor, archiveId: string): Promise<void> {
    if (!(await this.mine(wa, actor)).some((item) => item.archive_id === archiveId)) throw notMine();
  }

  private view(s: RawSession): WhatsAppConnection {
    if (typeof s.runner_online !== "boolean" || !Number.isSafeInteger(s.sync_count) || s.sync_count < 0) return invalid();
    return { id: id(s.id), number: nullable(s.number, 100), state: text(s.state, 80), archiveId: s.archive_id == null ? null : id(s.archive_id),
      runnerOnline: s.runner_online, createdAt: date(s.created_at), closedAt: s.closed_at == null ? null : date(s.closed_at),
      syncStatus: text(s.sync_status, 80), syncCount: s.sync_count };
  }

  sessions(auth?: string): Promise<WhatsAppConnection[]> {
    return this.run(auth, "whatsapp.read", async (wa, actor) => (await this.mine(wa, actor)).map((s) => this.view(s)));
  }

  /** One open connection per account: a second request returns the existing one. */
  connect(auth?: string) {
    return this.run(auth, "whatsapp.manage", async (wa, actor) => {
      const open = (await this.mine(wa, actor)).find((item) => item.closed_at == null);
      if (open) return { id: id(open.id), state: text(open.state, 80) };
      let created: WhatsAppAcknowledgement;
      try {
        created = ack(await wa.connect());
      } catch (error) {
        // Connect allows one open WhatsApp connection per activity.
        if (error && typeof error === "object" && "status" in error && error.status === 409)
          throw new ConflictException(
            "L’attività ha già un collegamento WhatsApp aperto, creato in Connect o da un altro account. Chiudilo o eliminalo in Connect per collegare il tuo numero.",
          );
        throw error;
      }
      await this.prisma.whatsAppLink.create({
        data: { tenantId: actor.tenantId, userId: actor.userId, sessionId: created.id },
      });
      return created;
    });
  }
  reconnect(auth: string | undefined, sessionId: string) {
    return this.run(auth, "whatsapp.manage", async (wa, actor) => {
      await this.ownedSession(wa, actor, sessionId);
      const result = ack(await wa.reconnect(sessionId));
      // Back in use: a later disconnect not asked from ALORA removes it again.
      await this.prisma.whatsAppLink.updateMany({ where: { sessionId }, data: { disconnectRequestedAt: null } });
      return result;
    });
  }
  disconnect(auth: string | undefined, sessionId: string) {
    return this.run(auth, "whatsapp.manage", async (wa, actor) => {
      await this.ownedSession(wa, actor, sessionId);
      // Recorded first: the state change may be observed before Connect answers.
      await this.prisma.whatsAppLink.updateMany({ where: { sessionId }, data: { disconnectRequestedAt: new Date() } });
      return ack(await wa.disconnect(sessionId));
    });
  }
  /** Removes the connection in Connect; the message archive is kept. */
  remove(auth: string | undefined, sessionId: string) {
    return this.run(auth, "whatsapp.manage", async (wa, actor) => {
      await this.ownedSession(wa, actor, sessionId);
      const result = await wa.deleteConnection(sessionId);
      if (typeof result?.removed !== "boolean") return invalid();
      await this.prisma.whatsAppLink.updateMany({ where: { sessionId }, data: { removedAt: new Date() } });
      return { id: sessionId, state: text(result.state, 80) };
    });
  }
  qr(auth: string | undefined, sessionId: string) {
    return this.run(auth, "whatsapp.manage", async (wa, actor) => {
      await this.ownedSession(wa, actor, sessionId);
      const value = await wa.qr(sessionId), state = text(value?.state, 80), qr = nullable(value?.qr, 500000);
      if (qr !== null && (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qr) || state !== "pairing")) return invalid();
      return { state, qr };
    });
  }
  archives(auth?: string): Promise<WhatsAppArchiveView[]> {
    return this.run(auth, "whatsapp.read", async (wa, actor) => {
      const archiveIds = new Set((await this.mine(wa, actor)).map((item) => item.archive_id).filter(Boolean));
      if (!archiveIds.size) return [];
      return rows(await wa.archives())
        .filter((a) => archiveIds.has(a.id))
        .map((a) => ({ id: id(a.id), number: text(a.number, 100) }));
    });
  }
  conversations(auth: string | undefined, archiveId: string): Promise<WhatsAppConversationView[]> {
    return this.run(auth, "whatsapp.read", async (wa, actor) => {
      await this.ownedArchive(wa, actor, archiveId);
      return rows(await wa.conversations(archiveId)).map(c => {
        if (!Number.isSafeInteger(c.messages) || c.messages < 0) return invalid();
        return { chatId: text(c.chat_id, 100), messages: c.messages, lastMessageAt: date(c.last_message_at), preview: nullable(c.preview),
          name: nullable(c.contact?.name ?? c.contact?.pushName, 200), kind: text(c.kind, 80), direction: direction(c.direction) };
      });
    });
  }
  messages(auth: string | undefined, archiveId: string, before?: string, chat?: string): Promise<WhatsAppMessageView[]> {
    if (before !== undefined && (typeof before !== "string" || !uuid.test(before))) throw new BadRequestException("Cursore non valido");
    if (chat !== undefined && (typeof chat !== "string" || chat.length > 100)) throw new BadRequestException("Conversazione non valida");
    return this.run(auth, "whatsapp.read", async (wa, actor) => {
      await this.ownedArchive(wa, actor, archiveId);
      return rows(await wa.messages(archiveId, before, chat)).map(m => ({
        id: id(m.id), chatId: text(m.chat_id, 100), direction: direction(m.direction), kind: text(m.kind, 80), occurredAt: date(m.occurred_at),
        text: nullable(m.body?.text ?? (m.body?.interactive && "body" in m.body.interactive ? m.body.interactive.body : null)),
        selectedButtonId: nullable(m.body?.selectedButtonId, 200),
      }));
    });
  }
  outbox(auth?: string): Promise<WhatsAppOutboxView[]> {
    return this.run(auth, "whatsapp.read", async (wa, actor) => {
      const sessionIds = new Set((await this.mine(wa, actor)).map((item) => item.id));
      if (!sessionIds.size) return [];
      return rows(await wa.outbox())
        .filter((o) => sessionIds.has(o.session_id))
        .map(o => ({ id: id(o.id), sessionId: id(o.session_id), state: text(o.state, 80), createdAt: date(o.created_at), hasError: o.error != null }));
    });
  }
  send(auth: string | undefined, sessionId: string, input: WhatsAppSendInput) {
    return this.run(auth, "whatsapp.send", async (wa, actor) => {
      await this.ownedSession(wa, actor, sessionId);
      if (!!input.customerId === !!input.to) throw new BadRequestException("Scegli un cliente o un numero");
      let to = input.to!;
      if (input.customerId) {
        const customer = await this.prisma.customer.findFirst({
          where: { id: input.customerId, tenantId: actor.tenantId, isActive: true },
          select: { phone: true },
        });
        if (!customer) throw new NotFoundException("Cliente non trovato");
        const number = customerWhatsAppNumber(customer.phone);
        if (!number) throw new BadRequestException("Il cliente non ha un numero di telefono valido");
        to = number;
      }
      // Connect's installation-wide key is namespaced by the authenticated local actor.
      const key = actorKey([actor.tenantId, actor.userId, input.idempotencyKey]);
      return ack(await wa.sendText(sessionId, to, input.text, key));
    });
  }
  private broadcastCustomers(tenantId: string) {
    return this.prisma.customer.findMany({
      where: { tenantId, isActive: true, phone: { not: null } },
      select: { id: true, phone: true, marketingConsent: true },
      orderBy: { id: "asc" },
    });
  }
  async audience(auth?: string): Promise<WhatsAppAudienceView> {
    const session = await resolveRequestSession(this.prisma, auth);
    const user = requireUser(session), tenantId = requireTenantId(session);
    if (user.technicalAccess || user.role === "platform_admin" || !canUseLocalFunction(user, "whatsapp.send"))
      throw new ForbiddenException("Permesso WhatsApp esplicito richiesto");
    const [customers, rows] = await Promise.all([
      this.prisma.customer.count({ where: { tenantId, isActive: true } }),
      this.broadcastCustomers(tenantId),
    ]);
    const reachable = rows.filter((row) => customerWhatsAppNumber(row.phone));
    return { customers, withPhone: reachable.length, eligible: reachable.filter((row) => row.marketingConsent).length };
  }
  /**
   * One message per customer, each with its own key derived from the request
   * key: repeating the same request never sends a customer the text twice.
   */
  broadcast(auth: string | undefined, sessionId: string, input: WhatsAppBroadcastInput): Promise<WhatsAppBroadcastResult> {
    return this.run(auth, "whatsapp.send", async (wa, actor) => {
      await this.ownedSession(wa, actor, sessionId);
      const rows = await this.broadcastCustomers(actor.tenantId);
      const seen = new Set<string>();
      const targets: Array<{ id: string; to: string }> = [];
      let skipped = 0;
      for (const row of rows) {
        const to = row.marketingConsent ? customerWhatsAppNumber(row.phone) : null;
        // Same number on two customer cards: one message only.
        if (!to || seen.has(to)) { skipped++; continue; }
        seen.add(to);
        targets.push({ id: row.id, to });
      }
      if (!targets.length) throw new BadRequestException("Nessun cliente con telefono e consenso marketing");
      if (targets.length > BROADCAST_LIMIT)
        throw new BadRequestException(`Troppi destinatari (${targets.length}): il massimo per invio è ${BROADCAST_LIMIT}`);
      let sent = 0, failed = 0;
      for (let index = 0; index < targets.length; index += 5) {
        const results = await Promise.allSettled(targets.slice(index, index + 5).map((target) =>
          wa.sendText(sessionId, target.to, input.text, actorKey([actor.tenantId, actor.userId, input.idempotencyKey, target.id]))));
        for (const result of results) {
          if (result.status === "fulfilled") sent++;
          else failed++;
        }
      }
      return { sent, failed, skipped };
    });
  }
}
