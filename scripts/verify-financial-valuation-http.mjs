/** Actual financial read model + inventory/price commands, isolated SQL and synthetic sessions only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cloneLegacySale } from "./payment-ledger-qa-fixtures.mjs";
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
const checks = [];
async function call(
  route,
  body,
  { method, headers = {}, subject = "owner", status } = {},
) {
  const r = await fetch(base + route, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      Authorization: "Bearer " + subject,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  assert.equal(
    r.status,
    status ?? (body === undefined || method === "PATCH" ? 200 : 201),
    route + ": " + JSON.stringify(data),
  );
  return data;
}
const site = await call("/locations", {
    name: "Valuation A",
    sectorName: "Valuation A1",
  }),
  sector = site.sectors[0].id;
await call(`/locations/${site.id}/sectors`, { name: "Valuation A2" });
const destination = await call("/locations", {
  name: "Valuation B",
  sectorName: "Valuation B1",
});
const headers = { "x-alora-location": site.id },
  otherHeaders = { "x-alora-location": destination.id };
const today = sql(
  "SELECT to_char(now() AT TIME ZONE 'Europe/Rome','YYYY-MM-DD')",
);
const route = "/dashboard/revenue?period=day&date=" + today;
const report = (options = {}) =>
  call(route, undefined, { headers, ...options });
const product = await call("/products", {
  name: "Valuation recorded product",
  price: "12.20",
  priceMode: "gross",
  vatRate: "22",
  cost: "5",
  costMode: "net",
  purchaseVatRate: "4",
  stockTracked: true,
  priceChangeReason: "Synthetic valuation",
});
const move = (kind, quantity, extras = {}) =>
  call("/inventory/operations", {
    idempotencyKey: randomUUID(),
    kind,
    locationId: site.id,
    productId: product.id,
    quantity,
    reason: "Synthetic valuation record",
    ...extras,
  });
await move("opening", "10", { unitCost: "5" });
await move("receipt", "10", {
  unitCost: "7",
  costMode: "net",
  purchaseVatRate: "4",
});
const sale = await call("/sales", {
  idempotencyKey: randomUUID(),
  locationId: site.id,
  paymentStatus: "unpaid",
  orderDiscount: "0.01",
  items: [{ productId: product.id, quantity: 2, sectorId: sector }],
});
let r = await report();
assert.equal(r.sold.gross, "24.39");
assert.deepEqual(r.salesTax, {
  knownNet: "19.99",
  knownTax: "4.40",
  knownGross: "24.39",
  unknownLinesGross: "0.00",
  unknownLineCount: 0,
  rates: [{ rate: "22.00", net: "19.99", tax: "4.40", gross: "24.39" }],
});
assert.deepEqual(r.materials, {
  knownCost: "12.000000",
  unknownLineCount: 0,
  unattributedMovementGroups: 0,
  margin: "7.990000",
});
assert.equal(r.inventory.receiptsNet, "70.000000");
assert.equal(r.inventory.receiptsTax, "2.80");
assert.equal(r.inventory.receiptsGross, "72.800000");
assert.equal(r.inventory.openingValue, "50.000000");
assert.equal(r.inventory.issuedCost, "12.000000");
assert.equal(r.inventory.currentValue, "108.000000");
assert.equal(r.inventory.currentDifference, "0.000000");
assert.equal(r.cash.net, "0.00");
checks.push(
  "explicit-sales-VAT-and-distributed-cent-discount-reconcile-while-material-cost-uses-recorded-weighted-average-and-purchase-VAT-is-independent",
);
const source = JSON.parse(
  sql(
    `SELECT row_to_json(m) FROM "StockMovement" m WHERE "saleId"='${sale.id}' AND "quantityDelta"<0`,
  ),
);
await move("return", "0.500", { returnOfId: source.id });
r = await report();
assert.equal(r.materials.knownCost, "9.000000");
assert.equal(r.materials.margin, "10.990000");
assert.equal(r.inventory.returnedCost, "3.000000");
assert.equal(r.inventory.currentValue, "111.000000");
assert.equal(r.inventory.movementDelta, "111.000000");
assert.equal(r.cash.net, "0.00");
assert.equal(r.salesTax.knownTax, "4.40");
await call(
  `/products/${product.id}`,
  {
    cost: "200",
    costMode: "net",
    purchaseVatRate: "10",
    price: "61",
    priceMode: "gross",
    vatRate: "22",
    priceChangeReason: "Change list after documented sale",
  },
  { method: "PATCH" },
);
r = await report();
assert.equal(r.materials.knownCost, "9.000000");
assert.equal(r.materials.margin, "10.990000");
assert.equal(r.inventory.receiptsTax, "2.80");
assert.equal(r.sold.gross, "24.39");
checks.push(
  "partial-physical-return-preserves-original-cost-without-money-or-VAT-reversal-and-later-catalog-cost-or-price-does-not-revalue-history",
);
const line = await report({
  headers: { ...headers, "x-alora-sector": sector },
});
assert.equal(line.materials.knownCost, "9.000000");
assert.equal(line.inventory, null);
const cashier = await report({ subject: "cashier" });
assert.equal(cashier.materials, null);
assert.equal(cashier.inventory, null);
assert.equal(cashier.salesTax.knownNet, "19.99");
sql(
  `INSERT INTO "UserSectorAccess" ("userId","sectorId") VALUES ('__http_manager','${sector}')`,
);
const manager = await report({ subject: "manager" });
assert.equal(manager.materials.knownCost, "9.000000");
assert.equal(manager.inventory, null);
sql(
  `DELETE FROM "UserSectorAccess" WHERE "userId"='__http_manager' AND "sectorId"='${sector}'`,
);
checks.push(
  "cost-and-warehouse-values-require-explicit-inventory-read-and-warehouse-aggregation-also-requires-full-location-scope-without-line-filters",
);
cloneLegacySale(health, sale.id);
const legacy = randomUUID(),
  legacyLine = randomUUID();
sql(
  `BEGIN; INSERT INTO "Sale" (id,"tenantId","locationId",subtotal,"taxTotal",total,"paymentBasis","soldAt") VALUES ('${legacy}','__http_a','${site.id}',10,1,11,'legacy_unknown',now()); INSERT INTO "SaleItem" (id,"saleId","sectorId","productId",label,quantity,"unitPrice","lineTotal","taxTotal","priceMode","stockState") VALUES ('${legacyLine}','${legacy}','${sector}','${product.id}','Legacy VAT not documented',1,10,10,1,'legacy','legacy'); COMMIT;`,
);
r = await report();
assert.equal(r.sold.gross, "59.78");
assert.equal(r.salesTax.knownNet, "39.98");
assert.equal(r.salesTax.unknownLinesGross, "11.00");
assert.equal(r.salesTax.unknownLineCount, 1);
assert.equal(r.salesTax.rates.length, 1);
assert.equal(r.salesTax.rates[0].rate, "22.00");
assert.equal(r.materials.knownCost, "9.000000");
assert.equal(r.materials.unknownLineCount, 2);
assert.equal(r.materials.margin, null);
checks.push(
  "legacy-VAT-is-not-inferred-as-zero-or-a-rate-and-unknown-material-history-never-produces-a-zero-cost-or-complete-margin",
);
await move("opening", "0", { locationId: destination.id });
await move("transfer", "2", { toLocationId: destination.id });
const service = await call("/services", {
  name: "Valuation material service",
  sectorId: destination.sectors[0].id,
  basePrice: "20",
  durationMinutes: 20,
  priceMode: "net",
  vatRate: "10",
  requiresCollaborator: false,
  requiresRoom: false,
});
await call(`/services/${service.id}/products`, {
  productId: product.id,
  mode: "optional",
  consumptionUnits: "0.250",
});
const serviceSale = await call("/sales", {
  idempotencyKey: randomUUID(),
  locationId: destination.id,
  customerId: "__http_customer",
  paymentStatus: "unpaid",
  items: [
    { serviceId: service.id, quantity: 1, sectorId: destination.sectors[0].id },
  ],
});
const other = await report({ headers: otherHeaders });
assert.equal(other.salesTax.knownNet, "20.00");
assert.equal(other.salesTax.knownTax, "2.00");
assert.equal(other.materials.knownCost, "1.500000");
assert.equal(other.materials.margin, "18.500000");
assert.equal(other.inventory.receiptsNet, "0.000000");
assert.equal(other.inventory.receiptsTax, "0.00");
assert.equal(other.inventory.transferDelta, "12.000000");
assert.equal(other.inventory.currentValue, "10.500000");
assert.equal(other.inventory.currentDifference, "0.000000");
const company = await call(route);
assert.equal(company.inventory.transferDelta, "0.000000");
checks.push(
  "declared-service-consumption-is-valued-from-frozen-material-requirements-and-internal-transfers-do-not-create-purchases-or-company-cost",
);
const zeroTaxProduct = await call("/products", {
  name: "Explicit zero rate",
  price: "0.30",
  priceMode: "net",
  vatRate: "0",
});
await call("/sales", {
  idempotencyKey: randomUUID(),
  locationId: destination.id,
  paymentStatus: "unpaid",
  items: [
    {
      productId: zeroTaxProduct.id,
      quantity: 1,
      sectorId: destination.sectors[0].id,
    },
  ],
});
const zeroTax = await report({ headers: otherHeaders });
assert.equal(
  zeroTax.salesTax.rates.find((row) => row.rate === "0.00").gross,
  "0.30",
);
assert.equal(zeroTax.materials.knownCost, "1.500000");
assert.equal(zeroTax.materials.margin, "18.800000");
checks.push(
  "explicit-zero-VAT-and-an-empty-frozen-material-list-are-known-values-distinct-from-legacy-unknown-costs",
);
const unknown = await call("/products", {
  name: "Uninitialized valuation product",
  price: "1",
  priceMode: "net",
  vatRate: "0",
  stockTracked: true,
});
const afterUnknown = await report();
assert(
  afterUnknown.inventory.unknownProductLocations >
    r.inventory.unknownProductLocations,
);
assert.equal(afterUnknown.inventory.currentValue, "99.000000");
assert.equal(afterUnknown.inventory.currentDifference, "0.000000");
const future = await call(
  "/dashboard/revenue?period=day&date=2038-01-01",
  undefined,
  { headers },
);
assert.equal(future.inventory.receiptsNet, "0.000000");
assert.equal(future.inventory.currentValue, "99.000000");
assert.equal(future.materials.margin, "0.000000");
const before = sql(
  'SELECT count(*) FROM "PaymentEntry"; SELECT count(*) FROM "StockMovement"; SELECT count(*) FROM "InventoryOperation"; SELECT count(*) FROM "OrderPriceRevision";',
);
await Promise.all(Array.from({ length: 4 }, () => report()));
assert.equal(
  sql(
    'SELECT count(*) FROM "PaymentEntry"; SELECT count(*) FROM "StockMovement"; SELECT count(*) FROM "InventoryOperation"; SELECT count(*) FROM "OrderPriceRevision";',
  ),
  before,
);
checks.push(
  "current-unknown-stock-is-excluded-with-explicit-coverage-and-current-valuation-is-distinct-from-empty-period-flows-with-read-only-reports",
);
const incomplete = cloneLegacySale(health, sale.id);
sql(
  `UPDATE "SaleItem" SET "stockState"='posted',"inventoryRequirements"=jsonb_build_object('serviceId',NULL,'productId','${product.id}','requirements',jsonb_build_array(jsonb_build_object('productId','${product.id}','units','1.000','kind','sale'))) WHERE "saleId"='${incomplete}';`,
);
const incompleteReport = await report();
assert.equal(incompleteReport.materials.knownCost, "9.000000");
assert.equal(incompleteReport.materials.unknownLineCount, 3);
assert.equal(incompleteReport.materials.margin, null);
checks.push(
  "posted-marker-with-required-materials-but-no-original-issue-is-incomplete-evidence-and-never-a-zero-cost",
);
const historicalOperation = randomUUID();
sql(`BEGIN;
INSERT INTO "InventoryOperation" (id,"tenantId","idempotencyKey",fingerprint,kind,"actorUserId",reason) VALUES ('${historicalOperation}','__http_a','synthetic-${historicalOperation}','synthetic','receipt','__http_owner','Synthetic imported receipt with unknown VAT');
INSERT INTO "StockMovement" (id,"tenantId","operationId","locationId","productId",kind,"quantityDelta","valueDelta","quantityAfter","valueAfter") SELECT gen_random_uuid()::text,'__http_a','${historicalOperation}','${site.id}','${product.id}','receipt',1,5,quantity+1,value+5 FROM "StockBalance" WHERE "locationId"='${site.id}' AND "productId"='${product.id}';
UPDATE "StockBalance" SET quantity=quantity+1,value=value+5,version=version+1 WHERE "locationId"='${site.id}' AND "productId"='${product.id}'; COMMIT;`);
const unknownPurchase = await report();
assert.equal(unknownPurchase.inventory.receiptsNet, "75.000000");
assert.equal(unknownPurchase.inventory.receiptsTax, "2.80");
assert.equal(unknownPurchase.inventory.receiptsGross, null);
assert.equal(unknownPurchase.inventory.receiptsUnknownTaxCount, 1);
assert.equal(unknownPurchase.inventory.currentValue, "104.000000");
assert.equal(unknownPurchase.inventory.currentDifference, "0.000000");
assert.equal(
  (await call(route + "&customerId=" + randomUUID(), undefined, { headers }))
    .inventory,
  null,
);
checks.push(
  "receipt-without-documented-purchase-VAT-keeps-known-net-value-and-partial-tax-but-withholds-complete-gross-and-customer-filters-withhold-warehouse-totals",
);
const lossSite = await call("/locations", {
  name: "Documented material loss",
  sectorName: "Loss area",
});
const lossProduct = await call("/products", {
  name: "Known loss material",
  price: "1",
  priceMode: "net",
  vatRate: "0",
  stockTracked: true,
});
await call("/inventory/operations", {
  idempotencyKey: randomUUID(),
  kind: "opening",
  locationId: lossSite.id,
  productId: lossProduct.id,
  quantity: "1",
  unitCost: "5",
  reason: "Synthetic negative material margin",
});
await call("/sales", {
  idempotencyKey: randomUUID(),
  locationId: lossSite.id,
  paymentStatus: "unpaid",
  items: [
    {
      productId: lossProduct.id,
      quantity: 1,
      sectorId: lossSite.sectors[0].id,
    },
  ],
});
const loss = await report({ headers: { "x-alora-location": lossSite.id } });
assert.equal(loss.materials.knownCost, "5.000000");
assert.equal(loss.materials.margin, "-4.000000");
assert.equal(loss.inventory.currentValue, "0.000000");
assert.equal(loss.inventory.currentDifference, "0.000000");
checks.push(
  "documented-negative-material-margin-remains-negative-and-last-issue-clears-inventory-value-without-rounding-or-profit-floor",
);
const result = {
  checkedAt: new Date().toISOString(),
  database: health.database,
  checks,
  realProviders: false,
  mainDatabaseModified: false,
  fixture: {
    locationId: site.id,
    destinationId: destination.id,
    sectorId: sector,
    productId: product.id,
    serviceId: service.id,
    serviceSaleId: serviceSale.id,
    date: today,
    uninitializedProductId: unknown.id,
  },
};
mkdirSync(".local/step13", { recursive: true, mode: 0o700 });
writeFileSync(
  ".local/step13/valuation-http-result.json",
  JSON.stringify(result, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(result, null, 2));
