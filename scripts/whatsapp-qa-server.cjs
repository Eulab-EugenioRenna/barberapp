/** Disposable harness: real ALORA guards/session store + real Connect SDK, synthetic Connect/OIDC HTTP only. */
require('reflect-metadata');
const {randomUUID,createHash,randomBytes}=require('node:crypto');
const {createServer}=require('node:http');
const {pathToFileURL}=require('node:url');
const {PrismaClient}=require('@prisma/client');
const {NestFactory}=require('@nestjs/core');
const {Module,ValidationPipe}=require('@nestjs/common');
const {APP_GUARD,APP_INTERCEPTOR}=require('@nestjs/core');
const assert=require('node:assert/strict');
const database=new URL(process.env.DATABASE_URL).pathname.slice(1);
if(process.env.ALORA_WHATSAPP_TEST_ONLY!=='1'||!/^step11_qa_\d+$/.test(database))throw Error('Isolated Step 11 database required');
const load=p=>require('/app/dist/apps/api/'+p);
const {PrismaService}=load('prisma/prisma.service');
const {WhatsAppModule}=load('modules/whatsapp/whatsapp.module');
const {NotificationAutomationGrantsModule}=load('modules/notifications/notification-automation-grants.module');
const {NotificationAutomationGrantsService}=load('modules/notifications/notification-automation-grants.service');
const {NotificationAutomationWebhooksModule}=load('modules/notifications/notification-automation-webhooks.module');
const {configureRequestBodies}=load('common/request-bodies');
const {AuthController}=load('modules/auth/auth.controller');
const {ConnectAuthService}=load('modules/auth/connect-auth.service');
const {LocalPolicyGuard}=load('common/local-policy.guard');
const {RequestSessionInterceptor}=load('common/request-session.interceptor');
const {SecurityAuditInterceptor}=load('common/security-audit.interceptor');
const {connectApplication,closeConnectApplication}=load('common/connect-application');
const {createLocalSession}=load('common/local-sessions');
const {sealConnect}=load('common/connect-runtime');
const {ALORA_FUNCTIONS}=load('common/function-catalog');
const prisma=new PrismaClient(),contexts=new Map(),tokens=new Map(),codes=new Map(),actors={},installations=new Map();
const flags={unavailable:false,malformed:false,loseNextSend:false,hangNextSend:false,unsafeQr:false};
const calls=[];let app,provider;
const automationProvider=require('/qa/automation-provider-qa.cjs')({contexts,actors,tokens,installations,flags,calls,json:(...args)=>json(...args)});
const origin='http://127.0.0.1:53030',providerOrigin='http://127.0.0.1:3011';
Object.assign(process.env,{NODE_ENV:'test',ALORA_CONNECT_SOURCE_ID:'step11-synthetic-source',ALORA_CONNECT_BOOTSTRAP_SECRET:'synthetic-bootstrap',ALORA_CONNECT_APP_ID:'alora-step11-test',ALORA_CONNECT_API_URL:providerOrigin,ALORA_CONNECT_ISSUER:providerOrigin+'/realms/test',ALORA_CONNECT_CLIENT_ID:'step11-client',ALORA_CONNECT_CALLBACK_URL:origin+'/auth/connect/callback',ALORA_AUTH_RETURN_URL:origin+'/admin/#/login',ALORA_CONNECT_ENCRYPTION_KEY:'c'.repeat(64),ALORA_CONNECT_TENANTS_JSON:'{}',ALORA_CONNECT_WEBHOOK_ORIGIN:'https://hooks.alora.synthetic.test'});
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
const listen=(server,port)=>new Promise(resolve=>server.listen(port,'0.0.0.0',resolve));
async function main(){
 const {generateKeyPair,exportJWK,SignJWT}=await import(pathToFileURL(require.resolve('jose')).href);
 const keys=await generateKeyPair('RS256'),jwk=await exportJWK(keys.publicKey);jwk.kid='step11-synthetic';
 const issueTokens=async(userId,nonce)=>{const access=randomUUID(),refresh=randomUUID();tokens.set(access,userId);tokens.set(refresh,userId);const c=[...contexts.values()].find(c=>c.user.id===userId);return {access_token:access,refresh_token:refresh,expires_in:3600,id_token:await new SignJWT({nonce}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(process.env.ALORA_CONNECT_ISSUER).setAudience('step11-client').setSubject(c.user.subject).setIssuedAt().setExpirationTime('1h').sign(keys.privateKey)};};
 provider=createServer(async(req,res)=>{try{
  const u=new URL(req.url,providerOrigin);let raw='';for await(const chunk of req)raw+=chunk;
  if(u.pathname==='/v1/app-onboarding/login-context'){assert.equal(req.headers.authorization,'Bearer synthetic-bootstrap');const c=contexts.get(JSON.parse(raw).email);return json(res,200,c?{status:'connect',context:c}:{status:'not_found'});}
  if(u.pathname.endsWith('/certs'))return json(res,200,{keys:[jwk]});
  if(u.pathname.endsWith('/token')){const b=new URLSearchParams(raw);if(b.get('grant_type')==='refresh_token'){const userId=tokens.get(b.get('refresh_token'));if(!userId)return json(res,400,{});return json(res,200,await issueTokens(userId,'refresh'));}const c=codes.get(b.get('code'));codes.delete(b.get('code'));assert(c);assert.equal(createHash('sha256').update(b.get('code_verifier')).digest('base64url'),c.challenge);return json(res,200,await issueTokens(c.userId,c.nonce));}
  if(await automationProvider.handle(req,res,u,raw))return;
  const userId=tokens.get((req.headers.authorization||'').replace('Bearer ','')),context=[...contexts.values()].find(c=>c.user.id===userId);
  if(!context)return json(res,401,{});
  assert.equal(req.headers['x-installation-id'],context.binding.installationId);assert.equal(req.headers['x-installation-secret'],context.binding.secret);
  const actor=Object.values(actors).find(a=>a.userId===userId);
  if(u.pathname==='/v1/access'){
   if(flags.unavailable)return json(res,503,{});
   return json(res,200,{installationId:context.binding.installationId,appId:'alora-step11-test',subject:context.user.subject,localUserId:userId,canLogin:!actor.revoked,functions:actor.permissions.map(key=>({key,name:key})),catalogVersion:7,functionsStatus:'ready'});
  }
  const prefix='/v1/installations/'+context.binding.installationId+'/whatsapp';
  if(!u.pathname.startsWith(prefix+'/'))return json(res,404,{});
  const route=u.pathname.slice(prefix.length), permission=route.endsWith('/qr')||req.method==='POST'&&!route.endsWith('/messages')?'whatsapp.manage':route.endsWith('/messages')&&req.method==='POST'?'whatsapp.send':'whatsapp.read';
  if(!actor.permissions.includes(permission))return json(res,403,{});
  calls.push({actor:actor.name,route,method:req.method});
  if(flags.malformed){res.writeHead(200,{'Content-Type':'text/html'});return res.end('<html>Maintenance</html>');}
  const installation=installations.get(context.binding.installationId),s=installation.session;
  if(route==='/sessions'&&req.method==='GET')return json(res,200,s?[s]:[]);
  if(route==='/sessions'&&req.method==='POST'){if(s&&!s.closed_at)return json(res,409,{});installation.session=makeSession(installation,'pairing');return json(res,201,{id:installation.session.id,state:'queued'});}
  if(route==='/archives')return json(res,200,[{id:installation.archiveId,number:'393330000001',installation_id:context.binding.installationId,secret:'must-not-project'}]);
  if(route==='/outbox')return json(res,200,[...installation.outbox.values()].map(o=>({...o,payload:'must-not-project'})));
  if(route.startsWith('/archives/')){const a=route.split('/')[2];if(a!==installation.archiveId)return json(res,200,[]);
   if(route.endsWith('/conversations'))return json(res,200,[{chat_id:'393330000002@c.us',messages:52,last_message_at:'2026-11-09T09:52:00Z',preview:'Ultima risposta sintetica',kind:'text',direction:'in',contact:{name:'Cliente di prova',pushName:null,avatar:'https://untrusted.invalid/image'},private:'must-not-project'}]);
   if(route.endsWith('/messages')){let messages=installation.messages;if(u.searchParams.get('chat')!=='393330000002@c.us')messages=[];if(u.searchParams.has('before')){const index=messages.findIndex(m=>m.id===u.searchParams.get('before'));messages=index<0?[]:messages.slice(index+1);}return json(res,200,messages.slice(0,50));}
  }
  if(route.startsWith('/sessions/')){if(!s||route.split('/')[2]!==s.id)return json(res,404,{});
   if(route.endsWith('/qr'))return json(res,200,{state:s.state,qr:flags.unsafeQr?'https://untrusted.invalid/qr':s.state==='pairing'?'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==':null});
   if(route.endsWith('/disconnect')){s.state='disconnecting';return json(res,201,{id:s.id,state:s.state});}
   if(route.endsWith('/reconnect')){s.state='queued';return json(res,201,{id:s.id,state:s.state});}
   if(route.endsWith('/messages')){
    const b=JSON.parse(raw),key=req.headers['idempotency-key'];assert(key&&/^[a-f0-9-]{36}$/.test(key));assert.equal(b.kind,'text');
    if(!/^(\+?[1-9][0-9 ]{6,20}|[1-9][0-9]{6,14}@c\.us)$/.test(b.to))return json(res,400,{});
    if(s.state!=='connected')return json(res,409,{});
    const old=installation.outbox.get(key),fingerprint=JSON.stringify(b);
    if(old&&old.fingerprint!==fingerprint)return json(res,409,{});
    const o=old||{id:randomUUID(),session_id:s.id,state:'queued',provider_id:null,error:null,created_at:new Date().toISOString(),fingerprint};installation.outbox.set(key,o);
    if(flags.loseNextSend){flags.loseNextSend=false;return res.destroy();}
    if(flags.hangNextSend){flags.hangNextSend=false;return;}
    return json(res,201,{id:o.id,state:o.state});
   }
  }
  return json(res,404,{});
 }catch{json(res,500,{message:'Synthetic provider assertion failed'});}});
 await listen(provider,3011);
 const all=ALORA_FUNCTIONS.map(f=>f.key);
 for(const label of ['a','b']){
  const tenant=await prisma.tenant.create({data:{name:'WhatsApp synthetic '+label,slug:'step11-'+label}}),location=await prisma.location.create({data:{tenantId:tenant.id,name:'Synthetic location'}});
  const sectors=[];for(const name of ['First','Second'])sectors.push(await prisma.sector.create({data:{tenantId:tenant.id,locationId:location.id,name}}));
  const installationId=randomUUID(),archiveId=randomUUID(),installation={archiveId,outbox:new Map(),messages:[],session:null};installations.set(installationId,installation);
  for(let i=52;i>=1;i--)installation.messages.push({id:randomUUID(),chat_id:'393330000002@c.us',direction:i%2?'in':'out',kind:'text',occurred_at:new Date(Date.UTC(2026,10,9,9,i)).toISOString(),body:{text:i===52?'<img src=x onerror=alert(1)>':'Messaggio sintetico '+i},authorization_cipher:'must-not-project'});
  installation.session=makeSession(installation,'pairing');
  const names=label==='a'?['owner','reader','sender','administrator','partial','none','automation_manager']:['foreign'];
  for(const name of names){
   const permissions=name==='reader'?['whatsapp.read']:name==='sender'?['whatsapp.read','whatsapp.send']:name==='administrator'?['whatsapp.read','whatsapp.manage']:name==='none'?['appointments.read.all']:all;
   const role=['owner','foreign'].includes(name)?'owner':'manager';
   const user=await prisma.user.create({data:{tenantId:tenant.id,email:`${name}@step11.invalid`,passwordHash:'disabled-synthetic',firstName:'Synthetic',lastName:name,role,permissions,permissionsConfigured:true}});
   if(role==='manager')for(const sector of name==='partial'?sectors.slice(0,1):sectors)await prisma.userSectorAccess.create({data:{userId:user.id,sectorId:sector.id}});
   const context={tenant:{id:tenant.id,name:tenant.name,slug:tenant.slug},binding:{customerId:randomUUID(),installationId,secret:'synthetic-installation-secret'},user:{id:user.id,subject:'subject-'+user.id,email:user.email,firstName:user.firstName,lastName:user.lastName,role,permissions}};
   // All identities in one installation must share its customer binding.
   const prior=[...contexts.values()].find(c=>c.binding.installationId===installationId);if(prior)context.binding.customerId=prior.binding.customerId;
   contexts.set(user.email,context);actors[name]={name,userId:user.id,tenantId:tenant.id,permissions:[...permissions],revoked:false};
  }
 }
 const application=await connectApplication(prisma);
 for(const actor of Object.values(actors)){
  const c=[...contexts.values()].find(c=>c.user.id===actor.userId),browser={origin,cookies:{}};
  const start=await application.auth.signIn({email:c.user.email},browser);assert.equal(start.status,'redirect');for(const cookie of start.cookies)browser.cookies[cookie.name]=cookie.value;
  const auth=new URL(start.url),code=randomUUID();codes.set(code,{challenge:auth.searchParams.get('code_challenge'),nonce:auth.searchParams.get('nonce'),userId:actor.userId});
  const handoff=await application.auth.callback({state:auth.searchParams.get('state'),code},browser);for(const cookie of handoff.cookies)browser.cookies[cookie.name]=cookie.value;
  const accepted=await application.auth.exchange(handoff.handoff,browser);
  const linked=await prisma.connectSession.create({data:{userId:actor.userId,installationId:c.binding.installationId,accessCipher:sealConnect('unused-synthetic'),sdkSessionCipher:sealConnect(accepted.session.sessionId),expiresAt:new Date(accepted.session.expiresAt)}});
  actor.session=await prisma.$transaction(tx=>createLocalSession(tx,actor.userId,undefined,undefined,linked.id));
 }
 const workflow=process.env.ALORA_APPOINTMENT_WORKFLOW_TEST_ONLY==='1'?await require('/qa/appointment-workflow-qa-setup.cjs')({prisma,actors}):null;
 class QaModule{}
 // WhatsAppModule receives the same real Prisma instance through a test-global provider module.
 const {Global}=require('@nestjs/common');class QaPrismaModule{};Global()(QaPrismaModule);Module({providers:[{provide:PrismaService,useValue:prisma}],exports:[PrismaService]})(QaPrismaModule);
 Module({imports:[QaPrismaModule,WhatsAppModule,NotificationAutomationGrantsModule,NotificationAutomationWebhooksModule],controllers:[AuthController,...(workflow?.controllers||[])],providers:[...(workflow?.providers||[]),{provide:ConnectAuthService,useValue:{}},{provide:APP_GUARD,useClass:LocalPolicyGuard},{provide:APP_INTERCEPTOR,useClass:RequestSessionInterceptor},{provide:APP_INTERCEPTOR,useClass:SecurityAuditInterceptor}]})(QaModule);
 app=await NestFactory.create(QaModule,{logger:["error","warn","log"],bodyParser:false,abortOnError:false});app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));
 app.use('/health',(_req,res)=>json(res,200,{testOnly:true,database,provider:'synthetic-loopback',realSdk:true,sdkVersion:require('node:fs').readFileSync('/app/node_modules/@eulab/connect/package.json','utf8')&&JSON.parse(require('node:fs').readFileSync('/app/node_modules/@eulab/connect/package.json','utf8')).version}));
 app.use('/_qa',async(req,res)=>{
  if(req.headers['x-alora-qa']!=='step11-synthetic')return json(res,403,{});
  try{let raw='';for await(const chunk of req)raw+=chunk;const b=raw?JSON.parse(raw):{};
   if(req.method==='POST'){
    if(b.workflow){if(!workflow)return json(res,403,{});return json(res,200,await workflow.control(b.workflow));}
    if(b.flags)Object.assign(flags,b.flags);
    if(b.releaseGrantCommit)automationProvider.release();
    if(b.releaseMessageCommit)automationProvider.releaseMessage();
    if(b.disableWebhooks)automationProvider.disableHooks();
    if(b.signWebhook)return json(res,200,{signature:automationProvider.sign(b.signWebhook.endpointId,b.signWebhook.raw,b.signWebhook.timestamp)});
    if(b.expireTokenActor)for(const [key,userId]of tokens)if(userId===actors[b.expireTokenActor].userId)tokens.delete(key);
    if(b.worker){const service=app.get(NotificationAutomationGrantsService);try{const value=b.worker==='verify'?await service.verifyForWorker(b.id):b.worker==='send'?await service.sendForWorker(b.id,b.commandId,b.payload):b.worker==='withdraw'?await service.withdrawForWorker(b.id,b.commandId,b.payload):await service.messageState(b.id,b.commandId);return json(res,200,value)}catch(e){const status=e.getStatus?.()||e.status;return json(res,status>=400&&status<600?status:503,{message:'Synthetic worker request rejected'})}}
    if(b.actor&&b.permissions)actors[b.actor].permissions=b.permissions;
    if(b.actor&&typeof b.revoked==='boolean')actors[b.actor].revoked=b.revoked;
    if(b.connectionState)for(const installation of installations.values())if(installation.session){installation.session.state=b.connectionState;if(b.connectionState==='connected')installation.session.number='393330000001';installation.session.closed_at=b.closed?new Date().toISOString():null;}
    if(b.outboxState)for(const installation of installations.values())for(const o of installation.outbox.values()){o.state=b.outboxState;if(o.delegatedStatus)o.delegatedStatus.state=b.outboxState;}
    if(b.delegatedMessage)for(const installation of installations.values())for(const o of installation.outbox.values())if(o.id===b.delegatedMessage.id){o.state=b.delegatedMessage.state;o.delegatedStatus={...o.delegatedStatus,state:b.delegatedMessage.state,error:b.delegatedMessage.error||null};}
   }
   const snapshot={automation:automationProvider.summary(),actors:Object.fromEntries(Object.entries(actors).map(([k,a])=>[k,{userId:a.userId,tenantId:a.tenantId,session:a.session}])),installations:[...installations.entries()].map(([id,i])=>({id,archiveId:i.archiveId,session:i.session,outbox:[...i.outbox.entries()].map(([key,o])=>({key,id:o.id,state:o.state,fingerprint:o.fingerprint}))})),calls};return json(res,200,snapshot);
  }catch{return json(res,500,{});}
 });
 configureRequestBodies(app);
 await app.listen(3000,'0.0.0.0');console.log(JSON.stringify({ready:true,database,realSdk:true,provider:'synthetic-loopback'}));
}
function makeSession(i,state){return {id:randomUUID(),number:state==='connected'?'393330000001':null,state,archive_id:i.archiveId,runner_online:true,runner_id:'must-not-project',closed_at:null,created_at:new Date().toISOString(),delete_requested:false,sync_count:52,sync_status:'available_history_synced',sync_limit:'available'};}
async function close(){await app?.close();await closeConnectApplication(prisma);await prisma.$disconnect();provider?.close();process.exit();}
process.on('SIGTERM',()=>void close());
main().catch(e=>{console.error(e.stack || e.message);process.exitCode=1;void close();});
