/** Synthetic sessions and real SQL/controller reads on the disposable QA server only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cloneLegacySale } from "./payment-ledger-qa-fixtures.mjs";
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
  { status, method, headers = {}, subject = "owner" } = {},
) {
  const response = await fetch(base + route, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      Authorization: "Bearer " + subject,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    status ?? (body === undefined || method === "PATCH" ? 200 : 201),
    route + ": " + JSON.stringify(data),
  );
  return data;
}
const site = await call("/locations", {
  name: "Financial synthetic site",
  sectorName: "Financial A",
});
const sectorA = site.sectors[0].id;
const sectorB = (
  await call(`/locations/${site.id}/sectors`, { name: "Financial B" })
).id;
const product = await call("/products", {
  name: "Financial synthetic product",
  price: "100",
  priceMode: "gross",
  vatRate: "22",
});
const headers = { "x-alora-location": site.id };
const report = (extra = "", options = {}) =>
  call("/dashboard/revenue?period=day&date=2026-02-10" + extra, undefined, {
    headers,
    ...options,
  });
const sale = () =>
  call("/sales", {
    idempotencyKey: randomUUID(),
    locationId: site.id,
    soldAt: "2026-02-10T11:00:00Z",
    paymentStatus: "unpaid",
    items: [{ productId: product.id, quantity: 1, sectorId: sectorA }],
  });
const pay = (id, revision, kind, entries, extras = {}) =>
  call(`/sales/${id}/payments`, {
    idempotencyKey: randomUUID(),
    revision,
    kind,
    entries,
    ...extras,
  });
const first = await sale();
let r = await report();
assert.equal(r.sold.gross, "100.00");
assert.equal(r.cash.net, "0.00");
assert.equal(r.accounts.remaining, "100.00");
assert.equal(r.sold.accounts, 1);
assert.equal(r.sold.unattributedGross, "0.00");
assert.equal(r.basis.paymentsAllocatedToLines, false);
checks.push(
  "confirmed-unpaid-account-counts-as-sold-without-inferred-cash-or-appointment-fallback",
);
const deposit = await pay(first.id, 0, "receive", [
  { amount: "20", method: "cash", receivedAt: "2026-02-10T11:30:00Z" },
]);
await pay(first.id, 1, "receive", [
  { amount: "30", method: "card", receivedAt: "2026-03-01T11:30:00Z" },
]);
await pay(
  first.id,
  2,
  "refund",
  [
    {
      amount: "5",
      method: "cash",
      receivedAt: "2026-02-10T12:00:00Z",
      refundOfId: deposit.entries[0].id,
    },
  ],
  { reason: "Synthetic partial refund" },
);
r = await report();
assert.equal(r.sold.gross, "100.00");
assert.deepEqual(r.cash, { receipts: "20.00", refunds: "5.00", net: "15.00" });
assert.equal(r.accounts.netReceived, "45.00");
assert.equal(r.accounts.remaining, "55.00");
const march = await call(
  "/dashboard/revenue?period=day&date=2026-03-01",
  undefined,
  { headers },
);
assert.equal(march.sold.gross, "0.00");
assert.equal(march.cash.net, "30.00");
assert.equal(march.accounts.total, "0.00");
checks.push(
  "partial-payment-refund-and-cross-period-cash-use-receivedAt-while-cohort-balance-stays-current",
);
const legacy = cloneLegacySale(health, first.id);
const unknown = cloneLegacySale(health, first.id);
await pay(legacy, 0, "reconcile", [{ amount: "40" }], {
  reason: "Explicit synthetic opening",
});
r = await report();
assert.equal(r.sold.gross, "300.00");
assert.equal(r.cash.receipts, "20.00");
assert.equal(r.accounts.opening, "40.00");
assert.equal(r.accounts.netReceived, "85.00");
assert.equal(r.accounts.remaining, "115.00");
assert.equal(r.accounts.unknownCount, 1);
assert.equal(r.accounts.unknownTotal, "100.00");
checks.push(
  "explicit-opening-is-not-new-period-cash-and-legacy-unknown-is-never-inferred-paid-or-zero",
);
// A second-sector line is known sold, but payments cannot be assigned to a subset of the account.
const mixed = await call("/sales", {
  idempotencyKey: randomUUID(),
  locationId: site.id,
  soldAt: "2026-02-10T11:00:00Z",
  paymentStatus: "unpaid",
  items: [
    { productId: product.id, quantity: 1, sectorId: sectorA },
    { productId: product.id, quantity: 1, sectorId: sectorB },
  ],
});
const scoped = await report("", {
  headers: { ...headers, "x-alora-sector": sectorA },
});
assert.equal(scoped.sold.gross, "400.00");
assert.equal(scoped.cash, null);
assert.equal(scoped.accounts, null);
assert.equal(scoped.basis.lineFiltered, true);
assert.equal(scoped.bySector.length, 1);
const b = await report("", {
  headers: { ...headers, "x-alora-sector": sectorB },
});
assert.equal(b.sold.gross, "100.00");
assert.equal(b.cash, null);
r = await report();
assert.equal(r.sold.gross, "500.00");
assert.equal(r.byLocation[0].revenue, "500.00");
assert.equal(
  r.bySector.reduce((n, row) => n + Number(row.revenue), 0),
  500,
);
checks.push(
  "sector-sales-project-only-selected-lines-and-account-payments-remain-explicitly-unattributed",
);
sql(
  `INSERT INTO "UserSectorAccess" ("userId","sectorId") VALUES ('__http_manager','${sectorA}');`,
);
const limited = await report("", {
  headers: { ...headers },
  subject: "manager",
});
assert.equal(limited.sold.gross, "300.00");
assert(!JSON.stringify(limited).includes(sectorB));
assert.equal(limited.accounts.unknownCount, 1);
await report("", { subject: "foreign", headers, status: 403 });
await report("", { subject: "scheduler", headers, status: 403 });
checks.push(
  "all-account-sector-memberships-are-required-and-other-tenant-or-missing-financial-function-is-denied",
);
for (const q of [
  "period=bad",
  "period=month&date=2026-02-30",
  "period=month&month=2026-13",
  "period=day&customerId=bad",
  "period=all&surprise=true",
])
  await call("/dashboard/revenue?" + q, undefined, { headers, status: 400 });
checks.push(
  "strict-query-dto-rejects-invalid-period-date-month-identifier-and-unrecognized-fields",
);
const dst = await call(
  "/dashboard/revenue?period=day&date=2026-03-29",
  undefined,
  { headers },
);
assert.equal(dst.range.start, "2026-03-28T23:00:00.000Z");
assert.equal(dst.range.end, "2026-03-29T21:59:59.999Z");
checks.push("tenant-local-day-range-covers-real-daylight-saving-transition");
const stranger = randomUUID();
const individual = await report("&collaboratorId=" + stranger);
assert.equal(individual.sold.gross, "0.00");
assert.equal(individual.cash, null);
assert.equal(individual.accounts, null);
assert.deepEqual(individual.byCollaborator, []);
checks.push(
  "professional-filter-does-not-inherit-account-primary-or-invent-payment-attribution",
);
const state = () =>
  sql(
    `SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY x.id)::text) FROM "Sale" x WHERE x."locationId"='${site.id}'; SELECT count(*) FROM "PaymentEntry"; SELECT count(*) FROM "OrderOperation"; SELECT count(*) FROM "NotificationDomainEvent";`,
  );
const before = state();
await Promise.all(Array.from({ length: 5 }, () => report()));
assert.equal(state(), before);
assert.equal(typeof r.sold.gross, "string");
assert.equal(typeof r.cash.net, "string");
assert(!JSON.stringify(r).includes("fixture-private-note"));
assert(!JSON.stringify(r).includes("recipientEmail"));
checks.push(
  "report-reads-do-not-mutate-domain-ledger-or-events-and-money-is-decimal-text-with-safe-projections",
);
sql(
  `DELETE FROM "UserSectorAccess" WHERE "userId"='__http_manager' AND "sectorId"='${sectorA}'`,
);
// More profiles than the current catalog first page: report options are a dedicated minimal projection.
const optionIds = Array.from({ length: 205 }, () => randomUUID());
sql(
  `BEGIN; INSERT INTO "Collaborator" (id,"tenantId","firstName","lastName","isActive") VALUES ${optionIds.map((id, i) => `('${id}','__http_a','Report ${String(i).padStart(2, "0")}','Synthetic',${i !== optionIds.length - 1})`).join(",")}; INSERT INTO "CollaboratorSector" ("collaboratorId","sectorId") VALUES ${optionIds.map((id) => `('${id}','${sectorA}')`).join(",")}; COMMIT;`,
);
const completeOptions = await report();
const firstCatalogPage = await call(
  "/collaborators?page=1&pageSize=200",
  undefined,
  { headers },
);
assert.equal(firstCatalogPage.items.length, 200);
assert.equal(firstCatalogPage.hasMore, true);
assert(
  optionIds.some((id) => !firstCatalogPage.items.some((row) => row.id === id)),
);

assert(
  optionIds.every((id) =>
    completeOptions.collaboratorOptions.some((row) => row.value === id),
  ),
);
assert(
  completeOptions.collaboratorOptions
    .find((row) => row.value === optionIds[optionIds.length - 1])
    .label.includes("non attivo"),
);
const otherSectorOptions = await report("", {
  headers: { ...headers, "x-alora-sector": sectorB },
});
assert(
  !optionIds.some((id) =>
    otherSectorOptions.collaboratorOptions.some((row) => row.value === id),
  ),
);
assert(
  completeOptions.collaboratorOptions.every(
    (row) => Object.keys(row).sort().join(",") === "label,value",
  ),
);
checks.push(
  "report-professional-selector-includes-all-profiles-beyond-catalog-first-page-and-inactive-history-without-pagination-or-appointment-editor-state",
);
const products = await call(
  "/dashboard/products?period=day&date=2026-02-10",
  undefined,
  { headers },
);
assert.equal(
  products.find((row) => row.productId === product.id).revenue,
  "500.00",
);
assert.equal(products.find((row) => row.productId === product.id).quantity, 5);
checks.push(
  "product-breakdown-reconciles-confirmed-unpaid-partial-and-historical-account-lines-without-appointment-values",
);
const activity = await call(
  "/dashboard/activity?period=all&pageSize=2",
  undefined,
  { headers },
);
const activity2 = await call(
  "/dashboard/activity?period=all&pageSize=2&page=2",
  undefined,
  { headers },
);
assert.equal(activity.items.length, 2);
assert.equal(activity.hasMore, true);
assert.equal(activity2.items.length, 2);
assert.equal(activity2.hasMore, false);
assert.equal(
  new Set([...activity.items, ...activity2.items].map((row) => row.orderId))
    .size,
  4,
);
assert(activity.items.every((row) => typeof row.amount === "string"));
const selectedActivity = await call(
  "/dashboard/activity?period=all",
  undefined,
  { headers: { ...headers, "x-alora-sector": sectorB } },
);
assert.equal(selectedActivity.items.length, 1);
assert.equal(selectedActivity.items[0].amount, "100.00");
const sectorTotals = await call("/locations/totals", undefined, { headers });
assert.equal(sectorTotals.registeredLineTotal, "500.00");
assert.equal(sectorTotals.basis, "confirmed-account-lines-gross-all-time");
checks.push(
  "account-activity-has-stable-database-pagination-with-selected-line-values-and-sector-selector-uses-confirmed-sales",
);
const executionSite = await call("/locations", {
  name: "Report execution site",
  sectorName: "Execution",
});
const executionSector = executionSite.sectors[0].id;
const executor = await call("/collaborators", {
  firstName: "Actual report",
  lastName: "Synthetic",
  sectorId: executionSector,
});
const executionService = await call("/services", {
  name: "Report synthetic execution",
  sectorId: executionSector,
  basePrice: "12.20",
  durationMinutes: 20,
  priceMode: "gross",
  vatRate: "22",
  requiresCollaborator: true,
  requiresRoom: false,
});
const execution = await call("/sales", {
  idempotencyKey: randomUUID(),
  customerId: "__http_customer",
  locationId: executionSite.id,
  soldAt: "2026-02-10T11:00:00Z",
  paymentStatus: "unpaid",
  items: [
    {
      serviceId: executionService.id,
      quantity: 1,
      sectorId: executionSector,
      collaboratorId: executor.id,
    },
  ],
});
const executionHeaders = { "x-alora-location": executionSite.id };
const personal = await call(
  "/dashboard/personal?period=day&date=2026-02-10&collaboratorId=" +
    executor.id,
  undefined,
  { headers: executionHeaders },
);
assert.equal(personal.values.registeredServiceLineTotal, "12.20");
assert.equal(personal.activity.attributedServices, 1);
const company = await call(
  "/dashboard/revenue?period=day&date=2026-02-10",
  undefined,
  { headers: executionHeaders },
);
assert.equal(
  company.byCollaborator.find((row) => row.id === executor.id).revenue,
  "12.20",
);
assert.equal(company.cash.net, "0.00");
const executionActivity = await call(
  "/dashboard/activity?period=all",
  undefined,
  { headers: executionHeaders },
);
assert.equal(
  executionActivity.items.filter((row) => row.orderId === execution.id).length,
  1,
);
assert.equal(executionActivity.items[0].kind, "combined");
checks.push(
  "actual-service-execution-is-counted-once-with-VAT-in-personal-and-company-values-without-inferred-cash",
);
// A legitimate legacy record with planning data is not proof of actual execution.
const oldAccount = randomUUID(),
  oldRow = randomUUID(),
  oldAppointment = randomUUID();
sql(`BEGIN;
INSERT INTO "Sale" (id,"tenantId","locationId","customerId",subtotal,total,"paymentBasis","soldAt") VALUES ('${oldAccount}','__http_a','${executionSite.id}','__http_customer',20,20,'legacy_unknown','2026-02-10T11:00:00Z');
INSERT INTO "SaleItem" (id,"saleId","sectorId","serviceId","collaboratorId",label,quantity,"unitPrice","lineTotal","priceMode","stockState") VALUES ('${oldRow}','${oldAccount}','${executionSector}','${executionService.id}','${executor.id}','Legacy planning',1,20,20,'legacy','legacy');
INSERT INTO "Appointment" (id,"tenantId","locationId","sectorId","customerId","serviceId","collaboratorId","startsAt","endsAt",status,"orderItemId","updatedAt") VALUES ('${oldAppointment}','__http_a','${executionSite.id}','${executionSector}','__http_customer','${executionService.id}','${executor.id}','2026-02-10T11:00:00Z','2026-02-10T11:20:00Z','confirmed','${oldRow}',now()); COMMIT;`);
const personalAfter = await call(
  "/dashboard/personal?period=day&date=2026-02-10&collaboratorId=" +
    executor.id,
  undefined,
  { headers: executionHeaders },
);
assert.equal(personalAfter.values.registeredServiceLineTotal, "12.20");
assert.equal(personalAfter.activity.attributedServices, 1);
const companyAfter = await call(
  "/dashboard/revenue?period=day&date=2026-02-10",
  undefined,
  { headers: executionHeaders },
);
assert.equal(companyAfter.sold.gross, "32.20");
assert.equal(
  companyAfter.byCollaborator.find((row) => row.id === executor.id).revenue,
  "12.20",
);
assert.equal(
  companyAfter.byCollaborator.find((row) => row.id === null).revenue,
  "20.00",
);
checks.push(
  "legacy-planned-professional-is-not-reinterpreted-as-performed-service-and-unknown-attribution-remains-visible",
);
const future = await call("/appointments", {
  idempotencyKey: randomUUID(),
  customerId: "__http_customer",
  lines: [
    {
      serviceId: executionService.id,
      collaboratorId: executor.id,
      startsAt: "2041-03-04T10:00:00Z",
    },
    {
      serviceId: executionService.id,
      collaboratorId: executor.id,
      startsAt: "2041-03-04T10:20:00Z",
    },
  ],
});
const futureDeposit = await pay(future.orderId, 0, "receive", [
  { amount: "10", method: "cash", receivedAt: "2026-02-10T14:00:00Z" },
]);
let openReport = await call("/dashboard/revenue?period=all", undefined, {
  headers: executionHeaders,
});
assert.equal(openReport.sold.gross, "32.20");
assert.equal(openReport.accounts.total, "36.60");
assert.equal(openReport.accounts.remaining, "26.60");
const beforeCancelActivity = await call(
  "/dashboard/activity?period=all",
  undefined,
  { headers: executionHeaders },
);
assert.equal(
  beforeCancelActivity.items.filter((row) => row.orderId === future.orderId)
    .length,
  1,
);
assert.equal(
  beforeCancelActivity.items.find((row) => row.orderId === future.orderId)
    .amountBasis,
  "planned-account-value",
);
const cancellation = await call(`/appointments/${future.id}/order/cancel`, {
  idempotencyKey: randomUUID(),
  revision: 1,
  reason: "Synthetic report cancellation with retained deposit",
});
assert.equal(cancellation.orderStatus, "cancelled");
const afterCancelReport = await call(
  "/dashboard/revenue?period=all",
  undefined,
  { headers: executionHeaders },
);
assert.equal(afterCancelReport.sold.gross, "32.20");
assert.equal(afterCancelReport.accounts.total, "12.20");
assert.equal(afterCancelReport.accounts.remaining, "12.20");
assert.equal(afterCancelReport.cash.net, "10.00");
await pay(
  future.orderId,
  cancellation.revision,
  "refund",
  [
    {
      amount: "5",
      method: "cash",
      receivedAt: "2026-02-10T14:30:00Z",
      refundOfId: futureDeposit.entries[0].id,
    },
  ],
  { reason: "Synthetic refund after cancellation" },
);
const afterCancelRefund = await call(
  "/dashboard/revenue?period=day&date=2026-02-10",
  undefined,
  { headers: executionHeaders },
);
assert.equal(afterCancelRefund.cash.net, "5.00");
assert.equal(afterCancelRefund.cash.refunds, "5.00");
checks.push(
  "open-and-cancelled-multi-service-account-is-not-sold-or-counted-twice-and-retained-deposit-refund-remains-real-period-cash",
);
// No sector can be inferred from an empty historical account.
const emptySite = await call("/locations", {
  name: "Report unattributed history",
  sectorName: "History A",
});
const emptySectorB = (
  await call(`/locations/${emptySite.id}/sectors`, { name: "History B" })
).id;
const emptyId = randomUUID();
sql(
  `INSERT INTO "Sale" (id,"tenantId","locationId",subtotal,total,"paymentBasis","soldAt") VALUES ('${emptyId}','__http_a','${emptySite.id}',17.13,17.13,'legacy_unknown','2026-02-10T11:00:00Z'); INSERT INTO "UserSectorAccess" ("userId","sectorId") VALUES ('__http_manager','${emptySite.sectors[0].id}');`,
);
const emptyHeaders = { "x-alora-location": emptySite.id };
const fullHistory = await call("/dashboard/revenue?period=all", undefined, {
  headers: emptyHeaders,
});
assert.equal(fullHistory.sold.gross, "17.13");
assert.equal(fullHistory.sold.linesGross, "0.00");
assert.equal(fullHistory.sold.unattributedGross, "17.13");
assert.deepEqual(fullHistory.bySector, []);
const limitedHistory = await call("/dashboard/revenue?period=all", undefined, {
  headers: emptyHeaders,
  subject: "manager",
});
assert.equal(limitedHistory.sold.gross, "0.00");
assert.equal(limitedHistory.sold.accounts, 0);
const limitedActivity = await call(
  "/dashboard/activity?period=all",
  undefined,
  { headers: emptyHeaders, subject: "manager" },
);
assert.equal(limitedActivity.items.length, 0);
sql(
  `DELETE FROM "UserSectorAccess" WHERE "userId"='__http_manager' AND "sectorId"='${emptySite.sectors[0].id}'`,
);
checks.push(
  "empty-historical-account-retains-original-total-as-unattributed-and-requires-full-location-scope-in-report-and-activity",
);
const result = {
  checkedAt: new Date().toISOString(),
  database: health.database,
  identity: "isolated-synthetic-http",
  mainDatabaseModified: false,
  realProviders: false,
  fixture: {
    locationId: site.id,
    sectorA,
    sectorB,
    productId: product.id,
    optionIds,
  },
  checks,
};
mkdirSync(".local/step13", { recursive: true, mode: 0o700 });
writeFileSync(
  ".local/step13/financial-http-result.json",
  JSON.stringify(result, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(result, null, 2));
