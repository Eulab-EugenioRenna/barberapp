/** Actual policy controllers/planner/PostgreSQL. Drafts cannot activate or dispatch. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const base = "http://127.0.0.1:53027",
  root = "/notifications/appointment-policy";
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
async function raw(
  path,
  body,
  { method = body ? "POST" : "GET", actor = "owner", headers = {} } = {},
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
  return { status: r.status, data: await r.json() };
}
async function call(path, body, options = {}) {
  const result = await raw(path, body, options);
  assert.equal(
    result.status,
    options.status || (body ? 201 : 200),
    path + ": " + JSON.stringify(result.data),
  );
  return result.data;
}
const checks = [];
const snapshot = () =>
  sql(
    `SELECT json_build_array((SELECT count(*) FROM "NotificationDomainEvent"),(SELECT count(*) FROM "NotificationHistory"),(SELECT count(*) FROM "Appointment"),(SELECT count(*) FROM "Sale"),(SELECT count(*) FROM "User"))`,
  );
const before = snapshot(),
  initial = await call(root),
  settings = initial.settings;
assert.equal(initial.status, "draft");
assert.equal(initial.activationAvailable, true);
assert.equal(initial.revision, 0);
assert.equal(sql('SELECT count(*) FROM "AppointmentAutomationPolicy"'), "0");
assert.equal(snapshot(), before);
checks.push(
  "migration-and-policy-read-create-no-policy-historical-event-booking-delivery-or-account",
);
for (const body of [
  { settings, expectedRevision: 0, enabled: true },
  { settings: { ...settings, active: true }, expectedRevision: 0 },
  { settings: { ...settings, maxReminders: 6 }, expectedRevision: 0 },
  {
    settings: { ...settings, noResponseAction: "cancel_booking" },
    expectedRevision: 0,
  },
  { settings },
  { settings, expectedRevision: "0" },
])
  await call(root, body, { method: "PATCH", status: 400 });
const concurrent = await Promise.all(
  [1200, 1440].map((leadMinutes) =>
    raw(
      root,
      { settings: { ...settings, leadMinutes }, expectedRevision: 0 },
      { method: "PATCH" },
    ),
  ),
);
assert.deepEqual(concurrent.map((x) => x.status).sort(), [200, 409]);
let current = concurrent.find((x) => x.status === 200).data;
assert.equal(current.revision, 1);
assert.equal(current.status, "draft");
const updated = await call(
  root,
  { settings, expectedRevision: 1 },
  { method: "PATCH", status: 200 },
);
assert.equal(updated.revision, 2);
await call(
  root,
  { settings, expectedRevision: 1 },
  { method: "PATCH", status: 409 },
);
assert.equal((await call(root)).revision, 2);
checks.push(
  "concurrent-first-save-and-stale-updates-have-one-atomic-version-winner-and-no-activation-field",
);
for (const actor of ["notifications_denied", "manager"]) {
  await call(root, undefined, { actor, status: 403 });
  await call(
    root,
    { settings, expectedRevision: 2 },
    { method: "PATCH", actor, status: 403 },
  );
  await call(
    root + "/preview",
    { settings, sectorId: "missing", localStartsAt: "2035-06-18T10:00" },
    { actor, status: 403 },
  );
}
assert.equal((await call(root, undefined, { actor: "foreign" })).revision, 0);
await call(
  root,
  { settings: { ...settings, leadMinutes: 2880 }, expectedRevision: 0 },
  { method: "PATCH", actor: "foreign", status: 200 },
);
assert.equal((await call(root)).settings.leadMinutes, 1440);
assert.throws(() =>
  sql(
    `UPDATE "AppointmentAutomationPolicy" SET revision=revision+2 WHERE "tenantId"='__http_a'`,
  ),
);
assert.throws(() =>
  sql(
    `UPDATE "AppointmentAutomationPolicy" SET revision=revision+1,"updatedByUserId"='__http_foreign' WHERE "tenantId"='__http_a'`,
  ),
);
assert.equal((await call(root)).revision, 2);
checks.push(
  "current-function-membership-and-tenant-checks-cover-policy-read-write-preview-and-database-rejects-cross-tenant-authorship-or-skipped-revision",
);
const site = await call("/locations", {
  name: "Draft policy " + Date.now(),
  sectorName: "Policy preview",
});
const sectorId = site.sectors[0].id;
await call(
  "/locations/" + site.id,
  {
    weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      isWorkingDay: weekday > 0 && weekday < 6,
      startTime: "09:00",
      endTime: "19:00",
    })),
  },
  { method: "PATCH", status: 200 },
);
const request = {
  settings: { ...settings, maxReminders: 3 },
  sectorId,
  localStartsAt: "2035-06-19T10:00",
};
const first = await call(root + "/preview", request);
assert.equal(first.sampleOnly, true);
assert.equal(first.status, "draft");
assert.equal(first.timezone, "Europe/Rome");
assert(first.reminders.length > 0);
assert.equal(
  (await call(root, undefined, { headers: { "x-alora-location": site.id } }))
    .revision,
  2,
);
const firstDay = first.reminders[0].dueAt.slice(0, 10);
await call(
  "/locations/" + site.id,
  { closures: [firstDay] },
  { method: "PATCH", status: 200 },
);
const closed = await call(root + "/preview", request);
assert.notEqual(closed.reminders[0].dueAt.slice(0, 10), firstDay);
assert.equal(closed.reminders[0].shifted, true);
await call(
  "/locations/" + site.id,
  { closures: [] },
  { method: "PATCH", status: 200 },
);
await call(
  `/locations/sectors/${sectorId}`,
  {
    weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      isWorkingDay: true,
      startTime: "11:00",
      endTime: "12:00",
    })),
  },
  { method: "PATCH", status: 200 },
);
const narrowed = await call(root + "/preview", request);
const local = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
}).format(new Date(narrowed.reminders[0].dueAt));
assert.equal(local, "11:59");
checks.push(
  "preview-reuses-live-location-and-sector-openings-closures-and-tenant-timezone-without-persisting-a-schedule",
);
for (const localStartsAt of [
  "2026-02-30T10:00",
  "2026-03-29T02:30",
  "2026-10-25T02:30",
  "2035-06-19T25:00",
  "2035-06-19T10:00Z",
])
  await call(root + "/preview", { ...request, localStartsAt }, { status: 400 });
await call(root + "/preview", { ...request, enabled: true }, { status: 400 });
await call(
  root + "/preview",
  { ...request, sectorId: "foreign-or-missing" },
  { status: 404 },
);
const noResponse = await call(root + "/preview", {
  ...request,
  settings: { ...settings, requestResponse: false },
});
assert.equal(noResponse.responseExpiresAt, null);
checks.push(
  "invalid-nonexistent-or-ambiguous-local-times-and-unavailable-sectors-are-rejected-without-guessing-a-clock-offset",
);
assert.equal(snapshot(), before);
assert.equal((await call(root)).activationAvailable, true);
checks.push(
  "saving-and-previewing-policy-leave-notification-domain-history-bookings-sales-and-accounts-unchanged",
);
const result = {
  checkedAt: new Date().toISOString(),
  database: health.database,
  realAccounts: false,
  realProviderMessages: false,
  checks,
  fixture: { sectorId, settings, localStartsAt: request.localStartsAt },
};
mkdirSync(".local/step12", { recursive: true, mode: 0o700 });
writeFileSync(
  ".local/step12/policy-http-result.json",
  JSON.stringify(result, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(result));
