/* Real PostgreSQL/store/domain transactions, disposable database only. No Connect/provider registration. */
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {PrismaClient}=require('@prisma/client');
const {Pool}=require('pg');
const {hash,compare}=require('bcrypt');
const fs=require('node:fs');
const source=new URL(process.env.DATABASE_URL||'http://invalid');
if(source.pathname!=='/barber_security_test'||!['localhost','127.0.0.1'].includes(source.hostname))throw Error('Requires local isolated barber_security_test configuration');
const name='barber_sdk_adapters_'+randomUUID().replaceAll('-','').slice(0,12);
const url=new URL(source);url.pathname='/'+name;
const docker=args=>execFileSync('docker',['exec','barber-security-postgres',...args],{stdio:['ignore','pipe','pipe']});
let created=false,prisma,pool,failed=false,checks=0,report;
const appId='alora-adapter-qa',sourceId='adapter-source';
const env={...process.env,DATABASE_URL:url.href,NODE_ENV:'test',ALORA_CONNECT_APP_ID:appId,ALORA_CONNECT_SOURCE_ID:sourceId,ALORA_CONNECT_BOOTSTRAP_SECRET:'synthetic-source',ALORA_CONNECT_API_URL:'http://127.0.0.1:1',ALORA_CONNECT_ISSUER:'http://127.0.0.1:1/realms/qa',ALORA_CONNECT_CLIENT_ID:'qa-client',ALORA_CONNECT_CALLBACK_URL:'http://127.0.0.1:5174/auth/connect/callback',ALORA_AUTH_RETURN_URL:'http://127.0.0.1:5174/admin/#/login',ALORA_CONNECT_ENCRYPTION_KEY:'b'.repeat(64),ALORA_CONNECT_TENANTS_JSON:'{}'};
Object.assign(process.env,env);
async function main(){
 docker(['createdb','-U','barber_test',name]);created=true;
 execFileSync(process.execPath,['scripts/prisma-bootstrap.js'],{env,stdio:['ignore','pipe','pipe']});
 prisma=new PrismaClient({datasources:{db:{url:url.href}}});pool=new Pool({connectionString:url.href,max:4});
 const sdk=await import('@eulab/connect/application');
 const store=new sdk.PostgresConnectApplicationStore(pool,'adapter-transaction-qa');
 const {connectAccounts}=require('../dist/apps/api/common/connect-accounts.js');
 const {connectApplication,closeConnectApplication}=require('../dist/apps/api/common/connect-application.js');
 const accounts=connectAccounts(prisma,code=>{throw new sdk.ConnectApplicationError(code);});
 const [application,shared]=await Promise.all([connectApplication(prisma),connectApplication(prisma)]);
 assert.equal(application,shared);assert.equal(application.catalog.functions.length,22);checks++;
 const password='Synthetic-Adapter-Password-9!',passwordHash=await hash(password,4);
 const tenant=await prisma.tenant.create({data:{name:'Original company',slug:'adapter-original'}});
 const user=await prisma.user.create({data:{tenantId:tenant.id,email:'original@example.test',firstName:'Original',lastName:'Profile',role:'owner',permissions:['services.read'],passwordHash}});
 const professional=await prisma.collaborator.create({data:{tenantId:tenant.id,userId:user.id,firstName:'Original',lastName:'Professional'}});
 const customer=await prisma.customer.create({data:{tenantId:tenant.id,firstName:'Customer',lastName:'QA'}});
 const service=await prisma.service.create({data:{tenantId:tenant.id,name:'Service',durationMinutes:30,basePrice:'27.35'}});
 const appointment=await prisma.appointment.create({data:{tenantId:tenant.id,customerId:customer.id,collaboratorId:professional.id,serviceId:service.id,startsAt:new Date('2026-10-01T09:00:00Z'),endsAt:new Date('2026-10-01T09:30:00Z'),finalPrice:'27.35'}});
 const legacy=await accounts.verifyLegacy({email:user.email,password});assert.equal(legacy.localUser.id,user.id);assert(!JSON.stringify(legacy).includes(passwordHash));
 assert.equal(await accounts.verifyLegacy({email:user.email,password:'wrong'}),null);checks++;
 const context={tenant:{id:tenant.id,name:'Remote renamed company',slug:'remote-slug'},binding:{customerId:randomUUID(),installationId:randomUUID(),secret:'synthetic-installation'},user:{...legacy.localUser,subject:randomUUID(),firstName:'Remote name',permissions:['sales.manage']}};
 await assert.rejects(store.transaction('handoff-rollback',async transaction=>{await accounts.provision(context,{operationId:'handoff-rollback',transaction});await transaction.put('handoff-rollback','synthetic-marker',Date.now()+60000);throw Error('Injected failure before handoff commit');}),/Injected failure/);
 assert.equal((await prisma.user.findUnique({where:{id:user.id}})).connectActivatedAt,null);
 assert.equal(await prisma.connectTenantBinding.count(),0);assert.equal(await prisma.auditLog.count(),0);
 assert.equal(await store.transaction('inspect',tx=>tx.get('handoff-rollback')),null);checks++;
 const profile=await store.transaction('handoff-success',async transaction=>{const result=await accounts.provision(context,{operationId:'handoff-success',transaction});await transaction.put('handoff-success','consumed',Date.now()+60000);return result;});
 assert.deepEqual(profile,{localTenantId:tenant.id,localUserId:user.id});
 const preserved=await prisma.user.findUnique({where:{id:user.id}});assert.equal(preserved.passwordHash,passwordHash);assert.equal(preserved.firstName,user.firstName);assert.deepEqual(preserved.permissions,user.permissions);assert.equal(preserved.role,user.role);assert(preserved.connectActivatedAt);
 assert.equal((await prisma.tenant.findUnique({where:{id:tenant.id}})).name,tenant.name);
 const preservedAppointment=await prisma.appointment.findUnique({where:{id:appointment.id}});assert.equal(preservedAppointment.collaboratorId,professional.id);assert.equal(preservedAppointment.finalPrice.toFixed(2),'27.35');checks++;
 await store.transaction('handoff-repeat',transaction=>accounts.provision(context,{operationId:'handoff-success',transaction}));assert.equal(await prisma.user.count(),1);assert.equal(await prisma.connectTenantBinding.count(),1);checks++;
 assert.equal(await accounts.verifyLegacy({email:user.email,password}),null);checks++;
 await assert.rejects(store.transaction('foreign-installation',transaction=>accounts.provision({...context,binding:{...context.binding,installationId:randomUUID()}},{operationId:'foreign-installation',transaction})),error=>error.code==='provision_conflict');checks++;
 await assert.rejects(store.transaction('email-conflict',transaction=>accounts.provision({...context,user:{...context.user,id:randomUUID(),subject:randomUUID()}},{operationId:'email-conflict',transaction})),error=>error.code==='provision_conflict');assert.equal(await prisma.user.count(),1);checks++;
 const newcomer={tenant:{id:randomUUID(),name:'New authorized company',slug:'authorized-company'},binding:{customerId:randomUUID(),installationId:randomUUID(),secret:'synthetic-second-installation'},user:{...context.user,id:randomUUID(),subject:randomUUID(),email:'connect-only@example.test',role:'reception',permissions:['services.read']}};
 await store.transaction('newcomer',transaction=>accounts.provision(newcomer,{operationId:'newcomer',transaction}));
 const newUser=await prisma.user.findUnique({where:{id:newcomer.user.id}});assert.equal(newUser.tenantId,newcomer.tenant.id);assert.equal(await compare(password,newUser.passwordHash),false);assert.notEqual(newUser.passwordHash,passwordHash);checks++;
 assert.equal(await accounts.restrict(profile,'services.read',{tenantId:tenant.id}),true);
 assert.equal(await accounts.restrict(profile,'services.read',{tenantId:newcomer.tenant.id}),false);checks++;
 const collaborator=await prisma.user.create({data:{tenantId:tenant.id,email:'collaborator@example.test',firstName:'Collab',lastName:'QA',role:'collaborator',passwordHash}});
 const own=await prisma.collaborator.create({data:{tenantId:tenant.id,userId:collaborator.id,firstName:'Collab',lastName:'QA'}});
 const collabProfile={localTenantId:tenant.id,localUserId:collaborator.id};
 assert.equal(await accounts.restrict(collabProfile,'appointments.read.own',{tenantId:tenant.id,collaboratorId:own.id}),true);
 assert.equal(await accounts.restrict(collabProfile,'appointments.read.own',{tenantId:tenant.id,collaboratorId:professional.id}),false);
 assert.equal(await accounts.restrict(collabProfile,'dashboard.revenue.read',null),false);checks++;
 await prisma.tenant.update({where:{id:tenant.id},data:{isSuspended:true}});
 assert.equal(await accounts.restrict(profile,'services.read',null),false);
 await assert.rejects(store.transaction('suspended',transaction=>accounts.provision(context,{operationId:'suspended',transaction})),error=>error.code==='access_denied');checks++;
 await closeConnectApplication(prisma);
 report={at:new Date().toISOString(),checks,realPostgres:true,officialSdkStore:true,sameTransactionRollback:true,legacyHashProfileAndRelationsPreserved:true,noEmailMerge:true,connectOnlyUnusableLegacyHash:true,tenantAndPersonalRestrictions:true,providerTested:false,httpAuthCutover:false,production:false};
}
main().catch(error=>{failed=true;console.error(error.message);}).finally(async()=>{
 let cleanupVerified=true;
 try{if(prisma)await require('../dist/apps/api/common/connect-application.js').closeConnectApplication(prisma);}catch{cleanupVerified=false;}
 try{if(pool)await pool.end();}catch{cleanupVerified=false;}
 try{if(prisma)await prisma.$disconnect();}catch{cleanupVerified=false;}
 try{if(created)docker(['dropdb','-U','barber_test','--force',name]);}catch{cleanupVerified=false;}
 if(!cleanupVerified)failed=true;
 report??={checks,incomplete:true,production:false};report.cleanupVerified=cleanupVerified;report.status=failed?'failed':'passed';
 fs.mkdirSync('docs/verification',{recursive:true});fs.writeFileSync('docs/verification/connect-account-adapters.json',JSON.stringify(report,null,2)+'\n');
 if(failed)process.exitCode=1;else console.log('PASS: '+checks+' SDK account-adapter checks on disposable PostgreSQL; hash/profile/relations preserved, transactional rollback, no email merge, tenant/personal restrictions. HTTP authentication cutover not yet tested.');
});
