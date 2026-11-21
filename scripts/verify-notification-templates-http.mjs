/** Actual controllers/renderer/outbox and disposable PostgreSQL. No real recipients. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
const base = "http://127.0.0.1:53027";
const health = await (await fetch(base + "/health")).json();
assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
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
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
async function call(
  path,
  body,
  {
    method = body ? "POST" : "GET",
    status = body ? 201 : 200,
    actor = "owner",
    headers = {},
  } = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Authorization: "Bearer " + actor,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, status, path + ": " + JSON.stringify(data));
  return data;
}
const checks = [];
const templates = await call("/notifications/templates");
const additionalEvents = [
  "appointment.rescheduled",
  "appointment.completed",
  "appointment.no_show",
  "appointment.checked_in",
];
const preferences = await call("/notifications/preferences");
assert.equal(
  templates.filter((t) => additionalEvents.includes(t.eventType)).length,
  8,
);
assert(
  preferences.tenant
    .filter((t) => additionalEvents.includes(t.eventType))
    .every((t) => t.enabled === false),
);
for (const t of templates) {
  await call(`/notifications/templates/${t.eventType}/${t.channel}/preview`, {
    subject: t.subject || "",
    title: t.title || "",
    body: t.body,
  });
}
checks.push(
  "all-eleven-domain-events-have-editable-valid-defaults-and-new-event-preferences-stay-disabled",
);
const item = templates.find(
  (t) =>
    t.eventType === "appointment.created.internal" && t.channel === "in_app",
);
assert(item);
const path = `/notifications/templates/${item.eventType}/${item.channel}`;
const draft = {
  subject: "",
  title: "Agenda di {{customer.firstName}}",
  body: "Ciao {{customer.firstName}} {{customer.lastName}}! {{service.name}} <img src=x onerror=alert(1)>",
};
const before =
  sql('SELECT count(*) FROM "NotificationDomainEvent"') +
  "/" +
  sql('SELECT count(*) FROM "NotificationHistory"');
const templateVersion = sql(
  `SELECT "updatedAt"::text FROM "NotificationTemplate" WHERE id=${quote(item.id)}`,
);
const preview = await call(path + "/preview", draft);
assert.equal(preview.sampleOnly, true);
assert.equal(preview.title, "Agenda di Giulia");
assert.equal(
  preview.body,
  "Ciao Giulia Esempio! Taglio e piega <img src=x onerror=alert(1)>",
);
assert(!preview.placeholders.includes("customer.email"));
assert.equal(
  before,
  sql('SELECT count(*) FROM "NotificationDomainEvent"') +
    "/" +
    sql('SELECT count(*) FROM "NotificationHistory"'),
);
assert.equal(
  sql(
    `SELECT "updatedAt"::text FROM "NotificationTemplate" WHERE id=${quote(item.id)}`,
  ),
  templateVersion,
);
checks.push(
  "preview-uses-operational-example-values-and-shared-renderer-without-event-history-or-delivery",
);
for (const body of [
  { ...draft, body: "{{customer.email}}" },
  { ...draft, body: "{{customer.__proto__}}" },
  { ...draft, body: "{{constructor.name}}" },
  { ...draft, body: "{{ customer.firstName }" },
  { ...draft, subject: "One\r\nTwo" },
  { ...draft, body: "x".repeat(16001) },
  { ...draft, body: " " },
  { ...draft, context: { customer: { firstName: "injected" } } },
])
  await call(path + "/preview", body, { status: 400 });
await call("/notifications/templates/forged/whatsapp/preview", draft, {
  status: 400,
});
await call(path, { ...draft }, { method: "PATCH", status: 400 });
await call(
  path,
  { ...draft, expectedUpdatedAt: item.updatedAt, body: "{{customer.phone}}" },
  { method: "PATCH", status: 400 },
);
checks.push(
  "unknown-placeholders-prototype-paths-malformed-or-unbounded-text-client-context-and-unversioned-writes-are-rejected",
);
await call("/notifications/templates", undefined, {
  actor: "notifications_denied",
  status: 403,
});
await call(path + "/preview", draft, {
  actor: "notifications_denied",
  status: 403,
});
await call(
  path,
  { ...draft, expectedUpdatedAt: item.updatedAt },
  { method: "PATCH", actor: "notifications_denied", status: 403 },
);
await call("/notifications/templates", undefined, {
  actor: "manager",
  status: 403,
});
await call(path + "/preview", draft, { actor: "manager", status: 403 });
await call(
  path,
  { ...draft, expectedUpdatedAt: item.updatedAt },
  { method: "PATCH", actor: "manager", status: 403 },
);
await call(
  path,
  { ...draft, expectedUpdatedAt: item.updatedAt },
  { method: "PATCH", actor: "foreign", status: 409 },
);
checks.push(
  "function-grants-whole-activity-membership-and-tenant-isolation-apply-to-read-preview-and-save",
);
const results = await Promise.all(
  ["Prima", "Seconda"].map((title) =>
    call(
      path,
      { ...draft, title, expectedUpdatedAt: item.updatedAt },
      { method: "PATCH", status: 200 },
    ).catch((e) => e),
  ),
);
// Independently inspect the conflict: one accepted version, one HTTP 409 assertion.
assert.equal(results.filter((x) => !(x instanceof Error)).length, 1);
assert(results.find((x) => x instanceof Error)?.message.includes("409"));
let current = (await call("/notifications/templates")).find(
  (t) => t.id === item.id,
);
assert.notEqual(current.updatedAt, item.updatedAt);
await call(
  path,
  { ...draft, expectedUpdatedAt: item.updatedAt },
  { method: "PATCH", status: 409 },
);
current = await call(
  path,
  { ...draft, expectedUpdatedAt: current.updatedAt },
  { method: "PATCH", status: 200 },
);
checks.push(
  "two-concurrent-writers-cannot-overwrite-one-another-and-stale-version-remains-rejected",
);
const site = await call("/locations", {
  name: "Template synthetic " + Date.now(),
  sectorName: "Template rendering",
});
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
assert(
  (
    await call("/notifications/templates", undefined, {
      headers: { "x-alora-location": site.id },
    })
  ).some((t) => t.id === item.id),
);
const service = await call("/services", {
  name: "Taglio e piega",
  sectorId: site.sectors[0].id,
  basePrice: "10",
  durationMinutes: 30,
  requiresCollaborator: false,
  requiresRoom: false,
});
// Use the harness's synthetic customer. CRM alignment is outside this verifier.
sql(
  `UPDATE "Customer" SET "firstName"='Giulia', "lastName"='Esempio' WHERE id='__http_customer' AND "tenantId"='__http_a'`,
);
const customer = { id: "__http_customer" };
const booking = await call("/appointments", {
  idempotencyKey: randomUUID(),
  customerId: customer.id,
  status: "confirmed",
  lines: [{ serviceId: service.id, startsAt: "2058-06-18T10:00:00Z" }],
});
await call("/__qa/notifications/recover", {}, { status: 200 });
const row = JSON.parse(
  sql(
    `SELECT row_to_json(h) FROM "NotificationHistory" h JOIN "NotificationDomainEvent" e ON e.id=h."domainEventId" WHERE e.payload#>>'{eventData,orderId}'=${quote(booking.orderId)} AND h.channel='in_app' AND h."recipientUserId"='__http_owner' LIMIT 1`,
  ),
);
assert.equal(row.payload.renderedMessage, preview.body);
assert.equal(row.payload.renderedTitle, preview.title);
const changed = await call(
  path,
  { ...draft, body: "Testo successivo", expectedUpdatedAt: current.updatedAt },
  { method: "PATCH", status: 200 },
);
assert.notEqual(changed.updatedAt, current.updatedAt);
const frozen = JSON.parse(
  sql(`SELECT payload FROM "NotificationHistory" WHERE id=${quote(row.id)}`),
);
assert.equal(frozen.renderedMessage, preview.body);
assert.deepEqual(
  (await call("/notifications/preferences")).tenant,
  preferences.tenant,
);
assert.equal(
  (await call("/__qa/notifications/state", {}, { status: 200 })).providerCalls
    .length,
  0,
);
checks.push(
  "saved-template-is-rendered-identically-by-real-booking-outbox-without-dispatch-and-global-editor-ignores-narrower-view-filter-for-fully-authorized-owner",
);
const result = {
  checkedAt: new Date().toISOString(),
  database: health.database,
  realAccounts: false,
  realProviderMessages: false,
  checks,
  fixture: {
    templateId: current.id,
    eventType: item.eventType,
    channel: item.channel,
  },
};
mkdirSync(".local/step12", { recursive: true, mode: 0o700 });
writeFileSync(
  ".local/step12/templates-http-result.json",
  JSON.stringify(result, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(result));
