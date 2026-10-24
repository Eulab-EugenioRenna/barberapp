/* Additive migration checkpoint: records only columns/counts/digests, never row contents. */
const {PrismaClient}=require('@prisma/client');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const {CURRENT_SNAPSHOT_VERSION,tableLayout,snapshotTables}=require('./lib/database-checkpoint.cjs');
const prisma=new PrismaClient();
const [mode,file]=process.argv.slice(2);
if(!['analyze','apply','verify'].includes(mode)||!file)throw new Error('Usage: connect-onboarding-migration.cjs analyze|apply|verify checkpoint.json');
const excluded=['_prisma_migrations','LocalSession','AuditLog','ConnectSession','ConnectAuthFlow'];
async function main(){
 const [{name}]=await prisma.$queryRaw`SELECT current_database() AS name`;
 const databaseKey=createHash('sha256').update(name+'|'+new URL(process.env.DATABASE_URL).host).digest('hex');
 if(mode==='analyze'){
  const tables=await tableLayout(prisma,excluded);fs.writeFileSync(file,JSON.stringify({snapshotVersion:CURRENT_SNAPSHOT_VERSION,databaseKey,capturedAt:new Date().toISOString(),tables,records:await snapshotTables(prisma,tables)},null,2),{flag:'wx',mode:0o600});console.log('Analysis saved: original columns, counts and digests; freeze writers before apply.');return;
 }
 const baseline=JSON.parse(fs.readFileSync(file,'utf8'));if(baseline.databaseKey!==databaseKey)throw new Error('Checkpoint belongs to another database');
 const verify=async()=>{if(JSON.stringify(await snapshotTables(prisma,baseline.tables,baseline.snapshotVersion??1))!==JSON.stringify(baseline.records))throw new Error('Legacy records changed: stop and reconcile');};
 await verify();
 if(mode==='apply'){
  if(process.env.ALORA_MIGRATION_WRITES_FROZEN!=='1')throw new Error('Freeze writers, then set ALORA_MIGRATION_WRITES_FROZEN=1');
  execFileSync(process.execPath,['scripts/prisma-bootstrap.js'],{stdio:'inherit',env:process.env});
 }
 const [{present}]=await prisma.$queryRaw`SELECT (to_regclass('public."ConnectSession"') IS NOT NULL AND to_regclass('public."ConnectAuthFlow"') IS NOT NULL AND to_regclass('public."ConnectTenantBinding"') IS NOT NULL AND to_regclass('public."ConnectMigrationChallenge"') IS NOT NULL) AS present`;
 if(!present)throw new Error('Connect tables missing');
 const [{nullable}]=await prisma.$queryRaw`SELECT is_nullable='YES' AS nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='ConnectAuthFlow' AND column_name='userId'`;
 if(!nullable)throw new Error('Connect-only flow schema missing');
 await prisma.connectAuthFlow.findFirst({select:{contextCipher:true}});
 await prisma.user.findFirst({select:{connectSubject:true,connectInstallationId:true,connectActivatedAt:true,connectAcceptedAt:true}});
 const version=await prisma.connectSdkSchema.findUnique({where:{version:1}});if(!version)throw new Error("SDK store schema missing");
 await prisma.connectSdkRecord.count();await prisma.connectSession.findFirst({select:{sdkSessionCipher:true}});
 await verify();console.log('Verified Connect schema; all original records, columns, IDs, relations and amounts unchanged.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
