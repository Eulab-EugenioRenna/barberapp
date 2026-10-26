// Synthetic identity/SDK; real disposable PostgreSQL. Never logs in or calls Connect.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { compare } = require('bcrypt');
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!/^\/barber_team_accounts_test_[0-9]+$/.test(url.pathname)) throw Error('Use an isolated barber_team_accounts_test_<digits> database only');
const prisma = new PrismaClient();
async function main() {
  const [{ empty }] = await prisma.$queryRaw`SELECT to_regclass('public."User"') IS NULL AS empty`;
  assert.equal(empty, true);
  execFileSync(process.execPath, ['scripts/prisma-bootstrap.js'], { stdio: 'inherit', env: process.env });
  const { TeamAccountService } = require('../dist/apps/api/modules/team/team-account.service.js');
  const company = await prisma.tenant.create({ data: { name: 'Synthetic company', slug: randomUUID() } });
  const foreign = await prisma.tenant.create({ data: { name: 'Synthetic foreign', slug: randomUUID() } });
  const actor = await prisma.user.create({ data: { tenantId: company.id, email: 'actor@example.test', firstName: 'Actor', lastName: 'Fixture', role: 'owner', passwordHash: 'preserved-fixture-hash' } });
  actor.connectFunctions = ['team.manage', 'users.manage', 'appointments.read.own'];
  const installationId = 'synthetic-installation', customerId = 'synthetic-customer', appId = 'synthetic-app', sourceId = 'synthetic-source';
  process.env.ALORA_CONNECT_SOURCE_ID = sourceId;
  await prisma.connectTenantBinding.create({ data: { tenantId: company.id, installationId, customerId, secretCipher: 'synthetic-not-a-secret' } });
  const roleId = randomUUID(), own = ['appointments.read.own'];
  const overview = { installationId, customerId, appId, canManage: true, delegation: actor.connectFunctions.map(key=>({key})), functions: actor.connectFunctions.map(key=>({key,delegable:true})), roles: [{id: roleId,permissions:own}] };
  const providers = new Map();let calls = 0, failCode, mismatch = false;
  const team = {
    withTeam: (_auth, operation) => operation({teamOverview: async()=>overview}, 'synthetic-token', {tenantId: actor.tenantId,user:actor}),
    createUser: async (_auth, input) => {
      calls++;
      const saved = await prisma.user.findUniqueOrThrow({where:{id:input.localUser.localUserId},include:{accountIntent:true}});
      assert(saved.accountIntent);assert.equal(saved.isActive, false);assert.equal(saved.permissionsConfigured,true);
      assert.equal(await compare('transient-fixture-password',saved.passwordHash),false);
      assert.equal(JSON.stringify(saved).includes('transient-fixture-password'),false);
      if (failCode) { const e=new Error('SENSITIVE PROVIDER BODY MUST NOT ESCAPE');e.name='ConnectApiError';e.code=failCode;e.status=failCode==='mirror_password_rejected'?400:409;throw e; }
      if (!providers.has(saved.id)) providers.set(saved.id,{subject:randomUUID(),password:input.initialPassword});
      const provider=providers.get(saved.id);
      return {sourceId,appId,installationId,customerId,localTenantId:mismatch?foreign.id:company.id,localUserId:saved.id,subject:provider.subject,roleIds:input.roleIds,created:true,status:'created',applicationAccess:true,ssoSetupRequired:!provider.password};
    }
  };
  const service = new TeamAccountService(prisma,team);
  const professional = await prisma.collaborator.create({data:{tenantId:company.id,firstName:'Own',lastName:'Professional'}});
  const foreignProfessional = await prisma.collaborator.create({data:{tenantId:foreign.id,firstName:'Foreign',lastName:'Professional'}});
  const body = (extra={})=>({id:randomUUID(),email:randomUUID()+'@example.test',firstName:'Synthetic',lastName:'Account',role:'collaborator',permissions:own,roleIds:[roleId],collaboratorId:professional.id,initialPassword:'transient-fixture-password',...extra});
  await assert.rejects(service.create(undefined,body({role:'owner'})),/ruoli validi/);
  await assert.rejects(service.create(undefined,body({permissions:['team.manage']})),/Visibilità locale/);
  await assert.rejects(service.create(undefined,body({roleIds:[randomUUID()]})),/Ruolo fuori/);
  const foreignInput=body({collaboratorId:foreignProfessional.id});
  await assert.rejects(service.create(undefined,foreignInput),/Professionista non disponibile/);
  assert.equal(await prisma.user.count({where:{id:foreignInput.id}}),0,'Foreign relation must roll back profile creation');
  const first=body();const result=await service.create(undefined,first);
  assert.deepEqual(result,{id:first.id,completed:true,ssoSetupRequired:false});
  const saved=await prisma.user.findUniqueOrThrow({where:{id:first.id},include:{accountIntent:true,collaborator:true}});
  assert.equal(saved.isActive,true);assert.equal(saved.connectAcceptedAt,null);assert.equal(saved.connectSubject,providers.get(first.id).subject);assert.equal(saved.collaborator.id,professional.id);
  assert(saved.accountIntent.completedAt);
  const beforeRepeat=calls;
  await service.create(undefined,{...first,initialPassword:'replacement-must-not-apply'});
  assert.equal(calls,beforeRepeat);assert.equal(providers.get(first.id).password,'transient-fixture-password');
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:first.id}})).passwordHash,saved.passwordHash);
  await assert.rejects(service.create(undefined,body({collaboratorId:professional.id})),/già associato/);
  await assert.rejects(service.create(undefined,body({email:actor.email,collaboratorId:null,permissions:[]})),/Email o ID già utilizzati/);
  const pending=body({permissions:[],collaboratorId:null});failCode='mirror_password_rejected';
  try {await service.create(undefined,pending);assert.fail('Expected password rejection');} catch(error) {assert.equal(error.getStatus(),400);assert.equal(error.message.includes('SENSITIVE'),false);}
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:pending.id}})).isActive,false);
  assert((await service.pending()).some(row=>row.id===pending.id));
  assert.equal(await prisma.auditLog.count({where:{entityId:pending.id,action:'team.account.requested'}}),1);
  await assert.rejects(service.create(undefined,{...pending,firstName:'Changed'}),/ID di creazione già utilizzato/);
  failCode=undefined;await service.resume(undefined,pending.id,'transient-fixture-password');
  assert.equal(providers.get(pending.id).password,'transient-fixture-password');
  const uncertain=body({permissions:[],collaboratorId:null});let failOnce=true;
  const failing=prisma.$extends({query:{user:{async update({args,query}) {if(args.where.id===uncertain.id&&failOnce){failOnce=false;throw Error('synthetic finalization failure');}return query(args);}}}});
  await assert.rejects(new TeamAccountService(failing,team).create(undefined,uncertain),/conferma locale/);
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:uncertain.id}})).isActive,false);
  const originalProvider=providers.get(uncertain.id);
  await service.resume(undefined,uncertain.id,'changed-password-must-not-apply');
  assert.deepEqual(providers.get(uncertain.id),originalProvider);
  assert.equal(await prisma.auditLog.count({where:{entityId:uncertain.id,action:'team.account.requested'}}),1);
  assert.equal(await prisma.auditLog.count({where:{entityId:uncertain.id,action:'team.account.created'}}),1);
  const revoked=body({permissions:[],collaboratorId:null});failCode='mirror_access_revoked';
  const beforeFailure=calls;
  try {await service.create(undefined,revoked);assert.fail('Expected revocation refusal');} catch(error) {assert.equal(error.getStatus(),409);}
  assert.equal(calls,beforeFailure+1,'No automatic mutation retry');
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:revoked.id}})).isActive,false);
  failCode=undefined;await service.resume(undefined,revoked.id);
  const wrong=body({permissions:[],collaboratorId:null});mismatch=true;
  await assert.rejects(service.create(undefined,wrong),/Risposta Connect non coerente/);
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:wrong.id}})).isActive,false);mismatch=false;
  const noPassword=body({permissions:[],collaboratorId:null,initialPassword:undefined});
  assert.equal((await service.create(undefined,noPassword)).ssoSetupRequired,true);
  actor.tenantId=foreign.id;
  await assert.rejects(service.resume(undefined,wrong.id),/Installazione Connect non coerente/);
  actor.tenantId=company.id;
  overview.installationId='changed-installation';
  await assert.rejects(service.resume(undefined,wrong.id),/Installazione Connect non coerente/);
  overview.installationId=installationId;
  const draft=await prisma.teamAccountIntent.findUniqueOrThrow({where:{userId:wrong.id}});
  assert.equal(Object.keys(draft).some(key=>/password|cipher|token|secret/i.test(key)),false);
  await service.resume(undefined,wrong.id);
  assert.equal((await service.pending()).length,0);
  await prisma.user.update({where:{id:first.id},data:{isActive:false}});
  const beforeSuspendedResume=calls;
  await service.resume(undefined,first.id);
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:first.id}})).isActive,false,'Completed creation must not reactivate a suspended local account');
  assert.equal(calls,beforeSuspendedResume);

  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:actor.id}})).passwordHash,'preserved-fixture-hash');
  console.log('PASS: persisted inactive profile before SDK, policy/delegation, duplicate and tenant rejection, no stored password, explicit recovery, finalization rollback, stable identity/password, result binding checks and provider-setup indication. Synthetic SDK/identity; real PostgreSQL only.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>prisma.$disconnect());
