/** Rehearsal on new disposable copies only; never applies to the source database. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
const stamp = Date.now();
const directory = `.local/step8/migration-${stamp}`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
const databases = [`step8_before_${stamp}`, `step8_after_${stamp}`];
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    stdio: "pipe",
    maxBuffer: 64 * 1024 * 1024,
  });
const sql = (db, query) =>
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
    query,
  )
    .toString()
    .trim();
const created = [];
const tables = [
  "Tenant",
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
const oldRevenue = `SELECT COALESCE((SELECT sum(total) FROM "Sale" WHERE "paymentStatus" IN ('paid','partial')),0) + COALESCE((SELECT sum(COALESCE(a."finalPrice",a."estimatedPrice",0)) FROM "Appointment" a WHERE status='completed' AND NOT EXISTS(SELECT 1 FROM "Sale" s WHERE s."appointmentId"=a.id)),0)`;
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
  for (const db of databases) {
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
  const [beforeDb, afterDb] = databases;
  if (
    sql(
      beforeDb,
      `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='Appointment' AND column_name='orderItemId')`,
    ) === "t"
  )
    throw Error(
      "Requires the pre-Step-8 source baseline; use its retained dump after deployment",
    );
  const fixtures = readFileSync(
    new URL("./verify-operational-order-legacy-fixtures.sql", import.meta.url),
    "utf8",
  );
  sql(beforeDb, fixtures);
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
  const before = snapshot(beforeDb),
    revenueBefore = sql(beforeDb, oldRevenue);
  docker(["exec", "barber-api-1", "mkdir", "-p", "/tmp/alora-step8/prisma"]);
  docker(["cp", "prisma/.", "barber-api-1:/tmp/alora-step8/prisma/"]);
  const deploy = () =>
    docker([
      "exec",
      "barber-api-1",
      "node",
      "-e",
      `const {execFileSync}=require('node:child_process');const u=new URL(process.env.DATABASE_URL);u.pathname='/${afterDb}';execFileSync(process.execPath,['/app/node_modules/prisma/build/index.js','migrate','deploy','--schema','/tmp/alora-step8/prisma/schema.prisma'],{env:{...process.env,DATABASE_URL:u.href},stdio:'pipe'});`,
    ]);
  deploy();
  const after = snapshot(afterDb);
  for (const table of tables)
    for (const row of before[table]) {
      const current = after[table].find((r) => r.id === row.id);
      assert(current, `Missing ${table} ID`);
      for (const key of Object.keys(row))
        assert.deepEqual(current[key], row[key], `${table}.${key} changed`);
    }
  const revenueAfter = sql(
    afterDb,
    oldRevenue.replace(
      `WHERE s."appointmentId"=a.id`,
      `WHERE s."appointmentId"=a.id AND NOT(s."orderOrigin"='legacy_appointment' AND s."orderStatus"='open')`,
    ),
  );
  assert.equal(revenueAfter, revenueBefore);
  deploy();
  assert.deepEqual(snapshot(afterDb), after, "Reapplication changed data");
  assert.equal(
    sql(
      afterDb,
      `SELECT count(*) FROM "Appointment" WHERE "orderItemId" IS NULL AND "orderIssue" IS NULL`,
    ),
    "0",
  );
  const assertions = sql(
    afterDb,
    readFileSync(
      new URL("./verify-operational-order-fixtures.sql", import.meta.url),
      "utf8",
    ),
  );
  const mappingPath = `${directory}/mapping.json`;
  writeFileSync(
    mappingPath,
    JSON.stringify([
      {
        appointmentId: "__order_duplicate",
        saleItemId: "__order_duplicate_sale_a_line",
      },
      {
        appointmentId: "__order_no_match",
        saleItemId: "__order_linked_sale_line",
      },
    ]),
    { mode: 0o600 },
  );
  const apply = () =>
    execFileSync(
      process.execPath,
      [
        "scripts/reconcile-operational-orders.mjs",
        "--database",
        afterDb,
        "--apply",
        mappingPath,
      ],
      { stdio: "pipe" },
    );
  let rejected = false;
  try {
    apply();
  } catch {
    rejected = true;
  }
  assert(rejected);
  assert.equal(
    sql(
      afterDb,
      `SELECT "orderIssue" FROM "Appointment" WHERE id='__order_duplicate'`,
    ),
    "multiple-sales",
    "Failed mapping batch partially applied",
  );
  writeFileSync(
    mappingPath,
    JSON.stringify([
      {
        appointmentId: "__order_duplicate",
        saleItemId: "__order_duplicate_sale_a_line",
      },
    ]),
    { mode: 0o600 },
  );
  apply();
  apply();
  assert.equal(
    sql(
      afterDb,
      `SELECT "orderItemId" FROM "Appointment" WHERE id='__order_duplicate'`,
    ),
    "__order_duplicate_sale_a_line",
  );
  const reconciled = snapshot(afterDb);
  for (const table of tables)
    for (const row of before[table])
      for (const key of Object.keys(row))
        assert.deepEqual(
          reconciled[table].find((r) => r.id === row.id)[key],
          row[key],
          "Reconciliation changed original data",
        );
  const report = {
    checkedAt: new Date().toISOString(),
    sourceDatabaseModified: false,
    restoreVerified: true,
    reapplied: true,
    originalTablesCompared: tables.length,
    originalFieldsPreserved: true,
    historicalRevenueBefore: revenueBefore,
    historicalRevenueAfter: revenueAfter,
    assertions: assertions
      .split("\n")
      .filter((x) => x.startsWith("PASS:"))
      .concat([
        "PASS:explicit-mapping-is-atomic-repeatable-and-preserves-all-original-fields",
      ]),
    issues: JSON.parse(
      sql(
        afterDb,
        `SELECT COALESCE(json_agg(t),'[]') FROM (SELECT "orderIssue",count(*) FROM "Appointment" WHERE "orderIssue" IS NOT NULL GROUP BY "orderIssue") t`,
      ),
    ),
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
