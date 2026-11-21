import { cloneLegacySale } from "./payment-ledger-qa-fixtures.mjs";
/** Real HTTP/PostgreSQL, synthetic sessions, no payment or message providers. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const base = "http://127.0.0.1:53027";
const health = await (await fetch(base + "/health")).json();
assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
const checks = [];
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
async function call(
  route,
  body,
  { status, method, subject = "owner", headers = {} } = {},
) {
  if (body && route === "/sales" && (!method || method === "POST"))
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
    status ??
      (body === undefined || method === "PATCH" || method === "DELETE"
        ? 200
        : 201),
    `${route}: ${JSON.stringify(data)}`,
  );
  return data;
}
const location = await call("/locations", {
  name: "Payment test",
  sectorName: "Payment sector",
});
const product = await call("/products", {
  name: "Payment synthetic product",
  price: "100",
  priceMode: "gross",
  vatRate: "22",
});
const createSale = () =>
  call("/sales", {
    locationId: location.id,
    paymentStatus: "unpaid",
    items: [
      { productId: product.id, quantity: 1, sectorId: location.sectors[0].id },
    ],
  });
const knownSale = await createSale();
assert.equal(
  (await call(`/sales/${knownSale.id}/payments`)).summary.netReceived,
  "0.00",
);
const sale = { ...knownSale, id: cloneLegacySale(health, knownSale.id) };
const route = `/sales/${sale.id}/payments`;
const cmd = (kind, revision, entries, extras = {}) => ({
  kind,
  revision,
  entries,
  idempotencyKey: randomUUID(),
  ...extras,
});
let ledger = await call(route);
assert.equal(ledger.summary.remaining, null);
assert.equal(ledger.legacyStatus, "unpaid");
await call(route, cmd("receive", 0, [{ amount: "10", method: "cash" }]), {
  status: 409,
});
await call(
  route,
  cmd("reconcile", 0, [{ amount: "0", method: "cash" }], {
    reason: "Synthetic opening",
  }),
  { status: 400 },
);
const opening = cmd("reconcile", 0, [{ amount: "0" }], {
  reason: "Explicit zero opening for synthetic sale",
});
const initial = await call(route, opening);
assert.equal(initial.summary.receipts, "0.00");
assert.equal(initial.summary.remaining, "100.00");
assert.equal(initial.entries[0].receivedAt, null);
assert.deepEqual(await call(route, opening), initial);
await call(route, { ...opening, entries: [{ amount: "1" }] }, { status: 409 });
await call(
  route,
  cmd("reconcile", 1, [{ amount: "0" }], { reason: "Second opening" }),
  { status: 409 },
);
checks.push(
  "explicit-historical-reconciliation-no-inferred-cash-and-idempotent-replay",
);
const beforeDeposit = sql(
  `SELECT json_build_object('stock',(SELECT count(*) FROM "StockMovement"),'appointments',(SELECT count(*) FROM "Appointment"),'orderStatus',(SELECT "orderStatus" FROM "Sale" WHERE id='${sale.id}'))`,
);
const depositCommand = cmd("receive", 1, [{ amount: "20.10", method: "cash" }]);
const deposit = await call(route, depositCommand);
assert.equal(deposit.summary.status, "partial");
assert.equal(deposit.summary.remaining, "79.90");
assert.equal(
  sql(
    `SELECT json_build_object('stock',(SELECT count(*) FROM "StockMovement"),'appointments',(SELECT count(*) FROM "Appointment"),'orderStatus',(SELECT "orderStatus" FROM "Sale" WHERE id='${sale.id}'))`,
  ),
  beforeDeposit,
);
assert.deepEqual(await call(route, depositCommand), deposit);
const settlementCommand = cmd("receive", 2, [
  { amount: "29.90", method: "cash" },
  { amount: "50", method: "card" },
]);
const settlement = await call(route, settlementCommand);
assert.equal(settlement.summary.netReceived, "100.00");
assert.equal(settlement.summary.remaining, "0.00");
assert.equal(settlement.summary.status, "paid");
assert.equal(
  sql(`SELECT "paymentMethod" FROM "Sale" WHERE id='${sale.id}'`),
  "mixed",
);
assert.deepEqual(await call(route, settlementCommand), settlement);
checks.push(
  "deposit-and-atomic-mixed-balance-no-fulfillment-or-stock-side-effects",
);
const state = () =>
  sql(
    `SELECT json_build_object('operations',(SELECT count(*) FROM "PaymentOperation" WHERE "saleId"='${sale.id}'),'entries',(SELECT count(*) FROM "PaymentEntry" WHERE "saleId"='${sale.id}'),'revision',(SELECT revision FROM "Sale" WHERE id='${sale.id}'))`,
  );
let before = state();
await call(route, cmd("receive", 3, [{ amount: "0.01", method: "cash" }]), {
  status: 400,
});
await call(
  route,
  cmd(
    "refund",
    3,
    [
      { amount: "11", method: "cash", refundOfId: deposit.entries[0].id },
      { amount: "10", method: "cash", refundOfId: deposit.entries[0].id },
    ],
    { reason: "Excess grouped refund" },
  ),
  { status: 400 },
);
await call(
  route,
  cmd(
    "refund",
    3,
    [{ amount: "1", method: "cash", refundOfId: initial.entries[0].id }],
    { reason: "Excess opening refund" },
  ),
  { status: 400 },
);
await call(route, cmd("receive", 2, [{ amount: "1", method: "cash" }]), {
  status: 409,
});
assert.equal(state(), before);
checks.push(
  "overpayment-stale-revision-and-grouped-overrefund-rejected-atomically",
);
const refund = await call(
  route,
  cmd(
    "refund",
    3,
    [{ amount: "5.10", method: "cash", refundOfId: deposit.entries[0].id }],
    { reason: "Actual manual refund declared" },
  ),
);
assert.equal(refund.summary.netReceived, "94.90");
assert.equal(refund.summary.refunds, "5.10");
ledger = await call(route);
assert.equal(
  ledger.items.find((row) => row.id === deposit.entries[0].id).refundableAmount,
  "15.00",
);
before = state();
await call(
  route,
  cmd(
    "refund",
    4,
    [{ amount: "15.01", method: "cash", refundOfId: deposit.entries[0].id }],
    { reason: "Over original residual" },
  ),
  { status: 400 },
);
await call(
  route,
  cmd(
    "refund",
    4,
    [{ amount: "1", method: "cash", refundOfId: refund.entries[0].id }],
    { reason: "Refund of refund invalid" },
  ),
  { status: 400 },
);
assert.equal(state(), before);
checks.push("refund-keeps-original-reference-and-cumulative-refundable-cap");
await call(route, opening, { subject: "foreign", status: 404 });
await call(route, opening, { subject: "manager", status: 404 });
await call(route, undefined, { subject: "foreign", status: 404 });
await call(route, { ...opening, unknown: "nope" }, { status: 400 });
await call(route, cmd("receive", 4, [{ amount: "1.001", method: "cash" }]), {
  status: 400,
});
await call(
  route,
  cmd("receive", 4, [
    { amount: "1", method: "cash", receivedAt: "2099-01-01T00:00:00Z" },
  ]),
  { status: 400 },
);
await call(route, opening, { subject: "cashier", status: 409 });
assert.equal(state(), before);
checks.push(
  "company-sector-authority-rechecked-before-replay-actor-bound-and-strict-dto",
);
const raceSource = await createSale();
const raceSale = { ...raceSource, id: cloneLegacySale(health, raceSource.id) };
const raceRoute = `/sales/${raceSale.id}/payments`;
await call(
  raceRoute,
  cmd("reconcile", 0, [{ amount: "0" }], { reason: "Explicit race opening" }),
);
const attempts = [
  cmd("receive", 1, [{ amount: "60", method: "cash" }]),
  cmd("receive", 1, [{ amount: "60", method: "card" }]),
];
const statuses = await Promise.all(
  attempts.map(async (body) => {
    const response = await fetch(base + raceRoute, {
      method: "POST",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    await response.json();
    return response.status;
  }),
);
assert.deepEqual(statuses.sort(), [201, 409]);
assert.equal((await call(raceRoute)).summary.netReceived, "60.00");
const replaySource = await createSale();
const replaySale = {
    ...replaySource,
    id: cloneLegacySale(health, replaySource.id),
  },
  replayRoute = `/sales/${replaySale.id}/payments`;
await call(
  replayRoute,
  cmd("reconcile", 0, [{ amount: "0" }], {
    reason: "Explicit replay race opening",
  }),
);
const same = cmd("receive", 1, [{ amount: "12.34", method: "cash" }]);
const replayResults = await Promise.all([
  call(replayRoute, same),
  call(replayRoute, same),
]);
assert.deepEqual(replayResults[0], replayResults[1]);
assert.equal((await call(replayRoute)).summary.netReceived, "12.34");
checks.push(
  "concurrent-distinct-keys-only-one-receipt-and-same-key-exact-replay",
);
await call(`/sales/${sale.id}`, undefined, { method: "DELETE", status: 409 });
const productRow = (await call("/sales")).items.find(
  (row) => row.id === sale.id,
).items[0];
await call(
  `/sales/${sale.id}`,
  {
    revision: 4,
    items: [
      {
        ...productRow,
        unitPrice: "90",
        priceOverrideReason: "Invalid below net payment",
      },
    ],
    paymentStatus: "partial",
  },
  { method: "PATCH", status: 409 },
);
assert.equal(state(), before);
assert.equal(
  sql(
    `SELECT count(*) FROM "Sale" s WHERE s."paymentBasis"='ledger' AND s.total<(SELECT coalesce(sum(CASE WHEN e.kind='refund' THEN -e.amount ELSE e.amount END),0) FROM "PaymentEntry" e WHERE e."saleId"=s.id)`,
  ),
  "0",
);
checks.push(
  "legacy-cashier-cannot-delete-financial-history-or-reduce-under-net-received",
);
const countSales = () =>
  sql(`SELECT count(*) FROM "Sale" WHERE "tenantId"='__http_a'`);
const beforeInvalid = countSales();
const newSaleBody = {
  locationId: location.id,
  items: [
    { productId: product.id, quantity: 1, sectorId: location.sectors[0].id },
  ],
};
await call(
  "/sales",
  { ...newSaleBody, paymentStatus: "paid" },
  { status: 400 },
);
await call(
  "/sales",
  { ...newSaleBody, paymentStatus: "paid", paymentMethod: "mixed" },
  { status: 400 },
);
await call(
  "/sales",
  { ...newSaleBody, paymentStatus: "partial", paymentMethod: "cash" },
  { status: 409 },
);
assert.equal(
  countSales(),
  beforeInvalid,
  "Invalid cashier declarations created accounts",
);
const fullyPaid = await call("/sales", {
  ...newSaleBody,
  paymentStatus: "paid",
  paymentMethod: "cash",
});
const paidLedger = await call(`/sales/${fullyPaid.id}/payments`);
assert.equal(paidLedger.summary.receipts, "100.00");
assert.equal(paidLedger.items.length, 1);
assert.equal(paidLedger.items[0].method, "cash");
assert.equal(paidLedger.items[0].kind, "receipt");
assert.equal(paidLedger.items[0].amount, "100.00");
assert.equal(paidLedger.summary.opening, "0.00");
checks.push(
  "new-cashier-zero-known-receipts-explicit-full-receipt-and-ambiguous-declarations-rollback",
);
mkdirSync(".local/step10", { recursive: true, mode: 0o700 });
const report = {
  checkedAt: new Date().toISOString(),
  identity: "isolated-synthetic-sessions",
  providerCalls: false,
  checks,
  concurrentStatuses: statuses,
  fixture: { saleId: sale.id, locationId: location.id, productId: product.id },
};
writeFileSync(
  ".local/step10/payments-http-result.json",
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(report, null, 2));
