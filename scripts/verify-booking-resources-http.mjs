import { randomUUID } from "node:crypto";
/** Actual PostgreSQL resource guards, public availability and transaction-bound planner. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const base = "http://127.0.0.1:53027";
const health = await (await fetch(base + "/health")).json();
assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
const container =
  "alora-step7-qa-" + health.database.replace("step7_http_", "");
const runPlanner = (lines, options = {}) =>
  JSON.parse(
    execFileSync(
      "docker",
      ["exec", "-i", container, "node", "/qa/booking-resources-qa.cjs"],
      { input: JSON.stringify({ lines, ...options }), stdio: "pipe" },
    ).toString(),
  );
async function call(route, body, { method, status } = {}) {
  if (
    body &&
    (route === "/appointments" ||
      route === "/sales" ||
      /\/bookings$/.test(route)) &&
    (!method || method === "POST")
  )
    body = { idempotencyKey: randomUUID(), ...body };
  // Existing-fixture adapter; the dedicated rescheduling verifier sends raw commands for negative/race tests.
  if (body && method === "PATCH" && /^\/appointments\/[^/]+$/.test(route)) {
    const current = await (
      await fetch(base + route, { headers: { Authorization: "Bearer owner" } })
    ).json();
    body = {
      revision: current?.orderItem?.sale?.revision ?? 0,
      idempotencyKey: randomUUID(),
      ...body,
    };
  }
  const response = await fetch(base + route, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    status ?? (body === undefined || method === "PATCH" ? 200 : 201),
    `${route}: ${JSON.stringify(data)}`,
  );
  return data;
}
const checks = [];
const site = await call("/locations", {
    name: "Resource capacity " + Date.now(),
    sectorName: "Pool A",
  }),
  sector = site.sectors[0].id;
await call(
  "/locations/rooms",
  { name: "Invalid capacity", sectorId: sector, capacity: 0 },
  { status: 400 },
);
const room = await call("/locations/rooms", {
  name: "Two-place resource",
  sectorId: sector,
  capacity: 2,
  isPublic: true,
});
assert.equal(room.capacity, 2);
await call(
  "/locations/rooms/" + room.id,
  { capacity: 101 },
  { method: "PATCH", status: 400 },
);
const short = await call("/services", {
  name: "Short pool service",
  sectorId: sector,
  durationMinutes: 30,
  basePrice: "10",
  requiresCollaborator: false,
  requiresRoom: true,
  isPublic: true,
  isBookableOnline: true,
});
const long = await call("/services", {
  name: "Long pool service",
  sectorId: sector,
  durationMinutes: 60,
  basePrice: "20",
  requiresCollaborator: false,
  requiresRoom: true,
  isPublic: true,
  isBookableOnline: true,
});
const booking = (serviceId, startsAt) =>
  call("/appointments", { customerId: "__http_customer", serviceId, startsAt });
await booking(short.id, "2035-01-08T10:00:00Z");
await booking(short.id, "2035-01-08T10:30:00Z");
const available = await call(
  `/public/__http_a/availability?serviceId=${long.id}&date=2035-01-08`,
);
assert(
  available.slots.some((row) => row.startsAt === "2035-01-08T10:00:00.000Z"),
);
const planned = runPlanner(
  [{ serviceId: long.id, startsAt: "2035-01-08T10:00:00Z" }],
  { publicOnly: true },
);
assert.equal(planned.rows[0].roomId, room.id);
const longBooking = await booking(long.id, "2035-01-08T10:00:00Z");
assert.equal(longBooking.roomId, room.id);
await call(
  "/appointments",
  {
    customerId: "__http_customer",
    serviceId: short.id,
    startsAt: "2035-01-08T10:15:00Z",
  },
  { status: 409 },
);
const full = await call(
  `/public/__http_a/availability?serviceId=${long.id}&date=2035-01-08`,
);
assert(!full.slots.some((row) => row.startsAt === "2035-01-08T10:00:00.000Z"));
checks.push(
  "peak-capacity-agrees-between-public-slots-planner-and-actual-appointment-insert",
);
await call(
  "/locations/rooms/" + room.id,
  { capacity: 1 },
  { method: "PATCH", status: 409 },
);
await call(
  "/appointments/" + longBooking.id,
  { status: "cancelled" },
  { method: "PATCH" },
);
const reduced = await call(
  "/locations/rooms/" + room.id,
  { capacity: 1 },
  { method: "PATCH" },
);
assert.equal(reduced.capacity, 1);
checks.push(
  "capacity-cannot-invalidate-future-work-and-can-reduce-after-explicit-release",
);
const secondSector = await call(`/locations/${site.id}/sectors`, {
  name: "Pool B",
  isPublic: true,
});
const A = await call("/collaborators", {
  firstName: "Resource A",
  lastName: "Synthetic",
  sectorId: sector,
  isPublic: true,
});
const B = await call("/collaborators", {
  firstName: "Resource B",
  lastName: "Synthetic",
  sectorId: sector,
  isPublic: true,
});
await call(`/locations/professionals/${A.id}/sectors`, {
  sectorIds: [sector, secondSector.id],
});
const one = await call("/services", {
  name: "Flexible service",
  sectorId: sector,
  durationMinutes: 45,
  basePrice: "15",
  requiresCollaborator: true,
  isPublic: true,
  isBookableOnline: true,
});
const two = await call("/services", {
  name: "Specialist service",
  sectorId: secondSector.id,
  durationMinutes: 30,
  basePrice: "10",
  requiresCollaborator: true,
  isPublic: true,
  isBookableOnline: true,
});
const lines = [
  { serviceId: one.id, startsAt: "2036-02-03T10:00:00Z" },
  { serviceId: two.id, startsAt: "2036-02-03T10:00:00Z" },
];
const complete = runPlanner(lines, { publicOnly: true });
assert.deepEqual(
  complete.rows.map((row) => row.collaboratorId),
  [B.id, A.id],
);
assert.deepEqual(
  complete.rows.map((row) => row.startsAt),
  ["2036-02-03T10:00:00.000Z", "2036-02-03T10:00:00.000Z"],
);
const impossible = runPlanner(
  lines.map((row) => ({ ...row, collaboratorId: A.id })),
  { publicOnly: true },
);
assert.equal(impossible.error.response.code, "RESOURCES_UNAVAILABLE");
const sequential = runPlanner(
  [lines[0], { ...lines[1], startsAt: "2036-02-03T10:45:00Z" }],
  { publicOnly: true },
);
assert.equal(sequential.rows[0].endsAt, sequential.rows[1].startsAt);
checks.push(
  "whole-sequence-assignment-is-not-greedy-and-keeps-non-grid-fixed-times",
);
const scoped = runPlanner(lines, {
  scope: {
    tenantId: "__http_a",
    allowedSectorIds: [sector],
    sectorIds: [sector],
    locationIds: [site.id],
    cacheKey: "synthetic",
  },
});
assert.equal(scoped.error.status, 400);
await call(
  "/locations/" + site.id,
  { closures: ["2036-02-03"] },
  { method: "PATCH" },
);
const closed = runPlanner(lines, { publicOnly: true });
assert.equal(closed.error.response.code, "BOOKING_OUTSIDE_HOURS");
checks.push(
  "planner-rechecks-authorized-sectors-and-business-closures-in-the-transaction",
);
writeFileSync(
  ".local/step10/resources-http-result.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      identity: "isolated-synthetic-qa",
      providerCalls: false,
      aggregateBookingExposed: false,
      checks,
      fixture: { locationId: site.id, roomId: room.id },
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify({ checks }));
