/** Actual ALORA domain services + SDK, disposable PostgreSQL; only the central transport is synthetic. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
const base = "http://127.0.0.1:53029",
  origin = "http://127.0.0.1:53030";
const health = await (await fetch(base + "/health")).json();
assert(health.testOnly && /^step11_qa_\d+$/.test(health.database));
const checks = [];
const push = checks.push.bind(checks);
checks.push = (...items) => {
  for (const item of items) console.log("PASS: " + item);
  return push(...items);
};
async function control(body) {
  const r = await fetch(base + "/_qa", {
    method: body ? "POST" : "GET",
    headers: {
      "X-Alora-QA": "step11-synthetic",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, 200, JSON.stringify(data));
  return data;
}
const state = await control(),
  tenant = state.actors.owner.tenantId,
  installation = state.installations[0];
async function call(
  path,
  body,
  {
    method = body ? "POST" : "GET",
    actor = "owner",
    status = method === "PATCH" || method === "GET" ? 200 : 201,
  } = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Authorization: "Bearer " + state.actors[actor].session.accessToken,
      Origin: origin,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await r.text();
  assert.equal(r.status, status, path + ": " + raw);
  assert(!/credentialCipher|payloadCipher|synthetic-grant-secret/.test(raw));
  return raw ? JSON.parse(raw) : null;
}
const sql = (q) =>
  execFileSync(
    "docker",
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
    { input: q, stdio: "pipe" },
  )
    .toString()
    .trim();
const quote = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const rows = (table, where = "true") =>
  JSON.parse(
    sql(
      `SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM "${table}" r WHERE ${where}`,
    ),
    (_key, value) =>
      typeof value === "string" &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value)
        ? value + "Z"
        : value,
  );
const workflow = async (body) => control({ workflow: body || {} });
let fixtures = (await workflow()).fixtures[0];
await control({ connectionState: "connected" });
const wa = await call("/notifications/automation-grants", {
  idempotencyKey: randomUUID(),
  channel: "whatsapp",
  validDays: 3,
  archiveId: installation.archiveId,
});
const action = await call("/notifications/automation-grants", {
  idempotencyKey: randomUUID(),
  channel: "application_notification",
  useCase: "customer_commands",
  validDays: 3,
});
const staff = await call("/notifications/automation-grants", {
  idempotencyKey: randomUUID(),
  channel: "application_notification",
  validDays: 3,
});
assert.equal(action.useCase, "customer_commands");
assert.deepEqual(
  rows("NotificationAutomationGrant", `id=${quote(action.id)}`)[0].request
    .functions,
  ["appointments.update.all", "notifications.manage"],
);
const hook = await call("/notifications/automation-webhooks", {
  idempotencyKey: randomUUID(),
});
const hookRow = rows(
  "NotificationAutomationWebhook",
  `id=${quote(hook.id)}`,
)[0];
const root = "/notifications/appointment-policy";
const settings = {
  initialConfirmation: true,
  requestResponse: true,
  leadMinutes: 1440,
  maxReminders: 2,
  repeatIntervalMinutes: 15,
  responseDeadlineMinutes: 30,
  deliveryStart: "00:00",
  deliveryEnd: "23:59",
  noResponseAction: "notify_staff",
};
let policy = await call(root);
policy = await call(
  root,
  { expectedRevision: policy.revision, settings },
  { method: "PATCH" },
);
await call(
  root + "/activate",
  {
    expectedRevision: policy.revision,
    whatsappGrantId: wa.id,
    actionGrantId: staff.id,
    staffGrantId: staff.id,
  },
  { status: 403 },
);
policy = await call(root + "/activate", {
  expectedRevision: policy.revision,
  whatsappGrantId: wa.id,
  actionGrantId: action.id,
  staffGrantId: staff.id,
});
assert.equal(policy.status, "active");
checks.push(
  "activation-requires-separate-channel-and-agenda-authorities-with-current-SDK-verification",
);
let day = 3;
async function book(extra = {}) {
  const start = new Date(Date.now() + day++ * 86400000);
  start.setUTCHours(10, 0, 0, 0);
  return call("/appointments", {
    idempotencyKey: randomUUID(),
    customerName: "Synthetic Workflow " + randomUUID().slice(0, 8),
    phone: "+393330000002",
    email: randomUUID() + "@workflow.invalid",
    appointmentWhatsAppConsent: true,
    status: "requested",
    lines: [{ serviceId: fixtures.services[0], startsAt: start.toISOString() }],
    ...extra,
  });
}
const runFor = (orderId) =>
  rows("AppointmentAutomationRun", `"orderId"=${quote(orderId)}`).at(-1);
const deliveries = (runId) =>
  rows("AppointmentAutomationDelivery", `"runId"=${quote(runId)}`).sort(
    (a, b) => a.sequence - b.sequence,
  );
const history = (id) => rows("NotificationHistory", `id=${quote(id)}`)[0];
async function materialize() {
  await workflow({ action: "recover" });
}
async function sendInitial(booking, expectedStatus = "queued") {
  await materialize();
  const run = runFor(booking.orderId);
  assert(run, "Missing run for " + booking.orderId);
  const first = deliveries(run.id)[0];
  assert.equal(first.sequence, 0);
  await workflow({
    clockOffsetMs: 65000,
    action: "dispatch",
    historyId: first.historyId,
  });
  await workflow({ clockOffsetMs: 0 });
  assert.equal(history(first.historyId).status, expectedStatus);
  return { run, first };
}
function actionsFromProvider(historyId) {
  const command = rows(
    "NotificationAutomationCommand",
    `"commandId"=${quote(historyId)}`,
  )[0];
  assert(command.lastReceipt?.id);
  return control().then((s) => {
    const out = s.installations[0].outbox.find(
      (o) => o.id === command.lastReceipt?.id,
    );
    assert(out);
    const parsed = JSON.parse(out.fingerprint);
    const payload = Array.isArray(parsed) ? parsed[1].payload : parsed.payload;
    assert.equal(payload.kind, "interactive");
    return payload.content.actions;
  });
}
async function reply(token, patch = {}) {
  const now = new Date().toISOString(),
    event = {
      id: randomUUID(),
      installationId: installation.id,
      sessionId: installation.session.id,
      kind: "message.interactive_response",
      createdAt: now,
      payload: {
        messageId: randomUUID(),
        providerId: "synthetic-workflow",
        sessionId: installation.session.id,
        messageSessionId: installation.session.id,
        archiveId: installation.archiveId,
        chatId: "393330000002@c.us",
        direction: "in",
        fromMe: false,
        senderId: "393330000002@c.us",
        recipientId: "393330000001@c.us",
        occurredAt: now,
        observedAt: now,
        timestampSource: "provider",
        source: "whatsapp_provider",
        addressingVerified: true,
        kind: "buttons_response",
        body: { selectedButtonId: token },
        ...patch,
      },
    };
  const raw = JSON.stringify(event),
    timestamp = String(Math.floor(Date.now() / 1000)),
    { signature } = await control({
      signWebhook: { endpointId: hookRow.endpointId, raw, timestamp },
    });
  const r = await fetch(
    base + `/notifications/automation-webhooks/${hook.id}/events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Eulab-Event-Id": event.id,
        "X-Eulab-Timestamp": timestamp,
        "X-Eulab-Signature": signature,
      },
      body: raw,
    },
  );
  assert.equal(r.status, 202, await r.text());
  return event;
}
const samplePreview = await call(root + "/preview", {
  settings,
  sectorId: fixtures.sectors[0],
  localStartsAt: "2035-06-18T11:00",
  texts: {
    initial: "{{appointment.status}}",
    reminder: "{{appointment.status}}",
    confirmed: "{{appointment.status}}",
    cancelled: "{{appointment.status}}",
    rescheduled: "{{appointment.status}}",
  },
});
assert.equal(samplePreview.messagePreview.confirmed, "confirmed");
assert.equal(samplePreview.messagePreview.cancelled, "cancelled");
assert.equal(samplePreview.messagePreview.rescheduled, "rescheduled");
checks.push("event-preview-renders-status-specific-operational-example-values");
const noticeFor = (orderId, type) =>
  rows(
    "AppointmentAutomationDelivery",
    `"runId" IS NULL AND "noticeContext"->>'orderId'=${quote(orderId)} AND "noticeContext"->>'eventType'=${quote(type)}`,
  ).at(-1);
async function confirm(booking) {
  return call(`/appointments/${booking.id}/status`, { status: "confirmed" });
}
async function cancel(booking) {
  const sale = rows("Sale", `id=${quote(booking.orderId)}`)[0];
  return call(`/appointments/${booking.id}/cancel`, {
    revision: sale.revision,
    idempotencyKey: randomUUID(),
    reason: "Synthetic event notice cancellation",
  });
}
async function activateEvents(events) {
  policy = await call(root);
  policy = await call(
    root,
    {
      expectedRevision: policy.revision,
      settings: { ...settings, eventNotices: events },
      texts: {
        initial: "INITIAL {{service.name}} {{appointment.startsAt}}",
        reminder: "REMINDER {{service.name}}",
        confirmed:
          "CONFIRMED {{customer.firstName}} {{service.name}} {{appointment.startsAt}}",
        cancelled:
          "CANCELLED {{customer.firstName}} {{service.name}} {{appointment.startsAt}}",
        rescheduled: "RESCHEDULED {{service.name}} {{appointment.startsAt}}",
      },
    },
    { method: "PATCH" },
  );
  policy = await call(root + "/activate", {
    expectedRevision: policy.revision,
    whatsappGrantId: wa.id,
    actionGrantId: action.id,
    staffGrantId: staff.id,
  });
}
async function sendNotice(notice) {
  assert(notice);
  await workflow({
    clockOffsetMs: 65000,
    action: "dispatch",
    historyId: notice.historyId,
  });
  await workflow({ clockOffsetMs: 0 });
  assert.equal(history(notice.historyId).status, "queued");
  const command = rows(
    "NotificationAutomationCommand",
    `"commandId"=${quote(notice.historyId)}`,
  )[0];
  assert(command.lastReceipt?.id);
  const wire = (await control()).installations[0].outbox.find(
    (o) => o.id === command.lastReceipt.id,
  );
  const payload = JSON.parse(wire.fingerprint)[1].payload;
  assert.equal(payload.kind, "text");
  assert(!payload.content);
  return { command, payload };
}
const disabled = await book();
await confirm(disabled);
await cancel(disabled);
await materialize();
assert.equal(noticeFor(disabled.orderId, "appointment.confirmed"), undefined);
assert.equal(noticeFor(disabled.orderId, "appointment.cancelled"), undefined);
checks.push(
  "new-confirmation-and-cancellation-events-stay-disabled-until-explicit-policy-choice",
);
await activateEvents({
  confirmation: true,
  cancellation: true,
  rescheduling: true,
});
const confirmed = await book();
await materialize();
await confirm(confirmed);
await materialize();
const cn = noticeFor(confirmed.orderId, "appointment.confirmed"),
  sentConfirmation = await sendNotice(cn);
assert(sentConfirmation.payload.text.startsWith("CONFIRMED "));
const beforeDuplicate = rows(
  "NotificationHistory",
  `"domainEventId"=${quote(history(cn.historyId).domainEventId)}`,
);
await materialize();
assert.deepEqual(
  rows(
    "NotificationHistory",
    `"domainEventId"=${quote(history(cn.historyId).domainEventId)}`,
  ),
  beforeDuplicate,
);
checks.push(
  "staff-confirmation-prepares-one-frozen-text-notice-with-configured-renderer-and-same-outbox",
);
const cancelled = await book();
await materialize();
await call(`/sales/${cancelled.orderId}/payments`, {
  kind: "receive",
  revision: rows("Sale", `id=${quote(cancelled.orderId)}`)[0].revision,
  idempotencyKey: randomUUID(),
  entries: [{ amount: "10", method: "cash" }],
});
const paymentBefore = rows(
  "PaymentEntry",
  `"saleId"=${quote(cancelled.orderId)}`,
);
await cancel(cancelled);
await materialize();
const can = noticeFor(cancelled.orderId, "appointment.cancelled"),
  sentCancellation = await sendNotice(can);
assert(sentCancellation.payload.text.startsWith("CANCELLED "));
assert.deepEqual(
  rows("PaymentEntry", `"saleId"=${quote(cancelled.orderId)}`),
  paymentBefore,
);
assert.equal(
  rows("Appointment", `id=${quote(cancelled.id)}`)[0].status,
  "cancelled",
);
checks.push(
  "cancelled-booking-can-notify-customer-without-reopening-agenda-changing-deposit-or-adding-buttons",
);
const customer = await book(),
  customerSend = await sendInitial(customer),
  customerActions = await actionsFromProvider(customerSend.first.historyId);
await reply(customerActions[0].id);
await materialize();
const customerNotice = noticeFor(customer.orderId, "appointment.confirmed");
await sendNotice(customerNotice);
assert.equal(
  rows(
    "OrderOperation",
    `"saleId"=${quote(customer.orderId)} AND source='customer'`,
  ).length,
  1,
);
assert.equal(
  rows("AppointmentAutomationRun", `"orderId"=${quote(customer.orderId)}`)
    .length,
  1,
);
checks.push(
  "customer-confirmation-notice-acknowledges-one-domain-operation-without-starting-another-response-cycle",
);
const stale = await book();
await confirm(stale);
const oldStart = rows("Appointment", `id=${quote(stale.id)}`)[0].startsAt,
  newStart = new Date(Date.parse(oldStart) + 86400000).toISOString();
await call(
  `/appointments/${stale.id}`,
  {
    revision: rows("Sale", `id=${quote(stale.orderId)}`)[0].revision,
    idempotencyKey: randomUUID(),
    startsAt: newStart,
  },
  { method: "PATCH" },
);
await materialize();
assert.equal(noticeFor(stale.orderId, "appointment.confirmed"), undefined);
const freshRun = runFor(stale.orderId);
assert(freshRun);
const rescheduledWire = await sendInitial(stale);
const rescheduledCommand = rows(
  "NotificationAutomationCommand",
  `"commandId"=${quote(rescheduledWire.first.historyId)}`,
)[0];
const rescheduledProvider = (await control()).installations[0].outbox.find(
  (o) => o.id === rescheduledCommand.lastReceipt.id,
);
assert(
  JSON.parse(
    rescheduledProvider.fingerprint,
  )[1].payload.content.body.startsWith("RESCHEDULED "),
);
checks.push(
  "delayed-old-event-cannot-build-a-new-intent-for-a-different-schedule-and-current-reschedule-uses-own-text",
);
const revoked = await book();
await confirm(revoked);
await materialize();
const revokedNotice = noticeFor(revoked.orderId, "appointment.confirmed");
await sendNotice(revokedNotice);
await call(
  `/customers/${rows("Sale", `id=${quote(revoked.orderId)}`)[0].customerId}`,
  { phone: "+393330000099" },
  { method: "PATCH" },
);
assert(
  rows(
    "NotificationAutomationCommand",
    `"commandId"=${quote(revokedNotice.historyId)}`,
  )[0].withdrawRequestedAt,
);
await workflow({
  clockOffsetMs: 100000,
  action: "dispatch",
  historyId: revokedNotice.historyId,
});
await workflow({ clockOffsetMs: 0 });
assert.equal(
  rows(
    "NotificationAutomationCommand",
    `"commandId"=${quote(revokedNotice.historyId)}`,
  )[0].lastReceipt.state,
  "cancelled",
);
checks.push(
  "phone-change-stops-queued-event-notice-transactionally-and-reconciles-original-withdrawal",
);
const withoutConsent = await book({ appointmentWhatsAppConsent: false });
await confirm(withoutConsent);
await cancel(withoutConsent);
await materialize();
assert.equal(
  noticeFor(withoutConsent.orderId, "appointment.confirmed"),
  undefined,
);
assert.equal(
  noticeFor(withoutConsent.orderId, "appointment.cancelled"),
  undefined,
);
checks.push(
  "event-notification-choice-does-not-authorize-a-customer-number-without-booking-consent",
);
const rebound = await book();
await confirm(rebound);
const reboundCustomer = rows("Sale", `id=${quote(rebound.orderId)}`)[0]
  .customerId;
await call(
  `/customers/${reboundCustomer}`,
  { phone: "+393330000099" },
  { method: "PATCH" },
);
const reboundContact = await call(
  `/appointments/${rebound.id}/notification-contact`,
);
await call(
  `/appointments/${rebound.id}/notification-contact`,
  {
    revision: reboundContact.revision,
    idempotencyKey: randomUUID(),
    authorized: true,
  },
  { method: "PATCH" },
);
await materialize();
assert.equal(noticeFor(rebound.orderId, "appointment.confirmed"), undefined);
checks.push(
  "pending-old-event-never-adopts-a-later-contact-authorization-or-recipient",
);
assert.throws(() =>
  sql(
    `UPDATE "AppointmentAutomationDelivery" SET "noticeContext"='{}' WHERE "historyId"=${quote(cn.historyId)}`,
  ),
);
assert.throws(() =>
  sql(
    `DELETE FROM "AppointmentAutomationDelivery" WHERE "historyId"=${quote(cn.historyId)}`,
  ),
);
assert.throws(() =>
  sql(`DELETE FROM "NotificationHistory" WHERE id=${quote(cn.historyId)}`),
);
assert.throws(() =>
  sql(
    `BEGIN; DELETE FROM "Tenant" WHERE id=${quote(tenant)}; DO $$ BEGIN IF EXISTS(SELECT 1 FROM "AppointmentAutomationDelivery" d JOIN "NotificationHistory" h ON h.id=d."historyId" WHERE h."tenantId"=${quote(tenant)}) THEN RAISE EXCEPTION 'Notice orphan'; END IF; END $$; ROLLBACK;`,
  ),
);
checks.push(
  "event-notice-context-and-original-history-are-immutable-and-booked-activity-deletion-remains-blocked",
);
await activateEvents({
  confirmation: false,
  cancellation: false,
  rescheduling: false,
});
const quiet = await book();
await materialize();
const oldRun = runFor(quiet.orderId);
await call(
  `/appointments/${quiet.id}`,
  {
    revision: rows("Sale", `id=${quote(quiet.orderId)}`)[0].revision,
    idempotencyKey: randomUUID(),
    startsAt: new Date(Date.parse(oldRun.startsAt) + 86400000).toISOString(),
  },
  { method: "PATCH" },
);
await materialize();
const quietRun = runFor(quiet.orderId);
assert(deliveries(quietRun.id).every((d) => d.sequence > 0));
checks.push(
  "reschedule-event-can-be-disabled-while-future-reminders-replan-for-the-new-slot",
);
const monitor = await call("/notifications/appointment-automations");
assert(
  monitor.some(
    (r) => r.kind === "event_notice" && r.eventType === "appointment.cancelled",
  ),
);
assert(!JSON.stringify(monitor).includes("CANCELLED "));
assert.equal(
  (
    await call("/notifications/appointment-automations", undefined, {
      actor: "foreign",
    })
  ).length,
  0,
);
checks.push(
  "monitor-distinguishes-event-notices-from-response-plans-without-message-payloads-or-cross-tenant-data",
);
const reminderDate = new Date(Date.now() + 2 * 86400000);
reminderDate.setUTCHours(10, 0, 0, 0);
const scheduled = await book({
  lines: [
    { serviceId: fixtures.services[0], startsAt: reminderDate.toISOString() },
  ],
});
const scheduledSend = await sendInitial(scheduled);
const scheduledDeliveries = deliveries(scheduledSend.run.id);
assert.equal(scheduledDeliveries.length, 3);
for (const delivery of scheduledDeliveries.filter((d) => d.sequence > 0)) {
  await workflow({
    clockOffsetMs: Date.parse(delivery.dueAt) - Date.now() + 1000,
    action: "dispatch",
    historyId: delivery.historyId,
  });
  assert.equal(history(delivery.historyId).status, "queued");
}
await workflow({ clockOffsetMs: 0 });
assert.equal(
  rows(
    "NotificationAutomationCommand",
    `"commandId" IN (${scheduledDeliveries.map((d) => quote(d.historyId)).join(",")}) AND "sendStartedAt" IS NOT NULL`,
  ).length,
  3,
);
checks.push(
  "scheduled-first-and-repeated-reminder-dispatch-with-original-due-times-and-bounded-command-count",
);
policy = await call(root);
policy = await call(
  root,
  {
    expectedRevision: policy.revision,
    settings: {
      ...settings,
      initialConfirmation: false,
      requestResponse: false,
      maxReminders: 0,
      eventNotices: {
        confirmation: false,
        cancellation: true,
        rescheduling: false,
      },
    },
  },
  { method: "PATCH" },
);
policy = await call(root + "/activate", {
  expectedRevision: policy.revision,
  whatsappGrantId: wa.id,
});
const cancellationOnly = await book();
await materialize();
assert.equal(runFor(cancellationOnly.orderId), undefined);
await cancel(cancellationOnly);
await materialize();
await sendNotice(noticeFor(cancellationOnly.orderId, "appointment.cancelled"));
checks.push(
  "owner-can-select-cancellation-only-without-initial-message-or-reminders",
);
await activateEvents({
  confirmation: false,
  cancellation: false,
  rescheduling: true,
});
const locker = spawn(
  "docker",
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
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
  ],
  { stdio: ["pipe", "pipe", "pipe"] },
);
const lockerClosed = once(locker, "close");
let lockOutput = "",
  resolveLocked;
const locked = new Promise((resolve) => (resolveLocked = resolve));
locker.stdout.on("data", (data) => {
  lockOutput += data.toString();
  if (lockOutput.includes("LOCKED")) resolveLocked();
});
locker.stdin.write(
  `BEGIN; SELECT pg_advisory_xact_lock(hashtextextended(${quote(tenant)},7)); SELECT 'LOCKED';\n`,
);
try {
  await Promise.race([
    locked,
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("Tenant lock timeout")), 3000),
    ),
  ]);
  const blockedBooking = book();
  let observed = false;
  for (let i = 0; i < 30; i++) {
    if (
      Number(
        sql(
          `SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'`,
        ),
      ) > 0
    ) {
      observed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  assert(
    observed,
    "Actual booking transaction did not wait for the tenant lock",
  );
  locker.stdin.end(
    `UPDATE "AppointmentAutomationPolicy" SET revision=revision+1,"enabledAt"=clock_timestamp() WHERE "tenantId"=${quote(tenant)}; COMMIT;\n`,
  );
  const bookingAfterActivation = await blockedBooking;
  assert.equal((await lockerClosed)[0], 0);
  await materialize();
  assert(runFor(bookingAfterActivation.orderId));
  const sourceEvent = rows(
    "NotificationDomainEvent",
    `payload->'eventData'->>'orderId'=${quote(bookingAfterActivation.orderId)} AND "eventType"='appointment.created.internal'`,
  )[0];
  assert(
    Date.parse(sourceEvent.createdAt) >=
      Date.parse(
        rows("AppointmentAutomationPolicy", `"tenantId"=${quote(tenant)}`)[0]
          .enabledAt,
      ),
  );
} finally {
  if (locker.exitCode === null) locker.stdin.end("ROLLBACK;\n");
}
checks.push(
  "booking-event-time-follows-tenant-lock-order-and-does-not-drop-post-activation-work",
);
const result = {
  checkedAt: new Date().toISOString(),
  database: health.database,
  realSdk: true,
  realDomainServices: true,
  provider: "synthetic-loopback",
  realAccounts: false,
  realProviderMessages: false,
  checks,
};
mkdirSync(".local/step12", { recursive: true });
writeFileSync(
  ".local/step12/event-notices-http-result.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
