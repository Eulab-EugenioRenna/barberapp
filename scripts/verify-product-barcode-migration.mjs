// Rehearsal on a newly restored copy only. Source database is read by pg_dump.
// Retains the copy and backup for inspection; does not drop databases.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const dockerBin = process.env.DOCKER_BIN || "docker";
const container = process.env.BARCODE_PG_CONTAINER || "barber-postgres-1";
const stamp = Date.now();
const directory = `.local/eul56/migration-${stamp}`;
const copy = `eul56_barcode_${stamp}`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
const docker = (args, input) =>
  execFileSync(dockerBin, args, {
    input,
    stdio: "pipe",
    maxBuffer: 128 * 1024 * 1024,
  });
const sql = (query) =>
  docker(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-U",
      "barber",
      "-d",
      copy,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    query,
  )
    .toString()
    .trim();
const dump = docker([
  "exec",
  container,
  "pg_dump",
  "-U",
  "barber",
  "-d",
  "barber",
  "-Fc",
]);
writeFileSync(`${directory}/before.dump`, dump, { mode: 0o600 });
docker(["exec", container, "createdb", "-U", "barber", copy]);
docker(
  [
    "exec",
    "-i",
    container,
    "pg_restore",
    "-U",
    "barber",
    "-d",
    copy,
    "--no-owner",
    "--exit-on-error",
  ],
  dump,
);
assert.equal(
  sql(
    `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Product' AND column_name='barcode')`,
  ),
  "f",
  "Expected a pre-barcode baseline; source remains untouched",
);
// Hash every original field without writing customer or business data to the report.
const tables = JSON.parse(
  sql(
    `SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public'`,
  ),
);
const snapshot = () =>
  Object.fromEntries(
    tables.map((table) => {
      const identifier = '"' + table.replaceAll('"', '""') + '"';
      return [
        table,
        sql(
          `SELECT count(*) || ':' || md5(COALESCE(string_agg(row_data::text, E'\\n' ORDER BY row_data::text),'')) FROM (SELECT to_jsonb(t)-'barcode' AS row_data FROM ${identifier} t) rows`,
        ),
      ];
    }),
  );
const before = snapshot();
const migration = readFileSync(
  "prisma/migrations/20261113093210_product_barcode/migration.sql",
  "utf8",
);
const rollback = readFileSync(
  "prisma/migrations/20261113093210_product_barcode/rollback.sql",
  "utf8",
);
sql(migration);
assert.deepEqual(
  snapshot(),
  before,
  "Additive migration must preserve every existing row and field",
);
assert.equal(
  sql(`SELECT count(*) FROM "Product" WHERE barcode IS NOT NULL`),
  "0",
);
sql(`BEGIN;
INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('__eul56_a','Fixture A','__eul56_a',now()),('__eul56_b','Fixture B','__eul56_b',now());
INSERT INTO "Product" (id,"tenantId",name,barcode) VALUES
('__eul56_p1','__eul56_a','Same code A','4006381333931'),
('__eul56_p2','__eul56_b','Same code B','4006381333931'),
('__eul56_p3','__eul56_a','No barcode 1',NULL),
('__eul56_p4','__eul56_a','No barcode 2',NULL);
DO $$ BEGIN
  BEGIN
    INSERT INTO "Product" (id,"tenantId",name,barcode) VALUES ('__eul56_duplicate','__eul56_a','Duplicate','4006381333931');
    RAISE EXCEPTION 'Duplicate barcode was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
ROLLBACK;`);
assert.deepEqual(snapshot(), before);
sql(rollback);
assert.equal(
  sql(
    `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Product' AND column_name='barcode')`,
  ),
  "f",
);
assert.deepEqual(
  snapshot(),
  before,
  "Rollback must preserve all original data",
);
sql(migration);
assert.deepEqual(
  snapshot(),
  before,
  "Reapply after rollback must preserve all original data",
);
const report = {
  checkedAt: new Date().toISOString(),
  sourceDatabaseModified: false,
  restoredCopy: copy,
  tablesCompared: tables.length,
  assertions: [
    "restore succeeded",
    "all original rows and fields preserved",
    "existing barcodes NULL",
    "duplicate tenant barcode rejected",
    "same barcode allowed across tenants",
    "multiple NULL barcodes allowed",
    "rollback removes column",
    "rollback preserves original data",
    "reapply succeeds",
  ],
  backup: `${directory}/before.dump`,
  retainedCopy: true,
};
writeFileSync(
  `${directory}/result.json`,
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(
  JSON.stringify({ evidence: `${directory}/result.json`, ...report }, null, 2),
);
