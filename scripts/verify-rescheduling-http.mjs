/** Actual disposable HTTP/PostgreSQL transactions; never touches Connect or a real provider. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const base = "http://127.0.0.1:53027",
  health = await (await fetch(base + "/health")).json();
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
async function raw(
  route,
  body,
  { method, subject = "owner", headers = {} } = {},
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
  return { status: response.status, data: await response.json() };
}
async function call(route, body, options = {}) {
  const r = await raw(route, body, options);
  assert.equal(
    r.status,
    options.status ?? (body && !options.method ? 201 : 200),
    route + ": " + JSON.stringify(r.data),
  );
  return r.data;
}
const checks = [],
  stamp = Date.now();
const site = await call("/locations", {
    name: "Rescheduling " + stamp,
    sectorName: "First area",
  }),
  sectorA = site.sectors[0].id;
await call(
  `/locations/${site.id}`,
  {
    weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      isWorkingDay: true,
      startTime: "10:00",
      endTime: "16:00",
    })),
  },
  { method: "PATCH" },
);
const sectorB = (
  await call(`/locations/${site.id}/sectors`, { name: "Second area" })
).id;
const person = await call("/collaborators", {
  firstName: "Move",
  lastName: "Synthetic " + stamp,
  sectorId: sectorA,
});
const other = await call("/collaborators", {
  firstName: "Alternative",
  lastName: "Synthetic " + stamp,
  sectorId: sectorA,
});
for (const id of [person.id, other.id])
  await call(`/locations/professionals/${id}/sectors`, {
    sectorIds: [sectorA, sectorB],
  });
const roomA = await call("/locations/rooms", {
    name: "Fixed room",
    sectorId: sectorA,
    capacity: 1,
  }),
  spare = await call("/locations/rooms", {
    name: "Spare room",
    sectorId: sectorA,
    capacity: 1,
  }),
  roomB = await call("/locations/rooms", {
    name: "Second room",
    sectorId: sectorB,
    capacity: 1,
  });
const makeService = (name, sectorId, basePrice, durationMinutes, extra = {}) =>
  call("/services", {
    name: name + " " + stamp,
    sectorId,
    basePrice,
    durationMinutes,
    priceMode: "gross",
    vatRate: "0",
    requiresCollaborator: true,
    requiresRoom: true,
    ...extra,
  });
const first = await makeService("Move first", sectorA, "20", 30),
  second = await makeService("Move second", sectorB, "10", 20),
  blocker = await makeService("Room blocker", sectorA, "1", 30, {
    requiresCollaborator: false,
  });
sql(
  `UPDATE "Service" SET "bufferAfterMinutes"=10 WHERE id='${first.id}' AND "tenantId"='__http_a'`,
);
const booking = await call("/appointments", {
  idempotencyKey: randomUUID(),
  customerId: "__http_customer",
  lines: [
    {
      serviceId: first.id,
      collaboratorId: person.id,
      roomId: roomA.id,
      startsAt: "2045-01-04T09:07:00.123Z",
    },
    {
      serviceId: second.id,
      collaboratorId: person.id,
      roomId: roomB.id,
      startsAt: "2045-01-04T10:00:00Z",
    },
  ],
});
const id = booking.id,
  route = `/appointments/${id}`,
  order = () => call(route + "/order"),
  detail = () => call(route);
let current = await order();
const anchor = await detail(),
  sibling = current.appointments.find((row) => row.id !== id),
  originalRow = anchor.orderItemId;
const state = () =>
  sql(
    `SELECT json_build_array((SELECT to_jsonb(x) FROM "Sale" x WHERE id='${booking.orderId}'),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM "SaleItem" x WHERE "saleId"='${booking.orderId}'),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM "Appointment" x WHERE "orderItemId" IN (SELECT id FROM "SaleItem" WHERE "saleId"='${booking.orderId}')),(SELECT count(*) FROM "OrderPriceRevision" WHERE "saleId"='${booking.orderId}'),(SELECT count(*) FROM "OrderOperation" WHERE "saleId"='${booking.orderId}'),(SELECT count(*) FROM "PaymentEntry" WHERE "saleId"='${booking.orderId}'),(SELECT count(*) FROM "StockMovement" WHERE "saleId"='${booking.orderId}'))`,
  );
const command = (revision, body) => ({
  idempotencyKey: randomUUID(),
  revision,
  ...body,
});
const patch = (body, status = 200, options = {}) =>
  call(route, body, { method: "PATCH", status, ...options });
const availability = (body = {}, options = {}) =>
  call(
    route + "/availability",
    {
      date: "2045-01-04",
      startsAt: anchor.startsAt,
      lines: [
        { serviceId: first.id, collaboratorId: person.id, roomId: roomA.id },
      ],
      ...body,
    },
    options,
  );
await call(
  `/services/${first.id}`,
  { durationMinutes: 60 },
  { method: "PATCH" },
);
const beforePreview = state(),
  auditBefore = sql('SELECT count(*) FROM "AuditLog"');
const slots = await availability();
assert.equal(slots.orderRevision, current.revision);
assert.equal(slots.orderId, booking.orderId);
assert(slots.slots.some((row) => row.startsAt === anchor.startsAt));
const nine = slots.slots.find(
  (row) => row.startsAt === "2045-01-04T09:00:00.000Z",
);
assert(nine);
assert.equal(nine.endsAt, "2045-01-04T09:30:00.000Z");
assert(
  !slots.slots.some((row) => row.startsAt === "2045-01-04T09:30:00.000Z"),
  "Sibling reservation and buffers must remain occupied",
);
assert(
  slots.slots.every(
    (row) =>
      new Date(row.startsAt).getUTCHours() >= 9 &&
      new Date(row.endsAt).getUTCHours() <= 15,
  ),
);
assert.equal(state(), beforePreview);
assert.equal(sql('SELECT count(*) FROM "AuditLog"'), auditBefore);
checks.push(
  "read-only-server-availability-honors-location-hours-fixed-sibling-buffer-original-duration-and-non-grid-millisecond-start-after-catalog-change",
);
await call("/appointments", {
  idempotencyKey: randomUUID(),
  customerId: "__http_customer",
  lines: [
    {
      serviceId: blocker.id,
      roomId: roomA.id,
      startsAt: "2045-01-04T12:00:00Z",
    },
  ],
});
const constrained = await availability();
assert(
  !constrained.slots.some((row) => row.startsAt === "2045-01-04T12:00:00.000Z"),
);
const freeRoom = await availability({
  lines: [{ serviceId: first.id, collaboratorId: person.id }],
});
assert(
  freeRoom.slots.some((row) => row.startsAt === "2045-01-04T12:00:00.000Z"),
);
const beforeConflict = state();
await patch(
  command(current.revision, { startsAt: "2045-01-04T12:00:00Z" }),
  409,
);
assert.equal(state(), beforeConflict);
await patch(
  command(current.revision, { startsAt: "2045-01-04T09:30:00Z" }),
  409,
);
assert.equal(state(), beforeConflict);
await patch(
  command(current.revision, { startsAt: "2045-01-04T08:00:00Z" }),
  409,
);
assert.equal(state(), beforeConflict);
await patch(
  command(current.revision, { startsAt: "2045-01-04T14:30:00.001Z" }),
  409,
);
assert.equal(state(), beforeConflict);
checks.push(
  "legacy-update-rechecks-fixed-room-sibling-and-business-hours-in-transaction-and-rolls-back-every-invalid-plan",
);
const move = command(current.revision, {
  startsAt: "2045-01-04T10:30:00Z",
  collaboratorId: other.id,
});
await call("/__qa/fail-next-booking-ack", {}, { status: 200 });
await patch(move, 500);
assert.equal(state(), beforeConflict);
const moved = await patch(move);
assert.equal(moved.id, id);
assert.equal(moved.orderItemId, originalRow);
assert.equal(moved.endsAt, "2045-01-04T11:00:00.000Z");
assert.equal(moved.collaboratorId, other.id);
assert.equal(moved.roomId, roomA.id);
assert.deepEqual(
  (await order()).appointments.find((row) => row.id === sibling.id),
  sibling,
);
assert.deepEqual(await patch(move), moved);
await patch({ ...move, startsAt: "2045-01-04T13:00:00Z" }, 409);
assert.equal((await detail()).orderItem.sale.revision, moved.orderRevision);
assert.equal(
  (await call("/appointments")).find((row) => row.id === id).orderItem.sale
    .revision,
  moved.orderRevision,
);
checks.push(
  "single-line-shift-preserves-account-row-primary-sibling-time-and-duration-post-ack-failure-rolls-back-before-same-key-retry-and-original-replay",
);
current = await order();
const duplicate = command(current.revision, {
  startsAt: "2045-01-04T11:00:00Z",
});
const same = await Promise.all([patch(duplicate), patch(duplicate)]);
assert.deepEqual(same[0], same[1]);
await patch(duplicate, 409, { subject: "cashier" });
current = await order();
const raced = await Promise.all(
  ["13:00", "13:30"].map((time) =>
    raw(
      route,
      command(current.revision, { startsAt: `2045-01-04T${time}:00Z` }),
      { method: "PATCH" },
    ),
  ),
);
assert.deepEqual(raced.map((row) => row.status).sort(), [200, 409]);
current = await order();
checks.push(
  "same-key-concurrent-move-replays-once-distinct-keys-with-same-revision-have-one-winner-and-command-is-actor-bound",
);
await call(`/sales/${booking.orderId}/payments`, {
  idempotencyKey: randomUUID(),
  revision: current.revision,
  kind: "receive",
  entries: [{ amount: "5", method: "cash" }],
});
let sale = await call(`/sales/${booking.orderId}`);
await call(
  `/sales/${sale.id}`,
  {
    idempotencyKey: randomUUID(),
    revision: sale.revision,
    orderStatus: "open",
    orderDiscount: "2",
    items: sale.items.map((row) => ({
      id: row.id,
      serviceId: row.serviceId,
      quantity: 1,
    })),
  },
  { method: "PATCH" },
);
current = await order();
const timesBefore = sql(
  `SELECT json_agg(json_build_array(id,"startsAt","endsAt") ORDER BY id) FROM "Appointment" WHERE "orderItemId" IN (SELECT id FROM "SaleItem" WHERE "saleId"='${sale.id}')`,
);
const price = command(current.revision, {
  finalPrice: 18,
  priceOverrideReason: "Explicit synthetic agreed price",
});
await patch(price);
sale = await call(`/sales/${sale.id}`);
assert.equal(Number(sale.total), 26);
assert.equal(sale.orderDiscount, "2");
assert.equal(
  (await call(`/sales/${sale.id}/payments`)).summary.netReceived,
  "5.00",
);
assert.equal(
  sql(
    `SELECT json_agg(json_build_array(id,"startsAt","endsAt") ORDER BY id) FROM "Appointment" WHERE "orderItemId" IN (SELECT id FROM "SaleItem" WHERE "saleId"='${sale.id}')`,
  ),
  timesBefore,
);
assert.equal(
  sql(`SELECT count(*) FROM "StockMovement" WHERE "saleId"='${sale.id}'`),
  "0",
);
checks.push(
  "legacy-price-change-reuses-shared-discount-and-ledger-calculation-without-changing-times-fulfilling-services-or-consuming-stock",
);
await call("/locations/access/__http_manager", { sectorIds: [sectorA] });
await availability({}, { subject: "manager", status: 404 });
current = await order();
const forbidden = command(current.revision, {
  startsAt: "2045-01-04T14:00:00Z",
});
await patch(forbidden, 404, { subject: "manager" });
await patch(forbidden, 403, { subject: "foreign" });
await patch(move, 409, { subject: "manager" });
await call("/locations/access/__http_manager", {
  sectorIds: [sectorA, sectorB],
});
assert((await availability({}, { subject: "manager" })).slots.length);
current = await order();
const managerCommand = command(current.revision, {
  customerNotes: "Synthetic scoped manager note",
});
await patch(managerCommand, 200, { subject: "manager" });
await call("/locations/access/__http_manager", { sectorIds: [sectorA] });
await patch(managerCommand, 404, { subject: "manager" });
checks.push(
  "whole-account-sector-and-company-authority-is-required-for-single-line-preview-write-and-replay",
);
current = await order();
const noWrites = state();
await patch(
  { revision: current.revision, startsAt: "2045-01-04T14:00:00Z" },
  400,
);
await patch(
  { idempotencyKey: randomUUID(), startsAt: "2045-01-04T14:00:00Z" },
  400,
);
await patch(
  command(current.revision, { email: "ignored-identity@example.invalid" }),
  400,
);
await patch(command(current.revision, { customerId: "__http_private" }), 400);
await patch(command(current.revision, { finalPrice: null }), 400);
await patch(command(0, { startsAt: "2045-01-04T14:00:00Z" }), 409);
assert.equal(state(), noWrites);
checks.push(
  "missing-recovery-key-revision-stale-state-identity-fields-and-ambiguous-null-price-are-rejected-with-no-domain-write",
);
await call(route + "/status", { status: "completed" });
current = await order();
const completed = await detail();
await call(route + "/status", { status: "confirmed" }, { status: 409 });
await call(`/appointments/${sibling.id}/status`, { status: "no_show" });
await call(
  `/appointments/${sibling.id}/status`,
  { status: "confirmed" },
  { status: 409 },
);
current = await order();

await patch(
  command(current.revision, { startsAt: "2045-01-04T14:00:00Z" }),
  409,
);
await availability({}, { status: 409 });
await patch(
  command(current.revision, {
    customerNotes: "Explicit metadata correction on historical execution",
  }),
);
const retained = await detail();
assert.equal(retained.status, "completed");
assert.equal(retained.startsAt, completed.startsAt);
assert.equal(retained.endsAt, completed.endsAt);
assert.equal(
  sql(
    `SELECT "collaboratorId" IS NULL FROM "SaleItem" WHERE id='${originalRow}'`,
  ),
  "t",
);
checks.push(
  "completed-service-preserves-historical-plan-and-unknown-actual-performer-while-allowing-explicit-metadata-correction",
);
const result = {
  checkedAt: new Date().toISOString(),
  database: health.database,
  identity: "isolated-synthetic-http",
  providerCalls: false,
  checks,
  fixture: {
    locationId: site.id,
    sectorA,
    sectorB,
    firstServiceId: first.id,
    secondServiceId: second.id,
    personId: person.id,
    otherId: other.id,
    roomA: roomA.id,
    roomB: roomB.id,
    spareRoomId: spare.id,
  },
};
writeFileSync(
  ".local/step10/rescheduling-http-result.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
