/** Against the synthetic isolated QA server; refuses every other database identity. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
const base = "http://127.0.0.1:53027";
const health = await (await fetch(base + "/health")).json();
assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
const quoteState = () =>
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
    {
      input: `SELECT json_build_object('audit',(SELECT count(*) FROM "AuditLog"),'prices',(SELECT count(*) FROM "OrderPriceRevision"),'stock',(SELECT count(*) FROM "StockMovement"),'sales',(SELECT count(*) FROM "Sale"))`,
      stdio: "pipe",
    },
  )
    .toString()
    .trim();
const checks = [];
async function call(
  route,
  body,
  { method, status, subject = "owner", headers = {} } = {},
) {
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
    status ??
      (body === undefined || method === "PATCH" || method === "DELETE"
        ? 200
        : 201),
    `${route}: ${JSON.stringify(data)}`,
  );
  return data;
}
const a = await call("/locations", {
  name: "Magazzino A",
  sectorName: "Area A",
});
const b = await call("/locations", {
  name: "Magazzino B",
  sectorName: "Area B",
});
const product = await call("/products", {
  name: "Prodotto tracciato " + Date.now(),
  price: "12.20",
  priceMode: "gross",
  vatRate: "22",
  cost: "5.00",
  costMode: "net",
  purchaseVatRate: "4",
  stockTracked: true,
  priceChangeReason: "Configurazione fixture",
});
assert.equal(product.vatRate, "22");
assert.equal(product.purchaseVatRate, "4");
let history = await call(`/products/${product.id}/prices`);
assert.equal(history.items[0].actorUserId, "__http_owner");
assert.equal(history.items[0].source, "application");
assert.equal(history.items[0].snapshot.priceMode, "gross");
const balances = (loc) => call(`/inventory/balances?locationId=${loc}`);
const balance = async (loc) =>
  (await balances(loc)).find((row) => row.id === product.id);
assert.equal((await balance(a.id)).quantity, null);
const command = (kind, locationId, quantity, extras = {}) => ({
  kind,
  locationId,
  productId: product.id,
  quantity,
  idempotencyKey: randomUUID(),
  reason: "Collaudo sintetico",
  ...extras,
});
const opening = command("opening", a.id, "10", { unitCost: "5" });
const first = await call("/inventory/operations", opening);
assert.equal(
  (await call("/inventory/operations", opening)).operationId,
  first.operationId,
);
await call(
  "/inventory/operations",
  { ...opening, quantity: "9" },
  { status: 409 },
);
await call("/inventory/operations", command("opening", a.id, "0"), {
  status: 400,
});
await call("/inventory/operations", command("opening", b.id, "0"));
await call(
  "/inventory/operations",
  command("receipt", a.id, "10", {
    unitCost: "12.20",
    costMode: "gross",
    purchaseVatRate: "22",
  }),
);
assert.deepEqual(await balance(a.id), {
  ...(await balance(a.id)),
  quantity: "20.000",
  value: "150.000000",
  averageCost: "7.500000",
});
checks.push(
  "explicit-opening-independent-purchase-vat-weighted-average-and-idempotent-replay",
);
await call(
  `/products/${product.id}`,
  { stockTracked: false },
  { method: "PATCH", status: 409 },
);
await call(`/inventory/balances?locationId=${a.id}`, undefined, {
  subject: "foreign",
  status: 403,
});
await call(`/inventory/balances?locationId=${a.id}`, undefined, {
  subject: "manager",
  status: 403,
});
await call(
  "/inventory/operations",
  command("issue", a.id, "1", { toLocationId: b.id }),
  { status: 400 },
);
await call(`/inventory/balances?locationId=${a.id}`, undefined, {
  subject: "cashier",
  status: 403,
});
await call("/inventory/operations", command("issue", a.id, "1"), {
  subject: "cashier",
  status: 403,
});
await call(
  `/products/${product.id}`,
  { stockTracked: true },
  { method: "PATCH", subject: "cashier", status: 403 },
);
checks.push("tenant-location-isolation-and-semantic-command-validation");
const beforeQuote = quoteState();
const preview = await call("/sales/quote", {
  items: [{ productId: product.id, sectorId: a.sectors[0].id, quantity: 2 }],
});
assert.equal(preview.total, "24.40");
assert.equal(preview.taxTotal, "4.40");
assert.equal(quoteState(), beforeQuote);
let sale = await call("/sales", {
  customerId: "__http_customer",
  paymentStatus: "unpaid",
  locationId: a.id,
  items: [{ productId: product.id, sectorId: a.sectors[0].id, quantity: 2 }],
});
assert.equal(sale.total, "24.4");
assert.equal(sale.taxTotal, "4.4");
assert.equal(sale.items[0].vatRate, "22");
assert.equal((await balance(a.id)).quantity, "18.000");
const rowId = sale.items[0].id;
await call(
  `/products/${product.id}`,
  {
    price: "13.42",
    vatRate: "22",
    priceMode: "gross",
    priceChangeReason: "Nuovo listino fixture",
  },
  { method: "PATCH" },
);
const payload = (quantity = 2, extra = {}) => ({
  customerId: "__http_customer",
  revision: sale.revision,
  items: [
    {
      id: rowId,
      productId: product.id,
      sectorId: a.sectors[0].id,
      quantity,
      unitPrice: "12.20",
      ...extra,
    },
  ],
});
sale = await call(`/sales/${sale.id}`, payload(), { method: "PATCH" });
assert.equal(sale.total, "24.4");
assert.equal((await balance(a.id)).quantity, "18.000");
sale = await call(`/sales/${sale.id}`, payload(3), { method: "PATCH" });
assert.equal((await balance(a.id)).quantity, "17.000");
await call(`/sales/${sale.id}`, payload(3, { unitPrice: "11.00" }), {
  method: "PATCH",
  status: 400,
});
sale = await call(
  `/sales/${sale.id}`,
  payload(3, {
    unitPrice: "11.00",
    priceOverrideReason: "Prezzo concordato fixture",
  }),
  { method: "PATCH" },
);
assert.equal((await balance(a.id)).quantity, "17.000");
history = await call(`/products/${product.id}/prices`);
assert.equal(history.items.length, 2);
const appliedHistory = await call(`/sales/${sale.id}/price-history`);
assert(
  appliedHistory.items.some(
    (row) =>
      row.reason === "Prezzo concordato fixture" &&
      row.actorUserId === "__http_owner" &&
      row.previousSnapshot,
  ),
);
await call(`/sales/${sale.id}/price-history`, undefined, {
  subject: "foreign",
  status: 403,
});
checks.push(
  "sale-tax-price-snapshots-catalog-history-and-quantity-difference-posting",
);
const ledgerA = await call(
  `/inventory/movements?locationId=${a.id}&productId=${product.id}`,
);
const originalIssue = ledgerA.items.find(
  (row) =>
    row.saleId === sale.id && row.kind === "sale" && row.quantityDelta === "-2",
);
assert(originalIssue);
const returned = await call(
  "/inventory/operations",
  command("return", a.id, "1", { returnOfId: originalIssue.id }),
);
assert.equal(returned.movements[0].valueDelta, "7.5");
await call(
  "/inventory/operations",
  command("return", a.id, "2", { returnOfId: originalIssue.id }),
  { status: 400 },
);
const payment = await call(`/sales/${sale.id}/payments`, {
  kind: "receive",
  revision: sale.revision,
  idempotencyKey: randomUUID(),
  entries: [{ amount: Number(sale.total).toFixed(2), method: "cash" }],
});
const refundPayment = await call(`/sales/${sale.id}/payments`, {
  kind: "refund",
  revision: payment.revision,
  idempotencyKey: randomUUID(),
  reason: "Rimborso sintetico distinto dal reso fisico",
  entries: [
    {
      amount: Number(sale.total).toFixed(2),
      method: "cash",
      refundOfId: payment.entries[0].id,
    },
  ],
});
sale.revision = refundPayment.revision;
assert.equal((await balance(a.id)).quantity, "18.000");
checks.push(
  "physical-return-uses-original-cost-and-is-not-repeated-by-payment-status-edits",
);
const transfer = command("transfer", a.id, "4", { toLocationId: b.id });
const transferred = await call("/inventory/operations", transfer);
assert.equal(
  (await call("/inventory/operations", transfer)).operationId,
  transferred.operationId,
);
assert.equal((await balance(a.id)).quantity, "14.000");
assert.equal((await balance(b.id)).value, "30.000000");
await call(
  "/inventory/operations",
  command("return", a.id, "1", { returnOfId: transferred.movements[0].id }),
  { status: 400 },
);
await call(
  "/inventory/operations",
  command("adjust", b.id, "5", { unitCost: "9" }),
);
assert.equal((await balance(b.id)).value, "39.000000");
await call("/inventory/operations", command("adjust", b.id, "3"));
assert.equal((await balance(b.id)).value, "23.400000");
const outcomes = await Promise.all(
  [0, 1].map(() =>
    fetch(base + "/inventory/operations", {
      method: "POST",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command("issue", a.id, "10")),
    }),
  ),
);
assert.deepEqual(outcomes.map((r) => r.status).sort(), [201, 400]);
assert.equal((await balance(a.id)).quantity, "4.000");
checks.push(
  "atomic-transfer-reconciliation-adjustments-and-concurrent-negative-stock-rejection",
);
const service = await call("/services", {
  name: "Servizio con consumo",
  sectorId: a.sectors[0].id,
  basePrice: "10",
  priceMode: "net",
  vatRate: "4",
  durationMinutes: 30,
  requiresCollaborator: false,
  isPublic: true,
  isBookableOnline: true,
});
await call(`/services/${service.id}/products`, {
  productId: product.id,
  mode: "optional",
  consumptionUnits: "0.250",
});
const booking = await call("/appointments", {
  customerId: "__http_customer",
  serviceId: service.id,
  startsAt: "2032-11-15T11:00:00+01:00",
});
assert.equal(booking.estimatedPrice, "10.40");
const publicServices = await call("/public/__http_a/services");
assert.equal(
  publicServices.find((row) => row.id === service.id).basePrice,
  "10.40",
);
let bookedOrder = await call(`/sales/for-appointment/${booking.id}`);
bookedOrder = await call(
  `/sales/${bookedOrder.id}`,
  {
    revision: bookedOrder.revision,
    customerId: "__http_customer",
    paymentStatus: "paid",
    paymentMethod: "cash",
    items: bookedOrder.items.map((i) => ({
      id: i.id,
      serviceId: i.serviceId,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
    })),
  },
  { method: "PATCH" },
);
assert.equal(bookedOrder.total, "10.4");
assert.equal((await balance(a.id)).quantity, "3.750");
await call(`/services/${service.id}/products`, {
  productId: product.id,
  mode: "included",
  consumptionUnits: "0.500",
});
bookedOrder = await call(
  `/sales/${bookedOrder.id}`,
  {
    revision: bookedOrder.revision,
    customerId: "__http_customer",
    paymentStatus: "paid",
    paymentMethod: "cash",
    items: bookedOrder.items.map((i) => ({
      id: i.id,
      serviceId: i.serviceId,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
    })),
  },
  { method: "PATCH" },
);
assert.equal((await balance(a.id)).quantity, "3.750");
checks.push(
  "configured-consumption-and-net-public-price-use-stable-order-snapshots",
);
const beforeFailedCheckout = await balance(a.id);
const failedBooking = await call("/appointments", {
  customerId: "__http_customer",
  serviceId: service.id,
  startsAt: "2032-11-20T11:00:00+01:00",
});
const failedOrder = await call(`/sales/for-appointment/${failedBooking.id}`);
await call(
  `/sales/${failedOrder.id}`,
  {
    revision: failedOrder.revision,
    customerId: "__http_customer",
    paymentStatus: "paid",
    paymentMethod: "cash",
    items: [
      ...failedOrder.items.map((i) => ({
        id: i.id,
        serviceId: i.serviceId,
        unitPrice: i.unitPrice,
        quantity: i.quantity,
      })),
      { productId: product.id, sectorId: a.sectors[0].id, quantity: 999 },
    ],
  },
  { method: "PATCH", status: 400 },
);
const unchangedOrder = await call(`/sales/for-appointment/${failedBooking.id}`);
assert.equal(unchangedOrder.orderStatus, "open");
assert.equal(unchangedOrder.items.length, 1);
assert.equal(unchangedOrder.items[0].id, failedOrder.items[0].id);
assert.equal(
  (await call(`/appointments/${failedBooking.id}`)).status,
  "confirmed",
);
assert.equal((await balance(a.id)).quantity, beforeFailedCheckout.quantity);
assert.equal((await balance(a.id)).value, beforeFailedCheckout.value);
checks.push(
  "insufficient-stock-rolls-back-order-rows-status-appointment-and-all-consumption-movements",
);
const oldQuantity = Number((await balance(a.id)).quantity);
const spare = await call("/products", {
  name: "Riga non tracciata",
  price: "0.00",
});
sale = await call(
  `/sales/${sale.id}`,
  {
    revision: sale.revision,
    customerId: "__http_customer",
    items: [{ productId: spare.id, sectorId: a.sectors[0].id, quantity: 1 }],
  },
  { method: "PATCH" },
);
assert.equal(Number((await balance(a.id)).quantity), oldQuantity + 2);
await call(
  "/inventory/operations",
  command("return", a.id, "1", { returnOfId: originalIssue.id }),
  { status: 400 },
);
const corrections = await call(
  `/inventory/movements?locationId=${a.id}&productId=${product.id}`,
);
assert(
  corrections.items
    .filter((row) => row.saleId === sale.id && row.kind === "order_adjust_in")
    .every((row) => row.returnOfId),
);
checks.push(
  "removed-order-row-reverses-remaining-original-costs-and-prevents-a-second-return",
);
const privateSector = await call(`/locations/${a.id}/sectors`, {
  name: "Settore riservato",
});
const privateService = await call("/services", {
  name: "Consumo riservato",
  sectorId: privateSector.id,
  basePrice: "1",
  durationMinutes: 30,
  requiresCollaborator: false,
});
await call(`/services/${privateService.id}/products`, {
  productId: product.id,
  mode: "optional",
  consumptionUnits: "0.125",
});
const privateSale = await call("/sales", {
  locationId: a.id,
  customerId: "__http_customer",
  items: [{ serviceId: privateService.id }],
});
const privateMove = (
  await call(`/inventory/movements?locationId=${a.id}&productId=${product.id}`)
).items.find((row) => row.saleId === privateSale.id);
assert(privateMove);
await call("/locations/access/__http_manager", {
  sectorIds: [a.sectors[0].id],
});
await call(`/inventory/balances?locationId=${a.id}`, undefined, {
  subject: "manager",
});
const limitedLedger = await call(
  `/inventory/movements?locationId=${a.id}&productId=${product.id}`,
  undefined,
  { subject: "manager" },
);
assert(!limitedLedger.items.some((row) => row.id === privateMove.id));
const selectedLedger = await call(
  `/inventory/movements?locationId=${a.id}&productId=${product.id}`,
  undefined,
  { headers: { "X-Alora-Sector": a.sectors[0].id } },
);
assert(!selectedLedger.items.some((row) => row.id === privateMove.id));
await call(
  "/inventory/operations",
  command("return", a.id, "0.125", { returnOfId: privateMove.id }),
  { subject: "manager", status: 400 },
);
await call(
  "/inventory/operations",
  command("transfer", a.id, "1", { toLocationId: b.id }),
  { subject: "manager", status: 403 },
);
checks.push(
  "shared-location-stock-with-sector-filtered-history-and-both-end-transfer-authorization",
);
async function pendingAccounts() {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(base + "/notifications/stream", {
      headers: { Authorization: "Bearer owner", "X-Alora-Location": a.id },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      assert(!done, "SSE ended before first data frame");
      buffer += new TextDecoder().decode(value);
      const frame = buffer
        .replace(/\r/g, "")
        .split("\n\n")
        .find((f) => f.split("\n").some((line) => line.startsWith("data:")));
      if (frame) {
        const json = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        return JSON.parse(json).appointments;
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
const queueBooking = await call("/appointments", {
  customerId: "__http_customer",
  serviceId: service.id,
  startsAt: "2020-01-10T11:00:00+01:00",
});
assert((await pendingAccounts()).some((row) => row.id === queueBooking.id));
const queueOrder = await call(`/sales/for-appointment/${queueBooking.id}`);
await call(
  `/sales/${queueOrder.id}`,
  {
    revision: queueOrder.revision,
    customerId: "__http_customer",
    paymentStatus: "paid",
    paymentMethod: "cash",
    items: queueOrder.items.map((i) => ({
      id: i.id,
      serviceId: i.serviceId,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
    })),
  },
  { method: "PATCH" },
);
assert(!(await pendingAccounts()).some((row) => row.id === queueBooking.id));
checks.push(
  "real-sse-queue-keeps-open-booked-accounts-and-removes-confirmed-ones",
);
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
sql(
  `BEGIN; DO $$ BEGIN BEGIN UPDATE "StockMovement" SET kind=kind WHERE "tenantId"='__http_a'; RAISE EXCEPTION 'Ledger mutation allowed'; EXCEPTION WHEN check_violation THEN NULL; END; BEGIN UPDATE "StockBalance" SET quantity=quantity+1 WHERE "tenantId"='__http_a'; SET CONSTRAINTS alora_stock_balance_reconcile IMMEDIATE; RAISE EXCEPTION 'Unbalanced stock allowed'; EXCEPTION WHEN check_violation THEN NULL; END; BEGIN UPDATE "CatalogPriceHistory" SET reason=reason WHERE "tenantId"='__http_a'; RAISE EXCEPTION 'Price history mutation allowed'; EXCEPTION WHEN check_violation THEN NULL; END; BEGIN UPDATE "OrderPriceRevision" SET reason=reason WHERE "tenantId"='__http_a'; RAISE EXCEPTION 'Applied price history mutation allowed'; EXCEPTION WHEN check_violation THEN NULL; END; END $$; ROLLBACK;`,
);
assert.equal(
  sql(
    `SELECT count(*) FROM "StockBalance" b WHERE b.quantity<>(SELECT COALESCE(sum("quantityDelta"),0) FROM "StockMovement" m WHERE m."locationId"=b."locationId" AND m."productId"=b."productId") OR b.value<>(SELECT COALESCE(sum("valueDelta"),0) FROM "StockMovement" m WHERE m."locationId"=b."locationId" AND m."productId"=b."productId")`,
  ),
  "0",
);
checks.push("database-enforces-immutable-history-and-ledger-balance-equality");
mkdirSync(".local/step9", { recursive: true, mode: 0o700 });
const report = {
  checkedAt: new Date().toISOString(),
  identity: "synthetic-local-test-sessions",
  providerCalls: false,
  checks,
  fixture: {
    locationA: a.id,
    locationB: b.id,
    sectorA: a.sectors[0].id,
    sectorB: b.sectors[0].id,
    productId: product.id,
    productName: product.name,
    serviceId: service.id,
  },
};
writeFileSync(
  ".local/step9/http-result.json",
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(report, null, 2));
