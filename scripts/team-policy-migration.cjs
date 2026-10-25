// Additive checkpoint workflow. Fingerprints exclude runtime sessions and contain no row data.
const { PrismaClient } = require('@prisma/client');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { CURRENT_SNAPSHOT_VERSION, tableLayout, snapshotTables } = require('./lib/database-checkpoint.cjs');
const [mode, file] = process.argv.slice(2);
if (!['analyze', 'apply', 'verify'].includes(mode) || !file) throw Error('Usage: team-policy-migration.cjs analyze|apply|verify checkpoint.json');
const prisma = new PrismaClient();
async function main() {
  const [{ name }] = await prisma.$queryRaw`SELECT current_database() AS name`;
  const databaseKey = createHash('sha256').update(name + '|' + new URL(process.env.DATABASE_URL).host).digest('hex');
  if (mode === 'analyze') {
    const tables = await tableLayout(prisma, ['_prisma_migrations', 'LocalSession', 'AuditLog', 'ConnectSession', 'ConnectSdkRecord']);
    fs.writeFileSync(file, JSON.stringify({ snapshotVersion: CURRENT_SNAPSHOT_VERSION, databaseKey, capturedAt: new Date().toISOString(), tables, records: await snapshotTables(prisma, tables) }, null, 2), { flag: 'wx', mode: 0o600 });
    console.log('Analysis saved: original columns, counts and digests. Freeze writers before apply.'); return;
  }
  const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (baseline.databaseKey !== databaseKey) throw Error('Checkpoint belongs to another database');
  async function verify() {
    if (JSON.stringify(await snapshotTables(prisma, baseline.tables, baseline.snapshotVersion)) !== JSON.stringify(baseline.records)) throw Error('Original records changed: stop and reconcile');
  }
  await verify();
  if (mode === 'apply') {
    if (process.env.ALORA_MIGRATION_WRITES_FROZEN !== '1') throw Error('Freeze writers, then set ALORA_MIGRATION_WRITES_FROZEN=1');
    execFileSync(process.execPath, ['scripts/prisma-bootstrap.js'], { stdio: 'inherit', env: process.env });
  }
  const [column] = await prisma.$queryRaw`SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='permissionsConfigured'`;
  if (!column || column.data_type !== 'boolean' || column.is_nullable !== 'NO' || column.column_default !== 'false') throw Error('Policy flag schema invalid');
  await verify();
  console.log('Verified policy schema; original records, IDs, passwords, permissions and relations unchanged. Previous application remains compatible.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
