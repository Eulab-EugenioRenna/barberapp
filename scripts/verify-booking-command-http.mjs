/** Isolated HTTP/PostgreSQL proof of the complete booking command. No provider calls. */
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
  { status, method, subject = "owner", headers = {} } = {},
) {
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
    status ?? (body === undefined || method === "PATCH" ? 200 : 201),
    `${route}: ${JSON.stringify(data)}`,
  );
  return data;
}
const counts = () =>
  JSON.parse(
    sql(
      `SELECT json_build_object('sales',(SELECT count(*) FROM "Sale" WHERE "tenantId"='__http_a'),'appointments',(SELECT count(*) FROM "Appointment" WHERE "tenantId"='__http_a'),'customers',(SELECT count(*) FROM "Customer" WHERE "tenantId"='__http_a'),'commands',(SELECT count(*) FROM "OrderOperation" WHERE "tenantId"='__http_a'),'payments',(SELECT count(*) FROM "PaymentEntry" WHERE "tenantId"='__http_a'),'stock',(SELECT count(*) FROM "StockMovement" WHERE "tenantId"='__http_a'))`,
    ),
  );
const checks = [];
const location = await call("/locations", {
    name: "Aggregate command " + Date.now(),
    sectorName: "Flexible sector",
  }),
  sectorA = location.sectors[0].id;
const sectorB = (
  await call(`/locations/${location.id}/sectors`, {
    name: "Specialist sector",
    isPublic: true,
  })
).id;
const A = await call("/collaborators", {
  firstName: "Specialist",
  lastName: "Synthetic",
  sectorId: sectorA,
  isPublic: true,
});
const B = await call("/collaborators", {
  firstName: "Flexible",
  lastName: "Synthetic",
  sectorId: sectorA,
  isPublic: true,
});
await call(`/locations/professionals/${A.id}/sectors`, {
  sectorIds: [sectorA, sectorB],
});
const one = await call("/services", {
  name: "Aggregate first",
  sectorId: sectorA,
  durationMinutes: 45,
  basePrice: "10",
  priceMode: "net",
  vatRate: "22",
  requiresCollaborator: true,
  isPublic: true,
  isBookableOnline: true,
  internalDescription: "synthetic-private-description",
});
const two = await call("/services", {
  name: "Aggregate specialist",
  sectorId: sectorB,
  durationMinutes: 30,
  basePrice: "8",
  priceMode: "gross",
  vatRate: "4",
  requiresCollaborator: true,
  isPublic: true,
  isBookableOnline: true,
});
const lines = (day) => [
  {
    serviceId: one.id,
    startsAt: `2036-02-${String(day).padStart(2, "0")}T10:00:00Z`,
  },
  {
    serviceId: two.id,
    startsAt: `2036-02-${String(day).padStart(2, "0")}T10:00:00Z`,
  },
];
const fresh = (day, extras = {}) => ({
  idempotencyKey: randomUUID(),
  customerId: "__http_customer",
  lines: lines(day),
  ...extras,
});
const command = fresh(3);
const before = counts();
const booked = await call("/appointments", command);
assert.equal(booked.appointments.length, 2);
assert.equal(booked.estimatedTotal, "20.20");
assert.deepEqual(
  booked.appointments.map((row) => row.collaboratorId),
  [B.id, A.id],
);
assert.deepEqual(
  booked.appointments.map((row) => row.estimatedPrice),
  ["12.20", "8.00"],
);
assert.equal(booked.id, booked.appointments[0].id);
let account = await call(`/sales/for-appointment/${booked.id}`);
assert.equal(account.id, booked.orderId);
assert.equal(account.items.length, 2);
assert.equal(account.orderStatus, "open");
assert.equal(account.paymentStatus, "unpaid");
assert(account.items.every((row) => row.collaboratorId === null));
assert.equal(
  (await call(`/sales/for-appointment/${booked.appointments[1].id}`)).id,
  account.id,
);
const after = counts();
assert.equal(after.sales - before.sales, 1);
assert.equal(after.appointments - before.appointments, 2);
assert.equal(after.commands - before.commands, 1);
assert.equal(after.customers, before.customers);
assert.equal(after.payments, before.payments);
assert.equal(after.stock, before.stock);
checks.push(
  "two-sectors-one-account-stable-line-links-and-real-automatic-resources-without-invented-performer-or-payment",
);
await call(
  "/services/" + one.id,
  {
    basePrice: "30",
    priceChangeReason:
      "Later catalogue must not change a command acknowledgement",
  },
  { method: "PATCH" },
);
for (let i = 0; i < 5; i++)
  assert.deepEqual(await call("/appointments", command), booked);
assert.deepEqual(counts(), after);
await call("/appointments", { ...command, lines: lines(4) }, { status: 409 });
await call(
  "/appointments",
  { ...command, idempotencyKey: undefined },
  { status: 400 },
);
checks.push(
  "original-acknowledgement-replayed-after-catalogue-change-without-replanning-or-duplicating-rows",
);
const originalAccess = JSON.parse(
  sql(
    `SELECT coalesce(json_agg("sectorId"),'[]') FROM "UserSectorAccess" WHERE "userId"='__http_manager'`,
  ),
);
await call("/locations/access/__http_manager", {
  sectorIds: [...new Set([...originalAccess, sectorA, sectorB])],
});
await call("/appointments", command, { subject: "manager", status: 409 });
const managerCommand = fresh(4);
const managerBooked = await call("/appointments", managerCommand, {
  subject: "manager",
});
await call("/locations/access/__http_manager", {
  sectorIds: [...new Set([...originalAccess, sectorA])],
});
const beforeRevoked = counts();
await call("/appointments", managerCommand, {
  subject: "manager",
  status: 404,
});
await call("/appointments", command, { subject: "foreign", status: 400 });
assert.deepEqual(counts(), beforeRevoked);
await call("/locations/access/__http_manager", { sectorIds: originalAccess });
checks.push(
  "actor-binding-and-current-whole-account-sector-authority-before-replay",
);
const raceCommands = [
  fresh(5, {
    customerId: undefined,
    customerName: "Race Alpha",
    email: "race-alpha@example.invalid",
  }),
  fresh(5, {
    customerId: undefined,
    customerName: "Race Beta",
    email: "race-beta@example.invalid",
  }),
];
const beforeRace = counts();
const race = await Promise.all(
  raceCommands.map(async (body) => {
    const response = await fetch(base + "/appointments", {
      method: "POST",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, result: await response.json() };
  }),
);
assert.deepEqual(race.map((row) => row.status).sort(), [201, 409]);
const afterRace = counts();
assert.equal(afterRace.sales - beforeRace.sales, 1);
assert.equal(afterRace.appointments - beforeRace.appointments, 2);
assert.equal(afterRace.customers - beforeRace.customers, 1);
assert.equal(afterRace.commands - beforeRace.commands, 1);
const simultaneous = fresh(6, {
  customerId: undefined,
  customerName: "One Retry",
  email: "one-retry@example.invalid",
});
const beforeSame = counts();
const same = await Promise.all([
  call("/appointments", simultaneous),
  call("/appointments", simultaneous),
]);
assert.deepEqual(same[0], same[1]);
const afterSame = counts();
assert.equal(afterSame.sales - beforeSame.sales, 1);
assert.equal(afterSame.customers - beforeSame.customers, 1);
assert.equal(afterSame.appointments - beforeSame.appointments, 2);
checks.push(
  "distinct-command-race-reserves-the-whole-sequence-once-and-same-key-race-replays-exactly",
);
const failing = fresh(7, {
  customerId: undefined,
  customerName: "Rollback Guest",
  email: "rollback-guest@example.invalid",
});
const beforeFailure = counts();
await call("/__qa/fail-next-order", {}, { status: 200 });
await call("/appointments", failing, { status: 500 });
assert.deepEqual(counts(), beforeFailure);
const recovered = await call("/appointments", failing);
assert.deepEqual(await call("/appointments", failing), recovered);
const invalid = fresh(9, {
  customerId: undefined,
  customerName: "Invalid Guest",
  email: "invalid-guest@example.invalid",
  lines: [lines(9)[0], { serviceId: randomUUID() }],
});
const beforeInvalid = counts();
await call("/appointments", invalid, { status: 400 });
assert.deepEqual(counts(), beforeInvalid);
checks.push(
  "fault-after-appointment-inserts-rolls-back-customer-account-lines-and-command-and-can-retry-same-key",
);
const privateHash = sql(
  `SELECT md5(to_jsonb(c)::text) FROM "Customer" c WHERE id='__http_private'`,
);
const publicCommand = {
  idempotencyKey: randomUUID(),
  customerName: "Stored Private",
  email: "fixture-private@example.invalid",
  lines: lines(8),
};
const publicAck = await call("/public/__http_a/bookings", publicCommand);
assert.equal(publicAck.appointments.length, 2);
assert.deepEqual(
  publicAck.appointments.map((row) => row.collaboratorId),
  [B.id, A.id],
);
for (const forbidden of [
  "customerId",
  "internalNotes",
  "createdById",
  "orderItemId",
  "orderId",
  "email",
  "phone",
  "synthetic-private-description",
  "fixture-private",
])
  assert(!JSON.stringify(publicAck).includes(forbidden), forbidden);
assert.deepEqual(publicAck.customer, {
  firstName: "Stored",
  lastName: "Private",
});
assert.equal(
  sql(`SELECT "customerId" FROM "Appointment" WHERE id='${publicAck.id}'`),
  "__http_private",
);
assert.equal(
  sql(
    `SELECT md5(to_jsonb(c)::text) FROM "Customer" c WHERE id='__http_private'`,
  ),
  privateHash,
);
const beforePublicReplay = counts();
for (let i = 0; i < 8; i++)
  assert.deepEqual(
    await call("/public/__http_a/bookings", publicCommand),
    publicAck,
  );
assert.deepEqual(counts(), beforePublicReplay);
assert.equal(
  sql(
    `SELECT count(*) FROM "OrderOperation" WHERE "idempotencyKey"='${publicCommand.idempotencyKey}' AND source='public' AND "actorUserId" IS NULL`,
  ),
  "1",
);
await call(
  "/public/__http_a/bookings",
  {
    ...publicCommand,
    idempotencyKey: randomUUID(),
    internalNotes: "Rejected public injection",
  },
  { status: 400 },
);
await call(
  "/public/__http_a/bookings",
  {
    ...publicCommand,
    idempotencyKey: randomUUID(),
    lines: lines(10).map((row) => ({ ...row, finalPrice: "0" })),
  },
  { status: 400 },
);
checks.push(
  "anonymous-no-preference-reserves-real-staff-reuses-crm-privately-and-replays-past-rate-limit-without-exposing-contact-fields",
);
await call("/services/" + two.id, { isPublic: false }, { method: "PATCH" });
await call("/public/__http_a/bookings", publicCommand, { status: 404 });
await call("/services/" + two.id, { isPublic: true }, { method: "PATCH" });
checks.push(
  "public-visibility-is-rechecked-before-returning-a-stored-acknowledgement",
);
const deposit = await call(`/sales/${booked.orderId}/payments`, {
  kind: "receive",
  idempotencyKey: randomUUID(),
  revision: account.revision,
  entries: [{ amount: "5.00", method: "cash" }],
});
account = await call(`/sales/for-appointment/${booked.id}`);
assert.equal(account.orderStatus, "open");
assert.equal(account.revision, deposit.revision);
const appointmentStatuses = JSON.parse(
  sql(
    `SELECT json_agg(status ORDER BY id) FROM "Appointment" WHERE "orderItemId" IN (SELECT id FROM "SaleItem" WHERE "saleId"='${account.id}')`,
  ),
);
assert(appointmentStatuses.every((status) => status === "confirmed"));
const actual = await call("/collaborators", {
  firstName: "Actual performer",
  lastName: "Synthetic",
  sectorId: sectorA,
  isPublic: false,
});
const product = await call("/products", {
  name: "Aggregate retail",
  price: "5",
  priceMode: "gross",
  vatRate: "10",
});
const originalIds = account.items.map((row) => row.id).sort();
const closed = await call(
  "/sales/" + account.id,
  {
    revision: account.revision,
    orderStatus: "confirmed",
    customerId: "__http_customer",
    items: [
      ...account.items.map((row) => ({
        id: row.id,
        serviceId: row.serviceId,
        unitPrice: row.unitPrice,
        quantity: 1,
        collaboratorId: row.serviceId === one.id ? actual.id : A.id,
      })),
      { productId: product.id, sectorId: sectorA, quantity: 1 },
    ],
  },
  { method: "PATCH" },
);
assert.equal(closed.id, account.id);
assert.equal(closed.items.length, 3);
assert.deepEqual(
  closed.items
    .filter((row) => row.serviceId)
    .map((row) => row.id)
    .sort(),
  originalIds,
);
const financial = await call(`/sales/${closed.id}/payments`);
assert.equal(financial.summary.netReceived, "5.00");
assert.equal(financial.summary.remaining, "20.20");
const firstBooking = await call("/appointments/" + booked.id);
assert.equal(firstBooking.collaboratorId, B.id);
assert.equal(firstBooking.status, "completed");
assert.equal(
  closed.items.find((row) => row.serviceId === one.id).collaboratorId,
  actual.id,
);
assert.equal(
  (await call(`/sales/for-appointment/${booked.appointments[1].id}`)).items
    .length,
  3,
);
assert.deepEqual(await call("/appointments", command), booked);
checks.push(
  "deposit-products-and-checkout-keep-one-account-line-ids-and-planned-versus-actual-performers-separate",
);
const cashierCommand = {
  idempotencyKey: randomUUID(),
  customerId: "__http_customer",
  locationId: location.id,
  paymentStatus: "paid",
  paymentMethod: "cash",
  soldAt: "2040-02-03T12:00:00Z",
  items: [
    { serviceId: one.id, quantity: 1, collaboratorId: actual.id },
    { productId: product.id, sectorId: sectorA, quantity: 1 },
    { serviceId: two.id, quantity: 1, collaboratorId: A.id },
  ],
};
const beforeCashier = counts();
const sold = await call("/sales", cashierCommand);
const afterCashier = counts();
assert.equal(afterCashier.sales - beforeCashier.sales, 1);
assert.equal(afterCashier.appointments - beforeCashier.appointments, 2);
assert.equal(afterCashier.commands - beforeCashier.commands, 1);
assert.equal(afterCashier.payments - beforeCashier.payments, 1);
const actualRows = JSON.parse(
  sql(
    `SELECT json_agg(json_build_object('id',a.id,'serviceId',a."serviceId",'startsAt',a."startsAt",'endsAt',a."endsAt",'orderItemId',a."orderItemId",'status',a.status) ORDER BY a."startsAt") FROM "Appointment" a JOIN "SaleItem" i ON i.id=a."orderItemId" WHERE i."saleId"='${sold.id}'`,
  ),
);
assert.equal(actualRows.length, 2);
assert.deepEqual(
  actualRows.map((row) => row.serviceId),
  [one.id, two.id],
);
assert(actualRows.every((row) => row.status === "completed"));
assert.equal(actualRows[0].endsAt, actualRows[1].startsAt);
assert.equal(sold.appointmentId, actualRows[0].id);
const cashierFinance = await call(`/sales/${sold.id}/payments`);
assert.equal(cashierFinance.summary.receipts, "49.60");
assert.equal(cashierFinance.items.length, 1);
assert(!("email" in sold.customer));
assert(!("cost" in sold.items.find((row) => row.productId).product));
const simultaneousCashier = await Promise.all([
  call("/sales", cashierCommand),
  call("/sales", Object.fromEntries(Object.entries(cashierCommand).reverse())),
]);
assert.deepEqual(simultaneousCashier, [sold, sold]);
assert.deepEqual(counts(), afterCashier);
await call(
  "/services/" + one.id,
  { basePrice: "31", priceChangeReason: "Command receipt remains immutable" },
  { method: "PATCH" },
);
assert.deepEqual(await call("/sales", cashierCommand), sold);
assert.deepEqual(counts(), afterCashier);
await call(
  "/sales",
  { ...cashierCommand, idempotencyKey: command.idempotencyKey },
  { status: 409 },
);
await call(
  "/sales",
  { ...cashierCommand, items: cashierCommand.items.slice(0, 1) },
  { status: 409 },
);
await call(
  "/sales",
  { ...cashierCommand, idempotencyKey: undefined },
  { status: 400 },
);
await call(
  "/sales",
  {
    ...cashierCommand,
    idempotencyKey: randomUUID(),
    items: [{ serviceId: one.id, quantity: 2, collaboratorId: actual.id }],
  },
  { status: 400 },
);
assert.deepEqual(counts(), afterCashier);
checks.push(
  "cashier-creation-replays-one-account-two-completed-service-rows-and-one-manual-receipt-even-after-catalogue-change",
);
const unpaidProduct = await call("/sales", {
  idempotencyKey: randomUUID(),
  locationId: location.id,
  items: [{ productId: product.id, sectorId: sectorA, quantity: 1 }],
});
assert.equal(
  (await call(`/sales/${unpaidProduct.id}/payments`)).summary.netReceived,
  "0.00",
);
await call("/sales/" + unpaidProduct.id, undefined, {
  method: "DELETE",
  status: 409,
});
checks.push(
  "creation-key-is-mandatory-bound-to-command-kind-and-preserves-an-unpaid-acknowledged-account",
);
writeFileSync(
  ".local/step10/booking-command-http-result.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      identity: "isolated-synthetic-sessions",
      providerCalls: false,
      checks,
      raceStatuses: race.map((row) => row.status).sort(),
      fixture: {
        locationId: location.id,
        sectorA,
        sectorB,
        serviceOne: one.id,
        serviceTwo: two.id,
        professionalA: A.id,
        professionalB: B.id,
        bookingId: booked.id,
        orderId: booked.orderId,
        publicBookingId: publicAck.id,
        managerBookingId: managerBooked.id,
      },
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify({ checks }));
