/** Backup/restore rehearsal only. Never applies migrations to the main database. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const stamp = Date.now(),
  database = `step12_migration_${stamp}`,
  directory = `.local/step12/migration-${stamp}`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
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
  const dump = docker([
    "exec",
    "barber-postgres-1",
    "pg_dump",
    "-U",
    "barber",
    "-d",
    "barber",
    "-Fc",
  ]);
  writeFileSync(directory + "/before.dump", dump, { mode: 0o600 });
  writeFileSync(
    directory + "/backup-list.txt",
    docker(["exec", "-i", "barber-postgres-1", "pg_restore", "--list"], dump),
    { mode: 0o600 },
  );
  const create = () => {
    docker(["exec", "barber-postgres-1", "createdb", "-U", "barber", database]);
    created = true;
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
        "--no-owner",
        "--exit-on-error",
      ],
      dump,
    );
  };
  create();
  assert.equal(
    sql(`SELECT to_regclass('public."NotificationDomainEvent"') IS NULL`),
    "t",
    "Use a retained pre-Step-12 dump after local release",
  );
  const columns = JSON.parse(
    sql(
      `SELECT json_object_agg(t,c) FROM (SELECT table_name t,json_agg(column_name ORDER BY ordinal_position)c FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' GROUP BY table_name)x`,
    ),
  );
  const snapshot = () =>
    Object.fromEntries(
      Object.entries(columns).map(([table, names]) => [
        table,
        sql(
          `SELECT count(*)||':'||md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'[]')) FROM (SELECT ${names.map(quote).join(",")} FROM ${quote(table)})x`,
        ),
      ]),
    );
  const before = snapshot();
  writeFileSync(
    directory + "/original-private-snapshot.json",
    JSON.stringify({ columns, hashes: before }) + "\n",
    { mode: 0o600 },
  );
  const deploy = () =>
    docker([
      "run",
      "--rm",
      "--network",
      "barber_app",
      "--entrypoint",
      "node",
      "-e",
      `DATABASE_URL=postgresql://barber:barber@postgres:5432/${database}?schema=public`,
      "-v",
      path.resolve("prisma") + ":/app/prisma:ro",
      "barber-api",
      "/app/node_modules/prisma/build/index.js",
      "migrate",
      "deploy",
      "--schema",
      "/app/prisma/schema.prisma",
    ]);
  deploy();
  assert.deepEqual(snapshot(), before);
  deploy();
  assert.deepEqual(snapshot(), before);
  assert.equal(sql('SELECT count(*) FROM "NotificationDomainEvent"'), "0");
  assert.equal(sql('SELECT count(*) FROM "AppointmentAutomationPolicy"'), "0");
  assert.equal(sql('SELECT count(*) FROM "NotificationAutomationGrant"'), "0");
  assert.equal(sql('SELECT count(*) FROM "NotificationAutomationWebhook"'), "0");
  assert.equal(sql('SELECT count(*) FROM "NotificationAutomationWebhookEvent"'), "0");
  assert.equal(sql('SELECT count(*) FROM "NotificationAutomationCommand"'), "0");
  for (const table of ["AppointmentAutomationRun","AppointmentAutomationAction","AppointmentAutomationDelivery"]) assert.equal(sql(`SELECT count(*) FROM "${table}"`),"0");
  assert.equal(sql('SELECT count(*) FROM "Sale" WHERE "automationContact" IS NOT NULL'),"0");
  assert.equal(sql(`SELECT count(*) FROM _prisma_migrations WHERE migration_name IN ('20261110200000_automation_queued_state','20261110201000_appointment_automation_workflow') AND finished_at IS NOT NULL`),"2");
  assert.equal(
    sql(
      `SELECT count(*) FROM _prisma_migrations WHERE migration_name='20261109180000_appointment_automation_policy' AND finished_at IS NOT NULL`,
    ),
    "1",
  );
  assert.equal(
    sql(
      'SELECT count(*) FROM "NotificationHistory" WHERE "domainEventId" IS NOT NULL OR "retrySafe"',
    ),
    "0",
  );
  const fixture = docker(
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
    readFileSync("scripts/verify-notification-outbox-fixtures.sql"),
  ).toString();
  writeFileSync(directory + "/assertions.txt", fixture, { mode: 0o600 });
  const assertions = fixture.split("\n").filter((s) => s.startsWith("PASS:"));
  assert.equal(assertions.length, 6);
  assert.deepEqual(snapshot(), before);
  docker([
    "exec",
    "barber-postgres-1",
    "dropdb",
    "-U",
    "barber",
    "--force",
    database,
  ]);
  created = false;
  create();
  assert.deepEqual(snapshot(), before);
  deploy();
  assert.deepEqual(snapshot(), before);
  const result = {
    checkedAt: new Date().toISOString(),
    sourceDatabaseModified: false,
    backupReadable: true,
    restoredAndReapplied: true,
    originalTablesUnchanged: Object.keys(columns).length,
    originalColumnsUnchanged: Object.values(columns).reduce(
      (n, c) => n + c.length,
      0,
    ),
    noInferredEventsOrDeliveries: true,
    draftPoliciesCreated: 0,
    automationGrantsCreated: 0,
    automationWebhooksCreated: 0,
    automationWebhookEventsCreated: 0,
    automationCommandsCreated: 0,
    appointmentPlansCreated:0,
    inferredContactConsents:0,
    workflowMigrationsApplied:2,
    policyMigrationApplied: true,
    legacyDeliveryStatusesUnchanged: true,
    assertions,
    evidence: directory + "/result.json",
  };
  writeFileSync(
    directory + "/result.json",
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
  writeFileSync(
    ".local/step12/migration-result.json",
    JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
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
