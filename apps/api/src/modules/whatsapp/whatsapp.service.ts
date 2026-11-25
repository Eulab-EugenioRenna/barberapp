import {
  BadGatewayException, BadRequestException, ConflictException, ForbiddenException,
  HttpException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit,
  ServiceUnavailableException, UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
  WhatsAppAudienceView, WhatsAppBroadcastInput, WhatsAppBroadcastView, WhatsAppImageInput,
  WhatsAppBroadcastDetail, WhatsAppBroadcastEventView, WhatsAppBroadcastRecipientView,
} from "../../common/whatsapp-contract";
import { appointmentPhone } from "../notifications/appointment-automation-state";

/** Most recipients per «Invia a tutti»: larger lists risk the number being blocked. */
export const BROADCAST_LIMIT = 500;
/** Recipients per background step, and the pauses that keep Connect's rate limit (15 req/s) far away. */
export const BROADCAST_STEP = 30;
export const broadcastTiming = {
  messageGapMs: 600, stepPauseMs: 20_000, busyPauseMs: 60_000,
  /** Each message waits for its outcome on Connect before the next one. */
  outcomePollMs: 1_500, outcomeTimeoutMs: 120_000, stepBudgetMs: 4 * 60_000,
};
/** Photos of closed queues are kept this long so «Completa e riprova» works for them too. */
const BROADCAST_IMAGE_KEEP_MS = 7 * 24 * 3600_000;
const BROADCAST_MAX_ATTEMPTS = 5;
/** Who already got this very text from ALORA recently is not written to again. */
const BROADCAST_REPEAT_WINDOW_MS = 48 * 3600_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorStatus = (error: unknown) =>
  error && typeof error === "object" && "status" in error ? Number((error as { status: unknown }).status) : undefined;
/**
 * Customer phone in international form. Numbers saved without prefix are
 * Italian (the salon's country), e.g. «333 1234567» → +393331234567.
 */
export type PhoneIssue = "prefix_added" | "landline" | "invalid";
/**
 * How a saved phone becomes a WhatsApp number. Without a prefix only Italian
 * shapes are accepted (mobile 3…, landline 0…, «39» written without «+»);
 * anything else is invalid rather than guessed.
 */
export function checkCustomerPhone(phone: string | null | undefined): { to: string | null; issue: PhoneIssue | null } {
  const compact = (phone ?? "").trim().replace(/[\s()./-]/g, "");
  if (!compact) return { to: null, issue: null };
  const read = (value: string) => {
    const digits = appointmentPhone(value);
    return digits ? `+${digits}` : null;
  };
  if (compact.startsWith("+") || compact.startsWith("00")) {
    const to = read(compact);
    return { to, issue: to ? null : "invalid" };
  }
  if (/^393\d{8,9}$/.test(compact)) return { to: `+${compact}`, issue: "prefix_added" };
  if (/^3\d{8,9}$/.test(compact)) return { to: `+39${compact}`, issue: "prefix_added" };
  if (/^0\d{5,10}$/.test(compact)) return { to: `+39${compact}`, issue: "landline" };
  return { to: null, issue: "invalid" };
}
export function customerWhatsAppNumber(phone: string | null | undefined): string | null {
  return checkCustomerPhone(phone).to;
}
function actorKey(parts: unknown[]) {
  const hash = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}` as const;
}

/** Message kinds whose content is a file. */
export const MEDIA_KINDS = new Set(["image", "sticker", "ptt", "audio", "video", "document"]);
/** «2768…@lid» is a WhatsApp internal id, not a phone: only «@c.us» chats carry the number. */
export function chatPhone(chatId: string): string | null {
  const match = /^(\d{7,15})@c\.us$/.exec(chatId);
  return match ? `+${match[1]}` : null;
}
/** Readable outcome for «Invii»: what happened and what to do, never «check in Connect». */
export function sendProblem(state: string, error: string | null | undefined): string | null {
  if (state === "uncertain") {
    if (error?.startsWith("Runner interrotto"))
      return "Il servizio WhatsApp si è riavviato proprio mentre inviava: controlla sul telefono se il messaggio è arrivato prima di inviarlo di nuovo.";
    return "WhatsApp non ha confermato l’invio. Di solito il numero non ha WhatsApp, oppure il telefono del salone era scollegato o senza rete: controlla sul telefono se il messaggio è arrivato prima di inviarlo di nuovo.";
  }
  if (state === "cancelled") {
    if (error === "explicit_disconnect") return "Non inviato: il numero WhatsApp del salone è stato disconnesso prima dell’invio.";
    if (error === "authorization_revoked")
      return "Non inviato: al momento dell’invio il numero WhatsApp del salone non era connesso, oppure il tuo permesso di invio non era più attivo. Ricollega WhatsApp e riprova.";
    if (error === "delegation_revoked") return "Non inviato: l’autorizzazione agli invii automatici è stata revocata.";
    if (error === "command_withdrawn") return "Non inviato: l’invio è stato ritirato prima di partire.";
    if (error === "bot_configuration_changed") return "Non inviato: la risposta automatica è stata modificata prima dell’invio.";
    return "Invio annullato prima di partire.";
  }
  if (state === "failed") {
    if (error === "provider_rejected") return "WhatsApp ha rifiutato l’invio: di solito il numero non ha WhatsApp.";
    return "Invio non riuscito. Verifica che il numero sia connesso e riprova.";
  }
  return error ? "Invio non confermato: controlla sul telefono se il messaggio è arrivato." : null;
}
/** Why Connect refused one recipient of a «Messaggio a tutti», in words the salon understands. */
export function recipientProblem(error: unknown, attempts: number): string {
  const status = errorStatus(error);
  const tries = attempts > 1 ? ` (dopo ${attempts} tentativi)` : "";
  if (status === 400 || status === 422) return "Numero o messaggio rifiutato da WhatsApp: controlla il numero nella scheda cliente.";
  if (status === 404) return "Collegamento WhatsApp non trovato: ricollega il numero del salone.";
  if (status === 409) return "Messaggio già in invio per questo cliente.";
  if (status === 413) return "Foto troppo grande da inviare.";
  if (status === 429) return `WhatsApp ha chiesto di rallentare e non ha accettato il messaggio${tries}.`;
  return `Connect non raggiungibile${tries}: il messaggio non è partito.`;
}
/**
 * WhatsApp puts the low-resolution preview of a photo or video in the message
 * body as raw base64 JPEG: it is a thumbnail, never text to show.
 */
export function inlineThumbnail(value: string | null | undefined): string | null {
  if (!value || value.length < 200) return null;
  const compact = value.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  return compact.startsWith("/9j/") && compact.length <= 300_000 ? `data:image/jpeg;base64,${compact}` : "";
}
/** Data URL from Connect («data:audio/ogg; codecs=opus;base64,…») → bytes. */
export function decodeDataUrl(value: string): { mimetype: string; data: Buffer } | null {
  const match = /^data:([\w.+-]+\/[\w.+-]+)[^,]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match) return null;
  return { mimetype: match[1].toLowerCase(), data: Buffer.from(match[2], "base64") };
}
const customerName = (c: { firstName: string | null; lastName: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null;

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

type Actor = { tenantId: string; userId: string; connectSessionId?: string };
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
export class WhatsAppService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("WhatsAppBroadcast");
  private timer?: ReturnType<typeof setInterval>;
  private working = false;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env["NODE_ENV"] === "test") return;
    this.timer = setInterval(() => void this.tick(), 5000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Opens Connect with the stored credentials of one ALORA sign-in. */
  private async withConnect<T>(tenantId: string, userId: string, connectSessionId: string,
    operation: (client: Client, actor: Actor) => Promise<T>): Promise<T> {
    const linked = await this.prisma.connectSession.findFirst({
      where: { id: connectSessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { sdkSessionCipher: true, installationId: true },
    });
    if (!linked?.sdkSessionCipher) throw new UnauthorizedException("Ripeti l’accesso Connect");
    const binding = await loadConnectConfig(this.prisma, tenantId);
    if (!binding || binding.installationId !== linked.installationId)
      throw new ForbiddenException("Collegamento WhatsApp dell’attività da verificare");
    const application = await connectApplication(this.prisma);
    return application.services(openConnect(linked.sdkSessionCipher), (client, token) =>
      operation(client.whatsapp(token), { tenantId, userId, connectSessionId }));
  }

  private async run<T>(authorization: string | undefined, permission: FunctionKey,
    operation: (client: Client, actor: Actor) => Promise<T>): Promise<T> {
    const session = await resolveRequestSession(this.prisma, authorization);
    const user = requireUser(session), tenantId = requireTenantId(session);
    if (user.technicalAccess || user.role === "platform_admin" || !canUseLocalFunction(user, permission))
      throw new ForbiddenException("Permesso WhatsApp esplicito richiesto");
    if (!session.connectSessionId) throw new UnauthorizedException("Accedi tramite Connect");
    try {
      return await this.withConnect(tenantId, user.id, session.connectSessionId, operation);
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
      const list = rows(await wa.conversations(archiveId)).map(c => {
        if (!Number.isSafeInteger(c.messages) || c.messages < 0) return invalid();
        const chatId = text(c.chat_id, 100);
        const preview = nullable(c.preview);
        return { chatId, messages: c.messages, lastMessageAt: date(c.last_message_at),
          preview: inlineThumbnail(preview) === null ? preview : "📷 Foto",
          name: nullable(c.contact?.name ?? c.contact?.pushName, 200), kind: text(c.kind, 80), direction: direction(c.direction),
          phone: chatPhone(chatId), isGroup: chatId.endsWith("@g.us") || !!c.contact?.isGroup };
      });
      await this.nameChats(wa, actor, archiveId, list);
      return list;
    });
  }
  /**
   * Names, in order: customer saved in ALORA with the chat's phone, the WhatsApp
   * contact, the profile name the person uses when writing (kept in
   * WhatsAppChat). Chats never named are looked up a few at a time.
   */
  private async nameChats(wa: Client, actor: Actor, archiveId: string,
    list: Array<{ chatId: string; name: string | null; phone: string | null; isGroup: boolean; messages: number }>) {
    const phones = list.map((c) => c.phone).filter((p): p is string => !!p);
    if (phones.length) {
      const customers = await this.prisma.customer.findMany({
        where: { tenantId: actor.tenantId, isActive: true, phone: { not: null } },
        select: { phone: true, firstName: true, lastName: true },
      });
      const byPhone = new Map(customers.map((c) => [customerWhatsAppNumber(c.phone), customerName(c)]));
      for (const chat of list) if (chat.phone && byPhone.get(chat.phone)) chat.name = byPhone.get(chat.phone)!;
    }
    const known = await this.prisma.whatsAppChat.findMany({
      where: { tenantId: actor.tenantId, archiveId, chatId: { in: list.map((c) => c.chatId) } },
      select: { chatId: true, name: true, updatedAt: true },
    });
    const cache = new Map(known.map((k) => [k.chatId, k]));
    for (const chat of list) if (!chat.name) chat.name = cache.get(chat.chatId)?.name ?? null;
    // Groups: the sender name is a member, not the group.
    const stale = Date.now() - 6 * 3600_000;
    const missing = list
      .filter((c) => !c.name && !c.isGroup && c.messages > 0 && !(cache.get(c.chatId) && cache.get(c.chatId)!.updatedAt.getTime() > stale))
      .slice(0, 5);
    await Promise.all(missing.map(async (chat) => {
      try {
        const sender = rows(await wa.messages(archiveId, undefined, chat.chatId))
          .find((m) => m.direction === "in" && typeof m.body?.senderName === "string" && m.body.senderName.trim().length > 1);
        chat.name = sender ? sender.body.senderName!.trim().slice(0, 200) : null;
        await this.rememberChat(actor, archiveId, chat.chatId, chat.name);
      } catch { /* named on a later refresh */ }
    }));
  }
  private rememberChat(actor: Actor, archiveId: string, chatId: string, name: string | null) {
    return this.prisma.whatsAppChat.upsert({
      where: { archiveId_chatId: { archiveId, chatId } },
      create: { tenantId: actor.tenantId, archiveId, chatId, name },
      update: { name },
    });
  }
  messages(auth: string | undefined, archiveId: string, before?: string, chat?: string): Promise<WhatsAppMessageView[]> {
    if (before !== undefined && (typeof before !== "string" || !uuid.test(before))) throw new BadRequestException("Cursore non valido");
    if (chat !== undefined && (typeof chat !== "string" || chat.length > 100)) throw new BadRequestException("Conversazione non valida");
    return this.run(auth, "whatsapp.read", async (wa, actor) => {
      await this.ownedArchive(wa, actor, archiveId);
      const list = rows(await wa.messages(archiveId, before, chat)).map(m => {
        const kind = text(m.kind, 80);
        const raw = nullable(m.body?.text ?? (m.body?.interactive && "body" in m.body.interactive ? m.body.interactive.body : null)) || null;
        // Base64 in the body is the attachment preview: shown as a picture, never as text.
        const thumbnail = MEDIA_KINDS.has(kind) ? inlineThumbnail(raw) : null;
        return {
          id: id(m.id), chatId: text(m.chat_id, 100), direction: direction(m.direction), kind, occurredAt: date(m.occurred_at),
          // Connect keeps the caption only when there is no preview: nothing else to show.
          text: thumbnail === null ? raw : null,
          selectedButtonId: nullable(m.body?.selectedButtonId, 200),
          media: MEDIA_KINDS.has(kind)
            ? { mimetype: nullable(m.body?.mimetype, 200), filename: nullable(m.body?.filename, 300), thumbnail: thumbnail || null } : null,
          senderName: nullable(m.body?.senderName, 200),
        };
      });
      const named = chat && !chat.endsWith("@g.us")
        ? list.find((m) => m.direction === "inbound" && m.senderName && m.senderName.trim().length > 1) : undefined;
      if (named && chat) await this.rememberChat(actor, archiveId, chat, named.senderName!.trim());
      return list;
    });
  }
  /**
   * Attachment of a message. Copied into ALORA the first time it is available,
   * then always served from here. null: Connect is still recovering it.
   */
  media(auth: string | undefined, archiveId: string, messageId: string) {
    if (!uuid.test(messageId)) throw new BadRequestException("Messaggio non valido");
    return this.run(auth, "whatsapp.read", async (wa, actor) => {
      const where = { archiveId_messageId: { archiveId, messageId } };
      const saved = await this.prisma.whatsAppMedia.findUnique({ where, select: { tenantId: true, mimetype: true, filename: true, data: true } });
      if (saved && saved.tenantId !== actor.tenantId) throw notMine();
      await this.ownedArchive(wa, actor, archiveId);
      if (saved) return { mimetype: saved.mimetype, filename: saved.filename, data: Buffer.from(saved.data) };
      const result = await wa.media(archiveId, messageId);
      if (!result?.data) return null;
      const decoded = decodeDataUrl(result.data);
      if (!decoded) return invalid();
      await this.prisma.whatsAppMedia.upsert({
        where,
        create: { tenantId: actor.tenantId, archiveId, messageId, mimetype: decoded.mimetype, size: decoded.data.length, data: decoded.data },
        update: {},
      });
      return { mimetype: decoded.mimetype, filename: null, data: decoded.data };
    });
  }
  outbox(auth?: string): Promise<WhatsAppOutboxView[]> {
    return this.run(auth, "whatsapp.read", async (wa, actor) => {
      const sessionIds = new Set((await this.mine(wa, actor)).map((item) => item.id));
      if (!sessionIds.size) return [];
      const items = rows(await wa.outbox()).filter((o) => sessionIds.has(o.session_id));
      const records = await this.prisma.whatsAppSend.findMany({
        where: { tenantId: actor.tenantId, outboxId: { in: items.map((o) => o.id) } },
        select: { outboxId: true, recipientName: true, recipient: true, preview: true, kind: true },
      });
      const byId = new Map(records.map((r) => [r.outboxId, r]));
      // Messages of a «Messaggio a tutti» are grouped under it in «Invii».
      const grouped = await this.prisma.whatsAppBroadcastRecipient.findMany({
        where: { outboxId: { in: items.map((o) => o.id) }, broadcast: { tenantId: actor.tenantId } },
        select: { outboxId: true, broadcastId: true },
      });
      const broadcastOf = new Map(grouped.map((r) => [r.outboxId, r.broadcastId]));
      return items.map(o => {
        const state = text(o.state, 80), record = byId.get(o.id);
        return { id: id(o.id), sessionId: id(o.session_id), state, createdAt: date(o.created_at), hasError: o.error != null,
          problem: sendProblem(state, o.error), recipientName: record ? record.recipientName || record.recipient : null,
          preview: record?.preview ?? null, kind: record?.kind ?? null, recipient: record?.recipient ?? null,
          broadcastId: broadcastOf.get(o.id) ?? null };
      });
    });
  }
  /** Text or image message, recorded so «Invii» can say to whom and what. */
  private async deliver(wa: Client, actor: Actor, sessionId: string, target: { to: string; customerId?: string; name: string | null },
    input: { text?: string; image?: WhatsAppImageInput }, key: ReturnType<typeof actorKey>) {
    const body = input.text?.trim() ? input.text : "";
    const result = ack(input.image
      ? await wa.send(sessionId, { kind: "image", to: target.to, data: input.image.data, filename: input.image.filename, caption: body }, key)
      : await wa.sendText(sessionId, target.to, body, key));
    const preview = (body || (input.image ? "Foto" : "")).slice(0, 300) || null;
    try {
      await this.prisma.whatsAppSend.upsert({
        where: { outboxId: result.id },
        create: { tenantId: actor.tenantId, userId: actor.userId, sessionId, outboxId: result.id, customerId: target.customerId ?? null,
          recipient: target.to, recipientName: target.name, kind: input.image ? "image" : "text", preview },
        update: {},
      });
    } catch { /* the message is sent anyway: only the label in «Invii» is missing */ }
    return result;
  }
  private requireContent(input: { text?: string; image?: WhatsAppImageInput }) {
    if (!input.image && !input.text?.trim()) throw new BadRequestException("Scrivi un messaggio o allega una foto");
    if (input.image && (input.text?.length ?? 0) > 2000) throw new BadRequestException("La didascalia della foto può avere al massimo 2000 caratteri");
  }
  send(auth: string | undefined, sessionId: string, input: WhatsAppSendInput) {
    return this.run(auth, "whatsapp.send", async (wa, actor) => {
      await this.ownedSession(wa, actor, sessionId);
      if (!!input.customerId === !!input.to) throw new BadRequestException("Scegli un cliente o un numero");
      this.requireContent(input);
      let to = input.to!, name: string | null = null;
      if (input.customerId) {
        const customer = await this.prisma.customer.findFirst({
          where: { id: input.customerId, tenantId: actor.tenantId, isActive: true },
          select: { phone: true, firstName: true, lastName: true },
        });
        if (!customer) throw new NotFoundException("Cliente non trovato");
        const number = customerWhatsAppNumber(customer.phone);
        if (!number)
          throw new BadRequestException(
            customer.phone?.trim()
              ? "Il numero del cliente non è leggibile: senza prefisso valgono solo i numeri italiani. Aggiungi il prefisso (es. +41) nella scheda cliente."
              : "Il cliente non ha un numero di telefono",
          );
        to = number; name = customerName(customer);
      } else {
        const chat = await this.prisma.whatsAppChat.findFirst({ where: { tenantId: actor.tenantId, chatId: to }, select: { name: true } });
        name = chat?.name ?? chatPhone(to);
      }
      // Connect's installation-wide key is namespaced by the authenticated local actor.
      const key = actorKey([actor.tenantId, actor.userId, input.idempotencyKey]);
      return this.deliver(wa, actor, sessionId, { to, customerId: input.customerId, name }, input, key);
    });
  }
  private broadcastCustomers(tenantId: string) {
    return this.prisma.customer.findMany({
      where: { tenantId, isActive: true, phone: { not: null } },
      select: { id: true, phone: true, firstName: true, lastName: true },
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
    // Consent is collected outside ALORA: every reachable number, once.
    const checked = rows.map((row) => ({ row, ...checkCustomerPhone(row.phone) }));
    const numbers = checked.flatMap((item) => (item.to ? [item.to] : []));
    const invalid = checked.filter((item) => item.issue === "invalid");
    return {
      customers,
      withPhone: numbers.length,
      eligible: new Set(numbers).size,
      prefixAdded: checked.filter((item) => item.issue === "prefix_added").length,
      landline: checked.filter((item) => item.issue === "landline").length,
      invalid: invalid.length,
      invalidCustomers: invalid.slice(0, 10).map((item) => ({
        id: item.row.id,
        name: customerName(item.row) ?? "Cliente senza nome",
        phone: item.row.phone ?? "",
      })),
    };
  }
  private broadcastView(row: {
    id: string; status: string; total: number; sent: number; failed: number; skipped: number; uncertain?: number;
    error: string | null; text: string | null; image?: unknown; createdAt: Date; finishedAt: Date | null;
  }): WhatsAppBroadcastView {
    const text = row.text?.trim() ?? "";
    return {
      id: row.id, status: row.status as WhatsAppBroadcastView["status"], total: row.total, sent: row.sent,
      failed: row.failed, skipped: row.skipped, uncertain: row.uncertain ?? 0,
      pending: Math.max(0, row.total - row.sent - row.failed - (row.uncertain ?? 0)),
      error: row.error, preview: text ? text.slice(0, 80) : row.image ? "Foto" : null,
      createdAt: row.createdAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null,
      retryable: (row.status === "done" || row.status === "cancelled") && (!!text || !!row.image),
    };
  }
  /**
   * «Messaggio a tutti» is queued and sent in the background, 30 recipients
   * per step (see tick). Each recipient has its own key derived from the
   * request key: repeating the request never writes to a customer twice.
   * Several messages can be queued: each is its own queue, and a number gets
   * the next message only after the earlier one reached it (see step).
   */
  broadcast(auth: string | undefined, sessionId: string, input: WhatsAppBroadcastInput): Promise<WhatsAppBroadcastView> {
    return this.run(auth, "whatsapp.send", async (wa, actor) => {
      const existing = await this.prisma.whatsAppBroadcast.findUnique({
        where: { tenantId_userId_idempotencyKey: { tenantId: actor.tenantId, userId: actor.userId, idempotencyKey: input.idempotencyKey } },
      });
      if (existing) return this.broadcastView(existing);
      await this.ownedSession(wa, actor, sessionId);
      this.requireContent(input);
      if (await this.sameContentQueued(actor.tenantId, input)) throw new ConflictException("Questo messaggio è già in coda");
      const already = new Set((await this.reachedWith(actor.tenantId, input, new Date(Date.now() - BROADCAST_REPEAT_WINDOW_MS))).keys());
      const rows = await this.broadcastCustomers(actor.tenantId);
      const seen = new Map<string, string>();
      const targets: Array<{ customerId: string; recipient: string; name: string | null }> = [];
      // Who is left out stays in the detail card, with the reason.
      const left: Array<{ customerId: string; recipient: string; name: string | null; error: string }> = [];
      for (const row of rows) {
        const to = customerWhatsAppNumber(row.phone), name = customerName(row);
        const raw = (row.phone ?? "").trim().slice(0, 40);
        if (!to) {
          left.push({ customerId: row.id, recipient: raw, name,
            error: raw ? "Numero non leggibile: senza prefisso valgono solo i numeri italiani" : "Nessun numero di telefono" });
          continue;
        }
        // Same number on two customer cards, or already reached with this text: one message only.
        if (seen.has(to)) { left.push({ customerId: row.id, recipient: to, name, error: `Stesso numero di ${seen.get(to)}: riceve un solo messaggio` }); continue; }
        if (already.has(to)) { left.push({ customerId: row.id, recipient: to, name, error: "Ha già ricevuto questo messaggio nelle ultime 48 ore" }); continue; }
        seen.set(to, name || to);
        targets.push({ customerId: row.id, recipient: to, name });
      }
      const skipped = left.length;
      if (!targets.length)
        throw new BadRequestException(already.size
          ? "Tutti i clienti con telefono hanno già ricevuto questo messaggio"
          : "Nessun cliente con un numero di telefono valido");
      if (targets.length > BROADCAST_LIMIT)
        throw new BadRequestException(`Troppi destinatari (${targets.length}): il massimo per invio è ${BROADCAST_LIMIT}`);
      const job = await this.prisma.whatsAppBroadcast.create({
        data: {
          tenantId: actor.tenantId, userId: actor.userId, connectSessionId: actor.connectSessionId!, sessionId,
          idempotencyKey: input.idempotencyKey, text: input.text?.trim() ? input.text : null,
          image: input.image ? ({ data: input.image.data, filename: input.image.filename } as Prisma.InputJsonValue) : undefined,
          total: targets.length, skipped, contentHash: this.contentHash(input),
          recipients: { create: [
            ...targets.map((target, position) => ({ ...target, position })),
            ...left.map((target, index) => ({ ...target, state: "skipped", position: targets.length + index })),
          ] },
        },
      });
      this.logger.log(`${job.id}: in coda ${targets.length} destinatari, ${skipped} saltati`);
      await this.event(job.id, "queued", { pending: targets.length, note: skipped ? `${skipped} saltati` : null });
      setTimeout(() => void this.tick(), 100);
      return this.broadcastView(job);
    });
  }
  private async ownBroadcast(auth: string | undefined, id: string) {
    const session = await resolveRequestSession(this.prisma, auth);
    const user = requireUser(session), tenantId = requireTenantId(session);
    if (user.technicalAccess || user.role === "platform_admin" || !canUseLocalFunction(user, "whatsapp.send"))
      throw new ForbiddenException("Permesso WhatsApp esplicito richiesto");
    const job = await this.prisma.whatsAppBroadcast.findFirst({ where: { id, tenantId, userId: user.id } });
    if (!job) throw new NotFoundException("Invio non trovato");
    return { job, session, user };
  }
  async broadcastStatus(auth: string | undefined, id: string): Promise<WhatsAppBroadcastView> {
    return this.broadcastView((await this.ownBroadcast(auth, id)).job);
  }
  /** Recent «Messaggio a tutti» of this account, newest first, for «Invii». */
  async listBroadcasts(auth: string | undefined): Promise<WhatsAppBroadcastView[]> {
    const session = await resolveRequestSession(this.prisma, auth);
    const user = requireUser(session), tenantId = requireTenantId(session);
    const jobs = await this.prisma.whatsAppBroadcast.findMany({
      where: { tenantId, userId: user.id }, orderBy: { createdAt: "desc" }, take: 30,
    });
    return jobs.map((job) => this.broadcastView(job));
  }
  /** Detail card of one queue: its steps and every recipient. */
  async broadcastDetail(auth: string | undefined, id: string): Promise<WhatsAppBroadcastDetail> {
    const { job } = await this.ownBroadcast(auth, id);
    const [events, recipients] = await Promise.all([
      this.prisma.whatsAppBroadcastEvent.findMany({ where: { broadcastId: id }, orderBy: { at: "asc" }, take: 500 }),
      this.prisma.whatsAppBroadcastRecipient.findMany({ where: { broadcastId: id }, orderBy: { position: "asc" } }),
    ]);
    return {
      ...this.broadcastView(job),
      events: events.map((e) => ({
        kind: e.kind as WhatsAppBroadcastEventView["kind"], sent: e.sent, failed: e.failed, pending: e.pending,
        note: e.note, at: e.at.toISOString(),
      })),
      recipients: recipients.map((r) => ({
        name: r.name, recipient: r.recipient, state: r.state as WhatsAppBroadcastRecipientView["state"],
        attempts: r.attempts, error: r.error, outboxId: r.outboxId, sentAt: r.sentAt?.toISOString() ?? null,
      })),
    };
  }
  /** Best effort: the detail card must never stop a send. */
  private async event(broadcastId: string, kind: WhatsAppBroadcastEventView["kind"],
    data: { sent?: number; failed?: number; pending?: number; note?: string | null } = {}) {
    try {
      await this.prisma.whatsAppBroadcastEvent.create({ data: { broadcastId, kind, ...data } });
    } catch (error) {
      this.logger.warn(`${broadcastId}: passo non registrato – ${error instanceof Error ? error.message : error}`);
    }
  }
  /** Queues still running or paused, oldest first: each has its own progress. */
  async activeBroadcasts(auth: string | undefined): Promise<WhatsAppBroadcastView[]> {
    const session = await resolveRequestSession(this.prisma, auth);
    const user = requireUser(session), tenantId = requireTenantId(session);
    const jobs = await this.prisma.whatsAppBroadcast.findMany({
      where: { tenantId, userId: user.id, status: { in: ["running", "paused"] } },
      orderBy: { createdAt: "asc" }, take: 20,
    });
    return jobs.map((job) => this.broadcastView(job));
  }
  /** The latest «Messaggio a tutti» of this account, to show its progress again. */
  async latestBroadcast(auth: string | undefined): Promise<WhatsAppBroadcastView | null> {
    const session = await resolveRequestSession(this.prisma, auth);
    const user = requireUser(session), tenantId = requireTenantId(session);
    const job = await this.prisma.whatsAppBroadcast.findFirst({
      where: { tenantId, userId: user.id }, orderBy: { createdAt: "desc" },
    });
    return job ? this.broadcastView(job) : null;
  }
  async cancelBroadcast(auth: string | undefined, id: string): Promise<WhatsAppBroadcastView> {
    const { job } = await this.ownBroadcast(auth, id);
    if (!["running", "paused"].includes(job.status)) return this.broadcastView(job);
    const updated = await this.prisma.whatsAppBroadcast.update({
      where: { id }, data: { status: "cancelled", finishedAt: new Date() },
    });
    this.logger.log(`${id}: annullato (${updated.sent} inviati)`);
    await this.event(id, "cancelled", { sent: updated.sent, failed: updated.failed, pending: Math.max(0, updated.total - updated.sent - updated.failed) });
    return this.broadcastView(updated);
  }
  /** Resumes a paused job with the credentials of the current sign-in. */
  async resumeBroadcast(auth: string | undefined, id: string): Promise<WhatsAppBroadcastView> {
    const { job, session } = await this.ownBroadcast(auth, id);
    if (job.status !== "paused") return this.broadcastView(job);
    if (!session.connectSessionId) throw new UnauthorizedException("Accedi tramite Connect");
    const updated = await this.prisma.whatsAppBroadcast.update({
      where: { id },
      data: { status: "running", error: null, nextRunAt: new Date(), connectSessionId: session.connectSessionId },
    });
    await this.event(id, "resumed", { sent: updated.sent, failed: updated.failed, pending: Math.max(0, updated.total - updated.sent - updated.failed) });
    setTimeout(() => void this.tick(), 100);
    return this.broadcastView(updated);
  }
  /**
   * «Completa e riprova i rimanenti» on a closed queue: failed recipients and
   * messages Connect cancelled go again, and customers not reached yet
   * (new, or left out before the reasons were saved) are added. Whoever got
   * it or might have got it (not confirmed) is never written to twice.
   */
  async retryBroadcast(auth: string | undefined, id: string): Promise<WhatsAppBroadcastView> {
    const { job, session } = await this.ownBroadcast(auth, id);
    if (!["done", "cancelled"].includes(job.status)) return this.broadcastView(job);
    if (!job.text?.trim() && !job.image)
      throw new BadRequestException("La foto di questo invio non è più disponibile: crea un nuovo «Messaggio a tutti»");
    if (!session.connectSessionId) throw new UnauthorizedException("Accedi tramite Connect");
    const content = { text: job.text, image: job.image };
    if (await this.sameContentQueued(job.tenantId, content, id)) throw new ConflictException("Questo messaggio è già in coda");
    return this.run(auth, "whatsapp.send", async (wa, actor) => {
      const sessionIds = new Set((await this.mine(wa, actor)).map((item) => item.id));
      if (!sessionIds.has(job.sessionId)) throw new BadRequestException("Il numero WhatsApp di questo invio non è più collegato");
      const list = await this.prisma.whatsAppBroadcastRecipient.findMany({ where: { broadcastId: id }, orderBy: { position: "asc" } });
      const outbox = new Map(list.some((r) => r.state === "sent" && r.outboxId)
        ? rows(await wa.outbox()).map((o) => [String(o.id), String(o.state)] as const) : []);
      const failed = list.filter((r) => r.state === "failed" || (r.state === "pending"));
      const cancelled = list.filter((r) => r.state === "sent" && r.outboxId && outbox.get(r.outboxId) === "cancelled");
      // Numbers this queue already reached (or may have): never again.
      const reached = new Set(list.filter((r) => (r.state === "sent" && !cancelled.includes(r)) || r.state === "uncertain").map((r) => r.recipient));
      // Whoever got this content since 48 hours before the queue started, also from other sends.
      for (const [recipient, outboxId] of await this.reachedWith(job.tenantId, content,
        new Date(Math.min(Date.now(), job.createdAt.getTime()) - BROADCAST_REPEAT_WINDOW_MS)))
        if (!cancelled.some((r) => r.outboxId === outboxId)) reached.add(recipient);
      const retry = [...failed, ...cancelled].filter((r) => !reached.has(r.recipient));
      const taken = new Set([...reached, ...retry.map((r) => r.recipient)]);
      const known = new Set(list.map((r) => r.customerId));
      const added: Array<{ customerId: string; recipient: string; name: string | null }> = [];
      for (const customer of await this.broadcastCustomers(job.tenantId)) {
        const to = customerWhatsAppNumber(customer.phone);
        if (!to || taken.has(to)) continue;
        // Known customers come back only if they were left out for a missing or unreadable number, now fixed.
        if (known.has(customer.id) && !list.some((r) => r.customerId === customer.id && r.state === "skipped"
          && (r.error?.startsWith("Numero non leggibile") || r.error?.startsWith("Nessun numero")))) continue;
        taken.add(to);
        added.push({ customerId: customer.id, recipient: to, name: customerName(customer) });
      }
      if (!retry.length && !added.length)
        throw new BadRequestException("Niente da completare: tutti i clienti con un numero valido hanno già ricevuto questo messaggio");
      if (job.total + added.length > BROADCAST_LIMIT)
        throw new BadRequestException(`Troppi destinatari: il massimo per invio è ${BROADCAST_LIMIT}`);
      let position = list.reduce((max, r) => Math.max(max, r.position), -1) + 1;
      const wasFailed = retry.filter((r) => r.state === "failed").length;
      const wasSent = retry.filter((r) => r.state === "sent").length;
      const updated = await this.prisma.$transaction(async (tx) => {
        for (const r of retry)
          await tx.whatsAppBroadcastRecipient.update({
            where: { id: r.id }, data: { state: "pending", attempts: 0, error: null, outboxId: null, sentAt: null, round: { increment: 1 } },
          });
        // A skipped customer that now has a valid number moves back in the queue.
        const revived = added.filter((a) => list.some((r) => r.customerId === a.customerId));
        for (const a of revived)
          await tx.whatsAppBroadcastRecipient.updateMany({
            where: { broadcastId: id, customerId: a.customerId, state: "skipped" },
            data: { state: "pending", recipient: a.recipient, name: a.name, error: null, round: { increment: 1 } },
          });
        const fresh = added.filter((a) => !revived.includes(a));
        if (fresh.length)
          await tx.whatsAppBroadcastRecipient.createMany({
            data: fresh.map((a) => ({ ...a, broadcastId: id, position: position++, round: 1 })),
          });
        return tx.whatsAppBroadcast.update({
          where: { id },
          data: {
            status: "running", error: null, finishedAt: null, nextRunAt: new Date(), connectSessionId: session.connectSessionId!,
            total: { increment: added.length }, failed: { decrement: wasFailed }, sent: { decrement: wasSent },
            contentHash: job.contentHash ?? this.contentHash(content),
            skipped: { decrement: revived.length },
          },
        });
      });
      const note = [retry.length ? `${retry.length} da riprovare` : "", added.length ? `${added.length} clienti aggiunti` : ""]
        .filter(Boolean).join(" · ");
      this.logger.log(`${id}: completa e riprova – ${note}`);
      await this.event(id, "retried", { sent: updated.sent, failed: updated.failed, pending: retry.length + added.length, note });
      setTimeout(() => void this.tick(), 100);
      return this.broadcastView(updated);
    });
  }
  /** Same text and same photo → same hash: «already received» means exactly this content. */
  private contentHash(input: { text?: string | null; image?: unknown }) {
    const image = input.image as { data?: string } | null | undefined;
    return createHash("sha256").update(JSON.stringify([input.text?.trim() ?? "", image?.data ?? ""])).digest("hex");
  }
  /**
   * Who already got this content: for a photo, recipients of queues with the
   * same photo and text; for text alone, also single sends with the same text.
   */
  private async reachedWith(tenantId: string, input: { text?: string | null; image?: unknown }, since: Date) {
    const hash = this.contentHash(input);
    const rows = await this.prisma.whatsAppBroadcastRecipient.findMany({
      where: { state: { in: ["sent", "uncertain"] }, broadcast: { tenantId, contentHash: hash, createdAt: { gt: since } } },
      select: { recipient: true, outboxId: true },
    });
    const reached = new Map(rows.map((r) => [r.recipient, r.outboxId]));
    if (!input.image) {
      const sends = await this.prisma.whatsAppSend.findMany({
        where: { tenantId, preview: this.preview(input), kind: "text", createdAt: { gt: since } },
        select: { recipient: true, outboxId: true },
      });
      // A queue message that Connect refused or cancelled did not arrive.
      const failed = new Set((await this.prisma.whatsAppBroadcastRecipient.findMany({
        where: { outboxId: { in: sends.map((r) => r.outboxId) }, state: "failed" }, select: { outboxId: true },
      })).map((r) => r.outboxId));
      for (const row of sends) if (!failed.has(row.outboxId) && !reached.has(row.recipient)) reached.set(row.recipient, row.outboxId);
    }
    return reached;
  }
  private async sameContentQueued(tenantId: string, input: { text?: string | null; image?: unknown }, except?: string) {
    return this.prisma.whatsAppBroadcast.count({
      where: { tenantId, status: { in: ["running", "paused"] }, contentHash: this.contentHash(input), ...(except ? { id: { not: except } } : {}) },
    });
  }
  /** Waits for Connect's outcome of one queued message. */
  private async outcome(wa: Client, outboxId: string): Promise<{ state: "sent" | "failed" | "uncertain"; error: string | null }> {
    const until = Date.now() + broadcastTiming.outcomeTimeoutMs;
    for (;;) {
      const row = rows(await wa.outbox()).find((o) => o.id === outboxId);
      const state = row ? String(row.state) : "queued";
      if (state === "sent") return { state: "sent", error: null };
      if (state === "failed" || state === "cancelled")
        return { state: "failed", error: sendProblem(state, row?.error ?? null) };
      if (state === "uncertain") return { state: "uncertain", error: sendProblem(state, row?.error ?? null) };
      if (Date.now() > until)
        return { state: "uncertain", error: "Connect non ha dato l’esito entro 2 minuti: controlla sul telefono prima di inviarlo di nuovo." };
      await sleep(broadcastTiming.outcomePollMs);
    }
  }
  private preview(input: { text?: string | null; image?: unknown }) {
    const body = input.text?.trim() ? input.text : "";
    return (body || (input.image ? "Foto" : "")).slice(0, 300) || null;
  }

  /** Background worker: one step of one due job at a time. */
  async tick(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      await this.prisma.whatsAppBroadcast.updateMany({
        where: { status: { in: ["done", "cancelled"] }, finishedAt: { lt: new Date(Date.now() - BROADCAST_IMAGE_KEEP_MS) }, image: { not: Prisma.DbNull } },
        data: { image: Prisma.DbNull },
      }).catch(() => undefined);
      const due = await this.prisma.whatsAppBroadcast.findFirst({
        where: { status: "running", nextRunAt: { lte: new Date() } },
        orderBy: { nextRunAt: "asc" }, select: { id: true, nextRunAt: true },
      });
      if (!due) return;
      // Lease: a restart mid-step resumes after ten minutes, never twice at once.
      const claimed = await this.prisma.whatsAppBroadcast.updateMany({
        where: { id: due.id, status: "running", nextRunAt: due.nextRunAt },
        data: { nextRunAt: new Date(Date.now() + 10 * 60_000) },
      });
      if (claimed.count) await this.step(due.id);
    } catch (error) {
      this.logger.error(`passo non riuscito: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.working = false;
    }
  }

  private async step(id: string): Promise<void> {
    const job = await this.prisma.whatsAppBroadcast.findUniqueOrThrow({ where: { id } });
    // A number still waiting for an earlier queued message gets this one later.
    const waiting = await this.prisma.whatsAppBroadcastRecipient.findMany({
      where: {
        state: "pending",
        broadcast: {
          tenantId: job.tenantId, status: { in: ["running", "paused"] },
          OR: [{ createdAt: { lt: job.createdAt } }, { createdAt: job.createdAt, id: { lt: job.id } }],
        },
      },
      select: { recipient: true }, distinct: ["recipient"],
    });
    const batch = await this.prisma.whatsAppBroadcastRecipient.findMany({
      where: {
        broadcastId: id, state: "pending",
        ...(waiting.length ? { recipient: { notIn: waiting.map((row) => row.recipient) } } : {}),
      },
      orderBy: { position: "asc" }, take: BROADCAST_STEP,
    });
    if (!batch.length) {
      const pending = await this.prisma.whatsAppBroadcastRecipient.count({ where: { broadcastId: id, state: "pending" } });
      if (!pending) return this.finish(id);
      await this.prisma.whatsAppBroadcast.update({
        where: { id },
        data: {
          nextRunAt: new Date(Date.now() + broadcastTiming.stepPauseMs),
          error: `${pending} numeri aspettano che parta il messaggio precedente`,
        },
      });
      this.logger.log(`${id}: ${pending} numeri aspettano il messaggio precedente`);
      if (job.error !== `${pending} numeri aspettano che parta il messaggio precedente`)
        await this.event(id, "waiting", { sent: job.sent, failed: job.failed, pending, note: "Aspettano che parta il messaggio precedente" });
      return;
    }
    const input = {
      text: job.text ?? undefined,
      image: (job.image as WhatsAppImageInput | null) ?? undefined,
    };
    let sent = 0, failed = 0, uncertain = 0, busy = false;
    const started = Date.now();
    const pause = async (error: string) => {
      const paused = await this.prisma.whatsAppBroadcast.update({ where: { id }, data: { status: "paused", error } });
      this.logger.warn(`${id}: in pausa – ${error}`);
      await this.event(id, "paused", { sent: paused.sent, failed: paused.failed, note: error });
    };
    try {
      await this.withConnect(job.tenantId, job.userId, job.connectSessionId, async (wa, actor) => {
        for (const [index, target] of batch.entries()) {
          const current = await this.prisma.whatsAppBroadcast.findUnique({ where: { id }, select: { status: true } });
          if (current?.status !== "running") return;
          // Long steps hand over to the next tick, inside the ten-minute lease.
          if (Date.now() - started > broadcastTiming.stepBudgetMs) return;
          let queued: { id: string } | null = null;
          try {
            const result = await this.deliver(wa, actor, job.sessionId,
              { to: target.recipient, customerId: target.customerId, name: target.name }, input,
              actorKey(target.round
                ? [job.tenantId, job.userId, job.idempotencyKey, target.customerId, target.round]
                : [job.tenantId, job.userId, job.idempotencyKey, target.customerId]));
            queued = result;
            // Taken by Connect: from here on it is never sent again by ALORA.
            await this.prisma.whatsAppBroadcastRecipient.update({
              where: { id: target.id }, data: { state: "uncertain", outboxId: result.id, attempts: { increment: 1 }, error: "In invio" },
            });
            // One at a time: the next message leaves only after this one has its outcome.
            const outcome = await this.outcome(wa, result.id);
            await this.prisma.whatsAppBroadcastRecipient.update({
              where: { id: target.id },
              data: { state: outcome.state, error: outcome.error, sentAt: outcome.state === "sent" ? new Date() : null },
            });
            if (outcome.state === "sent") sent++;
            else if (outcome.state === "failed") failed++;
            else uncertain++;
          } catch (error) {
            if (queued) {
              // Already on Connect: the outcome is unknown, never resend.
              await this.prisma.whatsAppBroadcastRecipient.update({
                where: { id: target.id },
                data: { state: "uncertain", error: "Esito non letto da Connect: controlla sul telefono prima di inviarlo di nuovo." },
              });
              uncertain++;
              busy = true; break;
            }
            const status = errorStatus(error);
            if (status === 401 || status === 403) throw error;
            const transient = status === 429 || status === undefined || status >= 500;
            const giveUp = !transient || target.attempts + 1 >= BROADCAST_MAX_ATTEMPTS;
            await this.prisma.whatsAppBroadcastRecipient.update({
              where: { id: target.id },
              data: {
                attempts: { increment: 1 }, state: giveUp ? "failed" : "pending",
                error: recipientProblem(error, target.attempts + 1),
              },
            });
            if (giveUp) failed++;
            if (transient) { busy = true; break; }
          }
          if (index < batch.length - 1) await sleep(broadcastTiming.messageGapMs);
        }
      });
    } catch (error) {
      const status = errorStatus(error);
      if (error instanceof UnauthorizedException || status === 401)
        await pause("Accesso Connect scaduto: apri ALORA e premi «Riprendi»");
      else if (error instanceof ForbiddenException || status === 403)
        await pause("WhatsApp non autorizzato dalla delega o dalla licenza Connect");
      else { busy = true; this.logger.warn(`${id}: Connect non raggiungibile – ${error instanceof Error ? error.message : error}`); }
    }
    const updated = await this.prisma.whatsAppBroadcast.update({
      where: { id },
      data: {
        sent: { increment: sent }, failed: { increment: failed }, uncertain: { increment: uncertain },
        ...(busy ? { error: "WhatsApp occupato: riprovo tra un minuto" } : {}),
      },
    });
    const pending = await this.prisma.whatsAppBroadcastRecipient.count({ where: { broadcastId: id, state: "pending" } });
    this.logger.log(`${id}: passo +${sent} inviati, +${failed} non riusciti, +${uncertain} non confermati, ${pending} da inviare (totale ${updated.sent}/${updated.total})${busy ? ", Connect occupato" : ""}`);
    if (sent || failed || uncertain)
      await this.event(id, "step", { sent, failed, pending, note: uncertain ? `${uncertain} non confermati` : null });
    if (busy && job.error !== "WhatsApp occupato: riprovo tra un minuto") await this.event(id, "busy", { pending, note: "WhatsApp occupato: riprovo tra un minuto" });
    if (updated.status !== "running") return;
    if (!pending) return this.finish(id);
    await this.prisma.whatsAppBroadcast.update({
      where: { id },
      data: {
        nextRunAt: new Date(Date.now() + (busy ? broadcastTiming.busyPauseMs : broadcastTiming.stepPauseMs)),
        ...(busy ? {} : { error: null }),
      },
    });
  }
  private async finish(id: string) {
    const job = await this.prisma.whatsAppBroadcast.update({
      // The photo stays a week, for «Completa e riprova».
      where: { id }, data: { status: "done", finishedAt: new Date(), error: null },
    });
    this.logger.log(`${id}: completato, ${job.sent} inviati, ${job.failed} non riusciti, ${job.skipped} saltati`);
    await this.event(id, "done", { sent: job.sent, failed: job.failed, note: job.skipped ? `${job.skipped} saltati` : null });
  }
}
