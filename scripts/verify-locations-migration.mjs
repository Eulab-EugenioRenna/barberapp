/** Data-preserving rehearsal. Operates only on newly created database copies. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import path from "node:path";
const stamp = new Date().toISOString().replace(/[^0-9]/g, "");
const directory = path.resolve(".local/step7/rehearsal-" + stamp);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const baselineIndex = process.argv.indexOf("--baseline-dump");
const baselinePath =
  baselineIndex >= 0 ? process.argv[baselineIndex + 1] : undefined;
if (baselineIndex >= 0 && !baselinePath)
  throw new Error("Missing --baseline-dump path");
const postgres = "barber-postgres-1",
  api = "barber-api-1";
const restored = "step7_restore_" + stamp,
  migrated = "step7_migrate_" + stamp;
const command = (args, input) =>
  execFileSync("docker", args, {
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: "pipe",
  });
const sql = (database, query) =>
  command(
    [
      "exec",
      "-i",
      postgres,
      "psql",
      "-X",
      "-U",
      "barber",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    query,
  )
    .toString()
    .trim();
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
const snapshots = (database, modelNames = tables, full = false) =>
  Object.fromEntries(
    modelNames.map((table) => {
      const ignored = full
        ? []
        : {
            Service: ["sectorId"],
            Room: ["sectorId"],
            Appointment: ["locationId", "sectorId"],
            Sale: ["locationId"],
            SaleItem: ["sectorId"],
          }[table] || [];
      const json =
        "to_jsonb(t)" + ignored.map((field) => `-'${field}'`).join("");
      const data = JSON.parse(
        sql(
          database,
          `SELECT json_build_object('count',count(*),'digest',md5(COALESCE(string_agg((${json})::text, E'\n' ORDER BY (${json})::text),''))) FROM "${table}" t`,
        ),
      );
      return [table, data];
    }),
  );
const created = [];
try {
  const dump = baselinePath
    ? readFileSync(path.resolve(baselinePath))
    : command([
        "exec",
        postgres,
        "pg_dump",
        "-U",
        "barber",
        "-d",
        "barber",
        "-Fc",
      ]);
  writeFileSync(path.join(directory, "before.dump"), dump, { mode: 0o600 });
  const list = command(["exec", "-i", postgres, "pg_restore", "--list"], dump);
  writeFileSync(path.join(directory, "backup-list.txt"), list, { mode: 0o600 });
  for (const database of [restored, migrated]) {
    command(["exec", postgres, "createdb", "-U", "barber", database]);
    created.push(database);
    command(
      [
        "exec",
        "-i",
        postgres,
        "pg_restore",
        "-U",
        "barber",
        "-d",
        database,
        "--no-owner",
        "--exit-on-error",
      ],
      dump,
    );
  }
  command(["exec", api, "mkdir", "-p", "/tmp/alora-step7/prisma"]);
  command(["cp", "prisma/.", api + ":/tmp/alora-step7/prisma/"]);
  const deploy = (database) =>
    command([
      "exec",
      "-i",
      api,
      "node",
      "-e",
      `const {execFileSync}=require('node:child_process');const u=new URL(process.env.DATABASE_URL);u.pathname='/'+${JSON.stringify(database)};execFileSync(process.execPath,['/app/node_modules/prisma/build/index.js','migrate','deploy','--schema','/tmp/alora-step7/prisma/schema.prisma'],{env:{...process.env,DATABASE_URL:u.href},stdio:'pipe'});`,
    ]).toString();
  const alreadyMigrated =
    sql(restored, `SELECT to_regclass('public."Location"') IS NOT NULL`) ===
    "t";
  const scopeTables = [
    "Location",
    "Sector",
    "CollaboratorSector",
    "UserSectorAccess",
  ];
  const scopeBefore = alreadyMigrated
    ? snapshots(restored, scopeTables, true)
    : null;
  deploy(migrated);
  const before = snapshots(restored, tables, alreadyMigrated),
    after = snapshots(migrated, tables, alreadyMigrated);
  const scopeAfter = snapshots(migrated, scopeTables, true);
  if (scopeBefore && JSON.stringify(scopeBefore) !== JSON.stringify(scopeAfter))
    throw new Error(
      "Operational scope metadata changed on restore/reapplication",
    );
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Operational data changed in migration");
  deploy(migrated);
  if (
    JSON.stringify(scopeAfter) !==
    JSON.stringify(snapshots(migrated, scopeTables, true))
  )
    throw new Error("Reapplication changed scope metadata");
  if (
    JSON.stringify(after) !==
    JSON.stringify(snapshots(migrated, tables, alreadyMigrated))
  )
    throw new Error("Reapplication changed operational data");
  const missing = Number(
    sql(
      migrated,
      `SELECT (SELECT count(*) FROM "Appointment" WHERE "sectorId" IS NULL OR "locationId" IS NULL)+(SELECT count(*) FROM "Sale" WHERE "locationId" IS NULL)+(SELECT count(*) FROM "SaleItem" WHERE "sectorId" IS NULL)+(SELECT count(*) FROM "Service" WHERE "sectorId" IS NULL)+(SELECT count(*) FROM "Room" WHERE "sectorId" IS NULL)`,
    ),
  );
  if (missing) throw new Error("Unattributed operations");
  let preflightVerified = false;
  if (!alreadyMigrated) {
    // An incoherent pre-migration reference must stop before adding scope columns.
    sql(
      restored,
      `INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('__preflight_a','Preflight A','__preflight_a',now()),('__preflight_b','Preflight B','__preflight_b',now());
    INSERT INTO "Customer" (id,"tenantId","firstName","lastName","updatedAt") VALUES ('__preflight_customer','__preflight_a','Synthetic','Fixture',now());
    INSERT INTO "Service" (id,"tenantId",name,"durationMinutes","basePrice") VALUES ('__preflight_service','__preflight_b','Synthetic fixture',30,1);
    INSERT INTO "Appointment" (id,"tenantId","customerId","serviceId","startsAt","endsAt","updatedAt") VALUES ('__preflight_bad','__preflight_a','__preflight_customer','__preflight_service','2030-11-11T10:00:00Z','2030-11-11T10:30:00Z',now());`,
    );
    let preflightRejected = false;
    try {
      deploy(restored);
    } catch {
      preflightRejected = true;
    }
    if (
      !preflightRejected ||
      sql(restored, `SELECT to_regclass('public."Location"') IS NULL`) !==
        "t" ||
      sql(
        restored,
        `SELECT count(*) FROM "Appointment" WHERE id='__preflight_bad' AND "serviceId"='__preflight_service'`,
      ) !== "1"
    )
      throw new Error("Preflight did not preserve inconsistent history");
    preflightVerified = true;
  }
  // Real database fixture checks are supplied separately and always rolled back.
  const assertions = sql(
    migrated,
    readFileSync(
      new URL("./verify-locations-fixtures.sql", import.meta.url),
      "utf8",
    ),
  );
  const report = {
    checkedAt: new Date().toISOString(),
    appliedVia: "prisma migrate deploy",
    reappliedVia: "prisma migrate deploy",
    restoreVerified: true,
    source: baselinePath ? "provided-baseline-dump" : "current-local-database",
    sourceAlreadyMigrated: alreadyMigrated,
    preflightCheck: preflightVerified
      ? "passed"
      : "not-run-source-already-migrated",
    scopeMetadataRestorePreserved: scopeBefore ? true : null,
    scopeSnapshots: scopeAfter,
    operationalDataUnchanged: true,
    unattributed: missing,
    snapshots: after,
    assertions: assertions
      .split("\n")
      .filter((line) => line.startsWith("PASS:"))
      .concat(
        preflightVerified
          ? ["PASS:preflight-rejects-incoherent-history-without-reassignment"]
          : [],
      ),
    privateBackup: path.join(directory, "before.dump"),
  };
  writeFileSync(
    path.join(directory, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      {
        evidence: path.join(directory, "result.json"),
        tables: tables.length,
        assertions: report.assertions,
        restored: true,
        reapplied: true,
        unattributed: missing,
      },
      null,
      2,
    ),
  );
} finally {
  for (const database of created.reverse())
    command(["exec", postgres, "dropdb", "-U", "barber", database]);
  chmodSync(directory, 0o700);
}
