/** Data preservation and restore rehearsal, always on newly created disposable copies. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const stamp = Date.now(),
  directory = `.local/step9/migration-${stamp}`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
const beforeDb = `step9_before_${stamp}`,
  afterDb = `step9_after_${stamp}`,
  created = [];
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    stdio: "pipe",
    maxBuffer: 64 * 1024 * 1024,
  });
const sql = (db, q) =>
  docker(
    [
      "exec",
      "-i",
      "barber-postgres-1",
      "psql",
      "-X",
      "-U",
      "barber",
      "-d",
      db,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    q,
  )
    .toString()
    .trim();
const tables = [
  "Tenant",
  "User",
  "Collaborator",
  "CollaboratorWeeklySchedule",
  "CollaboratorDayOverride",
  "TenantHoliday",
  "Customer",
  "Service",
  "Room",
  "Appointment",
  "Product",
  "ServiceProduct",
  "Sale",
  "SaleItem",
  "AppointmentCancellation",
];
const snapshot = (db) =>
  Object.fromEntries(
    tables.map((t) => [
      t,
      JSON.parse(
        sql(db, `SELECT COALESCE(json_agg(t ORDER BY id),'[]') FROM "${t}" t`),
      ),
    ]),
  );
try {
  const baselineIndex = process.argv.indexOf("--baseline-dump");
  if (baselineIndex >= 0 && !process.argv[baselineIndex + 1])
    throw Error("Missing baseline dump path");
  const dump =
    baselineIndex >= 0
      ? readFileSync(process.argv[baselineIndex + 1])
      : docker([
          "exec",
          "barber-postgres-1",
          "pg_dump",
          "-U",
          "barber",
          "-d",
          "barber",
          "-Fc",
        ]);
  writeFileSync(`${directory}/before.dump`, dump, { mode: 0o600 });
  writeFileSync(
    `${directory}/backup-list.txt`,
    docker(["exec", "-i", "barber-postgres-1", "pg_restore", "--list"], dump),
    { mode: 0o600 },
  );
  for (const db of [beforeDb, afterDb]) {
    docker(["exec", "barber-postgres-1", "createdb", "-U", "barber", db]);
    created.push(db);
    docker(
      [
        "exec",
        "-i",
        "barber-postgres-1",
        "pg_restore",
        "-U",
        "barber",
        "-d",
        db,
        "--no-owner",
        "--exit-on-error",
      ],
      dump,
    );
  }
  assert.equal(
    sql(
      beforeDb,
      `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='Product' AND column_name='priceMode')`,
    ),
    "f",
    "Use the retained pre-Step-9 baseline dump after deployment",
  );
  sql(
    beforeDb,
    `INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('__inventory_fixture_a','Synthetic A','__inventory_fixture_a',now()),('__inventory_fixture_b','Synthetic B','__inventory_fixture_b',now());
    INSERT INTO "User" (id,"tenantId",email,"passwordHash","firstName","lastName",role,"updatedAt") VALUES ('__inventory_fixture_user','__inventory_fixture_a','inventory@example.invalid','synthetic-unusable','Synthetic','Owner','owner',now());
    INSERT INTO "Product" (id,"tenantId",name,price,"vatRate",cost) VALUES ('__inventory_fixture_product','__inventory_fixture_a','Legacy price',12.20,22,5),('__inventory_fixture_foreign','__inventory_fixture_b','Foreign product',NULL,NULL,NULL);
    INSERT INTO "Service" (id,"tenantId",name,"durationMinutes","basePrice","vatRate","requiresCollaborator") VALUES ('__inventory_fixture_service','__inventory_fixture_a','Legacy service',30,19.37,4,false);
    INSERT INTO "ServiceProduct" (id,"serviceId","productId",mode,quantity) VALUES ('__inventory_fixture_association','__inventory_fixture_service','__inventory_fixture_product','included',2);
    INSERT INTO "Customer" (id,"tenantId","firstName","lastName","updatedAt") VALUES ('__inventory_future_customer','__inventory_fixture_a','Synthetic','Future',now());
    INSERT INTO "Appointment" (id,"tenantId","customerId","serviceId","startsAt","endsAt",status,"estimatedPrice","updatedAt") VALUES ('__inventory_future_booking','__inventory_fixture_a','__inventory_future_customer','__inventory_fixture_service','2099-01-01T11:00:00Z','2099-01-01T11:30:00Z','confirmed',19.37,now());
    INSERT INTO "Sale" (id,"tenantId","customerId","appointmentId",subtotal,total,"orderStatus","orderOrigin","paymentStatus") VALUES ('__inventory_future_order','__inventory_fixture_a','__inventory_future_customer','__inventory_future_booking',19.37,19.37,'open','booking','unpaid');
    INSERT INTO "SaleItem" (id,"saleId","serviceId",label,quantity,"unitPrice","lineTotal") VALUES ('__inventory_future_line','__inventory_future_order','__inventory_fixture_service','Future planned service',1,19.37,19.37);
    UPDATE "Appointment" SET "orderItemId"='__inventory_future_line' WHERE id='__inventory_future_booking';`,
  );
  const fixtureDump = docker([
    "exec",
    "barber-postgres-1",
    "pg_dump",
    "-U",
    "barber",
    "-d",
    beforeDb,
    "-Fc",
  ]);
  docker(
    [
      "exec",
      "-i",
      "barber-postgres-1",
      "pg_restore",
      "-U",
      "barber",
      "-d",
      afterDb,
      "--clean",
      "--if-exists",
      "--no-owner",
      "--exit-on-error",
    ],
    fixtureDump,
  );
  const before = snapshot(beforeDb);
  docker(["exec", "barber-api-1", "mkdir", "-p", "/tmp/alora-step9/prisma"]);
  docker(["cp", "prisma/.", "barber-api-1:/tmp/alora-step9/prisma/"]);
  const deploy = () =>
    docker([
      "exec",
      "barber-api-1",
      "node",
      "-e",
      `const {execFileSync}=require('node:child_process');const u=new URL(process.env.DATABASE_URL);u.pathname='/${afterDb}';execFileSync(process.execPath,['/app/node_modules/prisma/build/index.js','migrate','deploy','--schema','/tmp/alora-step9/prisma/schema.prisma'],{env:{...process.env,DATABASE_URL:u.href},stdio:'pipe'});`,
    ]);
  deploy();
  const after = snapshot(afterDb);
  for (const table of tables) {
    assert.equal(
      after[table].length,
      before[table].length,
      `${table} count changed`,
    );
    for (const row of before[table]) {
      const current = after[table].find((r) => r.id === row.id);
      assert(current);
      for (const key of Object.keys(row))
        assert.deepEqual(current[key], row[key], `${table}.${key} changed`);
    }
  }
  assert.equal(
    sql(
      afterDb,
      `SELECT (SELECT count(*) FROM "StockBalance")+(SELECT count(*) FROM "StockMovement")+(SELECT count(*) FROM "InventoryOperation")`,
    ),
    "0",
  );
  assert.equal(
    sql(
      afterDb,
      `SELECT count(*) FROM "Product" WHERE "priceMode"<>'legacy' OR "stockTracked"`,
    ),
    "0",
  );
  assert.equal(
    sql(
      afterDb,
      `SELECT count(*) FROM "SaleItem" WHERE "priceMode"<>'legacy' OR "stockState" NOT IN ('legacy','pending') OR "lineSubtotal" IS NOT NULL OR "discountNet" IS NOT NULL`,
    ),
    "0",
  );
  assert.equal(
    sql(
      afterDb,
      `SELECT count(*) FROM "ServiceProduct" WHERE "consumptionUnits" IS NOT NULL`,
    ),
    "0",
  );
  assert.equal(
    sql(
      afterDb,
      `SELECT "stockState" FROM "SaleItem" WHERE id='__inventory_future_line'`,
    ),
    "pending",
  );
  assert.equal(
    sql(
      afterDb,
      `SELECT count(*) FROM "SaleItem" i JOIN "Sale" s ON s.id=i."saleId" WHERE s."orderStatus"='confirmed' AND i."stockState"<>'legacy'`,
    ),
    "0",
  );
  const expectedHistory = before.Product.length + before.Service.length;
  assert.equal(
    Number(
      sql(
        afterDb,
        `SELECT count(*) FROM "CatalogPriceHistory" WHERE source='migration_observation' AND "actorUserId" IS NULL`,
      ),
    ),
    expectedHistory,
  );
  const appliedPrices = before.SaleItem.length;
  assert.equal(
    Number(
      sql(
        afterDb,
        `SELECT count(*) FROM "OrderPriceRevision" WHERE source='migration_observation'`,
      ),
    ),
    appliedPrices,
  );
  deploy();
  assert.deepEqual(snapshot(afterDb), after);
  assert.equal(
    Number(sql(afterDb, `SELECT count(*) FROM "CatalogPriceHistory"`)),
    expectedHistory,
  );
  assert.equal(
    Number(sql(afterDb, `SELECT count(*) FROM "OrderPriceRevision"`)),
    appliedPrices,
  );
  const proof = sql(
    afterDb,
    readFileSync(
      new URL("./verify-pricing-inventory-fixtures.sql", import.meta.url),
      "utf8",
    ),
  );
  const report = {
    checkedAt: new Date().toISOString(),
    sourceDatabaseModified: false,
    restoreVerified: true,
    reapplied: true,
    originalFieldsPreserved: true,
    tablesCompared: tables.length,
    initialInventoryRows: 0,
    historicalRepricing: false,
    priceObservations: expectedHistory,
    appliedPriceObservations: appliedPrices,
    assertions: [
      "PASS:all-original-fields-counts-and-financial-values-preserved",
      "PASS:no-invented-stock-consumption-vat-mode-or-historical-price-events",
      "PASS:only-future-open-booked-work-pending-for-first-delivery",
      "PASS:reapplication-does-not-duplicate-price-observations",
      ...proof.split("\n").filter((x) => x.startsWith("PASS:")),
    ],
    backup: `${directory}/before.dump`,
  };
  writeFileSync(
    `${directory}/result.json`,
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      { evidence: `${directory}/result.json`, ...report },
      null,
      2,
    ),
  );
} finally {
  for (const db of created.reverse())
    docker(["exec", "barber-postgres-1", "dropdb", "-U", "barber", db]);
}
