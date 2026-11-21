/** Restore/migration rehearsal. Never applies a migration to the main database. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const stamp = Date.now(),
  directory = `.local/step10/migration-${stamp}`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
const database = `step10_migration_${stamp}`;
const docker = (args, input) =>
  execFileSync("docker", args, {
    input,
    stdio: "pipe",
    maxBuffer: 64 * 1024 * 1024,
  });
const sql = (q) =>
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
      database,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    q,
  )
    .toString()
    .trim();
const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
let created = false;
try {
  const baseline = process.argv.indexOf("--baseline-dump");
  if (baseline >= 0 && !process.argv[baseline + 1])
    throw Error("Missing dump path");
  const dump =
    baseline >= 0
      ? readFileSync(process.argv[baseline + 1])
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
  docker(["exec", "barber-postgres-1", "createdb", "-U", "barber", database]);
  created = true;
  const restore = () =>
    docker(
      [
        "exec",
        "-i",
        "barber-postgres-1",
        "pg_restore",
        "-U",
        "barber",
        "-d",
        database,
        "--clean",
        "--if-exists",
        "--no-owner",
        "--exit-on-error",
      ],
      dump,
    );
  restore();
  assert.equal(
    sql(
      `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='Sale' AND column_name='paymentBasis')`,
    ),
    "f",
    "Supply retained pre-Step-10 dump after deployment",
  );
  const columns = JSON.parse(
    sql(
      `SELECT json_object_agg(t,c) FROM (SELECT table_name t,json_agg(column_name ORDER BY ordinal_position) c FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' GROUP BY table_name) x`,
    ),
  );
  const snapshot = () =>
    Object.fromEntries(
      Object.entries(columns).map(([table, names]) => [
        table,
        sql(
          `SELECT count(*)||':'||md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'[]')) FROM (SELECT ${names.map(quote).join(",")} FROM ${quote(table)}) x`,
        ),
      ]),
    );
  const before = snapshot();
  docker(["exec", "barber-api-1", "mkdir", "-p", "/tmp/alora-step10/prisma"]);
  docker(["cp", "prisma/.", "barber-api-1:/tmp/alora-step10/prisma/"]);
  const deploy = () =>
    docker([
      "exec",
      "barber-api-1",
      "node",
      "-e",
      `const {execFileSync}=require('node:child_process');const u=new URL(process.env.DATABASE_URL);u.pathname='/${database}';execFileSync(process.execPath,['/app/node_modules/prisma/build/index.js','migrate','deploy','--schema','/tmp/alora-step10/prisma/schema.prisma'],{env:{...process.env,DATABASE_URL:u.href},stdio:'pipe'});`,
    ]);
  deploy();
  assert.deepEqual(snapshot(), before);
  const calendarConfigurationLockTables = JSON.parse(
    sql(
      `SELECT json_agg(c.relname ORDER BY c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.tgname='alora_calendar_configuration_lock' AND t.tgenabled='O' AND NOT t.tgisinternal`,
    ),
  );
  assert.deepEqual(
    calendarConfigurationLockTables,
    [
      "Collaborator",
      "CollaboratorDayOverride",
      "CollaboratorSector",
      "CollaboratorWeeklySchedule",
      "Location",
      "Room",
      "Sector",
      "Service",
      "Tenant",
      "TenantHoliday",
    ].sort(),
  );
  assert.equal(
    sql(
      `SELECT (SELECT count(*) FROM "PaymentEntry")+(SELECT count(*) FROM "PaymentOperation")`,
    ),
    "0",
  );
  assert.equal(
    sql(`SELECT count(*) FROM "Sale" WHERE "paymentBasis"<>'legacy_unknown'`),
    "0",
  );
  deploy();
  assert.deepEqual(snapshot(), before);
  const assertions = sql(
    readFileSync("scripts/verify-payment-ledger-fixtures.sql", "utf8"),
  )
    .split("\n")
    .filter((line) => line.startsWith("PASS:"));
  assert.equal(assertions.length, 8);
  const resourceAssertions = sql(
    readFileSync("scripts/verify-booking-resource-fixtures.sql", "utf8"),
  )
    .split("\n")
    .filter((line) => line.startsWith("PASS:"));
  assert.equal(resourceAssertions.length, 4);
  assert.equal(sql(`SELECT count(*) FROM "OrderOperation"`), "0");
  const orderCommandAssertions = sql(
    readFileSync("scripts/verify-order-command-fixtures.sql", "utf8"),
  )
    .split("\n")
    .filter((line) => line.startsWith("PASS:"));
  assert.equal(orderCommandAssertions.length, 3);
  const bookingMutationAssertions = sql(
    readFileSync("scripts/verify-booking-mutation-fixtures.sql", "utf8"),
  )
    .split("\n")
    .filter((line) => line.startsWith("PASS:"));
  assert.equal(bookingMutationAssertions.length, 4);
  const cashierFulfilmentAssertions = sql(
    readFileSync("scripts/verify-cashier-fulfilment-fixtures.sql", "utf8"),
  )
    .split("\n")
    .filter((line) => line.startsWith("PASS:"));
  assert.equal(cashierFulfilmentAssertions.length, 4);
  assert.deepEqual(
    snapshot(),
    before,
    "Rolled-back fixtures changed original tables",
  );
  // The pre-migration dump cannot know the new tables/FKs. Restore into an empty
  // disposable database, as an actual full restore requires.
  docker([
    "exec",
    "barber-postgres-1",
    "dropdb",
    "-U",
    "barber",
    "--force",
    database,
  ]);
  docker(["exec", "barber-postgres-1", "createdb", "-U", "barber", database]);
  restore();
  assert.deepEqual(
    snapshot(),
    before,
    "Restore differs from original database",
  );
  deploy();
  assert.deepEqual(
    snapshot(),
    before,
    "Restored copy cannot reapply migration",
  );
  const result = {
    checkedAt: new Date().toISOString(),
    restoredAndReapplied: true,
    originalTablesUnchanged: Object.keys(before).length,
    originalColumnsUnchanged: Object.values(columns).reduce(
      (sum, cols) => sum + cols.length,
      0,
    ),
    originalHashes: before,
    noInferredPayments: true,
    assertions,
    resourceAssertions,
    orderCommandAssertions,
    bookingMutationAssertions,
    cashierFulfilmentAssertions,
    calendarConfigurationLockTables,
  };
  writeFileSync(`${directory}/result.json`, JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      directory,
      tables: result.originalTablesUnchanged,
      assertions,
    }),
  );
} finally {
  if (created)
    docker([
      "exec",
      "barber-postgres-1",
      "dropdb",
      "-U",
      "barber",
      "--force",
      database,
    ]);
}
