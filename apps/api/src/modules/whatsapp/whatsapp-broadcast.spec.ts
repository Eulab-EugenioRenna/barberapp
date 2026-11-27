const owner = { id: "owner", role: "owner", tenantId: "t1", connectFunctions: ["whatsapp.read", "whatsapp.manage", "whatsapp.send"] };
jest.mock("../../common/request-session", () => ({
  resolveRequestSession: jest.fn(async () => ({ connectSessionId: "cs", user: owner })),
  requireUser: (session: any) => session.user,
  requireTenantId: (session: any) => session.user.tenantId,
}));
jest.mock("../../common/connect-runtime", () => ({
  loadConnectConfig: jest.fn(async () => ({ installationId: "i1" })),
  openConnect: (value: string) => value,
}));
const wa = { sessions: jest.fn(), sendText: jest.fn(), send: jest.fn(), outbox: jest.fn(async () => [] as any[]) };
jest.mock("../../common/connect-application", () => ({
  connectApplication: jest.fn(async () => ({
    services: (_handle: unknown, operation: any) => operation({ whatsapp: () => wa }, "token"),
  })),
}));
import { Prisma } from "@prisma/client";
import { BROADCAST_STEP, WhatsAppService, broadcastTiming, providerChat } from "./whatsapp.service";

const SESSION = "00000000-0000-4000-8000-000000000001";
const OUTBOX = "00000000-0000-4000-9000-0000000000aa";
/** Every service of a test is stopped at its end: a late worker must not consume the next test's mocks. */
const services: WhatsAppService[] = [];
afterEach(() => { services.splice(0).forEach((s) => s.onModuleDestroy()); });
function setup(customers: Array<{ id: string; phone: string | null }>, alreadySent: string[] = []) {
  const jobs: any[] = [];
  const recipients: any[] = [];
  const sends: any[] = alreadySent.map((recipient) => ({ recipient }));
  const events: any[] = [];
  const connectSessions: any[] = [
    { id: "cs", userId: "owner", installationId: "i1", sdkSessionCipher: "cipher", revokedAt: null, expiresAt: new Date(Date.now() + 3600_000) },
  ];
  const match = (row: any, where: any = {}) =>
    Object.entries(where).every(([key, value]: [string, any]) =>
      value && typeof value === "object" && !(value instanceof Date)
        ? "in" in value ? value.in.includes(row[key])
          : "lte" in value ? row[key] <= value.lte
            : true
        : row[key] === value);
  const apply = (row: any, data: any) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in (value as any)) row[key] += (value as any).increment;
      else if (value && typeof value === "object" && "decrement" in (value as any)) row[key] -= (value as any).decrement;
      else if (value === Prisma.DbNull) row[key] = null;
      else row[key] = value;
    }
    return row;
  };
  const prisma: any = {
    connectSession: {
      findFirst: jest.fn(async ({ where }: any) => connectSessions.find((c) =>
        (typeof where.id === "string" ? c.id === where.id : c.id !== where.id?.not) &&
        c.userId === where.userId && !c.revokedAt && c.expiresAt > where.expiresAt.gt) ?? null),
      findUnique: jest.fn(async ({ where }: any) => connectSessions.find((c) => c.id === where.id) ?? null),
    },
    whatsAppLink: { findMany: jest.fn(async () => [{ tenantId: "t1", userId: "owner", sessionId: SESSION, removedAt: null }]), updateMany: jest.fn() },
    whatsAppSend: {
      findMany: jest.fn(async () => sends),
      upsert: jest.fn(async ({ create }: any) => { sends.push(create); return create; }),
    },
    customer: {
      findMany: jest.fn(async () => customers.map((c) => ({ ...c, firstName: c.id, lastName: null }))),
      findFirst: jest.fn(async ({ where }: any) => {
        const c = customers.find((row) => row.id === where.id);
        return c && where.tenantId === "t1" ? { ...c, firstName: c.id, lastName: null } : null;
      }),
    },
    whatsAppBroadcast: {
      findUnique: jest.fn(async ({ where }: any) => jobs.find((j) => j.id === where.id || (where.tenantId_userId_idempotencyKey && j.idempotencyKey === where.tenantId_userId_idempotencyKey.idempotencyKey)) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => jobs.find((j) => j.id === where.id)),
      findFirst: jest.fn(async ({ where }: any) => jobs.find((j) => match(j, where)) ?? null),
      findMany: jest.fn(async ({ where }: any) => jobs.filter((j) => match(j, where))),
      count: jest.fn(async ({ where }: any) => jobs.filter((j) => match(j, where)).length),
      create: jest.fn(async ({ data }: any) => {
        const { recipients: nested, ...rest } = data;
        const job = { id: "job-" + (jobs.length + 1), status: "running", sent: 0, failed: 0, uncertain: 0, error: null, nextRunAt: new Date(0), createdAt: new Date(Date.now() + jobs.length), finishedAt: null, ...rest };
        jobs.push(job);
        for (const row of nested.create) recipients.push({ id: "r" + recipients.length, broadcastId: job.id, state: "pending", attempts: 0, round: 0, ...row });
        return job;
      }),
      update: jest.fn(async ({ where, data }: any) => apply(jobs.find((j) => j.id === where.id), data)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const found = jobs.filter((j) => j.id === where.id && j.status === where.status);
        found.forEach((j) => apply(j, data));
        return { count: found.length };
      }),
    },
    whatsAppBroadcastEvent: {
      create: jest.fn(async ({ data }: any) => { events.push({ note: null, sent: 0, failed: 0, pending: 0, at: new Date(), ...data }); return data; }),
      findMany: jest.fn(async ({ where }: any) => events.filter((e) => e.broadcastId === where.broadcastId)),
    },
    whatsAppBroadcastRecipient: {
      findMany: jest.fn(async ({ where, take }: any) => {
        const { broadcast, recipient, ...plain } = where;
        let rows = recipients.filter((r) => match(r, plain));
        if (recipient?.notIn) rows = rows.filter((r) => !recipient.notIn.includes(r.recipient));
        if (where.state?.in) rows = recipients.filter((r) => where.state.in.includes(r.state));
        if (broadcast?.contentHash) {
          // Same content within the window.
          return rows.filter((r) => {
            const job = jobs.find((j) => j.id === r.broadcastId);
            return job && job.contentHash === broadcast.contentHash && job.createdAt > broadcast.createdAt.gt;
          });
        }
        if (broadcast?.tenantId && !broadcast.status) {
          // Outbox grouping: recipients of this tenant's queues.
          return rows.filter((r) => jobs.find((j) => j.id === r.broadcastId)?.tenantId === broadcast.tenantId);
        }
        if (broadcast) {
          // Earlier active queues of the account.
          rows = rows.filter((r) => {
            const job = jobs.find((j) => j.id === r.broadcastId);
            return job && broadcast.status.in.includes(job.status) &&
              (job.createdAt < broadcast.OR[0].createdAt.lt || (job.createdAt === broadcast.OR[1].createdAt && job.id < broadcast.OR[1].id.lt));
          });
        }
        return rows.sort((a, b) => a.position - b.position).slice(0, take);
      }),
      update: jest.fn(async ({ where, data }: any) => apply(recipients.find((r) => r.id === where.id), data)),
      findFirst: jest.fn(async ({ where }: any) => recipients.find((r) => match(r, where)) ?? null),
      count: jest.fn(async ({ where }: any) => recipients.filter((r) => match(r, where)).length),
      groupBy: jest.fn(async ({ where }: any) => {
        const counts = new Map<string, number>();
        for (const r of recipients.filter((row) => match(row, where))) counts.set(r.broadcastId, (counts.get(r.broadcastId) ?? 0) + 1);
        return [...counts].map(([broadcastId, n]) => ({ broadcastId, _count: { _all: n } }));
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const found = recipients.filter((r) => match(r, where));
        found.forEach((r) => apply(r, data));
        return { count: found.length };
      }),
      createMany: jest.fn(async ({ data }: any) => {
        for (const row of data) recipients.push({ id: "r" + recipients.length, state: "pending", attempts: 0, round: 0, ...row });
        return { count: data.length };
      }),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const service = new WhatsAppService(prisma);
  services.push(service);
  const run = async () => {
    for (const job of jobs) job.nextRunAt = new Date(0);
    await service.tick();
  };
  /** One step of one queue, as the worker would pick it. */
  const runJob = async (id: string) => {
    for (const job of jobs) job.nextRunAt = job.id === id ? new Date(0) : new Date(Date.now() + 3600_000);
    await service.tick();
  };
  return { service, jobs, recipients, run, runJob, customers, connectSessions };
}
const input = { text: "Promo di Natale", idempotencyKey: "key-12345678", recipientAuthorized: true as const };

describe("«Messaggio a tutti» in the background", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    broadcastTiming.messageGapMs = 0;
    wa.sessions.mockResolvedValue([{ id: SESSION, state: "connected", closed_at: null, runner_online: true }]);
    let n = 0;
    broadcastTiming.outcomePollMs = 0;
    wa.sendText.mockImplementation(async () => ({ id: `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`, state: "queued" }));
    // Connect sends whatever it took: every queued message comes back «sent».
    wa.outbox.mockImplementation(async () => {
      const acks = await Promise.allSettled(wa.sendText.mock.results.filter((r: any) => r.type === "return").map((r: any) => r.value));
      return acks.flatMap((a: any) => (a.status === "fulfilled" && a.value?.id ? [{ id: a.value.id, state: "sent", error: null }] : []));
    });
  });

  it("queues at once and sends 30 recipients per step", async () => {
    const customers = Array.from({ length: 45 }, (_, i) => ({ id: "c" + i, phone: "333" + String(1000000 + i) }));
    const { service, jobs, run } = setup(customers);
    const view = await service.broadcast("auth", SESSION, input);
    expect(view).toMatchObject({ status: "running", total: 45, sent: 0, pending: 45 });
    expect(wa.sendText).not.toHaveBeenCalled();
    await run();
    expect(wa.sendText).toHaveBeenCalledTimes(BROADCAST_STEP);
    expect(jobs[0]).toMatchObject({ status: "running", sent: 30 });
    await run();
    expect(jobs[0]).toMatchObject({ status: "done", sent: 45, failed: 0 });
  });

  it("skips duplicates, unreadable numbers and who already got the same text", async () => {
    const { service, recipients } = setup(
      [
        { id: "a", phone: "333 1111111" },
        { id: "b", phone: "+39 333 1111111" },
        { id: "c", phone: "79 123 45 67" },
        { id: "d", phone: "333 2222222" },
        { id: "e", phone: "333 3333333" },
      ],
      ["+393332222222"],
    );
    expect(await service.broadcast("auth", SESSION, input)).toMatchObject({ total: 2, skipped: 3 });
    // Who is left out stays visible in the detail card, with the reason.
    expect(recipients.filter((r) => r.state === "skipped").map((r) => [r.customerId, r.error])).toEqual([
      ["b", "Stesso numero di a: riceve un solo messaggio"],
      ["c", "Numero non leggibile: senza prefisso valgono solo i numeri italiani"],
      ["d", "Ha già ricevuto questo messaggio nelle ultime 48 ore"],
    ]);
    expect(recipients.filter((r) => r.state === "pending").map((r) => r.customerId)).toEqual(["a", "e"]);
  });

  it("waits for each outcome: unconfirmed messages are never resent", async () => {
    const { service, jobs, recipients, run } = setup([{ id: "a", phone: "3331111111" }, { id: "b", phone: "3332222222" }]);
    await service.broadcast("auth", SESSION, input);
    const real = wa.outbox.getMockImplementation()!;
    wa.outbox.mockImplementation(async () => (await real()).map((o: any, i: number) => (i === 0 ? { ...o, state: "uncertain", error: "x" } : o)));
    await run();
    wa.outbox.mockImplementation(real);
    expect(recipients.map((r) => r.state)).toEqual(["uncertain", "sent"]);
    expect(jobs[0]).toMatchObject({ status: "done", sent: 1, uncertain: 1, failed: 0 });
    await expect(service.retryBroadcast("auth", jobs[0].id)).rejects.toThrow(/Niente da completare/);
  });

  it("Connect retries by itself: the queue moves on and closes only with the verified outcome", async () => {
    const { service, jobs, recipients, run } = setup([{ id: "a", phone: "3331111111" }, { id: "b", phone: "3332222222" }]);
    await service.broadcast("auth", SESSION, input);
    const real = wa.outbox.getMockImplementation()!;
    let retrying = true;
    wa.outbox.mockImplementation(async () => (await real()).map((o: any, i: number) => (i === 0 && retrying
      ? { ...o, state: "queued", attempts: 1, error: "retrying: tentativo 1 di 6 non partito (NOT_ON_PHONE), nuovo tentativo tra 20 secondi" } : o)));
    await run();
    expect(recipients.map((r) => r.state)).toEqual(["sending", "sent"]);
    expect(recipients[0].error).toBe("Tentativo 1 di 6 non partito: il messaggio non è comparso sul telefono del salone (telefono senza rete o WhatsApp chiuso). Nuovo tentativo tra 20 secondi.");
    expect(jobs[0]).toMatchObject({ status: "running", sent: 1, uncertain: 0, error: "1 messaggio in verifica su WhatsApp" });
    expect((await service.listBroadcasts("auth"))[0]).toMatchObject({ sending: 1, pending: 1 });
    retrying = false;
    await run();
    wa.outbox.mockImplementation(real);
    expect(recipients.map((r) => r.state)).toEqual(["sent", "sent"]);
    expect(jobs[0]).toMatchObject({ status: "done", sent: 2, failed: 0, uncertain: 0 });
    expect(wa.sendText).toHaveBeenCalledTimes(2);
  });

  it("«Riprova» and «Annulla» on one recipient", async () => {
    const { service, jobs, recipients, run } = setup([{ id: "a", phone: "3331111111" }, { id: "b", phone: "3332222222" }, { id: "c", phone: "3333333333" }]);
    await service.broadcast("auth", SESSION, input);
    // Withdrawn before it leaves.
    expect(await service.cancelRecipient("auth", jobs[0].id, recipients[2].id)).toMatchObject({ total: 2, skipped: 1 });
    expect(recipients[2]).toMatchObject({ state: "skipped", error: "Annullato a mano" });
    const real = wa.outbox.getMockImplementation()!;
    wa.outbox.mockImplementation(async () => (await real()).map((o: any, i: number) =>
      i === 0 ? { ...o, state: "failed", error: "not_on_whatsapp" } : { ...o, state: "uncertain", error: "Esito provider non confermato; nessun reinvio automatico (WHATSAPP_NO_ACK)" }));
    await run();
    wa.outbox.mockImplementation(real);
    expect(jobs[0]).toMatchObject({ status: "done", failed: 1, uncertain: 1 });
    // No WhatsApp: nothing to retry. Maybe arrived: only with confirmation.
    await expect(service.retryRecipient("auth", jobs[0].id, recipients[0].id)).rejects.toThrow(/non ha WhatsApp/);
    await expect(service.retryRecipient("auth", jobs[0].id, recipients[1].id)).rejects.toThrow(/conferma/);
    expect(await service.retryRecipient("auth", jobs[0].id, recipients[1].id, true)).toMatchObject({ status: "running", uncertain: 0 });
    expect(await service.retryRecipient("auth", jobs[0].id, recipients[2].id)).toMatchObject({ total: 3, skipped: 0 });
    await run();
    expect(recipients.map((r) => r.state)).toEqual(["failed", "sent", "sent"]);
    expect(jobs[0]).toMatchObject({ status: "done", sent: 2, failed: 1, uncertain: 0 });
    await expect(service.cancelRecipient("auth", jobs[0].id, recipients[1].id)).rejects.toThrow(/non ha ancora ricevuto/);
  });

  it("gives the WhatsApp number of one customer for «Conversazioni»", async () => {
    const { service } = setup([{ id: "a", phone: "333 111 2222" }, { id: "b", phone: "06 1234567" }]);
    await expect(service.customerNumber("auth", "a")).resolves.toEqual({ customerId: "a", name: "a", to: "+393331112222", issue: "prefix_added" });
    await expect(service.customerNumber("auth", "b")).resolves.toMatchObject({ to: "+39061234567", issue: "landline" });
    await expect(service.customerNumber("auth", "zz")).rejects.toThrow(/Cliente non trovato/);
  });

  it("a different photo is not «already received»", async () => {
    const { service } = setup([{ id: "a", phone: "3331111111" }]);
    const photo = (data: string) => ({ idempotencyKey: "k-" + data.slice(-6), recipientAuthorized: true as const, image: { data, filename: "p.jpg" } });
    await service.broadcast("auth", SESSION, photo("data:image/jpeg;base64,AAAA111111"));
    await service.cancelBroadcast("auth", "job-1");
    expect(await service.broadcast("auth", SESSION, photo("data:image/jpeg;base64,BBBB222222"))).toMatchObject({ total: 1, skipped: 0 });
  });

  it("«Completa e riprova» resends failed and cancelled ones, adds new customers, never writes twice", async () => {
    const customers = [{ id: "a", phone: "3331111111" }, { id: "b", phone: "3332222222" }, { id: "c", phone: "3333333333" }];
    const { service, jobs, recipients, run } = setup(customers);
    await service.broadcast("auth", SESSION, input);
    wa.sendText
      .mockResolvedValueOnce({ id: "00000000-0000-4000-9000-00000000000a", state: "queued" })
      .mockRejectedValueOnce(Object.assign(new Error("Bad Request"), { status: 400 }))
      .mockResolvedValueOnce({ id: "00000000-0000-4000-9000-00000000000c", state: "queued" });
    // Connect sends a, but cancels c (WhatsApp disconnected).
    const real = wa.outbox.getMockImplementation()!;
    wa.outbox.mockImplementation(async () => (await real()).map((o: any) =>
      o.id.endsWith("c") ? { ...o, state: "cancelled", error: "authorization_revoked" } : o));
    await run();
    wa.outbox.mockImplementation(real);
    expect(jobs[0]).toMatchObject({ status: "done", sent: 1, failed: 2 });
    expect(recipients[2]).toMatchObject({ state: "failed", error: expect.stringMatching(/non era connesso/) });
    expect((await service.broadcastStatus("auth", jobs[0].id)).retryable).toBe(true);
    customers.push({ id: "d", phone: "3334444444" });
    const view = await service.retryBroadcast("auth", jobs[0].id);
    expect(view).toMatchObject({ status: "running", total: 4, sent: 1, failed: 0, pending: 3 });
    const before = wa.sendText.mock.calls.length;
    await run();
    const calls = wa.sendText.mock.calls.slice(before);
    expect(calls.map((c: any[]) => c[1])).toEqual(["+393332222222", "+393333333333", "+393334444444"]);
    // A new round sends with a new idempotency key, so Connect does not hand back the cancelled message.
    expect(new Set(calls.map((c: any[]) => JSON.stringify(c[3]))).size).toBe(3);
    expect(jobs[0]).toMatchObject({ status: "done", sent: 4, failed: 0 });
    expect(recipients.map((r) => r.state)).toEqual(["sent", "sent", "sent", "sent"]);
    await expect(service.retryBroadcast("auth", jobs[0].id)).rejects.toThrow(/Niente da completare/);
  });

  it("says in plain words why a recipient failed", async () => {
    const { service, recipients, jobs, run } = setup([{ id: "a", phone: "3331111111" }]);
    await service.broadcast("auth", SESSION, input);
    wa.sendText.mockRejectedValueOnce(Object.assign(new Error("Bad Request"), { status: 400 }));
    await run();
    expect(recipients[0]).toMatchObject({ state: "failed", error: "Numero o messaggio rifiutato da WhatsApp: controlla il numero nella scheda cliente." });
    expect(jobs[0]).toMatchObject({ status: "done", failed: 1 });
  });

  it("keeps recipients pending when Connect is busy (503) and retries later", async () => {
    const { service, jobs, recipients, run } = setup([
      { id: "a", phone: "3331111111" },
      { id: "b", phone: "3332222222" },
    ]);
    await service.broadcast("auth", SESSION, input);
    wa.sendText.mockRejectedValueOnce(Object.assign(new Error("Service Unavailable"), { status: 503 }));
    await run();
    expect(recipients.map((r) => r.state)).toEqual(["pending", "pending"]);
    expect(jobs[0]).toMatchObject({ status: "running", sent: 0, error: "WhatsApp occupato: riprovo tra un minuto" });
    expect(jobs[0].nextRunAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    await run();
    expect(jobs[0]).toMatchObject({ status: "done", sent: 2, error: null });
  });

  it("pauses when the Connect sign-in expired, and resumes", async () => {
    const { service, jobs, run } = setup([{ id: "a", phone: "3331111111" }]);
    await service.broadcast("auth", SESSION, input);
    wa.sendText.mockRejectedValueOnce(Object.assign(new Error("Unauthorized"), { status: 401 }));
    await run();
    expect(jobs[0].status).toBe("paused");
    expect((await service.resumeBroadcast("auth", jobs[0].id)).status).toBe("running");
    await run();
    expect(jobs[0]).toMatchObject({ status: "done", sent: 1 });
  });

  it("moves on to the user's new Connect sign-in when the one it started with expired", async () => {
    const { service, jobs, run, connectSessions } = setup([{ id: "a", phone: "3331111111" }, { id: "b", phone: "3332222222" }]);
    await service.broadcast("auth", SESSION, input);
    connectSessions[0].expiresAt = new Date(Date.now() - 1000);
    connectSessions.push({ ...connectSessions[0], id: "cs2", expiresAt: new Date(Date.now() + 3600_000) });
    await run();
    expect(jobs[0]).toMatchObject({ status: "done", sent: 2, connectSessionId: "cs2" });
  });

  it("pauses when the salon's number is unlinked, without failing the customers", async () => {
    const { service, jobs, recipients, run } = setup([{ id: "a", phone: "3331111111" }, { id: "b", phone: "3332222222" }]);
    await service.broadcast("auth", SESSION, input);
    wa.sendText.mockRejectedValueOnce(Object.assign(new Error('Connect 409: {"statusCode":409,"message":"Sessione non connessa"}'), { status: 409 }));
    await run();
    expect(jobs[0]).toMatchObject({ status: "paused", failed: 0, error: "Numero WhatsApp del salone scollegato: ricollegalo in WhatsApp e premi «Riprendi»" });
    expect(recipients.map((r) => r.state)).toEqual(["pending", "pending"]);
    expect((await service.resumeBroadcast("auth", jobs[0].id)).status).toBe("running");
    await run();
    expect(jobs[0]).toMatchObject({ status: "done", sent: 2 });
  });

  it("pauses instead of looping when the outcomes can no longer be read", async () => {
    const { service, jobs, recipients, run, connectSessions } = setup([{ id: "a", phone: "3331111111" }]);
    await service.broadcast("auth", SESSION, input);
    recipients[0].state = "sending";
    recipients[0].outboxId = OUTBOX;
    connectSessions[0].revokedAt = new Date();
    await run();
    expect(jobs[0]).toMatchObject({ status: "paused", error: "Accesso Connect scaduto: apri ALORA e premi «Riprendi»" });
  });

  it("queues more messages: a number gets the second only after the first", async () => {
    // Let the delayed worker runs of earlier tests finish first.
    await new Promise((resolve) => setTimeout(resolve, 200));
    wa.sendText.mockClear();
    const customers = Array.from({ length: 45 }, (_, i) => ({ id: "c" + i, phone: "333" + String(1000000 + i) }));
    const { service, jobs, runJob } = setup(customers);
    await service.broadcast("auth", SESSION, input);
    const second = await service.broadcast("auth", SESSION, { ...input, text: "Orari delle feste", idempotencyKey: "other-12345" });
    expect(second).toMatchObject({ status: "running", total: 45, preview: "Orari delle feste" });
    expect((await service.activeBroadcasts("auth")).map((job) => job.preview)).toEqual(["Promo di Natale", "Orari delle feste"]);
    await runJob(jobs[0].id); // first 30 get the promo
    await runJob(jobs[1].id); // the same 30 can get the second message
    expect(jobs[1]).toMatchObject({ status: "running", sent: 30 });
    await runJob(jobs[1].id); // the other 15 still wait for the promo
    expect(jobs[1]).toMatchObject({ status: "running", sent: 30, error: "15 numeri aspettano che parta il messaggio precedente" });
    await runJob(jobs[0].id);
    expect(jobs[0]).toMatchObject({ status: "done", sent: 45 });
    await runJob(jobs[1].id);
    expect(jobs[1]).toMatchObject({ status: "done", sent: 45 });
    // Per number, the promo always left first.
    const order = new Map<string, string[]>();
    for (const [, to, text] of wa.sendText.mock.calls) order.set(to, [...(order.get(to) ?? []), text]);
    expect(order.size).toBe(45);
    for (const texts of order.values()) expect(texts).toEqual(["Promo di Natale", "Orari delle feste"]);
  });

  it("frees the waiting numbers when the earlier queue is cancelled", async () => {
    const { service, jobs, runJob } = setup([{ id: "a", phone: "3331111111" }]);
    await service.broadcast("auth", SESSION, input);
    await service.broadcast("auth", SESSION, { ...input, text: "Orari delle feste", idempotencyKey: "other-12345" });
    await runJob(jobs[1].id);
    expect(jobs[1].sent).toBe(0);
    await service.cancelBroadcast("auth", jobs[0].id);
    await runJob(jobs[1].id);
    expect(jobs[1]).toMatchObject({ status: "done", sent: 1 });
  });

  it("keeps the steps and every recipient for the detail card", async () => {
    const customers = Array.from({ length: 35 }, (_, i) => ({ id: "c" + i, phone: "333" + String(1000000 + i) }));
    const { service, jobs, runJob } = setup(customers);
    await service.broadcast("auth", SESSION, input);
    await runJob(jobs[0].id);
    await runJob(jobs[0].id);
    const detail = await service.broadcastDetail("auth", jobs[0].id);
    expect(detail).toMatchObject({ status: "done", sent: 35, preview: "Promo di Natale" });
    expect(detail.events.map((e) => [e.kind, e.sent, e.pending])).toEqual([
      ["queued", 0, 35],
      ["step", 30, 5],
      ["step", 5, 0],
      ["done", 35, 0],
    ]);
    expect(detail.recipients).toHaveLength(35);
    expect(detail.recipients[0]).toMatchObject({ state: "sent", recipient: "+393331000000" });
    expect(detail.recipients[0].sentAt).toEqual(expect.any(String));
    expect((await service.listBroadcasts("auth")).map((job) => job.id)).toEqual([jobs[0].id]);
  });

  it("notifications: active, recent and outbox in one call, one grouped count of «sending»", async () => {
    const { service, jobs, recipients } = setup([{ id: "a", phone: "3331111111" }, { id: "b", phone: "3332222222" }]);
    await service.broadcast("auth", SESSION, input);
    await service.broadcast("auth", SESSION, { ...input, text: "Orari delle feste", idempotencyKey: "key-87654321" });
    jobs[0].status = "done";
    recipients.filter((r) => r.broadcastId === jobs[1].id)[0].state = "sending";
    wa.outbox.mockImplementation(async () => [{ id: OUTBOX, session_id: SESSION, state: "sent", recipient: "+393331111111", created_at: "2026-11-27T10:00:00.000Z" }]);
    const prisma = (service as any).prisma;
    prisma.whatsAppBroadcastRecipient.groupBy.mockClear();
    const view = await service.notifications("auth");
    expect(view.active.map((j) => [j.id, j.sending])).toEqual([[jobs[1].id, 1]]);
    expect(view.recent.map((j) => [j.id, j.sending]).sort()).toEqual([[jobs[0].id, 0], [jobs[1].id, 1]].sort());
    expect(view.outbox.map((o) => o.id)).toEqual([OUTBOX]);
    expect(prisma.whatsAppBroadcastRecipient.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppBroadcastRecipient.count).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: "sending" }) }));
    // Counting is best effort: views still come back.
    prisma.whatsAppBroadcastRecipient.groupBy.mockRejectedValueOnce(new Error("db"));
    expect((await service.notifications("auth")).active[0].sending).toBe(0);
  });

  it("notifications fail as a whole when Connect is unavailable, and need whatsapp.read", async () => {
    const { service } = setup([{ id: "a", phone: "3331111111" }]);
    wa.outbox.mockRejectedValueOnce(Object.assign(new Error("down"), { status: 503 }));
    await expect(service.notifications("auth")).rejects.toThrow("temporaneamente non disponibile");
    const functions = owner.connectFunctions;
    owner.connectFunctions = [];
    try {
      await expect(service.notifications("auth")).rejects.toThrow("Permesso WhatsApp esplicito richiesto");
    } finally {
      owner.connectFunctions = functions;
    }
  });

  it("does not queue the same text twice", async () => {
    const { service } = setup([{ id: "a", phone: "3331111111" }]);
    await service.broadcast("auth", SESSION, input);
    await expect(service.broadcast("auth", SESSION, { ...input, idempotencyKey: "other-12345" })).rejects.toThrow("già in coda");
  });
});

describe("sendProblem", () => {
  it("names the reason Connect gave", () => {
    const { sendProblem } = jest.requireActual("./whatsapp.service");
    expect(sendProblem("cancelled", "authorization_revoked")).toMatch(/non era connesso/);
    expect(sendProblem("cancelled", "explicit_disconnect")).toMatch(/disconnesso/);
    expect(sendProblem("uncertain", "Runner interrotto durante invio; verifica manuale necessaria")).toMatch(/riavviato/);
    expect(sendProblem("uncertain", "Esito provider non confermato; nessun reinvio automatico (WHATSAPP_NO_ACK)")).toMatch(/sul telefono.*ricontrolliamo/);
    expect(sendProblem("uncertain", "Esito provider non confermato; nessun reinvio automatico")).toMatch(/non verificabile/);
    expect(sendProblem("failed", "not_on_whatsapp")).toBe("Il numero non ha WhatsApp.");
    expect(sendProblem("failed", "not_sent: non partito dopo 6 tentativi (NOT_ON_PHONE)")).toBe(
      "Non partito dopo 6 tentativi: il messaggio non è comparso sul telefono del salone (telefono senza rete o WhatsApp chiuso). Premi «Riprova».");
    expect(sendProblem("failed", "not_sent: non partito dopo 6 tentativi (ERROR: Start a chat with sendText with this contact before trying to send media)"))
      .toMatch(/non ha aperto la chat con questo numero per mandare la foto/);
    expect(sendProblem("failed", "not_sent: non partito dopo 1 tentativi (ARCHIVE_CHECK)")).toMatch(/^Non partito dopo 1 tentativo: verificato sull’archivio/);
    expect(sendProblem("queued", "retrying: tentativo 2 di 6 non partito (NOT_ON_PHONE), nuovo tentativo tra 60 secondi"))
      .toBe("Tentativo 2 di 6 non partito: il messaggio non è comparso sul telefono del salone (telefono senza rete o WhatsApp chiuso). Nuovo tentativo tra 1 minuto.");
    expect(sendProblem("cancelled", "cancelled_by_user")).toMatch(/Annullato a mano/);
    expect(sendProblem("queued", null)).toBeNull();
    expect(sendProblem("sent", null)).toBeNull();
  });
});

describe("inlineThumbnail", () => {
  it("turns WhatsApp's base64 preview into a picture, never text", () => {
    const { inlineThumbnail } = jest.requireActual("./whatsapp.service");
    const jpeg = "/9j/4AAQSkZJRgABAQAAAQABAAD" + "A".repeat(400);
    expect(inlineThumbnail(jpeg)).toBe(`data:image/jpeg;base64,${jpeg}`);
    expect(inlineThumbnail("AAAA".repeat(100))).toBe("");
    expect(inlineThumbnail("Ciao, ci vediamo domani alle 10")).toBeNull();
    expect(inlineThumbnail(null)).toBeNull();
  });
});

describe("providerChat", () => {
  it("reads the chat of a verified message from its WhatsApp ID", () => {
    expect(providerChat("true_393331234567@c.us_3EB0ABC")).toBe("393331234567@c.us");
    expect(providerChat("true_27682913@lid_3EB0ABC")).toBe("27682913@lid");
    expect(providerChat("false_1203630@g.us_ABC_39333@c.us")).toBe("1203630@g.us");
    expect(providerChat(null)).toBeNull();
    expect(providerChat("synthetic-id")).toBeNull();
  });
});
