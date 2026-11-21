import { randomUUID } from "node:crypto";
/** Requires the isolated TEST ONLY server launched by verify-locations-http.mjs --browser. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const base = "http://127.0.0.1:53027";
const health = await (await fetch(base + "/health")).json();
assert.equal(health.testOnly, true);
assert(health.database.startsWith("step7_http_"));
const checks = [];
const call = async (
  route,
  body,
  { method, status, subject = "owner", headers = {} } = {},
) => {
  if (
    body &&
    (route === "/appointments" ||
      route === "/sales" ||
      /\/bookings$/.test(route)) &&
    (!method || method === "POST")
  )
    body = { idempotencyKey: randomUUID(), ...body };
  if (body && method === "PATCH" && /^\/sales\/[^/]+$/.test(route))
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
      Authorization: `Bearer ${subject}`,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    status ||
      (body === undefined || method === "PATCH" || method === "DELETE"
        ? 200
        : 201),
    `${route}: ${JSON.stringify(data)}`,
  );
  return data;
};
const location = await call("/locations", {
  name: "Conti prova",
  sectorName: "Servizi",
});
const sectorId = location.sectors[0].id;
const service = await call("/services", {
  name: "Conto fixture",
  sectorId,
  basePrice: 19.37,
  durationMinutes: 30,
  requiresCollaborator: false,
  isPublic: true,
  isBookableOnline: true,
});
const replacement = await call("/services", {
  name: "Conto alternativo",
  sectorId,
  basePrice: 23.17,
  durationMinutes: 30,
  requiresCollaborator: false,
});
const beforeFailedWrite = await call("/appointments");
await call("/__qa/fail-next-order", {}, { status: 200 });
await call(
  "/appointments",
  {
    customerId: "__http_customer",
    serviceId: service.id,
    startsAt: "2032-11-10T11:00:00+01:00",
  },
  { status: 500 },
);
const afterFailedWrite = await call("/appointments");
assert.equal(afterFailedWrite.length, beforeFailedWrite.length);
checks.push("failed-order-attachment-rolls-back-the-booking");
const appointment = await call("/appointments", {
  customerId: "__http_customer",
  serviceId: service.id,
  startsAt: "2032-11-11T11:00:00+01:00",
});
let order = await call(`/sales/for-appointment/${appointment.id}`);
const orderId = order.id,
  lineId = order.items[0].id;
assert.equal(order.orderStatus, "open");
assert.equal(order.paymentStatus, "unpaid");
assert.equal(order.items.length, 1);
assert.equal(order.items[0].collaboratorId, null);
assert.equal(appointment.orderItemId, lineId);
const list = await call("/sales");
assert(!list.items.some((row) => row.id === orderId));
checks.push(
  "booking-atomically-opens-unpaid-order-without-claiming-performer-or-sale",
);
await call(
  `/appointments/${appointment.id}`,
  { finalPrice: 17.13 },
  { method: "PATCH" },
);
order = await call(`/sales/for-appointment/${appointment.id}`);
assert.equal(order.id, orderId);
assert.equal(order.items[0].id, lineId);
assert.equal(order.total, "17.13");
await call(
  `/appointments/${appointment.id}`,
  { serviceId: replacement.id },
  { method: "PATCH" },
);
order = await call(`/sales/for-appointment/${appointment.id}`);
assert.equal(order.items[0].id, lineId);
assert.equal(order.items[0].serviceId, replacement.id);
assert.equal(order.total, "23.17");
checks.push("agenda-edits-update-the-existing-canonical-row");
const body = {
  customerId: "__http_customer",
  revision: order.revision,
  orderStatus: "open",
  paymentStatus: "unpaid",
  items: order.items.map((i) => ({
    id: i.id,
    serviceId: i.serviceId,
    quantity: 1,
    unitPrice: 25.19,
  })),
};
order = await call(`/sales/${orderId}`, body, { method: "PATCH" });
assert.equal(order.id, orderId);
assert.equal(order.orderStatus, "open");
assert.equal(order.items[0].id, lineId);
await call(`/sales/${orderId}`, body, { method: "PATCH", status: 409 });
checks.push("open-order-save-preserves-ids-and-rejects-stale-revisions");
await call(`/sales/for-appointment/${appointment.id}`, undefined, {
  subject: "foreign",
  status: 404,
});
await call(`/sales/for-appointment/${appointment.id}`, undefined, {
  subject: "manager",
  status: 404,
});
checks.push("canonical-order-read-is-tenant-and-sector-scoped");
const checkout = {
  ...body,
  revision: order.revision,
  orderStatus: "confirmed",
  paymentStatus: "paid",
  paymentMethod: "cash",
  appointmentId: appointment.id,
};
const outcomes = await Promise.all(
  [0, 1].map(() =>
    fetch(base + `/sales/${orderId}`, {
      method: "PATCH",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...checkout, idempotencyKey: randomUUID() }),
    }),
  ),
);
assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
order = await outcomes.find((r) => r.status === 200).json();
assert.equal(order.id, orderId);
assert.equal(order.items[0].id, lineId);
assert.equal(order.items.length, 1);
await call("/sales", checkout, { status: 409 });
await call(
  `/appointments/${appointment.id}`,
  { finalPrice: 99 },
  { method: "PATCH", status: 409 },
);
await call(`/sales/${orderId}`, undefined, { method: "DELETE", status: 409 });
checks.push(
  "checkout-confirms-the-same-order-once-without-recreating-booked-rows",
);
const detail = await call(`/appointments/${appointment.id}`);
assert.equal(detail.status, "completed");
assert.equal(detail.finalPrice, "25.19");
assert.equal(detail.orderItemId, lineId);
checks.push("confirmed-price-projection-and-booked-account-history-protection");
const report = {
  checkedAt: new Date().toISOString(),
  identity: "synthetic-local-test-sessions",
  database: "isolated-test-database",
  providerCalls: false,
  checks,
  fixture: {
    appointmentId: appointment.id,
    orderId,
    lineId,
    serviceId: replacement.id,
    locationId: location.id,
    sectorId,
  },
};
mkdirSync(".local/step8", { recursive: true, mode: 0o700 });
writeFileSync(
  ".local/step8/http-result.json",
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(report, null, 2));
