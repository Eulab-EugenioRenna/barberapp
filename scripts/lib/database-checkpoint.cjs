// Versioned, metadata-only fingerprints. No assumption that every table has an `id` column.
const CURRENT_SNAPSHOT_VERSION = 2;
const quote = value => '"' + value.replaceAll('"', '""') + '"';
async function tableLayout(prisma, excluded = []) {
  const columns = await prisma.$queryRaw`SELECT c.table_name,c.column_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name WHERE c.table_schema='public' AND t.table_type='BASE TABLE' ORDER BY c.table_name,c.ordinal_position`;
  const tables = {};
  for (const row of columns) if (!excluded.includes(row.table_name)) (tables[row.table_name] ??= []).push(row.column_name);
  return tables;
}
async function snapshotTables(prisma, tables, version = CURRENT_SNAPSHOT_VERSION) {
  if (![1, 2].includes(version)) throw Error('Unsupported checkpoint fingerprint version');
  const records = {};
  for (const [table, columns] of Object.entries(tables)) {
    // Keep the exact historical algorithm for pre-versioned checkpoints.
    const aggregate = version === 1
      ? "string_agg(to_jsonb(t)::text,'' ORDER BY id)"
      : "string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text))";
    const [record] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS count,md5(COALESCE(${aggregate},'')) AS digest FROM (SELECT ${columns.map(quote).join(',')} FROM ${quote(table)}) t`);
    records[table] = record;
  }
  return records;
}
module.exports = { CURRENT_SNAPSHOT_VERSION, tableLayout, snapshotTables };
