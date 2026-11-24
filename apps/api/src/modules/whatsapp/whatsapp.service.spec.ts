import { NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../../prisma/prisma.service";

const actors: Record<string, any> = {
  owner: { id: "owner", role: "owner", tenantId: "t1", connectFunctions: ["whatsapp.read", "whatsapp.manage", "whatsapp.send"] },
  colleague: { id: "colleague", role: "manager", tenantId: "t1", permissions: ["whatsapp.read", "whatsapp.manage", "whatsapp.send"], connectFunctions: ["whatsapp.read", "whatsapp.manage", "whatsapp.send"] },
};
let current = "owner";
jest.mock("../../common/request-session", () => ({
  resolveRequestSession: jest.fn(async () => ({ connectSessionId: "cs", user: actors[current] })),
  requireUser: (session: any) => session.user,
  requireTenantId: (session: any) => session.user.tenantId,
}));
jest.mock("../../common/connect-runtime", () => ({
  loadConnectConfig: jest.fn(async () => ({ installationId: "i1" })),
  openConnect: (value: string) => value,
}));
const wa = {
  sessions: jest.fn(),
  connect: jest.fn(),
  qr: jest.fn(),
  reconnect: jest.fn(),
  disconnect: jest.fn(),
  deleteConnection: jest.fn(),
  archives: jest.fn(),
  conversations: jest.fn(),
  messages: jest.fn(),
  outbox: jest.fn(),
  sendText: jest.fn(),
  send: jest.fn(),
  media: jest.fn(),
};
jest.mock("../../common/connect-application", () => ({
  connectApplication: jest.fn(async () => ({
    services: (_handle: unknown, operation: any) => operation({ whatsapp: () => wa }, "token"),
  })),
}));
import { WhatsAppService } from "./whatsapp.service";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const raw = (n: number, extra: Record<string, unknown> = {}) => ({
  id: uuid(n), number: null, state: "connected", archive_id: uuid(100 + n), runner_online: true,
  created_at: "2026-11-21T22:00:00.000Z", closed_at: null, sync_status: "complete", sync_count: 3, ...extra,
});

describe("WhatsApp: each account manages only the connection it created", () => {
  let links: Array<{ tenantId: string; userId: string; sessionId: string; removedAt: Date | null; disconnectRequestedAt?: Date | null }>;
  let service: WhatsAppService;
  let sends: any[];
  let chats: any[];
  let media: any;
  beforeEach(() => {
    jest.clearAllMocks();
    sends = []; chats = []; media = null;
    current = "owner";
    // 1 = owner's connection from ALORA, 2 = colleague's, 3 = created in Connect (no link).
    links = [
      { tenantId: "t1", userId: "owner", sessionId: uuid(1), removedAt: null },
      { tenantId: "t1", userId: "colleague", sessionId: uuid(2), removedAt: null },
    ];
    wa.sessions.mockResolvedValue([raw(1), raw(2), raw(3)]);
    wa.archives.mockResolvedValue([1, 2, 3].map((n) => ({ id: uuid(100 + n), number: `+39 00${n}` })));
    wa.outbox.mockResolvedValue([1, 2, 3].map((n) => ({ id: uuid(200 + n), session_id: uuid(n), state: "sent", created_at: "2026-11-21T22:00:00.000Z", error: null })));
    const prisma = {
      connectSession: { findFirst: jest.fn(async () => ({ sdkSessionCipher: "cipher", installationId: "i1" })) },
      whatsAppLink: {
        findMany: jest.fn(async ({ where }: any) =>
          links.filter((l) => l.tenantId === where.tenantId && l.userId === where.userId && !l.removedAt)),
        create: jest.fn(async ({ data }: any) => { links.push({ ...data, removedAt: null }); return data; }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const ids: string[] = where.sessionId?.in ?? [where.sessionId];
          for (const l of links) if (ids.includes(l.sessionId)) Object.assign(l, data);
          return { count: ids.length };
        }),
      },
      whatsAppSend: { findMany: jest.fn(async () => sends), upsert: jest.fn(async ({ create }: any) => { sends.push(create); return create; }) },
      whatsAppChat: {
        findMany: jest.fn(async () => chats), findFirst: jest.fn(async () => null),
        upsert: jest.fn(async ({ create }: any) => { chats.push({ ...create, updatedAt: new Date() }); return create; }),
      },
      whatsAppMedia: { findUnique: jest.fn(async () => media), upsert: jest.fn(async ({ create }: any) => { media = create; return create; }) },
      customer: {
        findMany: jest.fn(async () => [{ phone: "333 1234567", firstName: "Mario", lastName: "Rossi" }]),
        findFirst: jest.fn(async () => ({ phone: "333 1234567", firstName: "Mario", lastName: "Rossi" })),
      },
    } as unknown as PrismaService;
    service = new WhatsAppService(prisma);
  });

  it("lists only the caller's connection, archive and sends", async () => {
    expect((await service.sessions("Bearer x")).map((s) => s.id)).toEqual([uuid(1)]);
    expect((await service.archives("Bearer x")).map((a) => a.id)).toEqual([uuid(101)]);
    expect((await service.outbox("Bearer x")).map((o) => o.sessionId)).toEqual([uuid(1)]);
    current = "colleague";
    expect((await service.sessions("Bearer x")).map((s) => s.id)).toEqual([uuid(2)]);
  });

  it("never lets a colleague act on the owner's connection or read its archive", async () => {
    current = "colleague";
    await expect(service.qr("Bearer x", uuid(1))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.disconnect("Bearer x", uuid(1))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove("Bearer x", uuid(1))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.send("Bearer x", uuid(1), { to: "+39", text: "ciao", idempotencyKey: uuid(9) } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.conversations("Bearer x", uuid(101))).rejects.toBeInstanceOf(NotFoundException);
    expect(wa.disconnect).not.toHaveBeenCalled();
    expect(wa.sendText).not.toHaveBeenCalled();
    expect(wa.conversations).not.toHaveBeenCalled();
  });

  it("ignores connections opened outside ALORA", async () => {
    await expect(service.reconnect("Bearer x", uuid(3))).rejects.toBeInstanceOf(NotFoundException);
    expect(wa.reconnect).not.toHaveBeenCalled();
  });

  it("creates one connection per account and records its owner", async () => {
    links = links.filter((l) => l.userId !== "owner");
    wa.connect.mockResolvedValue({ id: uuid(4), state: "pairing" });
    expect(await service.connect("Bearer x")).toEqual({ id: uuid(4), state: "pairing" });
    expect(links).toContainEqual(expect.objectContaining({ userId: "owner", sessionId: uuid(4) }));
    // A second request returns the open connection instead of creating another.
    wa.sessions.mockResolvedValue([raw(2), raw(4, { state: "pairing", archive_id: null })]);
    expect(await service.connect("Bearer x")).toEqual({ id: uuid(4), state: "pairing" });
    expect(wa.connect).toHaveBeenCalledTimes(1);
  });

  it("explains why Connect refuses a second open connection in the activity", async () => {
    links = links.filter((l) => l.userId !== "owner");
    wa.connect.mockRejectedValue({ status: 409 });
    await expect(service.connect("Bearer x")).rejects.toThrow(/già un collegamento WhatsApp aperto/);
    expect(links.some((l) => l.userId === "owner")).toBe(false);
  });

  it("forgets links whose connection no longer exists in Connect", async () => {
    wa.sessions.mockResolvedValue([raw(2)]);
    expect(await service.sessions("Bearer x")).toEqual([]);
    expect(links.find((l) => l.sessionId === uuid(1))?.removedAt).toBeInstanceOf(Date);
  });

  it("removes the caller's own connection", async () => {
    wa.deleteConnection.mockResolvedValue({ removed: true, state: "deleted" });
    expect(await service.remove("Bearer x", uuid(1))).toEqual({ id: uuid(1), state: "deleted" });
    expect(wa.deleteConnection).toHaveBeenCalledWith(uuid(1));
    expect(links.find((l) => l.sessionId === uuid(1))?.removedAt).toBeInstanceOf(Date);
  });

  it("removes a connection unlinked from the phone and frees it in Connect", async () => {
    wa.sessions.mockResolvedValue([raw(1, { state: "disconnected" }), raw(2)]);
    wa.deleteConnection.mockResolvedValue({ removed: true, state: "deleted" });
    expect(await service.sessions("Bearer x")).toEqual([]);
    expect(wa.deleteConnection).toHaveBeenCalledWith(uuid(1));
    expect(links.find((l) => l.sessionId === uuid(1))?.removedAt).toBeInstanceOf(Date);
    // The account can pair a new number right away.
    wa.sessions.mockResolvedValue([raw(2)]);
    wa.connect.mockResolvedValue({ id: uuid(5), state: "pairing" });
    expect(await service.connect("Bearer x")).toEqual({ id: uuid(5), state: "pairing" });
  });

  it("removes a connection closed by Connect even if Connect refuses the delete", async () => {
    wa.sessions.mockResolvedValue([raw(1, { closed_at: "2026-11-22T08:00:00.000Z" }), raw(2)]);
    wa.deleteConnection.mockRejectedValue({ status: 404 });
    expect(await service.sessions("Bearer x")).toEqual([]);
    expect(links.find((l) => l.sessionId === uuid(1))?.removedAt).toBeInstanceOf(Date);
  });

  it("keeps a disconnect requested from ALORA reconnectable", async () => {
    wa.disconnect.mockResolvedValue({ id: uuid(1), state: "disconnecting" });
    await service.disconnect("Bearer x", uuid(1));
    wa.sessions.mockResolvedValue([raw(1, { state: "disconnected" }), raw(2)]);
    expect((await service.sessions("Bearer x")).map((s) => s.state)).toEqual(["disconnected"]);
    expect(wa.deleteConnection).not.toHaveBeenCalled();
    wa.reconnect.mockResolvedValue({ id: uuid(1), state: "queued" });
    await service.reconnect("Bearer x", uuid(1));
    expect(links.find((l) => l.sessionId === uuid(1))?.disconnectRequestedAt).toBeNull();
  });

  it("keeps a failed connection: a runner error is recoverable with Riconnetti", async () => {
    wa.sessions.mockResolvedValue([raw(1, { state: "failed" }), raw(2)]);
    expect((await service.sessions("Bearer x")).map((s) => s.state)).toEqual(["failed"]);
    expect(wa.deleteConnection).not.toHaveBeenCalled();
  });

  it("names chats by customer phone or by the name the person writes with", async () => {
    wa.conversations.mockResolvedValue([
      { chat_id: "393331234567@c.us", messages: 2, last_message_at: "2026-11-21T22:00:00.000Z", preview: "ciao", kind: "chat", direction: "in", contact: null },
      { chat_id: "27684000007464@lid", messages: 3, last_message_at: "2026-11-21T22:00:00.000Z", preview: "ok", kind: "chat", direction: "in", contact: null },
    ]);
    wa.messages.mockResolvedValue([{ id: uuid(300), chat_id: "27684000007464@lid", direction: "in", kind: "chat", occurred_at: "2026-11-21T22:00:00.000Z", body: { text: "ok", senderName: "Francesco" } }]);
    const list = await service.conversations("Bearer x", uuid(101));
    expect(list.map((c) => [c.name, c.phone])).toEqual([["Mario Rossi", "+393331234567"], ["Francesco", null]]);
  });

  it("sends a photo with caption and records recipient for «Invii»", async () => {
    wa.send.mockResolvedValue({ id: uuid(201), state: "queued" });
    const image = { data: "data:image/jpeg;base64,AAAA", filename: "foto.jpg" };
    await service.send("Bearer x", uuid(1), { customerId: uuid(50), text: "Ecco", image, idempotencyKey: uuid(9), recipientAuthorized: true });
    expect(wa.send).toHaveBeenCalledWith(uuid(1), { kind: "image", to: "+393331234567", data: image.data, filename: "foto.jpg", caption: "Ecco" }, expect.any(String));
    wa.outbox.mockResolvedValue([{ id: uuid(201), session_id: uuid(1), state: "uncertain", created_at: "2026-11-21T22:00:00.000Z", error: "x" }]);
    const [item] = await service.outbox("Bearer x");
    expect(item).toMatchObject({ recipientName: "Mario Rossi", preview: "Ecco", kind: "image" });
    expect(item.problem).toContain("controlla sul telefono");
  });

  it("refuses an empty message without a photo", async () => {
    await expect(service.send("Bearer x", uuid(1), { to: "+393331234567", text: "  ", idempotencyKey: uuid(9), recipientAuthorized: true }))
      .rejects.toThrow("Scrivi un messaggio o allega una foto");
  });

  it("copies an attachment into ALORA once, then serves it from there", async () => {
    wa.media.mockResolvedValue({ data: "data:audio/ogg; codecs=opus;base64,T2dnUw==", state: "available" });
    const first = await service.media("Bearer x", uuid(101), uuid(300));
    expect(first).toMatchObject({ mimetype: "audio/ogg" });
    expect(first!.data.toString()).toBe("OggS");
    const second = await service.media("Bearer x", uuid(101), uuid(300));
    expect(second!.data.toString()).toBe("OggS");
    expect(wa.media).toHaveBeenCalledTimes(1);
  });

  it("reports a file still being recovered as null", async () => {
    wa.media.mockResolvedValue({ data: null, state: "queued" });
    expect(await service.media("Bearer x", uuid(101), uuid(301))).toBeNull();
  });
});
