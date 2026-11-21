/** Actual ALORA domain services + SDK, disposable PostgreSQL; only the central transport is synthetic. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
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
async function sendInitial(
  booking,
  expectedStatus = "queued",
  allowReminder = false,
) {
  await materialize();
  const run = runFor(booking.orderId);
  assert(run, "Missing run for " + booking.orderId);
  const first = deliveries(run.id)[0];
  if (allowReminder) assert(first.sequence > 0);
  else assert.equal(first.sequence, 0);
  await workflow({
    clockOffsetMs: allowReminder
      ? Math.max(65000, Date.parse(first.dueAt) - Date.now() + 1000)
      : 65000,
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
const noConsent = await book({ appointmentWhatsAppConsent: false });
await materialize();
assert.equal(runFor(noConsent.orderId), undefined);
const contact = await call(
  `/appointments/${noConsent.id}/notification-contact`,
);
await call(
  `/appointments/${noConsent.id}/notification-contact`,
  {
    revision: contact.revision,
    idempotencyKey: randomUUID(),
    authorized: true,
  },
  { method: "PATCH" },
);
await materialize();
assert(runFor(noConsent.orderId));
await call(
  `/appointments/${noConsent.id}/notification-contact`,
  {
    revision: contact.revision,
    idempotencyKey: randomUUID(),
    authorized: false,
  },
  { method: "PATCH", status: 409 },
);
checks.push(
  "per-booking-explicit-consent-and-revision-checked-later-authorization-without-account-mutation",
);
const booked = await book();
const { run, first } = await sendInitial(booked);
await Promise.all([
  workflow({ action: "dispatch", historyId: first.historyId }),
  workflow({ action: "dispatch", historyId: first.historyId }),
]);
assert.equal(history(first.historyId).status, "queued");
const command = rows(
  "NotificationAutomationCommand",
  `"commandId"=${quote(first.historyId)}`,
)[0];
const outboxCount = (await control()).installations[0].outbox.length;
await workflow({
  clockOffsetMs: 100000,
  action: "dispatch",
  historyId: first.historyId,
});
await workflow({ clockOffsetMs: 0 });
assert.equal((await control()).installations[0].outbox.length, outboxCount);
checks.push(
  "durable-queue-ack-is-queued-and-repeated-jobs-poll-existing-command-without-second-send",
);
const revision = rows("Sale", `id=${quote(booked.orderId)}`)[0].revision;
await call(`/sales/${booked.orderId}/payments`, {
  kind: "receive",
  revision,
  idempotencyKey: randomUUID(),
  entries: [{ amount: "10", method: "cash" }],
});
const moneyBefore = rows("PaymentEntry", `"saleId"=${quote(booked.orderId)}`),
  saleBefore = rows("Sale", `id=${quote(booked.orderId)}`)[0];
assert.equal(runFor(booked.orderId).status, "waiting");
const actions = await actionsFromProvider(first.historyId);
await reply(actions[0].id, {
  senderId: "393330000099@c.us",
  chatId: "393330000099@c.us",
});
await materialize();
assert.equal(runFor(booked.orderId).status, "waiting");
await reply(actions[0].id);
await materialize();
assert.equal(runFor(booked.orderId).status, "confirmed");
assert.equal(
  rows("Appointment", `id=${quote(booked.id)}`)[0].status,
  "confirmed",
);
assert.deepEqual(
  rows("PaymentEntry", `"saleId"=${quote(booked.orderId)}`),
  moneyBefore,
);
const operation = rows(
  "OrderOperation",
  `"saleId"=${quote(booked.orderId)} AND source='customer'`,
);
assert.equal(operation.length, 1);
assert.equal(operation[0].actorUserId, null);
await reply(actions[2].id);
await materialize();
assert.equal(
  rows(
    "OrderOperation",
    `"saleId"=${quote(booked.orderId)} AND source='customer'`,
  ).length,
  1,
);
for (const field of [
  "subtotal",
  "total",
  "discountTotal",
  "taxTotal",
  "paymentStatus",
  "paymentBasis",
])
  assert.equal(
    rows("Sale", `id=${quote(booked.orderId)}`)[0][field],
    saleBefore[field],
  );
checks.push(
  "signed-bound-one-use-confirmation-cannot-impersonate-staff-and-deposits-do-not-invalidate-or-change",
);
const changed = await book(),
  changedSend = await sendInitial(changed),
  changeActions = await actionsFromProvider(changedSend.first.historyId);
await reply(changeActions[1].id);
await materialize();
assert.equal(runFor(changed.orderId).status, "change_requested");
assert.equal(
  rows("Appointment", `id=${quote(changed.id)}`)[0].status,
  "requested",
);
let monitored = (await call("/notifications/appointment-automations")).find(
  (r) => r.id === changedSend.run.id,
);
assert(monitored && !monitored.reviewedAt);
await call(`/notifications/appointment-automations/${monitored.id}/review`, {
  expectedUpdatedAt: monitored.updatedAt,
});
checks.push(
  "change-request-is-visible-and-reviewable-without-moving-booking-or-money",
);
const cancelled = await book(),
  cancelSend = await sendInitial(cancelled),
  cancelActions = await actionsFromProvider(cancelSend.first.historyId);
await reply(cancelActions[2].id);
await materialize();
assert.equal(runFor(cancelled.orderId).status, "cancelled");
assert.equal(
  rows("Appointment", `id=${quote(cancelled.id)}`)[0].status,
  "cancelled",
);
assert.equal(
  rows("AppointmentCancellation", `"appointmentId"=${quote(cancelled.id)}`)[0]
    .cancelledByType,
  "customer",
);
assert.equal(
  rows("PaymentEntry", `"saleId"=${quote(cancelled.orderId)}`).length,
  0,
);
checks.push(
  "customer-cancellation-outside-24-hours-records-customer-principal-without-refund-or-stock-return",
);
const lateStart = new Date(Date.now() + 20 * 3600000);
lateStart.setUTCSeconds(0, 0);
const late = await book({
  lines: [
    { serviceId: fixtures.services[1], startsAt: lateStart.toISOString() },
  ],
});
const lateSend = await sendInitial(late),
  lateActions = await actionsFromProvider(lateSend.first.historyId);
await reply(lateActions[2].id);
await materialize();
assert.equal(runFor(late.orderId).status, "change_requested");
assert.equal(
  rows("Appointment", `id=${quote(late.id)}`)[0].status,
  "requested",
);
checks.push("late-cancellation-becomes-staff-request-and-retains-booking");
const beforeStop = await book(),
  stopSend = await sendInitial(beforeStop),
  stopActions = await actionsFromProvider(stopSend.first.historyId);
const c = await call(`/appointments/${beforeStop.id}/notification-contact`);
await call(
  `/appointments/${beforeStop.id}/notification-contact`,
  { revision: c.revision, idempotencyKey: randomUUID(), authorized: false },
  { method: "PATCH" },
);
assert.equal(runFor(beforeStop.orderId).status, "superseded");
assert(
  rows(
    "NotificationAutomationCommand",
    `"commandId"=${quote(stopSend.first.historyId)}`,
  )[0].withdrawRequestedAt,
);
await reply(stopActions[0].id);
await materialize();
assert.equal(
  rows("Appointment", `id=${quote(beforeStop.id)}`)[0].status,
  "requested",
);
await workflow({ action: "withdrawals" });
checks.push(
  "consent-revocation-stops-original-outbox-command-and-rejects-late-customer-actions",
);
const lostBooking = await book();
await control({ flags: { loseDelegatedSend: true } });
const lostSend = await sendInitial(lostBooking, "uncertain");
const lostCount = (await control()).installations[0].outbox.length;
await workflow({
  clockOffsetMs: 100000,
  action: "dispatch",
  historyId: lostSend.first.historyId,
});
await workflow({ clockOffsetMs: 0 });
assert.equal(history(lostSend.first.historyId).status, "queued");
assert.equal((await control()).installations[0].outbox.length, lostCount);
const lostCommand = rows(
  "NotificationAutomationCommand",
  `"commandId"=${quote(lostSend.first.historyId)}`,
)[0];
await control({
  delegatedMessage: { id: lostCommand.lastReceipt.id, state: "sent" },
});
await workflow({
  clockOffsetMs: 135000,
  action: "dispatch",
  historyId: lostSend.first.historyId,
});
await workflow({ clockOffsetMs: 0 });
assert.equal(history(lostSend.first.historyId).status, "sent");
assert(history(lostSend.first.historyId).sentAt);
assert.equal((await control()).installations[0].outbox.length, lostCount);
checks.push(
  "lost-provider-ack-reconciles-original-receipt-without-requeue-and-only-sent-receipt-marks-history-sent",
);
const mixedStart = new Date(Date.now() + 2 * 86400000);
mixedStart.setUTCHours(10, 0, 0, 0);
const mixed = await book({
  lines: [
    { serviceId: fixtures.services[0], startsAt: mixedStart.toISOString() },
    {
      serviceId: fixtures.services[2],
      startsAt: new Date(mixedStart.getTime() + 3600000).toISOString(),
    },
  ],
});
await call(`/appointments/${mixed.appointments[0].id}/status`, {
  status: "completed",
});
const performedBefore = rows(
    "Appointment",
    `id=${quote(mixed.appointments[0].id)}`,
  )[0],
  mixedSend = await sendInitial(mixed, "queued", true),
  mixedActions = await actionsFromProvider(mixedSend.first.historyId);
assert.equal(mixedSend.run.snapshot.appointments.length, 1);
await reply(mixedActions[2].id);
await materialize();
assert.deepEqual(
  rows("Appointment", `id=${quote(mixed.appointments[0].id)}`)[0],
  performedBefore,
);
assert.equal(
  rows("Appointment", `id=${quote(mixed.appointments[1].id)}`)[0].status,
  "cancelled",
);
assert.equal(rows("Sale", `id=${quote(mixed.orderId)}`)[0].orderStatus, "open");
checks.push(
  "customer-cancels-only-future-pending-rows-and-preserves-performed-row-and-open-account",
);
// Persisted intents survive a Redis failure and use the existing queue on recovery.
for (let i = 0; i < 3; i++) {
  await workflow({ action: "drain" });
  await materialize();
}
await workflow({ queueUnavailable: true });
const offline = await book();
await materialize();
const offlineRun = runFor(offline.orderId);
assert(offlineRun);
assert(deliveries(offlineRun.id).length >= 2);
await workflow({ queueUnavailable: false, clockOffsetMs: 65000 });
await materialize();
await workflow({ clockOffsetMs: 0 });
const queueState = await workflow();
assert(
  queueState.queued.some(
    (j) => j.notificationHistoryId === deliveries(offlineRun.id)[0].historyId,
  ),
);
checks.push(
  "redis-outage-keeps-transactional-intents-and-recovery-rebuilds-existing-queue",
);
const moved = await book(),
  movedSend = await sendInitial(moved),
  movedActions = await actionsFromProvider(movedSend.first.historyId);
const movedRevision = rows("Sale", `id=${quote(moved.orderId)}`)[0].revision;
await call(
  `/appointments/${moved.id}`,
  {
    revision: movedRevision,
    idempotencyKey: randomUUID(),
    startsAt: new Date(
      new Date(movedSend.run.startsAt).getTime() + 86400000,
    ).toISOString(),
  },
  { method: "PATCH" },
);
assert.equal(
  rows("AppointmentAutomationRun", `id=${quote(movedSend.run.id)}`)[0].status,
  "superseded",
);
await materialize();
assert.equal(
  rows(
    "AppointmentAutomationRun",
    `"orderId"=${quote(moved.orderId)} AND status='waiting'`,
  ).length,
  1,
);
await reply(movedActions[0].id);
await materialize();
assert.equal(
  rows("Appointment", `id=${quote(moved.id)}`)[0].status,
  "requested",
);
assert.equal(
  new Date(rows("Appointment", `id=${quote(moved.id)}`)[0].startsAt).getTime(),
  new Date(movedSend.run.startsAt).getTime() + 86400000,
);
checks.push(
  "rescheduling-invalidates-old-plan-and-action-and-creates-only-one-current-plan",
);
const phoneBooking = await book(),
  phoneSend = await sendInitial(phoneBooking),
  phoneActions = await actionsFromProvider(phoneSend.first.historyId);
await call(
  `/customers/${phoneSend.run.customerId}`,
  { phone: "+39 333 000 0002" },
  { method: "PATCH" },
);
assert.equal(runFor(phoneBooking.orderId).status, "waiting");
await call(
  `/customers/${phoneSend.run.customerId}`,
  { phone: "+393330000099" },
  { method: "PATCH" },
);
assert.equal(runFor(phoneBooking.orderId).status, "superseded");
await reply(phoneActions[0].id);
await materialize();
assert.equal(
  rows("Appointment", `id=${quote(phoneBooking.id)}`)[0].status,
  "requested",
);
checks.push(
  "phone-formatting-keeps-consent-but-number-change-invalidates-frozen-recipient-without-retargeting",
);
const denied = await book(),
  deniedSend = await sendInitial(denied),
  deniedActions = await actionsFromProvider(deniedSend.first.historyId);
const oldPermissions = rows("User", `id=${quote(state.actors.owner.userId)}`)[0]
  .permissions;
await control({
  actor: "owner",
  permissions: oldPermissions.filter((p) => p !== "appointments.update.all"),
});
await reply(deniedActions[0].id);
await materialize();
assert.equal(
  rows("Appointment", `id=${quote(denied.id)}`)[0].status,
  "requested",
);
await control({ actor: "owner", permissions: oldPermissions });
checks.push(
  "current-agenda-revocation-denies-customer-writes-even-while-whatsapp-authority-remains",
);
const rollback = await book(),
  rollbackSend = await sendInitial(rollback),
  rollbackActions = await actionsFromProvider(rollbackSend.first.historyId),
  rollbackEvent = await reply(rollbackActions[0].id);
const eventRow = rows(
  "NotificationAutomationWebhookEvent",
  `"eventId"=${quote(rollbackEvent.id)}`,
)[0];
await workflow({ failCustomerOperation: true });
const failed = await fetch(base + "/_qa", {
  method: "POST",
  headers: {
    "X-Alora-QA": "step11-synthetic",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    workflow: { action: "processEvent", eventId: eventRow.id },
  }),
});
assert.equal(failed.status, 500);
assert.equal(runFor(rollback.orderId).status, "waiting");
assert.equal(
  rows("Appointment", `id=${quote(rollback.id)}`)[0].status,
  "requested",
);
assert.equal(
  rows(
    "OrderOperation",
    `"saleId"=${quote(rollback.orderId)} AND source='customer'`,
  ).length,
  0,
);
assert.equal(
  rows("NotificationAutomationWebhookEvent", `id=${quote(eventRow.id)}`)[0]
    .status,
  "received",
);
await workflow({ action: "processEvent", eventId: eventRow.id });
assert.equal(runFor(rollback.orderId).status, "confirmed");
checks.push(
  "failure-after-operation-insert-rolls-back-booking-operation-response-and-receipt-and-same-event-retries-once",
);
const raced = await book(),
  racedSend = await sendInitial(raced),
  racedActions = await actionsFromProvider(racedSend.first.historyId);
const raceEvents = await Promise.all([
    reply(racedActions[0].id),
    reply(racedActions[2].id),
  ]),
  raceRows = raceEvents.map(
    (e) =>
      rows("NotificationAutomationWebhookEvent", `"eventId"=${quote(e.id)}`)[0],
  );
await Promise.all(
  raceRows.map((e) => workflow({ action: "processEvent", eventId: e.id })),
);
assert.equal(
  rows(
    "OrderOperation",
    `"saleId"=${quote(raced.orderId)} AND source='customer'`,
  ).length,
  1,
);
assert(["confirmed", "cancelled"].includes(runFor(raced.orderId).status));
checks.push(
  "competing-confirm-cancel-callbacks-serialize-to-one-customer-operation",
);
const silent = await book(),
  silentSend = await sendInitial(silent);
await workflow({
  clockOffsetMs:
    new Date(silentSend.run.expiresAt).getTime() - Date.now() + 1000,
  action: "recover",
});
await workflow({ clockOffsetMs: 0 });
assert.equal(runFor(silent.orderId).status, "expired");
assert.equal(
  rows("Appointment", `id=${quote(silent.id)}`)[0].status,
  "requested",
);
assert.equal(
  rows(
    "NotificationDomainEvent",
    `"eventKey"=${quote("automation-staff:" + silentSend.run.id)}`,
  ).length,
  1,
);
checks.push(
  "no-response-deadline-keeps-booking-and-materializes-at-most-one-separately-authorized-staff-notice",
);
policy = await call(root);
policy = await call(
  root,
  {
    expectedRevision: policy.revision,
    settings: { ...settings, noResponseAction: "keep_booking" },
  },
  { method: "PATCH" },
);
policy = await call(root + "/activate", {
  expectedRevision: policy.revision,
  whatsappGrantId: wa.id,
  actionGrantId: action.id,
});
const quiet = await book(),
  quietSend = await sendInitial(quiet),
  quietActions = await actionsFromProvider(quietSend.first.historyId);
await reply(quietActions[0].id);
await materialize();
assert.equal(
  rows(
    "NotificationHistory",
    `"metadata"->>'automationRunId'=${quote(quietSend.run.id)} AND channel IN ('email','in_app')`,
  ).length,
  0,
);
assert.equal(
  rows(
    "NotificationInbox",
    `payload->'eventData'->>'automationRunId'=${quote(quietSend.run.id)}`,
  ).length,
  0,
);
checks.push(
  "customer-action-does-not-imply-email-or-native-notification-authority",
);
const openRequests = await call(
  "/notifications/appointment-automations?view=open_requests",
);
assert(
  openRequests.every((r) => r.status === "change_requested" && !r.reviewedAt),
);
await call("/notifications/appointment-automations?view=injected", undefined, {
  status: 400,
});
policy = await call(root);
await call(root + "/deactivate", { expectedRevision: policy.revision });
assert(
  rows("AppointmentAutomationRun", `"tenantId"=${quote(tenant)}`).every(
    (r) => r.status !== "waiting",
  ),
);
assert.equal(
  (
    await call("/notifications/appointment-automations", undefined, {
      actor: "foreign",
    })
  ).length,
  0,
);
checks.push(
  "policy-stop-closes-waiting-plans-and-monitor-retains-tenant-isolation",
);
assert.throws(() =>
  sql(
    `UPDATE "AppointmentAutomationRun" SET "planHash"='replacement' WHERE id=${quote(run.id)}`,
  ),
);
assert.throws(() =>
  sql(
    `UPDATE "AppointmentAutomationRun" SET "tenantId"=${quote(state.actors.foreign.tenantId)} WHERE id=${quote(run.id)}`,
  ),
);
assert.throws(() =>
  sql(`DELETE FROM "AppointmentAutomationRun" WHERE id=${quote(run.id)}`),
);
assert.throws(() =>
  sql(
    `UPDATE "AppointmentAutomationAction" SET "tokenHash"='replacement' WHERE "runId"=${quote(run.id)}`,
  ),
);
assert.throws(() =>
  sql(
    `UPDATE "AppointmentAutomationDelivery" SET "dueAt"=now() WHERE "runId"=${quote(run.id)}`,
  ),
);
checks.push(
  "database-freezes-plan-action-schedule-and-tenant-and-retains-domain-evidence",
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
  ".local/step12/workflow-http-result.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
