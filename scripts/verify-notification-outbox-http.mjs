/** Real PostgreSQL, actual domain writers and queue/worker service; all external effects are synthetic. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const base = "http://127.0.0.1:53027",
  health = await (await fetch(base + "/health")).json();
assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    stdio: "pipe",
    maxBuffer: 32 * 1024 * 1024,
  });
const sql = (q) =>
  docker(
    [
      "exec",
      "-i",
      "barber-postgres-1",
      "psql",
      "-X",
      "-U",
      "barber",
      "-d",
      health.database,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    q,
  )
    .toString()
    .trim();
const quote = (s) => "'" + s.replaceAll("'", "''") + "'",
  json = (q) => JSON.parse(sql(q));
async function call(
  route,
  body,
  {
    method = body ? "POST" : "GET",
    status = body ? 201 : 200,
    headers = {},
  } = {},
) {
  const r = await fetch(base + route, {
    method,
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, status, route + ": " + JSON.stringify(data));
  return data;
}
const control = (action = "state", body = {}) =>
  call("/__qa/notifications/" + action, body, { status: 200 });
const counts = () =>
  json(
    `SELECT json_build_object('appointments',(SELECT count(*) FROM "Appointment"),'sales',(SELECT count(*) FROM "Sale"),'commands',(SELECT count(*) FROM "OrderOperation"),'events',(SELECT count(*) FROM "NotificationDomainEvent"))`,
  );
const eventRows = (orderId) =>
  json(
    `SELECT coalesce(json_agg(e ORDER BY "createdAt",id),'[]') FROM "NotificationDomainEvent" e WHERE payload#>>'{eventData,orderId}'=${quote(orderId)}`,
  );
const eventHistories = (eventId) =>
  json(
    `SELECT coalesce(json_agg(h ORDER BY id),'[]') FROM "NotificationHistory" h WHERE "domainEventId"=${quote(eventId)}`,
  );
const history = (id) =>
  json(
    `SELECT row_to_json(h) FROM "NotificationHistory" h WHERE id=${quote(id)}`,
  );
const providerCount = async (id) =>
  (await control()).providerCalls.filter((c) => c.id === id).length;
async function recoverAll() {
  for (let i = 0; i < 20; i++) {
    await control("recover");
    if (
      sql(
        'SELECT count(*) FROM "NotificationDomainEvent" WHERE "processedAt" IS NULL AND "nextAttemptAt"<=now()',
      ) === "0"
    )
      return;
  }
  throw Error("Outbox did not drain");
}
const checks = [],
  stamp = Date.now();
// Explicitly enable only synthetic SMTP delivery tests; no real provider is instantiated.
await call("/notifications/preferences");
sql(
  "UPDATE \"NotificationPreferenceTenant\" SET enabled=true WHERE \"tenantId\"='__http_a' AND channel IN ('email','in_app'); UPDATE \"NotificationProviderConfig\" SET enabled=true WHERE \"tenantId\"='__http_a' AND channel='email'",
);
const site = await call("/locations", {
    name: "Notification outbox " + stamp,
    sectorName: "Synthetic appointment events",
  }),
  sectorId = site.sectors[0].id;
await call(
  "/locations/" + site.id,
  {
    weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      isWorkingDay: true,
      startTime: "08:00",
      endTime: "20:00",
    })),
  },
  { method: "PATCH", status: 200 },
);
const service = await call("/services", {
  name: "Outbox synthetic " + stamp,
  sectorId,
  basePrice: "10",
  durationMinutes: 30,
  requiresCollaborator: false,
  requiresRoom: false,
  isPublic: true,
  isBookableOnline: true,
});
let day = 8;
const input = (extra = {}) => ({
  idempotencyKey: randomUUID(),
  customerId: "__http_customer",
  status: "confirmed",
  lines: [
    {
      serviceId: service.id,
      startsAt: `2052-01-${String(day++).padStart(2, "0")}T10:00:00Z`,
    },
    { serviceId: service.id },
  ],
  ...extra,
});
const firstInput = input(),
  booking = await call("/appointments", firstInput);
let events = eventRows(booking.orderId);
assert.equal(events.length, 1);
assert.equal(events[0].eventType, "appointment.created.internal");
assert.equal(events[0].payload.eventData.affectedAppointments.length, 2);
assert.equal(events[0].payload.eventData.accountAppointments.length, 2);
assert.equal(events[0].payload.actor.id, "__http_owner");
assert(!JSON.stringify(events[0]).includes("internalNotes"));
assert.deepEqual(await call("/appointments", firstInput), booking);
assert.equal(eventRows(booking.orderId).length, 1);
checks.push(
  "two-service-command-persists-one-account-creation-event-and-complete-safe-snapshot-without-replay-duplicates",
);
const before = counts(),
  failing = input();
sql(
  `CREATE FUNCTION __step12_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic failure after event insert'; END $$; CREATE TRIGGER __step12_fail_event AFTER INSERT ON "NotificationDomainEvent" FOR EACH ROW EXECUTE FUNCTION __step12_fail_event();`,
);
try {
  const response = await fetch(base + "/appointments", {
    method: "POST",
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(failing),
  });
  assert(response.status >= 400);
  assert.deepEqual(counts(), before);
} finally {
  sql(
    'DROP TRIGGER __step12_fail_event ON "NotificationDomainEvent"; DROP FUNCTION __step12_fail_event();',
  );
}
const recovered = await call("/appointments", failing);
assert.equal(eventRows(recovered.orderId).length, 1);
await call("/appointments", failing);
assert.equal(eventRows(recovered.orderId).length, 1);
checks.push(
  "failure-after-acknowledgement-and-event-insert-rolls-back-account-bookings-command-and-event-and-same-key-recovers-once",
);
let detail = await call(`/appointments/${booking.id}/order`);
await call(
  `/appointments/${booking.id}`,
  {
    idempotencyKey: randomUUID(),
    revision: detail.revision,
    startsAt: "2052-01-08T12:00:00Z",
  },
  { method: "PATCH", status: 200 },
);
detail = await call(`/appointments/${booking.id}/order`);
const beforeNotes = eventRows(booking.orderId).length;
await call(
  `/appointments/${booking.id}`,
  {
    idempotencyKey: randomUUID(),
    revision: detail.revision,
    internalNotes: "Synthetic note only",
  },
  { method: "PATCH", status: 200 },
);
assert.equal(eventRows(booking.orderId).length, beforeNotes);
detail = await call(`/appointments/${booking.id}/order`);
await call(
  `/appointments/${booking.id}`,
  {
    idempotencyKey: randomUUID(),
    revision: detail.revision,
    startsAt: "2052-01-08T13:00:00Z",
  },
  { method: "PATCH", status: 200 },
);
events = eventRows(booking.orderId);
const moves = events.filter((e) => e.eventType === "appointment.rescheduled");
assert.equal(moves.length, 2);
assert.equal(moves[0].payload.appointment.startsAt, "2052-01-08T12:00:00.000Z");
assert.equal(moves[1].payload.appointment.startsAt, "2052-01-08T13:00:00.000Z");
checks.push(
  "single-rescheduling-snapshots-are-immutable-and-notes-only-or-financial-revision-do-not-create-calendar-events",
);
const requested = await call("/appointments", input({ status: "requested" }));
await call(
  `/appointments/${requested.id}/status`,
  { status: "confirmed" },
  { method: "POST", status: 201 },
);
let requestEvents = eventRows(requested.orderId);
assert.equal(
  requestEvents.filter((e) => e.eventType === "appointment.confirmed").length,
  1,
);
await call(
  `/appointments/${requested.id}/status`,
  { status: "confirmed" },
  { method: "POST", status: 201 },
);
assert.equal(eventRows(requested.orderId).length, requestEvents.length);
const cancel = await call(`/appointments/${requested.id}/order`);
await call(`/appointments/${requested.id}/order/cancel`, {
  idempotencyKey: randomUUID(),
  revision: cancel.revision,
  reason: "Synthetic cancel",
});
assert.equal(
  eventRows(requested.orderId).filter(
    (e) => e.eventType === "appointment.cancelled",
  ).length,
  1,
);
checks.push(
  "status-transition-and-whole-account-cancellation-are-transactional-grouped-and-do-not-repeat-unchanged-status",
);
const publicBooking = await call(
  "/public/__http_a/bookings",
  {
    idempotencyKey: randomUUID(),
    customerName: "Synthetic public outbox",
    email: `outbox-${stamp}@example.invalid`,
    lines: [
      { serviceId: service.id, startsAt: "2052-02-09T10:00:00Z" },
      { serviceId: service.id },
    ],
  },
  { headers: { "X-Forwarded-For": "198.51.100.170" } },
);
const publicOrder = sql(
  `SELECT s.id FROM "Sale" s JOIN "SaleItem" i ON i."saleId"=s.id JOIN "Appointment" a ON a."orderItemId"=i.id WHERE a.id=${quote(publicBooking.id)}`,
);
const publicEvents = eventRows(publicOrder);
assert.equal(publicEvents.length, 2);
assert(publicEvents.every((e) => e.actorUserId === null));
assert(
  publicEvents.every(
    (e) => e.payload.eventData.affectedAppointments.length === 2,
  ),
);
assert(!("orderId" in publicBooking));
checks.push(
  "public-multiple-booking-persists-customer-safe-creation-and-status-events-in-same-transaction-without-exposing-private-account-id",
);
const cashier = await call("/sales", {
  idempotencyKey: randomUUID(),
  customerId: "__http_customer",
  soldAt: "2026-11-01T14:00:00Z",
  items: [{ itemType: "service", serviceId: service.id, quantity: 1 }],
});
const cashierEvents = eventRows(cashier.id);
assert.equal(cashierEvents.length, 1);
assert.equal(cashierEvents[0].eventType, "appointment.completed");
const oldEvents = eventRows(booking.orderId).length;
detail = await call(`/appointments/${booking.id}/order`);
await call(`/sales/${booking.orderId}/payments`, {
  idempotencyKey: randomUUID(),
  revision: detail.revision,
  kind: "receive",
  entries: [{ amount: "1.00", method: "cash" }],
});
assert.equal(eventRows(booking.orderId).length, oldEvents);
checks.push(
  "cashier-execution-is-not-a-new-future-booking-and-deposit-does-not-produce-calendar-events",
);
// Configure only the synthetic rescheduling notices; original event snapshots remain unchanged.
sql(`INSERT INTO "NotificationTemplate"(id,"tenantId","eventType",channel,body,"updatedAt") VALUES('step12-reschedule-template','__http_a','appointment.rescheduled','email','At {{appointment.startsAt}}: {{service.name}}',now()) ON CONFLICT("tenantId","eventType",channel) DO NOTHING;
INSERT INTO "NotificationPreferenceTenant"(id,"tenantId","eventType",channel,enabled,"sendToCustomer","sendToOwners","updatedAt") VALUES('step12-reschedule-preference','__http_a','appointment.rescheduled','email',true,false,true,now()) ON CONFLICT("tenantId","eventType",channel) DO UPDATE SET enabled=true;`);
await control("state", { queueUnavailable: true });
await recoverAll();
assert.equal((await control()).providerCalls.length, 0);
assert.equal((await control()).queued.length, 0);
const immutableHistory = eventHistories(moves[0].id).find(
  (h) => h.channel === "email" && h.recipientUserId === "__http_owner",
);
assert(immutableHistory);
assert(immutableHistory.payload.renderedMessage.includes("12:00:00.000Z"));
assert(!immutableHistory.payload.renderedMessage.includes("13:00:00.000Z"));
const rowCount = sql('SELECT count(*) FROM "NotificationHistory"');
await recoverAll();
assert.equal(sql('SELECT count(*) FROM "NotificationHistory"'), rowCount);
await control("state", { queueUnavailable: false });
await recoverAll();
assert((await control()).queued.length > 0);
checks.push(
  "redis-outage-does-not-lose-prepared-deliveries-and-restored-queue-rebuilds-with-original-snapshots-and-no-duplicate-history",
);
const freshInput = input(),
  fresh = await call("/appointments", freshInput);
const freshEvent = eventRows(fresh.orderId)[0];
const inboxBefore = sql('SELECT count(*) FROM "NotificationInbox"');
await control("state", { failHistory: true });
assert.equal(await control("prepare"), null);
assert.equal(eventHistories(freshEvent.id).length, 0);
assert.equal(sql('SELECT count(*) FROM "NotificationInbox"'), inboxBefore);
assert.equal(
  sql(
    `SELECT "processedAt" IS NULL FROM "NotificationDomainEvent" WHERE id=${quote(freshEvent.id)}`,
  ),
  "t",
);
sql(
  `UPDATE "NotificationDomainEvent" SET "nextAttemptAt"=now() WHERE id=${quote(freshEvent.id)}`,
);
const preparations = await Promise.all([
  control("prepare"),
  control("prepare"),
]);
assert.equal(preparations.filter(Boolean).length, 1);
const freshHistories = eventHistories(freshEvent.id);
assert(freshHistories.length > 0);
checks.push(
  "failure-after-history-inbox-insert-rolls-back-materialization-and-two-concurrent-transactions-claim-one-event-delivery-set",
);
const ownerMail = freshHistories.find(
  (h) => h.channel === "email" && h.recipientUserId === "__http_owner",
);
assert(ownerMail);
await control("state", { mode: "success", pauseSend: true });
const firstDispatch = control("dispatch", { id: ownerMail.id });
let paused = false;
for (let i = 0; i < 40; i++) {
  paused = (await control()).paused;
  if (paused) break;
  await new Promise((r) => setTimeout(r, 50));
}
assert(paused);
assert.equal(history(ownerMail.id).status, "dispatching");
await control("dispatch", { id: ownerMail.id });
assert.equal(await providerCount(ownerMail.id), 1);
await control("state", { releaseSend: true });
await firstDispatch;
assert.equal(history(ownerMail.id).status, "sent");
await control("dispatch", { id: ownerMail.id });
assert.equal(await providerCount(ownerMail.id), 1);
checks.push(
  "two-concurrent-delivery-workers-and-repeated-job-have-one-committed-claim-and-one-provider-call",
);
const uncertain = freshHistories.find(
  (h) => h.channel === "email" && h.id !== ownerMail.id,
);
assert(uncertain);
await control("state", { mode: "uncertain" });
await control("dispatch", { id: uncertain.id });
assert.equal(history(uncertain.id).status, "uncertain");
await recoverAll();
await control("dispatch", { id: uncertain.id });
assert.equal(await providerCount(uncertain.id), 1);
checks.push(
  "ambiguous-provider-result-remains-uncertain-through-recovery-and-repeated-job-without-another-provider-call",
);
const crash = freshHistories.find(
  (h) => h.channel === "email" && ![ownerMail.id, uncertain.id].includes(h.id),
);
assert(crash);
sql(
  'CREATE TABLE IF NOT EXISTS "__step12_provider_attempt" ("historyId" text NOT NULL)',
);
const container = execFileSync(
  "docker",
  [
    "ps",
    "--filter",
    `name=alora-step7-qa-${health.database.slice("step7_http_".length)}`,
    "--format",
    "{{.Names}}",
  ],
  { encoding: "utf8" },
).trim();
assert(/^alora-step7-qa-\d+$/.test(container));
let killed = false;
try {
  docker([
    "exec",
    container,
    "node",
    "/qa/notification-crash-qa.cjs",
    crash.id,
  ]);
} catch (e) {
  assert.equal(e.status, 137);
  killed = true;
}
assert(killed);
assert.equal(history(crash.id).status, "dispatching");
sql(
  `UPDATE "NotificationHistory" SET "dispatchLeaseUntil"=now()-interval '1 second' WHERE id=${quote(crash.id)}`,
);
await recoverAll();
assert.equal(history(crash.id).status, "uncertain");
await control("dispatch", { id: crash.id });
assert.equal(await providerCount(crash.id), 0);
assert.equal(
  sql(
    `SELECT count(*) FROM "__step12_provider_attempt" WHERE "historyId"=${quote(crash.id)}`,
  ),
  "1",
);
checks.push(
  "real-killed-dispatch-process-leaves-durable-attempt-and-expired-lease-becomes-uncertain-without-replay",
);
// Old rescheduling notice is stale after the newer plan; no provider call may start.
await control("state", { mode: "success" });
await control("dispatch", { id: immutableHistory.id });
assert.equal(history(immutableHistory.id).status, "skipped");
assert.equal(await providerCount(immutableHistory.id), 0);
const latestMail = eventHistories(moves[1].id).find(
  (h) => h.channel === "email" && h.recipientUserId === "__http_owner",
);
assert(latestMail);
await control("dispatch", { id: latestMail.id });
assert.equal(history(latestMail.id).status, "sent");
checks.push(
  "current-plan-check-rejects-superseded-schedule-before-effect-but-financial-revision-does-not-invalidate-unchanged-calendar",
);
const retryBooking = await call("/appointments", input());
await recoverAll();
const retryHistories = eventHistories(eventRows(retryBooking.orderId)[0].id),
  safe = retryHistories.find(
    (h) => h.channel === "email" && h.recipientUserId === "__http_owner",
  );
assert(safe);
await control("state", { mode: "not_started" });
await control("dispatch", { id: safe.id });
assert.equal(history(safe.id).status, "failed");
assert.equal(history(safe.id).retrySafe, true);
await control("dispatch", { id: safe.id });
assert.equal(await providerCount(safe.id), 1);
sql(
  `UPDATE "NotificationHistory" SET "nextRetryAt"=now()-interval '1 second' WHERE id=${quote(safe.id)}`,
);
await control("state", { mode: "success" });
await recoverAll();
await control("dispatch", { id: safe.id });
assert.equal(history(safe.id).status, "sent");
assert.equal(history(safe.id).attemptCount, 2);
assert.equal(await providerCount(safe.id), 2);
checks.push(
  "only-definitive-no-effect-failure-can-retry-after-deadline-using-same-delivery-identity",
);
const address = retryHistories.find(
  (h) => h.channel === "email" && h.recipientUserId === "__http_cashier",
);
assert(address);
const oldEmail = sql(`SELECT email FROM "User" WHERE id='__http_cashier'`);
sql(
  `UPDATE "User" SET email='changed-synthetic@example.invalid' WHERE id='__http_cashier'`,
);
try {
  await control("dispatch", { id: address.id });
  assert.equal(history(address.id).status, "skipped");
  assert.equal(await providerCount(address.id), 0);
} finally {
  sql(`UPDATE "User" SET email=${quote(oldEmail)} WHERE id='__http_cashier'`);
}
const policy = retryHistories.find(
  (h) => h.channel === "email" && h.recipientUserId === "__http_scheduler",
);
assert(policy);
sql(
  `UPDATE "NotificationProviderConfig" SET enabled=false WHERE "tenantId"='__http_a' AND channel='email'`,
);
try {
  await control("dispatch", { id: policy.id });
  assert.equal(history(policy.id).status, "skipped");
  assert.equal(await providerCount(policy.id), 0);
} finally {
  sql(
    `UPDATE "NotificationProviderConfig" SET enabled=true WHERE "tenantId"='__http_a' AND channel='email'`,
  );
}
checks.push(
  "changed-recipient-address-or-disabled-provider-cancels-pending-effect-and-never-retargets-original-delivery",
);
// Company monitoring and personal inbox follow all sectors in the account, including later revocation.
const sectorB = (
  await call(`/locations/${site.id}/sectors`, {
    name: "Second notification scope",
  })
).id;
const serviceB = await call("/services", {
  name: "Outbox second scope " + stamp,
  sectorId: sectorB,
  basePrice: "5",
  durationMinutes: 30,
  requiresCollaborator: false,
  requiresRoom: false,
});
sql(
  `INSERT INTO "UserSectorAccess"("userId","sectorId") VALUES('__http_manager',${quote(sectorId)}) ON CONFLICT DO NOTHING`,
);
const scopedBooking = async (day) =>
  call("/appointments", {
    idempotencyKey: randomUUID(),
    customerId: "__http_customer",
    lines: [
      { serviceId: service.id, startsAt: `2052-03-${day}T10:00:00Z` },
      { serviceId: serviceB.id },
    ],
  });
const partial = await scopedBooking("09");
await recoverAll();
const partialEvent = eventRows(partial.orderId)[0];
assert.equal(
  eventHistories(partialEvent.id).filter(
    (h) => h.recipientUserId === "__http_manager",
  ).length,
  0,
);
sql(
  `INSERT INTO "UserSectorAccess"("userId","sectorId") VALUES('__http_manager',${quote(sectorB)}) ON CONFLICT DO NOTHING`,
);
const full = await scopedBooking("10");
await recoverAll();
const fullEvent = eventRows(full.orderId)[0],
  managerMail = eventHistories(fullEvent.id).find(
    (h) => h.channel === "email" && h.recipientUserId === "__http_manager",
  );
assert(managerMail);
const managerOptions = { headers: { Authorization: "Bearer manager" } };
let monitored = await call("/notifications/history", undefined, managerOptions);
assert(monitored.some((h) => h.domainEventId === fullEvent.id));
assert(monitored.every((h) => !("payload" in h) && !("recipientEmail" in h)));
let inbox = await call("/notifications/inbox", undefined, managerOptions);
assert(inbox.some((i) => i.entityId === full.id));
assert(inbox.every((i) => !("payload" in i)));
sql(
  `DELETE FROM "UserSectorAccess" WHERE "userId"='__http_manager' AND "sectorId"=${quote(sectorB)}`,
);
monitored = await call("/notifications/history", undefined, managerOptions);
assert(!monitored.some((h) => h.domainEventId === fullEvent.id));
inbox = await call("/notifications/inbox", undefined, managerOptions);
assert(!inbox.some((i) => i.entityId === full.id));
await control("dispatch", { id: managerMail.id });
assert.equal(history(managerMail.id).status, "skipped");
assert.equal(await providerCount(managerMail.id), 0);
checks.push(
  "multi-sector-notice-requires-all-account-memberships-and-revocation-hides-history-inbox-and-blocks-pending-email-without-contact-payload-leaks",
);
const beforeManual = counts();
await call(
  "/notifications/events",
  {
    eventType: "appointment.confirmed",
    entityType: "appointment",
    entityId: full.id,
  },
  { status: 400 },
);
assert.deepEqual(counts(), beforeManual);
checks.push(
  "generic-notification-endpoint-cannot-forge-an-appointment-confirmation-without-domain-transition",
);
const legacyId = randomUUID();
sql(
  `INSERT INTO "NotificationHistory"(id,"tenantId",channel,"eventType",status) VALUES(${quote(legacyId)},'__http_a','email','appointment.confirmed','pending')`,
);
await control("dispatch", { id: legacyId });
assert.equal(history(legacyId).status, "pending");
assert.equal(await providerCount(legacyId), 0);
checks.push(
  "legacy-external-pending-status-is-not-reinterpreted-as-a-safe-new-send",
);
await call(
  "/notifications/providers/webhook",
  {
    enabled: true,
    providerKey: "webhook.http",
    config: { url: "https://synthetic.invalid" },
  },
  {
    method: "PATCH",
    status: 403,
    headers: { Authorization: "Bearer manager" },
  },
);
checks.push("shared-webhook-setting-requires-whole-company-operational-scope");
sql(
  `DELETE FROM "UserSectorAccess" WHERE "userId"='__http_manager' AND "sectorId" IN (${quote(sectorId)},${quote(sectorB)})`,
);

const result = {
  checkedAt: new Date().toISOString(),
  database: health.database,
  identity: "isolated-synthetic-http",
  providerCalls: "synthetic-only",
  mainDatabaseModified: false,
  checks,
  fixture: {
    serviceId: service.id,
    locationId: site.id,
    sectorId,
    orderId: booking.orderId,
  },
};
writeFileSync(
  ".local/step12/http-result.json",
  JSON.stringify(result, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify({ ...result, fixture: undefined }));
