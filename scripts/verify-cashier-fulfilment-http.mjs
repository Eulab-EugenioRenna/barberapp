/** Actual isolated HTTP/PostgreSQL transactions. No Connect identities or providers. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
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
const read = (query) => JSON.parse(sql(query));
async function call(route, body, { method, status, subject = "owner" } = {}) {
  const response = await fetch(base + route, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Authorization: "Bearer " + subject,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    status ?? (body && !method ? 201 : 200),
    route + ": " + JSON.stringify(data),
  );
  return data;
}
const checks = [],
  stamp = Date.now();
const site = await call("/locations", {
  name: "Cashier synthetic " + stamp,
  sectorName: "Execution sector",
});
const sectorId = site.sectors[0].id;
const planned = await call("/collaborators", {
  firstName: "Scheduled",
  lastName: "Synthetic " + stamp,
  sectorId,
  isPublic: true,
});
const actual = await call("/collaborators", {
  firstName: "Actual",
  lastName: "Synthetic " + stamp,
  sectorId,
  isPublic: true,
});
const services = [];
for (const [name, basePrice, durationMinutes] of [
  ["S", "20", 20],
  ["T", "15", 15],
  ["U", "5", 5],
  ["V", "10", 10],
]) {
  services.push(
    await call("/services", {
      name: `Execution ${name} ${stamp}`,
      sectorId,
      basePrice,
      durationMinutes,
      priceMode: "gross",
      vatRate: "0",
      requiresCollaborator: true,
      requiresRoom: false,
      isPublic: true,
      isBookableOnline: true,
    }),
  );
}
const [s, t, u, v] = services;
const consumable = await call("/products", {
  name: "Execution consumable " + stamp,
  price: "1",
  priceMode: "gross",
  vatRate: "0",
  stockTracked: true,
});
const retail = await call("/products", {
  name: "Execution retail " + stamp,
  price: "10",
  priceMode: "gross",
  vatRate: "0",
  stockTracked: true,
});
for (const productId of [consumable.id, retail.id])
  await call("/inventory/operations", {
    idempotencyKey: randomUUID(),
    kind: "opening",
    locationId: site.id,
    productId,
    quantity: "100",
    unitCost: "1",
    reason: "Synthetic known stock",
  });
for (const [service, quantity] of [
  [s, "1"],
  [t, "2"],
  [u, "3"],
  [v, "2"],
])
  await call(`/services/${service.id}/products`, {
    productId: consumable.id,
    mode: "optional",
    consumptionUnits: quantity,
  });
const oldDefault = read(
  `SELECT coalesce(to_json("defaultCollaboratorId")::text,'null') FROM "Tenant" WHERE id='__http_a'`,
);
sql(
  `UPDATE "Tenant" SET "defaultCollaboratorId"='${planned.id}' WHERE id='__http_a'`,
);
let booking, sale;
const get = (id) => call(`/sales/${id}`);
const rows = (account) =>
  account.items.map((row) => ({
    id: row.id,
    serviceId: row.serviceId || undefined,
    productId: row.productId || undefined,
    quantity: row.quantity,
    sectorId: row.sectorId,
  }));
const patch = (account, items, extra = {}) => ({
  idempotencyKey: randomUUID(),
  revision: account.revision,
  items,
  ...extra,
});
const update = (id, body, status = 200, subject = "owner") =>
  call(`/sales/${id}`, body, { method: "PATCH", status, subject });
const snapshot = (id) =>
  sql(
    `SELECT json_build_array((SELECT to_jsonb(x) FROM "Sale" x WHERE id='${id}'),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM "SaleItem" x WHERE "saleId"='${id}'),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM "Appointment" x WHERE "orderItemId" IN (SELECT id FROM "SaleItem" WHERE "saleId"='${id}')),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM "StockMovement" x WHERE "saleId"='${id}'),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM "OrderOperation" x WHERE "saleId"='${id}'),(SELECT count(*) FROM "OrderPriceRevision" WHERE "saleId"='${id}'))`,
  );
try {
  await call(
    "/sales",
    {
      idempotencyKey: randomUUID(),
      locationId: site.id,
      customerId: "__http_customer",
      collaboratorId: planned.id,
      paymentStatus: "unpaid",
      items: [{ serviceId: u.id }],
    },
    { status: 400 },
  );
  const standalone = await call("/sales", {
    idempotencyKey: randomUUID(),
    locationId: site.id,
    customerId: "__http_customer",
    paymentStatus: "unpaid",
    soldAt: "2025-11-04T14:15:00Z",
    items: [
      { serviceId: u.id, collaboratorId: actual.id },
      { serviceId: v.id, collaboratorId: actual.id },
    ],
  });
  const executions = read(
    `SELECT json_agg(json_build_object('service',"serviceId",'actor',"collaboratorId",'duration',extract(epoch FROM ("endsAt"-"startsAt"))/60,'status',status) ORDER BY "startsAt") FROM "Appointment" WHERE "orderItemId" IN (SELECT id FROM "SaleItem" WHERE "saleId"='${standalone.id}')`,
  );
  assert.deepEqual(executions, [
    { service: u.id, actor: actual.id, duration: 5, status: "completed" },
    { service: v.id, actor: actual.id, duration: 10, status: "completed" },
  ]);
  assert.equal(
    Number(
      sql(
        `SELECT extract(epoch FROM max("endsAt")) FROM "Appointment" WHERE "orderItemId" IN (SELECT id FROM "SaleItem" WHERE "saleId"='${standalone.id}')`,
      ),
    ),
    Date.parse("2025-11-04T14:15:00Z") / 1000,
  );
  checks.push(
    "standalone-each-service-has-own-completed-execution-and-explicit-performer-no-tenant-or-root-default",
  );
  booking = await call("/appointments", {
    idempotencyKey: randomUUID(),
    customerId: "__http_customer",
    lines: [
      {
        serviceId: s.id,
        startsAt: "2040-01-04T10:00:00Z",
        collaboratorId: planned.id,
      },
      {
        serviceId: t.id,
        startsAt: "2040-01-04T10:30:00Z",
        collaboratorId: planned.id,
      },
    ],
  });
  sale = await get(booking.orderId);
  const tBooking = read(
    `SELECT json_build_object('id',id) FROM "Appointment" WHERE "orderItemId" IN (SELECT id FROM "SaleItem" WHERE "saleId"='${sale.id}' AND "serviceId"='${t.id}')`,
  );
  await call(`/sales/${sale.id}/payments`, {
    idempotencyKey: randomUUID(),
    revision: sale.revision,
    kind: "receive",
    entries: [{ amount: "7", method: "cash" }],
  });
  sale = await get(sale.id);
  await call(`/appointments/${tBooking.id}/cancel`, {
    idempotencyKey: randomUUID(),
    revision: sale.revision,
    reason: "Synthetic single cancellation",
  });
  sale = await get(sale.id);
  assert.equal(sale.orderStatus, "open");
  const originalRows = rows(sale);
  const open = patch(
    sale,
    [
      ...originalRows,
      { serviceId: u.id },
      { productId: retail.id, quantity: 2, sectorId },
    ],
    { orderStatus: "open" },
  );
  await update(sale.id, open);
  sale = await get(sale.id);
  assert(
    sale.items
      .filter((row) => row.serviceId)
      .every((row) => !row.collaboratorId),
  );
  assert.equal(
    sql(`SELECT count(*) FROM "StockMovement" WHERE "saleId"='${sale.id}'`),
    "0",
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM "Appointment" WHERE "orderItemId" IN (SELECT id FROM "SaleItem" WHERE "saleId"='${sale.id}' AND "serviceId"='${u.id}')`,
    ),
    "0",
  );
  checks.push(
    "open-counter-keeps-unknown-actual-performers-and-added-services-without-execution-stock-or-inferred-receipt",
  );
  const before = snapshot(sale.id);
  await update(sale.id, patch(sale, rows(sale)), 400);
  assert.equal(snapshot(sale.id), before);
  const actualRows = rows(sale).map((row) =>
    row.serviceId && row.serviceId !== t.id
      ? { ...row, collaboratorId: actual.id }
      : row,
  );
  await update(sale.id, patch(sale, actualRows), 400);
  assert.equal(snapshot(sale.id), before);
  const checkout = patch(
    sale,
    actualRows.map((row) =>
      row.serviceId === t.id
        ? {
            ...row,
            nonPerformanceChargeReason: "Explicit retained cancellation fee",
          }
        : row,
    ),
  );
  await call("/__qa/fail-next-sale-ack", {}, { status: 200 });
  await update(sale.id, checkout, 500);
  assert.equal(
    snapshot(sale.id),
    before,
    "Failure after ack/stock/execution writes must roll back all domain changes",
  );
  const ack = await update(sale.id, checkout);
  assert.deepEqual(await update(sale.id, checkout), ack);
  await update(sale.id, { ...checkout, items: checkout.items.slice(1) }, 409);
  sale = await get(sale.id);
  assert.equal(sale.orderStatus, "confirmed");
  assert.equal(Number(sale.total), 60);
  const completed = read(
    `SELECT json_agg(json_build_object('service',i."serviceId",'actual',i."collaboratorId",'planned',a."collaboratorId",'status',a.status,'duration',extract(epoch FROM (a."endsAt"-a."startsAt"))/60) ORDER BY i."serviceId") FROM "SaleItem" i JOIN "Appointment" a ON a."orderItemId"=i.id WHERE i."saleId"='${sale.id}'`,
  );
  assert.deepEqual(
    completed.find((row) => row.service === s.id),
    {
      service: s.id,
      actual: actual.id,
      planned: planned.id,
      status: "completed",
      duration: 20,
    },
  );
  assert.deepEqual(
    completed.find((row) => row.service === u.id),
    {
      service: u.id,
      actual: actual.id,
      planned: actual.id,
      status: "completed",
      duration: 5,
    },
  );
  assert.deepEqual(
    completed.find((row) => row.service === t.id),
    {
      service: t.id,
      actual: null,
      planned: planned.id,
      status: "cancelled",
      duration: 15,
    },
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM "StockMovement" WHERE "saleItemId" IN (SELECT id FROM "SaleItem" WHERE "saleId"='${sale.id}' AND "serviceId"='${t.id}')`,
    ),
    "0",
  );
  const issues = read(
    `SELECT json_object_agg("productId",quantity) FROM (SELECT "productId",sum("quantityDelta") quantity FROM "StockMovement" WHERE "saleId"='${sale.id}' GROUP BY "productId") x`,
  );
  assert.equal(Number(issues[consumable.id]), -4);
  assert.equal(Number(issues[retail.id]), -2);
  const ledger = await call(`/sales/${sale.id}/payments`);
  assert.equal(ledger.items.length, 1);
  assert.equal(ledger.summary.netReceived, "7.00");
  checks.push(
    "partial-cancellation-checkout-explicit-fee-preserves-planned-actor-actual-execution-and-single-deposit-without-consuming-cancelled-service",
  );
  checks.push(
    "post-write-failure-rolls-back-rows-executions-stock-price-history-and-ack-same-key-retry-and-replay-create-no-duplicates",
  );
  await call(
    `/collaborators/${actual.id}`,
    { isActive: false },
    { method: "PATCH" },
  );
  await update(sale.id, patch(sale, rows(sale)));
  sale = await get(sale.id);
  const inactiveActorBefore = snapshot(sale.id);
  await update(
    sale.id,
    patch(sale, [
      ...rows(sale),
      { serviceId: v.id, collaboratorId: actual.id },
    ]),
    400,
  );
  assert.equal(snapshot(sale.id), inactiveActorBefore);
  await call(
    `/collaborators/${actual.id}`,
    { isActive: true },
    { method: "PATCH" },
  );
  const beforeAppend = snapshot(sale.id);
  await update(sale.id, patch(sale, [...rows(sale), { serviceId: v.id }]), 400);
  assert.equal(snapshot(sale.id), beforeAppend);
  await update(
    sale.id,
    patch(sale, [
      ...rows(sale),
      { serviceId: v.id, collaboratorId: actual.id, quantity: 2 },
    ]),
    400,
  );
  const append = patch(sale, [
    ...rows(sale),
    { serviceId: v.id, collaboratorId: actual.id },
  ]);
  const appendAck = await update(sale.id, append);
  await call(
    `/services/${v.id}`,
    { basePrice: "12", priceChangeReason: "Synthetic catalog change" },
    { method: "PATCH" },
  );
  assert.deepEqual(
    await update(sale.id, append),
    appendAck,
    "Replay must use original acknowledgement after catalog changes",
  );
  sale = await get(sale.id);
  for (const [route, addition] of [
    [`/services/${v.id}`, { serviceId: v.id, collaboratorId: actual.id }],
    [`/products/${retail.id}`, { productId: retail.id, quantity: 1, sectorId }],
  ]) {
    await call(route, { isActive: false }, { method: "PATCH" });
    const unchangedInactive = snapshot(sale.id);
    await update(sale.id, patch(sale, [...rows(sale), addition]), 400);
    assert.equal(snapshot(sale.id), unchangedInactive);
    await call(route, { isActive: true }, { method: "PATCH" });
  }
  checks.push(
    "retained-inactive-performer-and-catalog-items-stay-on-own-historical-rows-without-authorizing-new-performances-or-duplicate-inactive-articles",
  );
  assert.equal(Number(sale.total), 70);
  assert.equal(
    sql(
      `SELECT count(*) FROM "Appointment" WHERE "orderItemId" IN (SELECT id FROM "SaleItem" WHERE "saleId"='${sale.id}')`,
    ),
    "4",
  );
  for (const row of originalRows)
    assert(sale.items.some((current) => current.id === row.id));
  checks.push(
    "adding-service-to-confirmed-account-requires-explicit-actor-and-separate-row-creates-exactly-one-new-execution-stable-existing-ids-and-catalog-independent-replay",
  );
  // Synthetic historical inconsistency: preserve an already consumed service after cancellation.
  const sItem = sale.items.find((row) => row.serviceId === s.id);
  sql(
    `UPDATE "Appointment" SET status='confirmed' WHERE "orderItemId"='${sItem.id}' AND "tenantId"='__http_a'`,
  );
  const sAppointment = read(
    `SELECT json_build_object('id',id) FROM "Appointment" WHERE "orderItemId"='${sItem.id}'`,
  );
  await call(`/appointments/${sAppointment.id}/cancel`, {
    idempotencyKey: randomUUID(),
    revision: sale.revision,
    reason: "Synthetic historical nonperformance",
  });
  sale = await get(sale.id);
  assert.equal(sale.orderStatus, "confirmed");
  const priorIssues = sql(
    `SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM "StockMovement" x WHERE "saleItemId"='${sItem.id}'`,
  );
  await update(
    sale.id,
    patch(
      sale,
      rows(sale).map((row) =>
        row.productId === retail.id ? { ...row, quantity: 3 } : row,
      ),
    ),
  );
  assert.equal(
    sql(
      `SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM "StockMovement" x WHERE "saleItemId"='${sItem.id}'`,
    ),
    priorIssues,
  );
  const sourceIssue = read(
    `SELECT json_build_object('id',id) FROM "StockMovement" WHERE "saleItemId"='${sItem.id}' AND kind='consumption'`,
  );
  await call("/inventory/operations", {
    idempotencyKey: randomUUID(),
    kind: "return",
    locationId: site.id,
    productId: consumable.id,
    quantity: "1",
    returnOfId: sourceIssue.id,
    reason: "Explicit synthetic physical return",
  });
  sale = await get(sale.id);
  const afterReturn = sql(
    `SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM "StockMovement" x WHERE "saleItemId"='${sItem.id}'`,
  );
  await update(
    sale.id,
    patch(
      sale,
      rows(sale).map((row) =>
        row.productId === retail.id ? { ...row, quantity: 4 } : row,
      ),
    ),
  );
  assert.equal(
    sql(
      `SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM "StockMovement" x WHERE "saleItemId"='${sItem.id}'`,
    ),
    afterReturn,
  );
  checks.push(
    "unchanged-historical-cancelled-charge-allows-unrelated-retail-edit-preserves-prior-consumption-and-does-not-reissue-explicitly-returned-stock",
  );
  // Legacy confirmed row with unknown execution remains unknown on unrelated product changes.
  const legacy = randomUUID(),
    legacyRow = randomUUID();
  sql(
    `BEGIN; INSERT INTO "Sale" (id,"tenantId","locationId","customerId",subtotal,total,"paymentBasis","soldAt") VALUES ('${legacy}','__http_a','${site.id}','__http_customer',20,20,'legacy_unknown',now()); INSERT INTO "SaleItem" (id,"saleId","sectorId","serviceId",label,quantity,"unitPrice","lineTotal","priceMode","stockState") VALUES ('${legacyRow}','${legacy}','${sectorId}','${s.id}','Legacy unknown',1,20,20,'legacy','legacy'); COMMIT;`,
  );
  let historical = await get(legacy);
  await update(
    legacy,
    patch(historical, [
      ...rows(historical),
      { productId: retail.id, quantity: 1, sectorId },
    ]),
  );
  historical = await get(legacy);
  assert.equal(
    historical.items.find((row) => row.id === legacyRow).collaboratorId,
    null,
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM "Appointment" WHERE "orderItemId"='${legacyRow}'`,
    ),
    "0",
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM "StockMovement" WHERE "saleItemId"='${legacyRow}'`,
    ),
    "0",
  );
  assert.equal(
    sql(`SELECT count(*) FROM "PaymentEntry" WHERE "saleId"='${legacy}'`),
    "0",
  );
  checks.push(
    "legacy-confirmed-unknown-performer-execution-stock-and-receipts-are-never-backfilled-by-unrelated-edit",
  );
  const unresolvedBooking = randomUUID();
  sql(
    `INSERT INTO "Appointment" (id,"tenantId","locationId","sectorId","customerId","serviceId","collaboratorId","startsAt","endsAt",status,"orderItemId","updatedAt") VALUES ('${unresolvedBooking}','__http_a','${site.id}','${sectorId}','__http_customer','${s.id}','${planned.id}','2043-01-04T10:00:00Z','2043-01-04T10:20:00Z','confirmed','${legacyRow}',now())`,
  );
  await update(
    legacy,
    patch(
      historical,
      rows(historical).map((row) =>
        row.productId === retail.id ? { ...row, quantity: 2 } : row,
      ),
    ),
  );
  assert.equal(
    sql(`SELECT status FROM "Appointment" WHERE id='${unresolvedBooking}'`),
    "confirmed",
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM "StockMovement" WHERE "saleItemId"='${legacyRow}'`,
    ),
    "0",
  );
  assert.equal(
    (await get(legacy)).items.find((row) => row.id === legacyRow)
      .collaboratorId,
    null,
  );
  checks.push(
    "legacy-confirmed-account-with-unresolved-booking-status-does-not-silently-declare-execution-on-retail-edit",
  );
  sale = await get(sale.id);
  const concurrent = patch(
    sale,
    rows(sale).map((row) =>
      row.productId === retail.id ? { ...row, quantity: 5 } : row,
    ),
  );
  const concurrentAcks = await Promise.all([
    update(sale.id, concurrent),
    update(sale.id, concurrent),
  ]);
  assert.deepEqual(concurrentAcks[0], concurrentAcks[1]);
  await update(sale.id, concurrent, 409, "cashier");
  sale = await get(sale.id);
  const race = [6, 7].map((quantity) =>
    patch(
      sale,
      rows(sale).map((row) =>
        row.productId === retail.id ? { ...row, quantity } : row,
      ),
    ),
  );
  const raced = await Promise.all(
    race.map(async (body) => {
      const response = await fetch(`${base}/sales/${sale.id}`, {
        method: "PATCH",
        headers: {
          Authorization: "Bearer owner",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }),
  );
  assert.deepEqual(raced.map((row) => row.status).sort(), [200, 409]);
  assert.equal((await get(sale.id)).revision, sale.revision + 1);
  assert.equal(
    sql(
      `SELECT count(*) FROM "OrderOperation" WHERE "saleId"='${sale.id}' AND "idempotencyKey" IN ('${race[0].idempotencyKey}','${race[1].idempotencyKey}')`,
    ),
    "1",
  );
  checks.push(
    "concurrent-sale-update-same-key-replays-once-distinct-keys-with-same-revision-have-one-winner-and-ack-is-actor-bound",
  );
  const zeroBooking = await call("/appointments", {
    idempotencyKey: randomUUID(),
    customerId: "__http_customer",
    lines: [
      {
        serviceId: s.id,
        startsAt: "2042-01-04T10:00:00Z",
        collaboratorId: planned.id,
      },
      {
        serviceId: t.id,
        startsAt: "2042-01-04T11:00:00Z",
        collaboratorId: planned.id,
      },
    ],
  });
  let zeroAccount = await get(zeroBooking.orderId);
  const zeroCancelled = zeroAccount.items.find((row) => row.serviceId === t.id);
  await call(`/appointments/${zeroCancelled.booking.id}/cancel`, {
    idempotencyKey: randomUUID(),
    revision: zeroAccount.revision,
    reason: "Synthetic no-charge cancellation",
  });
  zeroAccount = await get(zeroAccount.id);
  await update(
    zeroAccount.id,
    patch(
      zeroAccount,
      rows(zeroAccount).map((row) =>
        row.serviceId === t.id
          ? {
              ...row,
              unitPrice: "0",
              priceOverrideReason: "Explicitly waived cancelled service",
              nonPerformanceChargeReason: null,
            }
          : { ...row, collaboratorId: actual.id },
      ),
    ),
  );
  zeroAccount = await get(zeroAccount.id);
  assert.equal(Number(zeroAccount.total), 20);
  assert.equal(
    zeroAccount.items.find((row) => row.id === zeroCancelled.id).booking.status,
    "cancelled",
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM "StockMovement" WHERE "saleItemId"='${zeroCancelled.id}'`,
    ),
    "0",
  );
  checks.push(
    "explicit-zero-price-waives-cancelled-service-without-a-fee-or-implicit-stock-movement",
  );
  await update(sale.id, { items: rows(sale) }, 400);
  const restricted = patch(await get(sale.id), rows(await get(sale.id)));
  await update(sale.id, restricted, 403, "foreign");
  await update(sale.id, restricted, 403, "manager");
  await update(sale.id, restricted, 401, "unknown");
  checks.push(
    "sale-update-requires-recovery-key-and-enforces-tenant-and-authenticated-write-isolation",
  );
} finally {
  sql(
    `UPDATE "Tenant" SET "defaultCollaboratorId"=${oldDefault ? `'${oldDefault}'` : "NULL"} WHERE id='__http_a'`,
  );
}
mkdirSync(".local/step10", { recursive: true });
const result = {
  checkedAt: new Date().toISOString(),
  database: health.database,
  checks,
  fixture: {
    locationId: site.id,
    sectorId,
    plannedId: planned.id,
    actualId: actual.id,
    serviceIds: services.map((row) => row.id),
    consumableId: consumable.id,
    retailId: retail.id,
  },
};
writeFileSync(
  ".local/step10/cashier-fulfilment-http-result.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
