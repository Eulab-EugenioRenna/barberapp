// Explicit analysis/apply/verify checkpoints. Never prints or persists business data.
const { PrismaClient } = require("@prisma/client");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const {CURRENT_SNAPSHOT_VERSION,tableLayout,snapshotTables}=require("./lib/database-checkpoint.cjs");
const prisma = new PrismaClient();
const [mode, checkpoint] = process.argv.slice(2);
if (!["analyze", "apply", "verify"].includes(mode) || !checkpoint)
  throw new Error(
    "Usage: node scripts/security-session-migration.cjs analyze|apply|verify <checkpoint.json>",
  );
async function assertTenantIntegrity() {
  const links = [
    ["Appointment", "customerId", "Customer"],
    ["Appointment", "serviceId", "Service"],
    ["Appointment", "collaboratorId", "Collaborator"],
    ["Appointment", "roomId", "Room"],
    ["Sale", "customerId", "Customer"],
    ["Sale", "collaboratorId", "Collaborator"],
    ["Sale", "appointmentId", "Appointment"],
    ["Collaborator", "userId", "User"],
    ["Tenant", "defaultCollaboratorId", "Collaborator"],
    ["NotificationInbox", "recipientUserId", "User"],
    ["NotificationPreferenceUser", "userId", "User"],
  ];
  for (const [left, field, right] of links) {
    const leftTenant = left === "Tenant" ? 'a."id"' : 'a."tenantId"';
    const [result] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS count FROM "${left}" a JOIN "${right}" b ON a."${field}" = b."id" WHERE ${leftTenant} IS DISTINCT FROM b."tenantId"`,
    );
    if (result.count)
      throw new Error(
        `Tenant integrity failed: ${left}.${field}, ${result.count} references; reconcile before migrating`,
      );
  }
  const [nested] = await prisma.$queryRawUnsafe(`SELECT (
    (SELECT count(*) FROM "ServiceProduct" x JOIN "Service" s ON s.id=x."serviceId" JOIN "Product" p ON p.id=x."productId" WHERE s."tenantId" <> p."tenantId") +
    (SELECT count(*) FROM "SaleItem" x JOIN "Sale" s ON s.id=x."saleId" LEFT JOIN "Product" p ON p.id=x."productId" LEFT JOIN "Service" v ON v.id=x."serviceId" LEFT JOIN "Collaborator" c ON c.id=x."collaboratorId" WHERE (p.id IS NOT NULL AND s."tenantId" <> p."tenantId") OR (v.id IS NOT NULL AND s."tenantId" <> v."tenantId") OR (c.id IS NOT NULL AND s."tenantId" <> c."tenantId"))
  )::int AS count`);
  if (nested.count)
    throw new Error(
      `Tenant integrity failed: ${nested.count} nested catalog/order references`,
    );
}
const excluded=["_prisma_migrations","LocalSession","AuditLog"];
async function snapshot(tables,version=1){
  return snapshotTables(prisma,tables??await tableLayout(prisma,excluded),version);
}
async function main() {
  await assertTenantIntegrity();
  const database = await prisma.$queryRaw`SELECT current_database() AS name`;
  const databaseKey = createHash("sha256")
    .update(database[0].name + "|" + new URL(process.env.DATABASE_URL).host)
    .digest("hex");
  if (mode === "analyze") {
    if (fs.existsSync(checkpoint))
      throw new Error("Checkpoint already exists; use a new filename");
    const tables=await tableLayout(prisma,excluded);
    fs.writeFileSync(
      checkpoint,
      JSON.stringify(
        {
          snapshotVersion:CURRENT_SNAPSHOT_VERSION,
          tables,
          databaseKey,
          capturedAt: new Date().toISOString(),
          records: await snapshot(tables,CURRENT_SNAPSHOT_VERSION),
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      "Analysis checkpoint saved (counts and digests only). Freeze writers before apply.",
    );
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(checkpoint, "utf8"));
  if (baseline.databaseKey !== databaseKey)
    throw new Error("Checkpoint belongs to a different database");
  if (JSON.stringify(baseline.records) !== JSON.stringify(await snapshot(baseline.tables,baseline.snapshotVersion??1)))
    throw new Error("Business data differ from checkpoint; stop and reconcile");
  if (mode === "apply") {
    if(process.env.ALORA_MIGRATION_WRITES_FROZEN!=="1")throw new Error("Freeze writers, then set ALORA_MIGRATION_WRITES_FROZEN=1");
    execFileSync(process.execPath, ["scripts/prisma-bootstrap.js"], {
      stdio: "inherit",
      env: process.env,
    });
  }
  const [state] =
    await prisma.$queryRaw`SELECT to_regclass('public."LocalSession"') IS NOT NULL AS present`;
  if (!state.present) throw new Error("LocalSession table missing");
  if (JSON.stringify(baseline.records) !== JSON.stringify(await snapshot(baseline.tables,baseline.snapshotVersion??1)))
    throw new Error("Business reconciliation failed");
  await prisma.localSession.count();
  console.log(
    "Verified session schema and unchanged business records/IDs/relations/amounts.",
  );
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
