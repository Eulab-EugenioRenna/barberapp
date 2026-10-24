/* Opt-in local Docker integration. Real Keycloak authorization-code/PKCE over HTTP, no browser UI. */
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),{PrismaClient}=require('@prisma/client'),{hash,compare}=require('bcrypt');
const databaseUrl=process.env.DATABASE_URL;
if(process.env.ALORA_REAL_CONNECT_QA!=='1'||!databaseUrl||new URL(databaseUrl).pathname!=='/barber_security_test')throw Error('Requires ALORA_REAL_CONNECT_QA=1 and isolated barber_security_test');
const root=resolve(process.env.CONNECT_CHECKOUT||'../eulab connect');process.loadEnvFile(root+'/.env');
const connect='http://localhost:8088',issuer='http://localhost:8080/realms/eulab',base='http://localhost:5174';
const suffix=randomUUID().slice(0,8),appId='qa-alora-'+suffix,sourceId='qa-alora-source-'+suffix;
const password='QA-Alora-Temporary-9!'+suffix,prisma=new PrismaClient({datasources:{db:{url:databaseUrl}}});
let child,bridge,adminToken,source,tenant,practice,installation,customer,report,failed=false,checks=0;
const identities=new Set(),fixtureUsers=new Set();
async function dockerNode(code,input){
 return new Promise((resolve,reject)=>{const proc=spawn('docker',['exec','-i','eulab-connect-api-1','node','--input-type=module','-e',code],{stdio:['pipe','pipe','pipe']});let out='';proc.stdout.on('data',chunk=>out+=chunk);proc.stderr.resume();proc.once('error',reject);proc.once('exit',status=>status===0?resolve(out):reject(Error('Docker QA helper failed')));proc.stdin.end(JSON.stringify(input));});
}
async function sql(query,params=[]){
 return JSON.parse(await dockerNode(`import pg from 'pg';let text='';for await(const c of process.stdin)text+=c;const input=JSON.parse(text);const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();try{console.log(JSON.stringify((await db.query(input.query,input.params)).rows));}finally{await db.end();}`,{query,params}));
}
const decode=value=>value.replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"');
async function authorizationCode(url,username,secret,continueAuthentication){
 const jar=new Map();
 const send=async(target,body)=>{const response=await fetch(target,{method:body?'POST':'GET',redirect:'manual',headers:{...(jar.size?{cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}:{}),...(body?{'content-type':'application/x-www-form-urlencoded'}:{})},body});for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';'),at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}return response;};
 let response=await send(url);for(let i=0;i<5&&response.status>=300&&response.status<400;i++)response=await send(new URL(response.headers.get('location'),url).href);
 const html=await response.text(),form=html.match(/<form\b[^>]*\bid=["']kc-form-login["'][^>]*>/i)?.[0];
 if(!form)throw Error('Keycloak login form unavailable or requires an additional action');
 const action=decode(form.match(/\baction=["']([^"']+)["']/i)?.[1]||'');assert(action);
 response=await send(new URL(action,issuer).href,new URLSearchParams({username,password:secret,credentialId:''}));
 const location=response.headers.get('location');
 if(continueAuthentication)return continueAuthentication({response,send,location});
 if(!location)throw Error('Keycloak did not issue an authorization code: credentials or required actions need verification');
 return new URL(location,issuer);
}
async function loginAdmin(){
 const verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url'),redirect=connect+'/';
 const url=new URL(issuer+'/protocol/openid-connect/auth');
 for(const [k,v] of Object.entries({client_id:'connect-admin',redirect_uri:redirect,response_type:'code',scope:'openid profile email',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))url.searchParams.set(k,v);
 const callback=await authorizationCode(url.href,process.env.EULAB_ADMIN_USERNAME,process.env.EULAB_ADMIN_PASSWORD);assert.equal(callback.searchParams.get('state'),state);assert(callback.searchParams.has('code'));
 const response=await fetch(issuer+'/protocol/openid-connect/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:'connect-admin',redirect_uri:redirect,code_verifier:verifier,code:callback.searchParams.get('code')})});assert(response.ok,'Admin OIDC token exchange failed');adminToken=(await response.json()).access_token;checks++;
}
async function api(path,method='GET',body){
 const response=await fetch(connect+path,{method,headers:{'content-type':'application/json',Authorization:'Bearer '+adminToken},body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();
 if(!response.ok)throw Error(`Connect ${method} ${path}: HTTP ${response.status}`);return text?JSON.parse(text):null;
}
const aloraCookies=new Map();
async function alora(path,{body,token,cookie,expected=body?201:200}={}){
 const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(body?{origin:base}:{}),...(token?{Authorization:'Bearer '+token}:{}),...((cookie||aloraCookies.size)?{cookie:cookie||[...aloraCookies].map(([k,v])=>k+'='+v).join('; ')}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual'});
 for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';'),at=pair.indexOf('=');aloraCookies.set(pair.slice(0,at),pair.slice(at+1));}
 const text=await response.text();assert.equal(response.status,expected,`ALORA ${path}: HTTP ${response.status}`);assert(!text.includes(password));checks++;let data;try{data=JSON.parse(text);}catch{data=text;}return {response,data};
}
async function sso(email,continueAuthentication){
 const start=await alora('/auth/login',{body:{email}});assert.equal(start.data.status,'connect_redirect');const cookie=start.response.headers.get('set-cookie').split(';')[0];
 const callback=await authorizationCode(start.data.redirectUrl,email,password,continueAuthentication);assert.equal(callback.origin,base);assert(callback.searchParams.has('code'));
 const returned=await alora(callback.pathname+callback.search,{cookie,expected:303});const handoff=new URLSearchParams(new URL(returned.response.headers.get('location')).hash.split('?')[1]).get('alora_connect');assert(handoff,'ALORA rejected the real Keycloak callback');
 return (await alora('/auth/connect/exchange',{body:{handoff}})).data;
}
// TOTP helpers are QA-only; shared SDK code is not reimplemented for the application.
function otp(secret,policy){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',bytes=[];let buffer=0,bits=0;
 for(const char of secret.toUpperCase().replace(/[ =]/g,'')){const value=alphabet.indexOf(char);assert(value>=0,'Invalid QA OTP seed');buffer=(buffer<<5)|value;bits+=5;if(bits>=8){bits-=8;bytes.push((buffer>>>bits)&255);}}
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/1000/policy.otpPolicyPeriod)));
 const value=createHmac(policy.otpPolicyAlgorithm.replace(/^Hmac/,'').toLowerCase(),Buffer.from(bytes)).update(counter).digest(),offset=value.at(-1)&15;
 return String((value.readUInt32BE(offset)&0x7fffffff)%10**policy.otpPolicyDigits).padStart(policy.otpPolicyDigits,'0');
}
let identityAdminToken;
async function identityAdmin(path,method='GET',body){
 if(!identityAdminToken){const response=await fetch(issuer+'/protocol/openid-connect/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:'connect-identity-admin',client_secret:process.env.OIDC_IDENTITY_ADMIN_SECRET})});assert(response.ok,'QA identity administration unavailable');identityAdminToken=(await response.json()).access_token;}
 const response=await fetch(issuer.replace('/realms/','/admin/realms/')+path,{method,headers:{Authorization:'Bearer '+identityAdminToken,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert(response.ok,'QA identity administration request failed');const text=await response.text();return text?JSON.parse(text):null;
}
async function providerPage(response,send){
 for(let i=0;i<8;i++){
  const location=response.headers.get('location');
  if(!location)return {response,html:await response.text()};
  const target=new URL(location,issuer);if(target.origin!==new URL(issuer).origin)return {callback:target};
  response=await send(target.href);
 }
 throw Error('Too many provider redirects');
}
function formAction(html,id){
 const forms=html.match(/<form\b[^>]*>/gi)||[],form=forms.find(value=>value.includes('id="'+id+'"')||value.includes("id='"+id+"'"));assert(form,'Expected provider form is missing');
 return decode(form.match(/\baction=["']([^"']+)["']/i)?.[1]||'');
}
function inputValue(html,name){
 const inputs=html.match(/<input\b[^>]*>/gi)||[],input=inputs.find(value=>value.includes('name="'+name+'"')||value.includes("name='"+name+"'"));assert(input,'Expected provider field is missing');
 return decode(input.match(/\bvalue=["']([^"']*)["']/i)?.[1]||'');
}
async function main(){
 await loginAdmin();
 // Loopback-only test bridge: production Connect source endpoints are reached from its API container loopback.
 // This avoids changing ingress/TLS configuration and does not test public production transport.
 bridge=createServer(async(req,res)=>{try{let raw='';for await(const chunk of req)raw+=chunk;const result=JSON.parse(await dockerNode(`let raw='';for await(const c of process.stdin)raw+=c;const p=JSON.parse(raw);const r=await fetch('http://127.0.0.1:3000'+p.path,{method:p.method,headers:p.headers,body:p.method==='GET'?undefined:p.body,redirect:'error'});console.log(JSON.stringify({status:r.status,body:await r.text()}));`,{path:req.url,method:req.method,headers:{'content-type':'application/json',...(req.headers.authorization?{authorization:req.headers.authorization}:{}),...(req.headers['x-connect-source']?{'x-connect-source':req.headers['x-connect-source']}:{}),...(req.headers['idempotency-key']?{'idempotency-key':req.headers['idempotency-key']}:{}),...(req.headers['x-installation-id']?{'x-installation-id':req.headers['x-installation-id']}:{}),...(req.headers['x-installation-secret']?{'x-installation-secret':req.headers['x-installation-secret']}: {})},body:raw}));res.writeHead(result.status,{'content-type':'application/json'});res.end(result.body);}catch{res.writeHead(503,{'content-type':'application/json'});res.end('{"message":"QA bridge unavailable"}');}});
 await new Promise(r=>bridge.listen(0,'127.0.0.1',r));const sourceApi=`http://127.0.0.1:${bridge.address().port}`;
 source=await api('/v1/connect-sources','POST',{id:sourceId,appId,name:'Disposable ALORA QA '+suffix,environment:'development',origins:[base],catalogUrl:base+'/.well-known/eulab-connect.json',oidcCallbacks:[base+'/auth/connect/callback'],deploymentIdentity:'alora-real-oidc-qa-'+suffix});
 tenant=await prisma.tenant.create({data:{name:'Disposable ALORA QA '+suffix,slug:'qa-alora-'+suffix}});
 const legacy=await prisma.user.create({data:{tenantId:tenant.id,email:'qa-alora-'+suffix+'@example.test',firstName:'QA',lastName:'Legacy',role:'owner',passwordHash:await hash(password,4)}});fixtureUsers.add(legacy.id);
 child=spawn(process.execPath,['dist/apps/api/main.js'],{env:{...process.env,NODE_ENV:'test',DATABASE_URL:databaseUrl,PORT:'5174',REDIS_HOST:'127.0.0.1',REDIS_PORT:'56389',SMTP_HOST:'127.0.0.1',SMTP_PORT:'1',ALORA_CONNECT_SOURCE_ID:sourceId,ALORA_CONNECT_BOOTSTRAP_SECRET:source.secret,ALORA_CONNECT_APP_ID:appId,ALORA_CONNECT_API_URL:sourceApi,ALORA_CONNECT_ISSUER:issuer,ALORA_CONNECT_CLIENT_ID:'connect-demo',ALORA_CONNECT_CALLBACK_URL:base+'/auth/connect/callback',ALORA_AUTH_RETURN_URL:base+'/admin/#/login',ALORA_CONNECT_ENCRYPTION_KEY:randomBytes(32).toString('hex'),ALORA_CONNECT_TENANTS_JSON:'{}'},stdio:['ignore','ignore','ignore']});
 let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('QA ALORA API did not start');try{ready=(await fetch(base+'/health')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}assert(ready);
 const proof=(await alora('/auth/login',{body:{email:legacy.email,password}})).data;assert.equal(proof.accessToken,undefined);assert.equal(proof.status,'migration_required');
 const submitted=(await alora('/auth/connect/accept',{body:{challenge:proof.onboarding.challenge,password,firstName:legacy.firstName,lastName:legacy.lastName,accepted:true,consentVersion:proof.onboarding.version}})).data;
 const row=(await sql('SELECT practice_id,password_cipher FROM onboarding_requests WHERE id=$1',[submitted.request.requestId]))[0];practice=row.practice_id;assert(row.password_cipher);assert(!row.password_cipher.includes(password));
 await api('/v1/applications','POST',{id:appId,name:'Disposable ALORA QA '+suffix,description:'Protocol QA fixture'});
 // Seed the effective ALORA matrix: public HTTPS catalog retrieval is a separate acceptance requirement.
 const matrix=await (await fetch(base+'/.well-known/eulab-connect.json')).json();
 await sql('INSERT INTO catalogs(app_id,version,document) VALUES($1,$2,$3)',[appId,matrix.version,JSON.stringify(matrix)]);
 for(const fn of matrix.functions){await sql('INSERT INTO features(app_id,key,name) VALUES($1,$2,$3)',[appId,fn.key,fn.name]);await sql('INSERT INTO permissions(app_id,key,feature_key,name) VALUES($1,$2,$2,$3)',[appId,fn.key,fn.name]);}
 await sql('UPDATE applications SET catalog_version=$2 WHERE id=$1',[appId,matrix.version]);
 const plan={license:{state:'active',expiresAt:null,features:[{key:'services.read',purchased:true,enabled:true}]},roles:[{localRole:'owner',roleName:'QA owner '+suffix,permissions:['services.read']}]};
 await api('/v1/onboarding/practices/'+practice+'/plan','PUT',plan);
 const executed=await api('/v1/onboarding/practices/'+practice+'/execute','POST',{});assert.equal(executed.state,'completed','Migration not completed');installation=executed.installation.id;customer=(await sql('SELECT customer_id FROM installations WHERE id=$1',[installation]))[0].customer_id;
 identities.add(executed.requests[0].identitySubject);assert.equal(executed.requests[0].credentialPresent,false);
 let session=await sso(legacy.email);assert.equal((await alora('/auth/me',{token:session.accessToken})).data.id,legacy.id);await alora('/services',{token:session.accessToken});await alora('/dashboard/revenue',{token:session.accessToken,expected:403});
 const preserved=await prisma.user.findUnique({where:{id:legacy.id}});assert.equal(preserved.passwordHash,legacy.passwordHash);assert(preserved.connectActivatedAt);
 const stored=await prisma.localSession.findUnique({where:{accessHash:createHash('sha256').update(session.accessToken).digest('hex')}});const bridgeSession=await prisma.connectSession.findUnique({where:{id:stored.connectSessionId}});assert(bridgeSession.sdkSessionCipher);assert.equal(bridgeSession.accessCipher,'');assert.equal(bridgeSession.refreshCipher,null);session=(await alora('/auth/refresh',{body:{refreshToken:session.refreshToken}})).data;await alora('/auth/me',{token:session.accessToken});
 // Explicit Connect-only users are provisioned in ALORA only after successful SSO.
 const receptionRole=await api('/v1/roles','PUT',{customerId:customer,appId,name:'QA reception '+suffix,permissions:['services.read'],reason:'Disposable QA explicit role'});
 async function connectOnly(label,temporaryPassword){
  const username='qa-alora-'+label+'-'+suffix,email=username+'@example.test',localId=randomUUID();
  const identity=await api('/v1/sso-identities','POST',{username,email,displayName:'QA '+label,userType:'client',password,temporaryPassword});
  identities.add(identity.subject);fixtureUsers.add(localId);
  await api('/v1/connect-sources/'+sourceId+'/local-users','POST',{installationId:installation,localTenantId:tenant.id,localUserId:localId,subject:identity.subject,email,firstName:'QA',lastName:label,role:'reception',permissions:['services.read'],enabled:true});
  await api('/v1/memberships','PUT',{subject:identity.subject,customerId:customer,enabled:true,roleIds:[receptionRole.id]});
  assert.equal(await prisma.user.count({where:{id:localId}}),0);
  return {email,localId,subject:identity.subject};
 }
 const newcomer=await connectOnly('connectonly',false);
 const newcomerSession=await sso(newcomer.email);
 const newProfile=await prisma.user.findUnique({where:{id:newcomer.localId}});assert(newProfile?.connectActivatedAt);assert.equal(newProfile.tenantId,tenant.id);assert.equal(await compare(password,newProfile.passwordHash),false);
 assert.equal((await alora('/auth/me',{token:newcomerSession.accessToken})).data.id,newcomer.localId);
 const actionUser=await connectOnly('requiredaction',true);
 const actionStart=await alora('/auth/login',{body:{email:actionUser.email}});
 const actionReturn=await authorizationCode(actionStart.data.redirectUrl,actionUser.email,password);
 assert.equal(actionReturn.origin,new URL(issuer).origin);assert.equal(actionReturn.searchParams.has('code'),false);
 assert.equal(await prisma.user.count({where:{id:actionUser.localId}}),0);
 checks++;
 // Enable the required action only for this disposable account; never change the realm policy.
 const mfaUser=await connectOnly('mfa',false),managed=await identityAdmin('/users/'+mfaUser.subject),policy=await identityAdmin('');
 assert.equal(managed.username,'qa-alora-mfa-'+suffix);
 await identityAdmin('/users/'+mfaUser.subject,'PUT',{...managed,requiredActions:['CONFIGURE_TOTP']});
 let seed;
 const enrolled=await sso(mfaUser.email,async({response,send})=>{
  let page=await providerPage(response,send);assert(!page.callback,'MFA configuration was bypassed');
  const manual=(page.html.match(/<a\b[^>]*>/gi)||[]).find(value=>value.includes('id="mode-manual"'));
  assert(manual,'Manual OTP setup link is missing');
  const manualUrl=decode(manual.match(/\bhref=["']([^"']+)["']/i)?.[1]||'');
  page=await providerPage(await send(manualUrl),send);
  // The displayed Base32 key differs from Keycloak's hidden raw totpSecret field.
  seed=decode(page.html.match(/<[^>]+id=["']kc-totp-secret-key["'][^>]*>([^<]+)</i)?.[1]||'').replace(/\s+/g,'');assert(seed);
  const rawSecret=inputValue(page.html,'totpSecret'),action=formAction(page.html,'kc-totp-settings-form');
  const result=await providerPage(await send(action,new URLSearchParams({totpSecret:rawSecret,mode:'manual',totp:otp(seed,policy),userLabel:'Disposable ALORA QA'})),send);
  assert(result.callback?.searchParams.has('code'),'MFA enrollment did not return an authorization code');return result.callback;
 });
 assert.equal((await alora('/auth/me',{token:enrolled.accessToken})).data.id,mfaUser.localId);
 const sessionsBefore=await prisma.localSession.count({where:{userId:mfaUser.localId}});
 await assert.rejects(sso(mfaUser.email),/authorization code/);
 assert.equal(await prisma.localSession.count({where:{userId:mfaUser.localId}}),sessionsBefore);
 // Registration may already consume the current OTP time step. Wait for the next period to avoid reuse.
 const delay=(policy.otpPolicyPeriod-Math.floor(Date.now()/1000)%policy.otpPolicyPeriod+1)*1000;
 console.log('MFA QA: waiting for the next OTP time step ('+Math.ceil(delay/1000)+' seconds).');
 await new Promise(resolve=>setTimeout(resolve,delay));
 const mfaSession=await sso(mfaUser.email,async({response,send})=>{
  const page=await providerPage(response,send);assert(!page.callback,'OTP was not required');
  let action=formAction(page.html,'kc-otp-login-form');
  const correct=otp(seed,policy),wrong=String((Number(correct)+1)%10**policy.otpPolicyDigits).padStart(policy.otpPolicyDigits,'0');
  const rejected=await providerPage(await send(action,new URLSearchParams({otp:wrong,login:'Log In'})),send);
  assert(!rejected.callback,'Wrong OTP was accepted');
  assert.equal(await prisma.localSession.count({where:{userId:mfaUser.localId}}),sessionsBefore);
  action=formAction(rejected.html,'kc-otp-login-form');
  const accepted=await providerPage(await send(action,new URLSearchParams({otp:otp(seed,policy),login:'Log In'})),send);
  assert(accepted.callback?.searchParams.has('code'),'Correct OTP was not accepted');return accepted.callback;
 });
 seed=undefined;
 assert.equal((await alora('/auth/me',{token:mfaSession.accessToken})).data.id,mfaUser.localId);
 checks+=3;
 const signedOut=await alora('/auth/logout',{body:{},token:mfaSession.accessToken});assert.equal(signedOut.data.providerRevoked,true);await alora('/auth/me',{token:mfaSession.accessToken,expected:401});
 await api('/v1/licenses','PUT',{customerId:customer,appId,state:'suspended',expiresAt:null,features:[{key:'services.read',purchased:true,enabled:true}],reason:'Disposable QA revocation'});
 await alora('/auth/login',{body:{email:legacy.email,password},expected:403});await alora('/auth/me',{token:session.accessToken,expected:403});
 await alora('/auth/logout',{body:{},token:session.accessToken});await alora('/auth/me',{token:session.accessToken,expected:401});
 report={at:new Date().toISOString(),checks,requiredActionBlocked:true,connectOnlyProvisioned:true,mfaEnrollment:true,mfaMissingBlocked:true,mfaWrongBlocked:true,mfaCorrectAccepted:true,realKeycloak:true,realConnectDocker:true,realPostgres:true,realBrowser:false,sdkVersion:"0.10.0",sdkFacade:true,activeProviderLogoutVerified:true,catalog:'seeded from actual ALORA matrix; HTTPS fetch not tested',production:false};
 console.log(`PASS: ${checks} HTTP checks with real Connect Docker/Keycloak/PostgreSQL, authorization code + PKCE, migrated password, Connect-only provisioning, real MFA enrollment/missing/wrong/correct OTP, required-action blocking, callback, fresh permissions, real provider refresh, license revocation and logout. Browser UI and HTTPS catalog fetch not tested.`);
}
async function cleanup(){
 if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
 if(bridge)await new Promise(r=>bridge.close(r));
 if(source){
  const rows=await sql('SELECT p.target_customer_id,p.target_installation_id,r.identity_subject FROM onboarding_practices p LEFT JOIN onboarding_requests r ON r.practice_id=p.id WHERE p.source_id=$1',[sourceId]);
  for(const row of rows){if(row.identity_subject)identities.add(row.identity_subject);if(row.target_customer_id)customer=row.target_customer_id;if(row.target_installation_id)installation=row.target_installation_id;}
  for(const table of ['onboarding_requests','onboarding_practices','app_local_users','source_installation_bindings','source_tenant_bindings'])await sql('DELETE FROM '+table+' WHERE source_id=$1',[sourceId]);
  await sql('DELETE FROM connect_sources WHERE id=$1',[sourceId]);
  for(const subject of identities)await api('/v1/sso-identities/'+subject,'DELETE');
  if(customer){for(const table of ['assignments','memberships','entitlements','licenses','roles','installations'])await sql('DELETE FROM '+table+' WHERE customer_id=$1',[customer]);await sql('DELETE FROM customers WHERE id=$1',[customer]);}
  for(const table of ['permissions','features','catalogs','app_access_revocations'])await sql('DELETE FROM '+table+' WHERE app_id=$1',[appId]);await sql('DELETE FROM applications WHERE id=$1',[appId]);
  await sql('DELETE FROM audit WHERE target=ANY($1::text[]) OR detail::text LIKE $2 OR detail::text LIKE $3',[[sourceId,appId,practice,customer,installation,...identities].filter(Boolean),'%'+appId+'%','%'+sourceId+'%']);
  const remaining=await sql('SELECT (SELECT count(*) FROM connect_sources WHERE id=$1)+(SELECT count(*) FROM applications WHERE id=$2)+(SELECT count(*) FROM onboarding_requests WHERE source_id=$1)+(SELECT count(*) FROM customers WHERE id=$3)+(SELECT count(*) FROM app_local_users WHERE source_id=$1)+(SELECT count(*) FROM audit WHERE target=ANY($4::text[]) OR detail::text LIKE $5 OR detail::text LIKE $6) AS n',[sourceId,appId,customer||null,[sourceId,appId,practice,customer,installation,...identities].filter(Boolean),'%'+appId+'%','%'+sourceId+'%']);assert.equal(Number(remaining[0].n),0,'QA cleanup incomplete');
 }
 if(tenant){await prisma.auditLog.deleteMany({where:{tenantId:tenant.id}});await prisma.tenant.deleteMany({where:{id:tenant.id}});}
 if(adminToken&&identities.size){const current=await api('/v1/sso-identities');assert(!current.some(user=>identities.has(user.subject)),'Keycloak QA cleanup incomplete');}
 await prisma.connectSdkRecord.deleteMany({where:{namespace:'alora:'+createHash('sha256').update(JSON.stringify(['test',sourceId,appId])).digest('hex')}});
 await prisma.$disconnect();
}
main().catch(error=>{failed=true;report??={at:new Date().toISOString(),checks,realKeycloak:true,realConnectDocker:true,realPostgres:true,realBrowser:false,production:false,incomplete:true};console.error(error.message);}).finally(async()=>{try{await cleanup();if(report)report.cleanupVerified=true;}catch{failed=true;console.error('QA cleanup incomplete; inspect only the qa-alora fixture IDs');}if(report){report.status=failed?'failed':'passed';await mkdir('docs/verification',{recursive:true});await writeFile('docs/verification/connect-real-oidc.json',JSON.stringify(report,null,2)+'\n');}if(failed)process.exitCode=1;});
