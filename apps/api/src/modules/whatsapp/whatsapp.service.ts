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
  WhatsAppAudienceView, WhatsAppBroadcastInput, WhatsAppBroadcastResult, WhatsAppImageInput,
} from "../../common/whatsapp-contract";
import { appointmentPhone } from "../notifications/appointment-automation-state";

/** Most recipients per «Invia a tutti»: larger lists risk the number being blocked. */
export const BROADCAST_LIMIT = 500;
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
  if (state === "uncertain")
    return "WhatsApp non ha confermato l’invio: controlla sul telefono se il messaggio è arrivato prima di inviarlo di nuovo.";
  if (state === "cancelled") {
    if (error === "explicit_disconnect") return "Annullato: il numero è stato disconnesso prima dell’invio.";
    if (error === "authorization_revoked") return "Annullato: il numero non era connesso o il permesso di invio non è più attivo.";
    return "Invio annullato.";
  }
  if (state === "failed") return "Invio non riuscito. Verifica che il numero sia connesso e riprova.";
  return error ? "Invio non confermato: controlla sul telefono se il messaggio è arrivato." : null;
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
      const list = rows(await wa.conversations(archiveId)).map(c => {
        if (!Number.isSafeInteger(c.messages) || c.messages < 0) return invalid();
        const chatId = text(c.chat_id, 100);
        return { chatId, messages: c.messages, lastMessageAt: date(c.last_message_at), preview: nullable(c.preview),
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
        return {
          id: id(m.id), chatId: text(m.chat_id, 100), direction: direction(m.direction), kind, occurredAt: date(m.occurred_at),
          text: nullable(m.body?.text ?? (m.body?.interactive && "body" in m.body.interactive ? m.body.interactive.body : null)) || null,
          selectedButtonId: nullable(m.body?.selectedButtonId, 200),
          media: MEDIA_KINDS.has(kind) ? { mimetype: nullable(m.body?.mimetype, 200), filename: nullable(m.body?.filename, 300) } : null,
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
      return items.map(o => {
        const state = text(o.state, 80), record = byId.get(o.id);
        return { id: id(o.id), sessionId: id(o.session_id), state, createdAt: date(o.created_at), hasError: o.error != null,
          problem: sendProblem(state, o.error), recipientName: record ? record.recipientName || record.recipient : null,
          preview: record?.preview ?? null, kind: record?.kind ?? null };
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
  /**
   * One message per customer, each with its own key derived from the request
   * key: repeating the same request never sends a customer the text twice.
   */
  broadcast(auth: string | undefined, sessionId: string, input: WhatsAppBroadcastInput): Promise<WhatsAppBroadcastResult> {
    return this.run(auth, "whatsapp.send", async (wa, actor) => {
      await this.ownedSession(wa, actor, sessionId);
      this.requireContent(input);
      const rows = await this.broadcastCustomers(actor.tenantId);
      const seen = new Set<string>();
      const targets: Array<{ id: string; to: string; name: string | null }> = [];
      let skipped = 0;
      for (const row of rows) {
        const to = customerWhatsAppNumber(row.phone);
        // Same number on two customer cards: one message only.
        if (!to || seen.has(to)) { skipped++; continue; }
        seen.add(to);
        targets.push({ id: row.id, to, name: customerName(row) });
      }
      if (!targets.length) throw new BadRequestException("Nessun cliente con un numero di telefono valido");
      if (targets.length > BROADCAST_LIMIT)
        throw new BadRequestException(`Troppi destinatari (${targets.length}): il massimo per invio è ${BROADCAST_LIMIT}`);
      let sent = 0, failed = 0;
      for (let index = 0; index < targets.length; index += 5) {
        const results = await Promise.allSettled(targets.slice(index, index + 5).map((target) =>
          this.deliver(wa, actor, sessionId, { to: target.to, customerId: target.id, name: target.name }, input,
            actorKey([actor.tenantId, actor.userId, input.idempotencyKey, target.id]))));
        for (const result of results) {
          if (result.status === "fulfilled") sent++;
          else failed++;
        }
      }
      return { sent, failed, skipped };
    });
  }
}
