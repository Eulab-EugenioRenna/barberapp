/** Real isolated API/PostgreSQL proof. No identity creation, providers or real recipients. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const base = "http://127.0.0.1:53027",
  health = await (await fetch(base + "/health")).json();
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
  route,
  body,
  { method, subject = "owner", headers = {} } = {},
) {
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
  if (body && options.method === "PATCH" && /^\/sales\/[^/]+$/.test(route))
    body = { idempotencyKey: randomUUID(), ...body };
  const r = await raw(route, body, options);
  assert.equal(
    r.status,
    options.status ?? (body && options.method !== "PATCH" ? 201 : 200),
    route + ": " + JSON.stringify(r.data),
  );
  return r.data;
}
const checks = [],
  stamp = Date.now();
const site = await call("/locations", {
    name: "Coordinated mutation " + stamp,
    sectorName: "First area",
  }),
  sector = site.sectors[0].id;
const sectorB = (
  await call(`/locations/${site.id}/sectors`, {
    name: "Second area",
    isPublic: true,
  })
).id;
const person = await call("/collaborators", {
  firstName: "Mutation",
  lastName: "Synthetic " + stamp,
  sectorId: sector,
  isPublic: true,
});
await call(`/locations/professionals/${person.id}/sectors`, {
  sectorIds: [sector, sectorB],
});
for (const sectorId of [sector, sectorB])
  await call("/locations/rooms", {
    name: "Mutation room",
    sectorId,
    capacity: 1,
    isPublic: true,
  });
const service = async (
  name,
  sectorId,
  price,
  durationMinutes = 30,
  priceMode = "gross",
  vatRate = "22",
) =>
  call("/services", {
    name: name + " " + stamp,
    sectorId,
    basePrice: price,
    durationMinutes,
    priceMode,
    vatRate,
    requiresCollaborator: true,
    requiresRoom: true,
    isPublic: true,
    isBookableOnline: true,
  });
const first = await service("First", sector, "10", 30, "net"),
  second = await service("Second", sectorB, "8"),
  third = await service("Third", sectorB, "5", 45),
  fourth = await service("Fourth", sector, "7");
const create = async (day = 4) =>
  call("/appointments", {
    idempotencyKey: randomUUID(),
    customerId: "__http_customer",
    lines: [
      {
        serviceId: first.id,
        startsAt: `2038-01-${String(day).padStart(2, "0")}T10:00:00Z`,
      },
      {
        serviceId: second.id,
        startsAt: `2038-01-${String(day).padStart(2, "0")}T11:00:00Z`,
      },
    ],
  });
const made = await create();
const route = `/appointments/${made.id}/order`;
const get = () => call(route);
let current = await get();
assert.equal(current.orderId, made.orderId);
assert.equal(current.appointments.length, 2);
const originalIds = current.appointments.map((row) => [
  row.id,
  row.orderItemId,
]);
const moneySnapshot = () =>
  sql(
    `SELECT json_build_array((SELECT count(*) FROM "PaymentEntry" WHERE "saleId"='${made.orderId}'),(SELECT count(*) FROM "StockMovement" WHERE "saleId"='${made.orderId}'),(SELECT total FROM "Sale" WHERE id='${made.orderId}'),(SELECT count(*) FROM "OrderPriceRevision" WHERE "saleId"='${made.orderId}'))`,
  );
const ackLines = (view) =>
  view.appointments
    .filter(
      (row) => !["cancelled", "no_show", "completed"].includes(row.status),
    )
    .map((row) => ({
      appointmentId: row.id,
      orderItemId: row.orderItemId,
      serviceId: row.service.id,
      startsAt: row.startsAt,
      collaboratorId: row.collaboratorId || undefined,
      roomId: row.roomId || undefined,
    }));
const swap = {
  idempotencyKey: randomUUID(),
  revision: current.revision,
  lines: ackLines(current).map((row, i) => ({
    ...row,
    startsAt: current.appointments[1 - i].startsAt,
  })),
};
const before = moneySnapshot(),
  audits = sql('SELECT count(*) FROM "AuditLog"');
const preview = await call(route + "/preview", swap);
assert.equal(preview.lines.length, 2);
assert.equal(preview.economics.total, "20.20");
assert.equal(preview.economics.previousTotal, "20.20");
assert.equal(preview.economics.difference, "0.00");
assert.equal(preview.economics.payment.netReceived, "0.00");
assert.equal(preview.economics.payment.remaining, "20.20");
const schedulingOnly = await call(route + "/preview", swap, {
  subject: "scheduler",
});
assert.equal(schedulingOnly.lines.length, 2);
assert.equal("economics" in schedulingOnly, false);
assert.equal(moneySnapshot(), before);
assert.equal(sql('SELECT count(*) FROM "AuditLog"'), audits);
current = await call(route, swap, { method: "PATCH" });
assert.equal(current.revision, 1);
assert.deepEqual(
  current.appointments.map((row) => [row.id, row.orderItemId]).sort(),
  [...originalIds].sort(),
);
for (const row of swap.lines)
  assert.equal(
    current.appointments.find((old) => old.id === row.appointmentId).startsAt,
    new Date(row.startsAt).toISOString(),
  );
assert.equal(moneySnapshot(), before);
assert.equal(
  sql(`SELECT "appointmentId" FROM "Sale" WHERE id='${made.orderId}'`),
  made.id,
);
assert.deepEqual(await call(route, swap, { method: "PATCH" }), current);
checks.push(
  "read-only-preview-and-atomic-resource-swap-preserve-appointment-line-primary-and-price-identities",
);
const stale = { ...swap, idempotencyKey: randomUUID() };
await call(route, stale, { method: "PATCH", status: 409 });
await call(
  route,
  {
    ...swap,
    lines: swap.lines.slice(0, 1),
    idempotencyKey: randomUUID(),
    revision: current.revision,
  },
  { method: "PATCH", status: 409 },
);
const invalid = {
  idempotencyKey: randomUUID(),
  revision: current.revision,
  lines: ackLines(current).map((row) => ({
    ...row,
    startsAt: "2038-01-04T13:00:00Z",
  })),
};
const unchanged = await get();
await call(route, invalid, { method: "PATCH", status: 409 });
assert.deepEqual(await get(), unchanged);
const raceBase = {
  revision: current.revision,
  lines: ackLines(current).map((row, i) => ({
    ...row,
    startsAt: `2038-01-05T${i ? "11" : "10"}:00:00Z`,
  })),
};
const raced = await Promise.all([
  raw(
    route,
    { ...raceBase, idempotencyKey: randomUUID() },
    { method: "PATCH" },
  ),
  raw(
    route,
    { ...raceBase, idempotencyKey: randomUUID() },
    { method: "PATCH" },
  ),
]);
assert.deepEqual(raced.map((row) => row.status).sort(), [200, 409]);
current = await get();
const sameKey = {
  idempotencyKey: randomUUID(),
  revision: current.revision,
  lines: ackLines(current),
};
const sameKeyResults = await Promise.all([
  raw(route, sameKey, { method: "PATCH" }),
  raw(route, sameKey, { method: "PATCH" }),
]);
assert.deepEqual(
  sameKeyResults.map((row) => row.status),
  [200, 200],
);
assert.deepEqual(sameKeyResults[0].data, sameKeyResults[1].data);
assert.equal((await get()).revision, current.revision + 1);
current = await get();
await call(
  "/services/" + first.id,
  {
    basePrice: "30",
    priceChangeReason:
      "Catalogue changes cannot rewrite booking mutation acknowledgement",
  },
  { method: "PATCH" },
);
assert.deepEqual(await call(route, swap, { method: "PATCH" }), unchanged);
await call(
  "/services/" + first.id,
  {
    basePrice: "10",
    priceChangeReason:
      "Restore synthetic price for remaining mutation assertions",
  },
  { method: "PATCH" },
);
checks.push(
  "stale-partial-and-conflicting-plans-rollback-and-distinct-revision-race-has-one-winner-with-original-acknowledgement-replay",
);
const payment = await call(`/sales/${made.orderId}/payments`, {
  kind: "receive",
  idempotencyKey: randomUUID(),
  revision: current.revision,
  entries: [{ amount: "5.00", method: "cash" }],
});
current = await get();
const add = {
  idempotencyKey: randomUUID(),
  revision: current.revision,
  startsAt: "2038-01-06T09:00:00Z",
  lines: [
    ...ackLines(current).map(({ startsAt, ...row }) => row),
    { serviceId: third.id },
  ],
};
const beforeEconomicPreview = moneySnapshot();
const addPreview = await call(route + "/preview", add);
assert.equal(addPreview.economics.total, "25.20");
assert.equal(addPreview.economics.difference, "5.00");
assert.equal(addPreview.economics.payment.netReceived, "5.00");
assert.equal(addPreview.economics.payment.remaining, "20.20");
assert.equal(moneySnapshot(), beforeEconomicPreview);
const belowDeposit = {
  ...add,
  lines: add.lines.map((row) => ({
    ...row,
    finalPrice: "1.00",
    priceOverrideReason: "Synthetic price reduction below known deposit",
  })),
};
await call(route + "/preview", belowDeposit, { status: 409 });
await call(route, belowDeposit, { method: "PATCH", status: 409 });
assert.equal(moneySnapshot(), beforeEconomicPreview);
const added = await call(route, add, { method: "PATCH" });
assert.equal(added.appointments.length, 3);
assert.deepEqual(
  added.appointments
    .slice(0, 2)
    .map((row) => [row.id, row.orderItemId])
    .sort(),
  [...originalIds].sort(),
);
let sale = await call(`/sales/for-appointment/${made.id}`);
assert.equal(sale.total, "25.2");
assert.equal(Number(sale.total), Number(addPreview.economics.total));
assert.equal(sale.items.length, 3);
assert(sale.items.every((row) => !row.collaboratorId));
let ledger = await call(`/sales/${made.orderId}/payments`);
assert.equal(ledger.items.length, 1);
assert.equal(ledger.summary.receipts, "5.00");
assert.equal(added.appointments[1].endsAt, added.appointments[2].startsAt);
checks.push(
  "service-append-keeps-one-account-stable-original-rows-exact-sequence-and-deposit-without-inventing-actual-performer-or-stock",
);
checks.push(
  "read-only-economic-preview-matches-save-and-known-deposit-residual-rejects-price-reduction-below-net-received-without-domain-writes",
);
await call(
  `/sales/${made.orderId}`,
  {
    revision: sale.revision,
    orderStatus: "open",
    orderDiscount: "2",
    items: sale.items.map((row) => ({
      id: row.id,
      kind: "service",
      serviceId: row.serviceId,
      collaboratorId: person.id,
      sectorId: row.sectorId,
      quantity: 1,
    })),
  },
  { method: "PATCH" },
);
current = await get();
const withDiscount = await call(
  route,
  {
    idempotencyKey: randomUUID(),
    revision: current.revision,
    startsAt: "2038-01-07T09:00:00Z",
    lines: [
      ...ackLines(current).map(({ startsAt, ...row }) => row),
      { serviceId: fourth.id },
    ],
  },
  { method: "PATCH" },
);
sale = await call(`/sales/for-appointment/${made.id}`);
assert.equal(sale.items.length, 4);
assert.equal(sale.total, "30.2");
assert.equal(sale.orderDiscount, "2");
assert.equal(
  sale.items.reduce(
    (sum, row) => sum + Math.round(Number(row.orderDiscountShare) * 100),
    0,
  ),
  200,
);
checks.push(
  "new-service-reuses-shared-price-engine-and-redistributes-existing-order-discount-exactly",
);
// A service added in the cashier already owns a stable line: scheduling must reuse it.
sale = await call(`/sales/for-appointment/${made.id}`);
const existingIds = new Set(sale.items.map((row) => row.id));
await call(
  `/sales/${made.orderId}`,
  {
    revision: sale.revision,
    orderStatus: "open",
    items: [
      ...sale.items.map((row) => ({
        id: row.id,
        kind: "service",
        serviceId: row.serviceId,
        collaboratorId: person.id,
        sectorId: row.sectorId,
        quantity: 1,
      })),
      {
        kind: "service",
        serviceId: third.id,
        collaboratorId: person.id,
        sectorId: sectorB,
        quantity: 1,
      },
    ],
  },
  { method: "PATCH" },
);
sale = await call(`/sales/for-appointment/${made.id}`);
const unplanned = sale.items.find((row) => !existingIds.has(row.id));
assert(unplanned);
const valueBeforePlanning = sale.total;
current = await get();
const plannedExisting = await call(
  route,
  {
    idempotencyKey: randomUUID(),
    revision: current.revision,
    startsAt: "2038-01-09T09:00:00Z",
    lines: [
      ...ackLines(current).map(({ startsAt, ...row }) => row),
      { orderItemId: unplanned.id, serviceId: third.id },
    ],
  },
  { method: "PATCH" },
);
assert.equal(plannedExisting.appointments.length, 5);
assert.equal(
  plannedExisting.appointments.filter((row) => row.orderItemId === unplanned.id)
    .length,
  1,
);
const actualQuote = sql(
  `SELECT "estimatedPrice" FROM "Appointment" WHERE "orderItemId"='${unplanned.id}'`,
);
assert.equal(
  Number(actualQuote).toFixed(2),
  (Number(unplanned.lineTotal) + Number(unplanned.taxTotal)).toFixed(2),
);
assert.equal((await call(`/sales/for-appointment/${made.id}`)).items.length, 5);
assert.equal(
  (await call(`/sales/for-appointment/${made.id}`)).total,
  valueBeforePlanning,
);
checks.push(
  "planning-existing-unbooked-service-reuses-its-line-value-and-performer-without-duplicating-cashier-lines",
);
const mutationStart = plannedExisting;
const failedCommand = {
  idempotencyKey: randomUUID(),
  revision: mutationStart.revision,
  lines: ackLines(mutationStart).map((row, i) => ({
    ...row,
    startsAt: `2038-01-08T${String(9 + i).padStart(2, "0")}:00:00Z`,
    ...(i === 0
      ? {
          finalPrice: "14",
          priceOverrideReason:
            "Synthetic agreed price after full rollback check",
        }
      : {}),
  })),
};
const beforeFailure = await get(),
  economicBeforeFailure = moneySnapshot();
await call("/__qa/fail-next-booking-recalculation", {}, { status: 200 });
await call(route, failedCommand, { method: "PATCH", status: 500 });
assert.deepEqual(await get(), beforeFailure);
assert.equal(moneySnapshot(), economicBeforeFailure);
current = await call(route, failedCommand, { method: "PATCH" });
assert.deepEqual(
  await call(route, failedCommand, { method: "PATCH" }),
  current,
);
checks.push(
  "failure-after-schedule-and-price-writes-rolls-back-every-row-history-and-revision-before-same-key-recovery",
);
await call(route, failedCommand, {
  subject: "foreign",
  method: "PATCH",
  status: 403,
});
await call("/locations/access/__http_manager", { sectorIds: [sector] });
await call(route, undefined, { subject: "manager", status: 404 });
await call(
  route,
  {
    ...failedCommand,
    idempotencyKey: randomUUID(),
    revision: current.revision,
  },
  { subject: "manager", method: "PATCH", status: 404 },
);
await call("/locations/access/__http_manager", {
  sectorIds: [sector, sectorB],
});
const managerBody = {
  idempotencyKey: randomUUID(),
  revision: current.revision,
  lines: ackLines(current),
};
await call(route, managerBody, { method: "PATCH", subject: "manager" });
await call("/locations/access/__http_manager", { sectorIds: [sector] });
await call(route, managerBody, {
  method: "PATCH",
  subject: "manager",
  status: 404,
});
current = await get();
checks.push(
  "whole-account-sector-authority-and-company-scope-rechecked-for-read-write-preview-and-replay",
);
const primaryBeforeReplacement = current.appointments.find(
  (row) => row.id === made.id,
);
const replacement = await call(
  route,
  {
    idempotencyKey: randomUUID(),
    revision: current.revision,
    lines: ackLines(current).map((row) =>
      row.appointmentId === made.id
        ? { ...row, serviceId: third.id, roomId: undefined }
        : row,
    ),
  },
  { method: "PATCH" },
);
const primaryAfterReplacement = replacement.appointments.find(
  (row) => row.id === made.id,
);
assert.equal(
  primaryAfterReplacement.orderItemId,
  primaryBeforeReplacement.orderItemId,
);
assert.equal(primaryAfterReplacement.sectorId, sectorB);
assert.equal(primaryAfterReplacement.service.id, third.id);
assert.equal(
  sql(`SELECT "appointmentId" FROM "Sale" WHERE id='${made.orderId}'`),
  made.id,
);
const replacedItem = (
  await call(`/sales/for-appointment/${made.id}`)
).items.find((row) => row.id === primaryBeforeReplacement.orderItemId);
assert.equal(replacedItem.serviceId, third.id);
assert.equal(replacedItem.collaboratorId, null);
current = replacement;
checks.push(
  "replacing-primary-service-across-authorized-sectors-preserves-booking-line-and-account-ids-and-clears-old-actual-performer",
);
const toCancel = current.appointments[0];
await call(`/appointments/${toCancel.id}/cancel`, {
  idempotencyKey: randomUUID(),
  revision: current.revision,
  reason: "Cancel one synthetic service",
});
current = await get();
assert.equal(current.orderStatus, "open");
assert.equal(
  current.appointments.filter((row) => row.status === "cancelled").length,
  1,
);
const completed = current.appointments.find(
  (row) => row.status !== "cancelled",
);
await call(`/appointments/${completed.id}/status`, { status: "completed" });
const afterCompletion = await get();
assert.equal(afterCompletion.revision, current.revision + 1);
const cancel = {
  idempotencyKey: randomUUID(),
  revision: afterCompletion.revision,
  reason:
    "Cancel remaining synthetic services without refund or physical return",
};
const ledgerBeforeCancel = await call(`/sales/${made.orderId}/payments`),
  moneyBeforeCancel = moneySnapshot();
const cancelled = await call(route + "/cancel", cancel);
assert.equal(cancelled.orderStatus, "cancelled");
assert.equal(cancelled.cancelledAppointmentIds.length, 3);
assert.equal(
  cancelled.appointments.find((row) => row.id === completed.id).status,
  "completed",
);
assert.equal(cancelled.refund, "not_requested");
assert.equal(cancelled.stockReturn, "not_requested");
assert.equal(moneySnapshot(), moneyBeforeCancel);
assert.deepEqual(await call(route + "/cancel", cancel), cancelled);
await call(
  `/sales/${made.orderId}/payments`,
  {
    idempotencyKey: randomUUID(),
    revision: cancelled.revision,
    kind: "receive",
    entries: [{ amount: "1.00", method: "cash" }],
  },
  { status: 409 },
);
await call(
  route + "/cancel",
  {
    ...cancel,
    reason: "Changed reason on an already acknowledged cancellation key",
  },
  { status: 409 },
);
assert.equal(
  sql(
    `SELECT count(*) FROM "AppointmentCancellation" c JOIN "Appointment" a ON a.id=c."appointmentId" JOIN "SaleItem" i ON i.id=a."orderItemId" WHERE i."saleId"='${made.orderId}'`,
  ),
  "4",
);
assert.equal(
  (await call(`/sales/${made.orderId}/payments`)).items.length,
  ledgerBeforeCancel.items.length,
);
await call(
  route,
  {
    idempotencyKey: randomUUID(),
    revision: cancelled.revision,
    lines: ackLines(cancelled),
  },
  { method: "PATCH", status: 400 },
);
await call(
  `/appointments/${cancelled.cancelledAppointmentIds[0]}`,
  { status: "confirmed" },
  { method: "PATCH", status: 409 },
);
const refund = ledgerBeforeCancel.items.find((row) => row.kind === "receipt");
assert(refund);
const afterRefund = await call(`/sales/${made.orderId}/payments`, {
  idempotencyKey: randomUUID(),
  revision: cancelled.revision,
  kind: "refund",
  reason: "Explicit refund after synthetic cancellation",
  entries: [{ amount: "5.00", method: "cash", refundOfId: refund.id }],
});
assert.equal(afterRefund.summary.refunds, "5.00");
assert.equal((await get()).orderStatus, "cancelled");
checks.push(
  "single-and-whole-cancellation-preserve-completed-service-ledger-and-original-value-release-active-resources-and-allow-only-explicit-refund",
);
writeFileSync(
  ".local/step10/booking-mutation-http-result.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      identity: "isolated-synthetic-qa",
      providerCalls: false,
      checks,
      fixture: {
        siteId: site.id,
        siteName: site.name,
        firstServiceId: first.id,
        secondServiceId: second.id,
        thirdServiceId: third.id,
        firstServiceName: first.name,
        secondServiceName: second.name,
      },
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify({ checks }));
