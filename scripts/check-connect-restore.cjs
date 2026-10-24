/* Isolated PostgreSQL backup/migration/restore proof. Never mutates the source database. */
const assert=require('node:assert/strict');
const {execFileSync,spawnSync}=require('node:child_process');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const http=require('node:http');const {Pool}=require('pg');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {PrismaClient}=require('@prisma/client');const {hash}=require('bcrypt');
const {tableLayout,snapshotTables}=require('./lib/database-checkpoint.cjs');
const sourceUrl=process.env.DATABASE_URL;
if(!sourceUrl||new URL(sourceUrl).pathname!=='/barber_security_test')throw Error('Requires isolated barber_security_test');
const container='barber-security-postgres',suffix=randomUUID().replaceAll('-','').slice(0,12),beforeDb='barber_restore_before_'+suffix,afterDb='barber_restore_after_'+suffix;
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'alora-connect-restore-')),clients=[],created=[];
let report,provider;const pools=[];let failed=false,checks=0;
const quote=value=>'"'+value.replaceAll('"','""')+'"';
function docker(args,input){return execFileSync('docker',['exec',...(input?['-i']:[]),container,...args],{input,maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']});}
function cloneUrl(name){const url=new URL(sourceUrl);url.pathname='/'+name;return url.href;}
function client(name){const prisma=new PrismaClient({datasources:{db:{url:cloneUrl(name)}}});clients.push(prisma);return prisma;}
function cli(script,mode,file,name,extra={}){return spawnSync(process.execPath,[script,mode,file],{env:{...process.env,DATABASE_URL:cloneUrl(name),...extra},encoding:'utf8',maxBuffer:1024*1024});}
function ok(result,label){assert.equal(result.status,0,label+' failed');checks++;}
async function fingerprint(prisma){return snapshotTables(prisma,await tableLayout(prisma));}
async function main(){
 const dump=docker(['pg_dump','-U','barber_test','-d','barber_security_test','-Fc']);assert(dump.length>0);
 const sourceBackup=path.join(stage,'source.dump');fs.writeFileSync(sourceBackup,dump,{mode:0o600});
 for(const name of [beforeDb,afterDb]){docker(['createdb','-U','barber_test',name]);created.push(name);}
 docker(['pg_restore','-U','barber_test','-d',beforeDb,'--no-owner','--no-privileges'],dump);
 const before=client(beforeDb);
 // Positive monetary/relational fixture, present before migration.
 const tenant=await before.tenant.create({data:{name:'Restore proof',slug:'restore-'+suffix}});
 const user=await before.user.create({data:{tenantId:tenant.id,email:'restore-'+suffix+'@example.test',firstName:'Restore',lastName:'Owner',role:'owner',passwordHash:await hash('Synthetic-Restore-Only-9!',4)}});
 const customer=await before.customer.create({data:{tenantId:tenant.id,firstName:'Restore',lastName:'Customer'}});
 const service=await before.service.create({data:{tenantId:tenant.id,name:'Restore service',durationMinutes:30,basePrice:'27.35'}});
 const product=await before.product.create({data:{tenantId:tenant.id,name:'Restore product',price:'5.60'}});
 const appointment=await before.appointment.create({data:{tenantId:tenant.id,customerId:customer.id,serviceId:service.id,startsAt:new Date('2026-10-01T09:00:00Z'),endsAt:new Date('2026-10-01T09:30:00Z'),status:'completed',finalPrice:'27.35'}});
 const sale=await before.sale.create({data:{tenantId:tenant.id,customerId:customer.id,appointmentId:appointment.id,subtotal:'38.55',total:'38.55',paymentStatus:'paid',items:{create:[{serviceId:service.id,label:'Restore service',quantity:1,unitPrice:'27.35',lineTotal:'27.35'},{productId:product.id,label:'Restore product',quantity:2,unitPrice:'5.60',lineTotal:'11.20'}]}}});
 // Reconstruct the pre-Connect schema only in this disposable clone, never the source.
 await before.$executeRawUnsafe('DROP TABLE connect_sdk_records,connect_sdk_schema,"ConnectMigrationChallenge","ConnectTenantBinding","ConnectAuthFlow","ConnectSession" CASCADE');
 await before.$executeRawUnsafe('ALTER TABLE "LocalSession" DROP COLUMN "connectSessionId"');
 await before.$executeRawUnsafe('ALTER TABLE "User" DROP COLUMN "connectSubject",DROP COLUMN "connectInstallationId",DROP COLUMN "connectAcceptedAt",DROP COLUMN "connectActivatedAt"');
 await before.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE migration_name IN (\'20261021010000_connect_onboarding\',\'20261021020000_connect_activation_gate\',\'20261022000000_connect_application_store\',\'20261022010000_connect_sdk_session_bridge\')');
 const checkpoint=path.join(stage,'connect-v2.json');
 ok(cli('scripts/connect-onboarding-migration.cjs','analyze',checkpoint,beforeDb),'Pre-migration analysis');
 const baseline=JSON.parse(fs.readFileSync(checkpoint,'utf8'));assert.equal(baseline.snapshotVersion,2);
 // Validate compatibility with a checkpoint produced by the historical algorithm.
 const legacyCheckpoint=path.join(stage,'connect-v1.json');
 fs.writeFileSync(legacyCheckpoint,JSON.stringify({...baseline,snapshotVersion:undefined,records:await snapshotTables(before,baseline.tables,1)}),{mode:0o600});
 const refused=cli('scripts/connect-onboarding-migration.cjs','apply',checkpoint,beforeDb);assert.notEqual(refused.status,0);checks++;
 ok(cli('scripts/connect-onboarding-migration.cjs','apply',checkpoint,beforeDb,{ALORA_MIGRATION_WRITES_FROZEN:'1'}),'Migration apply');
 ok(cli('scripts/connect-onboarding-migration.cjs','verify',checkpoint,beforeDb),'Migration reconciliation');
 ok(cli('scripts/connect-onboarding-migration.cjs','verify',legacyCheckpoint,beforeDb),'Historical checkpoint compatibility');
 const migrationCount=await before.$queryRaw`SELECT count(*)::int AS n FROM "_prisma_migrations"`;
 ok(cli('scripts/connect-onboarding-migration.cjs','apply',checkpoint,beforeDb,{ALORA_MIGRATION_WRITES_FROZEN:'1'}),'Idempotent migration apply');
 assert.deepEqual(await before.$queryRaw`SELECT count(*)::int AS n FROM "_prisma_migrations"`,migrationCount);
 assert.equal((await before.sale.findUnique({where:{id:sale.id}})).total.toFixed(2),'38.55');
 assert.equal((await before.user.findUnique({where:{id:user.id}})).passwordHash,user.passwordHash);
 // Persist new Connect state and a later business write before the recovery backup.
 const runtime=require('../dist/apps/api/common/connect-runtime.js');
 const sessions=require('../dist/apps/api/common/local-sessions.js');
 const {resolveRequestSession}=require('../dist/apps/api/common/request-session.js');
 process.env.ALORA_CONNECT_ENCRYPTION_KEY=randomBytes(32).toString('hex');
 const encryptionKey=process.env.ALORA_CONNECT_ENCRYPTION_KEY,installationId=randomUUID();
 await before.connectTenantBinding.create({data:{tenantId:tenant.id,customerId:randomUUID(),installationId,secretCipher:runtime.sealConnect('synthetic-installation-credential')}});
 await before.user.update({where:{id:user.id},data:{connectSubject:'restore-subject-'+suffix,connectInstallationId:installationId,connectAcceptedAt:new Date(),connectActivatedAt:new Date()}});
 const providerSession=await before.connectSession.create({data:{userId:user.id,installationId,accessCipher:runtime.sealConnect('synthetic-provider-access'),refreshCipher:runtime.sealConnect('synthetic-provider-refresh'),expiresAt:new Date(Date.now()+600000)}});
 await before.connectAuthFlow.create({data:{installationId,stateHash:createHash('sha256').update(randomBytes(32)).digest('hex'),browserHash:createHash('sha256').update(randomBytes(32)).digest('hex'),contextCipher:runtime.sealConnect('synthetic-context'),verifierCipher:runtime.sealConnect('synthetic-verifier'),expiresAt:new Date(Date.now()+600000)}});
 await before.$transaction(tx=>sessions.createLocalSession(tx,user.id,undefined,undefined,providerSession.id));
 const ungated=await before.user.create({data:{tenantId:tenant.id,email:'unmigrated-'+suffix+'@example.test',firstName:'Local',lastName:'Only',role:'owner',passwordHash:user.passwordHash}});
 const legacyAccess=randomBytes(32).toString('base64url');
 await before.localSession.create({data:{userId:ungated.id,familyId:randomUUID(),accessHash:sessions.tokenHash(legacyAccess),refreshHash:sessions.tokenHash(randomBytes(32).toString('base64url')),accessExpiresAt:new Date(Date.now()+600000),refreshExpiresAt:new Date(Date.now()+600000)}});
 const laterSale=await before.sale.create({data:{tenantId:tenant.id,customerId:customer.id,subtotal:'19.99',total:'19.99',paymentStatus:'unpaid'}});
 const currentCheckpoint=path.join(stage,'connect-current.json'),securityCheckpoint=path.join(stage,'security-current.json');
 ok(cli('scripts/connect-onboarding-migration.cjs','analyze',currentCheckpoint,beforeDb),'Current Connect checkpoint without id-column assumption');
 ok(cli('scripts/security-session-migration.cjs','analyze',securityCheckpoint,beforeDb),'Current security checkpoint');
 ok(cli('scripts/security-session-migration.cjs','verify',securityCheckpoint,beforeDb),'Current security reconciliation');
 // One cent of drift must be detected, then restoring the exact value must reconcile again.
 await before.sale.update({where:{id:sale.id},data:{total:'38.56'}});
 assert.notEqual(cli('scripts/connect-onboarding-migration.cjs','verify',currentCheckpoint,beforeDb).status,0);checks++;
 await before.sale.update({where:{id:sale.id},data:{total:'38.55'}});
 ok(cli('scripts/connect-onboarding-migration.cjs','verify',currentCheckpoint,beforeDb),'Reconciliation after corrected drift');
 // Persist an actual encrypted SDK proof, then resume it from the recovered database.
 const sdk=await import('@eulab/connect/application');
 const {connectAccounts}=require('../dist/apps/api/common/connect-accounts.js');
 provider=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;res.setHeader('content-type','application/json');
  if(req.url.endsWith('/login-context'))return res.end(JSON.stringify({status:'not_found'}));
  const body=JSON.parse(raw);assert.equal(body.initialPassword,'Synthetic-Restore-Only-9!');return res.end(JSON.stringify({requestId:'restore-request',state:'pending',nextAction:'wait'}));
 });
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 const apiUrl='http://127.0.0.1:'+provider.address().port;
 const application=(dbName,db,key=encryptionKey)=>{const pool=new Pool({connectionString:cloneUrl(dbName)});pools.push(pool);return new sdk.ConnectApplication({apiUrl,sourceId:'restore-source',sourceSecret:'synthetic-source',appId:'restore-app',issuer:apiUrl+'/realms/qa',clientId:'restore-client',redirectUri:apiUrl+'/callback',appOrigin:apiUrl,encryptionKey:key,allowLoopbackHttp:true,store:new sdk.PostgresConnectApplicationStore(pool,'restore-sdk'),accounts:connectAccounts(db,code=>{throw new sdk.ConnectApplicationError(code);}),catalog:{schemaVersion:1,appId:'restore-app',version:1,functions:[]}});};
 const sdkBefore=application(beforeDb,before),proof=await sdkBefore.auth.signIn({email:ungated.email,password:'Synthetic-Restore-Only-9!'},{origin:apiUrl,cookies:{}});assert.equal(proof.status,'migration_required');
 const browser={origin:apiUrl,cookies:Object.fromEntries(proof.cookies.map(cookie=>[cookie.name,cookie.value]))};
 const sdkRecords=await before.connectSdkRecord.findMany({where:{namespace:'restore-sdk'}});assert.equal(sdkRecords.length,1);assert(!sdkRecords[0].cipher.includes('Synthetic-Restore-Only-9!'));checks++;
 const expected=await fingerprint(before),recoveryDump=docker(['pg_dump','-U','barber_test','-d',beforeDb,'-Fc']);
 fs.writeFileSync(path.join(stage,'recovery.dump'),recoveryDump,{mode:0o600});
 docker(['pg_restore','-U','barber_test','-d',afterDb,'--no-owner','--no-privileges'],recoveryDump);
 const after=client(afterDb);assert.deepEqual(await fingerprint(after),expected);checks++;
 const restoredBinding=await after.connectTenantBinding.findUnique({where:{tenantId:tenant.id}});
 assert.equal(runtime.openConnect(restoredBinding.secretCipher),'synthetic-installation-credential');
 const restoredSession=await after.connectSession.findUnique({where:{id:providerSession.id}});assert.equal(runtime.openConnect(restoredSession.refreshCipher),'synthetic-provider-refresh');
 process.env.ALORA_CONNECT_ENCRYPTION_KEY=randomBytes(32).toString('hex');assert.throws(()=>runtime.openConnect(restoredBinding.secretCipher));process.env.ALORA_CONNECT_ENCRYPTION_KEY=encryptionKey;checks++;
 assert.equal((await after.sale.findUnique({where:{id:laterSale.id}})).total.toFixed(2),'19.99');
 assert.equal((await after.appointment.findUnique({where:{id:appointment.id}})).customerId,customer.id);
 await assert.rejects(resolveRequestSession(after,'Bearer '+legacyAccess),error=>error.getStatus()===401);checks++;
 assert.notEqual(cli('scripts/connect-onboarding-migration.cjs','verify',currentCheckpoint,afterDb).status,0);checks++;
 const submission={challenge:proof.challenge,legacyPassword:'Synthetic-Restore-Only-9!',consentVersion:proof.consentVersion,idempotencyKey:'restore-sdk-submission'};
 await assert.rejects(application(afterDb,after,randomBytes(32).toString('hex')).migration.submit(submission,browser),error=>error.code==='invalid_flow');
 const sdkAfter=application(afterDb,after);assert.equal((await sdkAfter.migration.submit(submission,browser)).state,'pending');
 await assert.rejects(sdkAfter.migration.submit(submission,browser),error=>error.code==='invalid_flow');checks++;

 report={at:new Date().toISOString(),status:'passed',checks,tablesReconciled:Object.keys(expected).length,legacyProjectionPreserved:true,historicalCheckpointCompatible:true,repeatedApply:true,monetaryDriftDetected:true,allPostBackupRowsPreserved:true,newWritesPreserved:true,connectCiphersReadableWithOriginalKey:true,sdkProofResumedAfterRestore:true,sdkProofReplayBlocked:true,wrongKeyRejected:true,localAccessStillBlocked:true,sourceDatabaseReadOnly:true,productionCopy:false};
}
main().catch(error=>{failed=true;console.error(error.message);}).finally(async()=>{
 let cleanupVerified=true;
 for(const pool of pools)try{await pool.end();}catch{cleanupVerified=false;}
 if(provider)try{await new Promise(resolve=>provider.close(resolve));}catch{cleanupVerified=false;}
 for(const prisma of clients)try{await prisma.$disconnect();}catch{cleanupVerified=false;}
 for(const name of created)try{docker(['dropdb','-U','barber_test','--force',name]);}catch{cleanupVerified=false;}
 try{fs.rmSync(stage,{recursive:true,force:true});}catch{cleanupVerified=false;}
 if(!cleanupVerified){failed=true;console.error('Temporary restore cleanup failed');}
 report??={at:new Date().toISOString(),checks,sourceDatabaseReadOnly:true,productionCopy:false};
 report.cleanupVerified=cleanupVerified;report.status=failed?'failed':'passed';
 fs.mkdirSync('docs/verification',{recursive:true});fs.writeFileSync('docs/verification/connect-restore.json',JSON.stringify(report,null,2)+'\n');
 if(!failed)console.log(`PASS: ${checks} migration/restore checks; ${report.tablesReconciled} tables reconciled; legacy data, new writes and Connect ciphers preserved. Local access remains blocked. Isolated database, not a production-copy acceptance.`);
 if(failed)process.exitCode=1;
});
