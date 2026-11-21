/** Entire-sequence preview against isolated PostgreSQL; no provider or real identity. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const base = "http://127.0.0.1:53027";
const health = await (await fetch(base + "/health")).json();
assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
const sql = (query) =>
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
    { input: query, stdio: "pipe" },
  )
    .toString()
    .trim();
async function call(
  route,
  body,
  { status = body ? 201 : 200, method, subject = "owner", headers = {} } = {},
) {
  const response = await fetch(base + route, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Authorization: "Bearer " + subject,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.equal(response.status, status, route + ": " + JSON.stringify(data));
  return data;
}
const checks = [],
  stamp = Date.now();
const site = await call("/locations", {
  name: "Sequence preview " + stamp,
  sectorName: "First area",
});
const sectorA = site.sectors[0].id;
const sectorB = (
  await call(`/locations/${site.id}/sectors`, {
    name: "Second area",
    isPublic: true,
  })
).id;
const person = await call("/collaborators", {
  firstName: "Sequence",
  lastName: "Specialist " + stamp,
  sectorId: sectorB,
  isPublic: true,
});
const room = await call("/locations/rooms", {
  name: "Sequence room",
  sectorId: sectorB,
  isPublic: true,
  capacity: 1,
});
const one = await call("/services", {
  name: "Sequence first " + stamp,
  sectorId: sectorA,
  durationMinutes: 45,
  basePrice: "10",
  priceMode: "net",
  vatRate: "22",
  requiresCollaborator: false,
  isPublic: true,
  isBookableOnline: true,
});
const two = await call("/services", {
  name: "Sequence second " + stamp,
  sectorId: sectorB,
  durationMinutes: 30,
  basePrice: "8",
  priceMode: "gross",
  vatRate: "4",
  requiresCollaborator: true,
  requiresRoom: true,
  isPublic: true,
  isBookableOnline: true,
  internalDescription: "private-preview-description",
});
const lines = [{ serviceId: one.id }, { serviceId: two.id }];
const date = "2036-02-04";
const preview = (extra = {}, options = {}) =>
  call("/public/__http_a/availability", { lines, date, ...extra }, options);
const counts = () =>
  sql(
    `SELECT json_build_array((SELECT count(*) FROM "Sale"),(SELECT count(*) FROM "Appointment"),(SELECT count(*) FROM "Customer"),(SELECT count(*) FROM "OrderOperation"),(SELECT count(*) FROM "AuditLog"))`,
  );
const before = counts();
const available = await preview();
assert(available.slots.length > 2, JSON.stringify(available));
const slot = available.slots.find((row) => row.label === "11:00");
assert(slot);
assert.equal(slot.estimatedTotal, "20.20");
assert.equal(slot.lines.length, 2);
assert.equal(slot.lines[0].endsAt, slot.lines[1].startsAt);
assert.equal(
  Date.parse(slot.lines[1].startsAt) - Date.parse(slot.startsAt),
  45 * 60000,
);
assert.equal(slot.lines[1].collaboratorId, person.id);
assert.equal(slot.lines[1].roomId, room.id);
assert(!JSON.stringify(available).includes("private-preview-description"));
const internal = await call("/appointments/availability", { lines, date });
assert.deepEqual(internal, available);
const host = await call("/public/availability", { lines, date });
assert.deepEqual(host, available);
assert.equal(
  counts(),
  before,
  "Preview must not reserve, write customers or audit",
);
checks.push(
  "repeatable-read-public-and-internal-preview-has-no-writes-and-keeps-45-minute-offset-prices-and-safe-projections",
);
const blocked = await call("/appointments", {
  idempotencyKey: randomUUID(),
  customerId: "__http_customer",
  serviceId: two.id,
  startsAt: slot.lines[1].startsAt,
});
const firstOnly = await preview({ lines: [lines[0]] });
assert(firstOnly.slots.some((row) => row.startsAt === slot.startsAt));
assert(
  !(await preview()).slots.some((row) => row.startsAt === slot.startsAt),
  "Later-service conflict must hide first-service start",
);
const self = await call("/appointments/availability", {
  lines: [lines[1]],
  date,
  appointmentId: blocked.id,
});
// Existing appointments can have a non-grid start. Exclusion must at least restore surrounding grid slots.
const selfGrid = await call("/appointments", {
  idempotencyKey: randomUUID(),
  customerId: "__http_customer",
  serviceId: two.id,
  startsAt: "2036-02-05T10:00:00Z",
});
const selfBody = { lines: [lines[1]], date: "2036-02-05" };
assert(
  !(await call("/appointments/availability", selfBody)).slots.some(
    (row) => row.startsAt === selfGrid.startsAt,
  ),
);
assert(
  (
    await call("/appointments/availability", {
      ...selfBody,
      appointmentId: selfGrid.id,
    })
  ).slots.some((row) => row.startsAt === selfGrid.startsAt),
);
assert(self.slots.length);
checks.push(
  "later-service-resource-conflict-removes-sequence-start-and-internal-edit-excludes-only-authorized-self",
);
const lastFirst = firstOnly.slots.at(-1);
assert(
  !available.slots.some((row) => row.startsAt === lastFirst.startsAt),
  "Sequence must fit closing time including later services",
);
sql(`UPDATE "Service" SET "bufferBeforeMinutes"=15 WHERE id='${two.id}'`);
const buffered = await preview();
// A later service ending at the existing reservation now overlaps its preparation buffer.
const overlap = firstOnly.slots.find(
  (row) => Date.parse(row.startsAt) === Date.parse(slot.startsAt) - 30 * 60000,
);
assert(overlap);
assert(!buffered.slots.some((row) => row.startsAt === overlap.startsAt));
sql(`UPDATE "Service" SET "bufferBeforeMinutes"=0 WHERE id='${two.id}'`);
const range = await preview({ date: undefined, from: date, to: "2036-02-10" });
assert.equal(range.days.length, 7);
assert.equal(range.days[0].hasSlots, true);
checks.push("whole-sequence-hours-buffers-and-bounded-range-availability");
await preview(
  { date: undefined, from: date, to: "2036-02-11" },
  { status: 400 },
);
await preview({ appointmentId: blocked.id }, { status: 400 });
await preview(
  { lines: [{ serviceId: one.id, roomId: room.id }] },
  { status: 400 },
);
await preview({ date: "2036-02-30" }, { status: 400 });
await preview({ lines: [{ serviceId: "missing" }] }, { status: 400 });
await call(
  "/appointments/availability",
  { lines, date },
  { subject: "foreign", status: 400 },
);
await call(
  "/appointments/availability",
  { lines, date },
  { subject: "manager", status: 400 },
);
const otherSite = await call("/locations", {
  name: "Other preview site " + stamp,
  sectorName: "Other",
});
await call(
  "/appointments/availability",
  { lines, date },
  { headers: { "X-Alora-Location": otherSite.id }, status: 400 },
);
await sql(
  `INSERT INTO "UserSectorAccess" ("userId","sectorId") VALUES ('__http_manager','${sectorA}') ON CONFLICT DO NOTHING`,
);
await call(
  "/appointments/availability",
  { lines, date },
  { subject: "manager", status: 400 },
);
await call(
  "/locations/" + site.id,
  { closures: [date] },
  { method: "PATCH", status: 200 },
);
assert.deepEqual((await preview()).slots, []);
await call(
  "/locations/" + site.id,
  { closures: [] },
  { method: "PATCH", status: 200 },
);
await call(
  "/services/" + two.id,
  { isPublic: false },
  { method: "PATCH", status: 200 },
);
await preview({}, { status: 400 });
assert(
  (await call("/appointments/availability", { lines, date })).slots.length,
);
await call(
  "/services/" + two.id,
  { isPublic: true },
  { method: "PATCH", status: 200 },
);
assert.deepEqual((await preview({ date: "2020-02-03" })).slots, []);
checks.push(
  "public-forged-internal-fields-invalid-dates-inactive-visibility-and-tenant-location-sector-fences",
);
const free = (await preview()).slots[0];
const ack = await call(
  "/public/__http_a/bookings",
  {
    idempotencyKey: randomUUID(),
    lines,
    startsAt: free.startsAt,
    customerName: "Sequence Synthetic",
    email: `sequence-${stamp}@example.invalid`,
  },
  { headers: { "X-Forwarded-For": "198.51.100.81" } },
);
assert.equal(ack.appointments.length, 2);
for (let i = 0; i < 2; i++) {
  assert.equal(ack.appointments[i].startsAt, free.lines[i].startsAt);
  assert.equal(ack.appointments[i].endsAt, free.lines[i].endsAt);
  assert.equal(
    ack.appointments[i].collaboratorId,
    free.lines[i].collaboratorId,
  );
  assert.equal(ack.appointments[i].roomId, free.lines[i].roomId);
}
checks.push(
  "public-reservation-rechecks-and-commits-the-previewed-whole-sequence-on-one-account",
);
writeFileSync(
  ".local/step10/booking-availability-http-result.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      identity: "isolated-synthetic-qa",
      providerCalls: false,
      checks,
      fixture: {
        siteId: site.id,
        firstServiceId: one.id,
        secondServiceId: two.id,
        firstServiceName: one.name,
        secondServiceName: two.name,
        siteName: site.name,
      },
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify({ checks }));
