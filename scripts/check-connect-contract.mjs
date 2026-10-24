/* Two real Nest APIs; isolated ALORA PostgreSQL and Connect PGlite. OIDC/Keycloak is simulated. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { readFileSync } from 'node:fs';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const require=createRequire(import.meta.url), {PrismaClient}=require('@prisma/client'), {hash,compare}=require('bcrypt');
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl||new URL(databaseUrl).pathname!=='/barber_security_test')throw Error('Requires isolated barber_security_test');
const connectRoot=resolve(process.env.CONNECT_CHECKOUT||'../eulab connect');
const prisma=new PrismaClient({datasources:{db:{url:databaseUrl}}});
const password='Synthetic-Contract-Only-9!', port=Number(process.env.CONNECT_CONTRACT_PORT||53026), base=`http://127.0.0.1:${port}`;
const realCatalog=process.env.ALORA_CONTRACT_REAL_CATALOG==='1';
const realPasswordPolicy=process.env.ALORA_CONTRACT_REAL_PASSWORD_POLICY==='1',nativeFetch=globalThis.fetch;
let sdkNamespace,h,child,provider,catalogTls,untrustedTls,catalogRequests=0,catalogNegativeChecks=0,checks=0,failed=false;const fixtureTenants=[];
async function main(){
 const oldCwd=process.cwd();
 // The Connect harness resolves its migrations relative to that checkout; no source writes.
 try{process.chdir(connectRoot);const {harness}=await import(pathToFileURL(join(connectRoot,'tests/harness.mjs')).href);h=await harness();}finally{process.chdir(oldCwd);}
 const connectUrl=await h.listen(), appId='alora-contract-'+randomUUID().slice(0,8),sourceId='source-'+randomUUID().slice(0,8);
 // Use real HTTP for admin operations too; do not mix live sockets with light-my-request injection.
 h.request=async(path,method='GET',body)=>{
  const response=await fetch(connectUrl+path,{method,headers:{Authorization:'Bearer '+await h.token(),'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null};
 };
 const catalogOrigin='https://alora.local.test';
 if(realCatalog){
  catalogTls=createTlsServer({key:readFileSync(process.env.ALORA_CONTRACT_TLS_KEY),cert:readFileSync(process.env.ALORA_CONTRACT_TLS_CERT)},async(req,res)=>{
   catalogRequests++;
   assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.cookie,undefined);
   if(req.url==='/redirect'){res.writeHead(302,{location:catalogOrigin+'/.well-known/eulab-connect.json'});return res.end();}
   if(req.url==='/html'){res.writeHead(200,{'content-type':'text/html'});return res.end('<html></html>');}
   if(req.url==='/invalid-json'){res.writeHead(200,{'content-type':'application/json'});return res.end('{');}
   try{const response=await fetch(base+req.url);res.writeHead(response.status,{'content-type':response.headers.get('content-type')||''});res.end(await response.text());}
   catch{res.writeHead(503);res.end();}
  });
  untrustedTls=createTlsServer({key:readFileSync(process.env.ALORA_CONTRACT_BAD_TLS_KEY),cert:readFileSync(process.env.ALORA_CONTRACT_BAD_TLS_CERT)},(_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{}');});
  await new Promise(r=>catalogTls.listen(0,'127.0.0.1',r));await new Promise(r=>untrustedTls.listen(0,'127.0.0.1',r));
  process.env.CATALOG_INTERNAL_ORIGINS_JSON=JSON.stringify({[catalogOrigin]:`https://127.0.0.1:${catalogTls.address().port}`,'https://untrusted.alora.local.test':`https://127.0.0.1:${untrustedTls.address().port}`});
 }
 const users=new Map(),codes=new Map(),refreshes=new Map();
 const keys=await generateKeyPair('RS256'),jwk=await exportJWK(keys.publicKey);jwk.kid='qa-id-token';
 sdkNamespace='alora:'+createHash('sha256').update(JSON.stringify(['test',sourceId,appId])).digest('hex');
 if(realPasswordPolicy){
  const target=new URL(process.env.ALORA_POLICY_PROVIDER_URL);assert.equal(target.hostname,'127.0.0.1');assert.equal(target.protocol,'http:');
  const harnessFetch=globalThis.fetch;
  // Redirect only identity-management transport to the disposable provider. Admin JWT validation stays simulated.
  globalThis.fetch=async(input,options={})=>{
   const url=String(input),adminPrefix=h.issuer.replace('/realms/','/admin/realms/');
   if(url.startsWith(adminPrefix))return nativeFetch(url.replace(adminPrefix,target.href.replace('/realms/','/admin/realms/')),options);
   if(url===h.issuer+'/protocol/openid-connect/token'&&new URLSearchParams(options.body).get('grant_type')==='client_credentials')return nativeFetch(target.href+'/protocol/openid-connect/token',options);
   return harnessFetch(input,options);
  };
 }else h.setIdentityRequest(async(path,method='GET',body)=>{
  if(path.startsWith('/users?')){const query=new URLSearchParams(path.split('?')[1]);return {body:[...users.values()].filter(u=>u.email===query.get('email')||u.username===query.get('username'))};}
  if(path==='/users'&&method==='POST'){assert.equal(body.credentials[0].value,password);const user={...body,id:randomUUID()};users.set(user.id,user);return {location:'https://provider.test/users/'+user.id,body:null};}
  if(path.endsWith('/role-mappings/realm/composite'))return {body:[]};
  if(path.startsWith('/users/'))return {body:users.get(path.split('/')[2])};
  throw Error('Unexpected simulated identity route');
 });
 const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
 provider=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');let raw='';for await(const chunk of req)raw+=chunk;
  if(url.pathname.endsWith('/auth')){
   const rows=await h.store.query('SELECT subject FROM app_local_users WHERE source_id=$1 AND email_normalized=$2',[sourceId,url.searchParams.get('login_hint')]);assert.equal(rows.length,1);
   const code=randomUUID();codes.set(code,{subject:rows[0].subject,challenge:url.searchParams.get('code_challenge'),nonce:url.searchParams.get('nonce')});
   const target=new URL(url.searchParams.get('redirect_uri'));target.searchParams.set('state',url.searchParams.get('state'));target.searchParams.set('code',code);
   res.writeHead(302,{location:target.href});return res.end();
  }
  if(url.pathname.endsWith('/certs'))return json(res,200,{keys:[jwk]});
  if(url.pathname.endsWith('/logout'))return json(res,204,{});
  if(url.pathname.endsWith('/token')){
   const body=new URLSearchParams(raw);
   let grant;
   if(body.get('grant_type')==='refresh_token'){grant=refreshes.get(body.get('refresh_token'));refreshes.delete(body.get('refresh_token'));}
   else{grant=codes.get(body.get('code'));codes.delete(body.get('code'));assert(grant);assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),grant.challenge);}
   assert(grant);const refresh=randomUUID();refreshes.set(refresh,grant);
   const idToken=await new SignJWT({nonce:grant.nonce}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience('alora-contract-client').setSubject(grant.subject).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
   return json(res,200,{access_token:await h.token(grant.subject,[]),refresh_token:refresh,id_token:idToken,expires_in:300});
  }
  return json(res,404,{});
 }catch{return json(res,400,{message:'Simulated provider verification failed'});}});
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));const issuer=`http://127.0.0.1:${provider.address().port}/realms/test`;
 const source=await h.request('/v1/connect-sources','POST',{id:sourceId,appId,name:'Isolated ALORA contract',environment:'development',origins:realCatalog?[base,catalogOrigin]:[base],catalogUrl:(realCatalog?catalogOrigin:base)+'/.well-known/eulab-connect.json',oidcCallbacks:[base+'/auth/connect/callback'],deploymentIdentity:'isolated-contract-test'});assert.equal(source.status,201,JSON.stringify(source.body));
 const suffix=randomUUID(),tenant=await prisma.tenant.create({data:{name:'Contract '+suffix,slug:'contract-'+suffix}});fixtureTenants.push(tenant.id);
 const legacy=await prisma.user.create({data:{tenantId:tenant.id,email:'contract-'+suffix+'@example.test',firstName:'Legacy',lastName:'Owner',role:'owner',passwordHash:await hash(password,4)}});
 child=spawn(process.execPath,['dist/apps/api/main.js'],{cwd:oldCwd,env:{...process.env,NODE_ENV:'test',DATABASE_URL:databaseUrl,PORT:String(port),REDIS_HOST:'127.0.0.1',REDIS_PORT:'56389',SMTP_HOST:'127.0.0.1',SMTP_PORT:'1',ALORA_CONNECT_APP_ID:appId,ALORA_CONNECT_SOURCE_ID:sourceId,ALORA_CONNECT_BOOTSTRAP_SECRET:source.body.secret,ALORA_CONNECT_API_URL:connectUrl,ALORA_CONNECT_ISSUER:issuer,ALORA_CONNECT_CLIENT_ID:'alora-contract-client',ALORA_CONNECT_CALLBACK_URL:base+'/auth/connect/callback',ALORA_AUTH_RETURN_URL:base+'/admin/#/login',ALORA_CONNECT_ENCRYPTION_KEY:'c'.repeat(64),ALORA_CONNECT_TENANTS_JSON:'{}'},stdio:['ignore','ignore','ignore']});
 let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('ALORA API failed to start');try{ready=(await fetch(base+'/health')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}assert(ready);
 if(realCatalog){
  const {CatalogReader}=await import(pathToFileURL(join(connectRoot,'dist/server/apps/api/src/catalog-reader.js')).href);
  const reader=new CatalogReader();h.setCatalogReader(url=>reader.read(url));
  for(const [url,pattern] of [
   ['http://127.0.0.1/catalog',/HTTPS/],
   ['https://127.0.0.1/catalog',/Destinazione catalogo non consentita/],
   [catalogOrigin+'/redirect',/HTTP 302/],
   [catalogOrigin+'/html',/JSON/],
   [catalogOrigin+'/invalid-json',/JSON/],
   ['https://untrusted.alora.local.test/catalog',/certificate|self.signed|verify/i],
  ]){await assert.rejects(reader.read(url),pattern);catalogNegativeChecks++;}
 }else h.setCatalogReader(async()=>{const response=await fetch(base+'/.well-known/eulab-connect.json');assert(response.ok);return response.json();});
 const jar=new Map();
 async function call(path,{body,token,cookie,expected=body?201:200}={}){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(body?{origin:base}:{}),...(token?{Authorization:'Bearer '+token}:{}),...((cookie||jar.size)?{cookie:cookie||[...jar].map(([k,v])=>k+'='+v).join('; ')}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual'});for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';'),at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}const text=await response.text();assert.equal(response.status,expected,path+': '+text);assert(!text.includes(password));let data;try{data=JSON.parse(text);}catch{data=text;}checks++;return {response,data};}
 const proof=(await call('/auth/login',{body:{email:legacy.email,password}})).data;assert.equal(proof.status,'migration_required');assert.equal(proof.accessToken,undefined);
 const submitted=(await call('/auth/connect/accept',{body:{challenge:proof.onboarding.challenge,accepted:true,consentVersion:proof.onboarding.version,firstName:legacy.firstName,lastName:legacy.lastName,password}})).data;
 const request=(await h.store.query('SELECT id,practice_id,password_cipher FROM onboarding_requests WHERE id=$1',[submitted.request.requestId]))[0];assert(request);assert(request.password_cipher);assert(!request.password_cipher.includes(password));
 const pending=(await call('/auth/login',{body:{email:legacy.email,password}})).data;assert.equal(pending.onboarding.request.requestId,request.id);
 const plan={license:{state:'active',expiresAt:null,features:[{key:'services.read',purchased:true,enabled:true}]},roles:[{localRole:'owner',roleName:'Contract owner',permissions:['services.read']}]};
 const planned=await h.request('/v1/onboarding/practices/'+request.practice_id+'/plan','PUT',plan);assert.equal(planned.status,200);
 const executed=await h.request('/v1/onboarding/practices/'+request.practice_id+'/execute','POST',{});assert.equal(executed.status,201);
 if(realPasswordPolicy){
  assert.equal(executed.body.state,'failed');
  const person=executed.body.requests.find(row=>row.id===request.id);assert(person);
  assert.equal(person.state,'failed');assert.equal(person.actionRequired,'password_change_required');
  assert.equal(person.credentialPresent,false);assert(person.credentialDestroyedAt);assert.equal(person.identitySubject,null);
  assert(!JSON.stringify(executed.body).includes(password));
  const failedRequest=(await h.store.query('SELECT password_cipher,identity_subject FROM onboarding_requests WHERE id=$1',[request.id]))[0];
  assert.equal(failedRequest.password_cipher,null);assert.equal(failedRequest.identity_subject,null);
  assert.equal((await h.store.query('SELECT count(*)::int AS n FROM app_local_users WHERE source_id=$1',[sourceId]))[0].n,0);
  checks+=3;
  const blocked=(await call('/auth/login',{body:{email:legacy.email,password}})).data;
  assert.equal(blocked.status,'migration_required');assert.equal(blocked.accessToken,undefined);assert.equal(blocked.onboarding.request.state,'failed');
  assert.equal(await prisma.localSession.count({where:{userId:legacy.id}}),0);assert.equal(await prisma.connectSession.count({where:{userId:legacy.id}}),0);
  const unchanged=await prisma.user.findUnique({where:{id:legacy.id}});assert.equal(unchanged.passwordHash,legacy.passwordHash);assert.equal(unchanged.connectActivatedAt,null);
  checks+=2;
  assert.equal(blocked.onboarding.request.nextAction,'choose_connect_password');
  const recoveryPassword='New-Connect-For-Policy-9!'.repeat(4);
  const recovered=await call('/auth/connect/accept',{body:{challenge:blocked.onboarding.challenge,password,newConnectPassword:recoveryPassword,accepted:true,consentVersion:blocked.onboarding.version,firstName:legacy.firstName,lastName:legacy.lastName}});
  assert.equal(recovered.data.request.requestId,request.id);assert.equal(recovered.data.request.state,'pending');
  assert.equal(await prisma.localSession.count({where:{userId:legacy.id}}),0);
  const replacement=(await h.store.query('SELECT password_cipher,identity_subject FROM onboarding_requests WHERE id=$1',[request.id]))[0];assert(replacement.password_cipher);assert(!replacement.password_cipher.includes(recoveryPassword));assert.equal(replacement.identity_subject,null);
  const retried=await h.request('/v1/onboarding/practices/'+request.practice_id+'/execute','POST',{});assert.equal(retried.status,201);assert.equal(retried.body.state,'completed');assert.equal(retried.body.requests[0].credentialPresent,false);assert(retried.body.requests[0].identitySubject);
  assert.equal((await prisma.user.findUnique({where:{id:legacy.id}})).passwordHash,legacy.passwordHash);
  checks+=3;
  console.log(JSON.stringify({checks,recoverySubmitted:true,recoveryExecuted:true,recoveredEmail:legacy.email,passwordPolicyRejected:true,transientCredentialDestroyed:true,noIdentityLinked:true,noOperationalSession:true,legacyProfilePreserved:true,realKeycloak:true,connectDatabase:'PGlite',adminOidcSimulated:true,realBrowser:false,production:false}));
  return;
 }
 assert.equal(executed.body.state,'completed',JSON.stringify(executed.body));
 assert.equal((await h.store.query('SELECT password_cipher FROM onboarding_requests WHERE id=$1',[request.id]))[0].password_cipher,null);
 if(realCatalog){
  const catalog=(await h.store.query('SELECT document FROM catalogs WHERE app_id=$1',[appId]))[0];
  const actual=await (await fetch(base+'/.well-known/eulab-connect.json')).json();
  const normalized=matrix=>({...matrix,functions:[...matrix.functions].sort((a,b)=>a.key.localeCompare(b.key))});
  assert.deepEqual(normalized(catalog.document),normalized(actual));assert.equal(actual.functions.length,22);assert(catalogRequests>3);
 }

 async function sso(email){
  const start=await call('/auth/login',{body:{email}});assert.equal(start.data.status,'connect_redirect');
  const authorize=await fetch(start.data.redirectUrl,{redirect:'manual'});assert.equal(authorize.status,302);const callback=new URL(authorize.headers.get('location'));
  const returned=await call(callback.pathname+callback.search,{expected:303});const handoff=new URLSearchParams(new URL(returned.response.headers.get('location')).hash.split('?')[1]).get('alora_connect');assert(handoff,'Callback failed');
  return (await call('/auth/connect/exchange',{body:{handoff}})).data;
 }
 const session=await sso(legacy.email);assert((await call('/auth/me',{token:session.accessToken})).data.connectFunctions.includes('services.read'));
 await call('/services',{token:session.accessToken});await call('/dashboard/revenue',{token:session.accessToken,expected:403});
 const preserved=await prisma.user.findUnique({where:{id:legacy.id}});assert.equal(preserved.passwordHash,legacy.passwordHash);assert.equal(preserved.tenantId,tenant.id);
 const installation=executed.body.installation.id;
 const site=(await h.store.query('SELECT customer_id FROM installations WHERE id=$1',[installation]))[0];assert(site);
 const newcomer={id:randomUUID(),subject:randomUUID(),email:'connect-only-'+suffix+'@example.test'};
 users.set(newcomer.subject,{id:newcomer.subject,username:newcomer.email,email:newcomer.email,firstName:'Connect',lastName:'Only',enabled:true});
 const assigned=await h.request('/v1/connect-sources/'+sourceId+'/local-users','POST',{installationId:installation,localTenantId:tenant.id,localUserId:newcomer.id,subject:newcomer.subject,email:newcomer.email,firstName:'Connect',lastName:'Only',role:'reception',permissions:['services.read'],enabled:true});assert.equal(assigned.status,201,JSON.stringify(assigned.body));
 const role=(await h.store.query('SELECT id FROM roles WHERE customer_id=$1 AND app_id=$2',[site.customer_id,appId]))[0];
 await h.request('/v1/memberships','PUT',{subject:newcomer.subject,customerId:site.customer_id,enabled:true,roleIds:[role.id]});
 assert.equal(await prisma.user.count({where:{id:newcomer.id}}),0);
 const connectOnly=await sso(newcomer.email);const local=await prisma.user.findUnique({where:{id:newcomer.id}});assert(local?.connectActivatedAt);assert.equal(local.tenantId,tenant.id);assert.equal(await compare(password,local.passwordHash),false);
 assert.equal((await call('/auth/me',{token:connectOnly.accessToken})).data.id,newcomer.id);
 await h.store.query("UPDATE licenses SET state='suspended' WHERE customer_id=$1 AND app_id=$2",[site.customer_id,appId]);
 await call('/auth/login',{body:{email:legacy.email,password},expected:403});await call('/auth/me',{token:connectOnly.accessToken,expected:403});
 console.log(`PASS: ${checks} ALORA HTTP checks against actual Connect source/admin/access handlers, SDK 0.10.0 facade, signed ID token, encrypted practice, approval, SSO cutover, Connect-only provisioning and license revocation. Isolated Connect PGlite; identity/OIDC simulated; catalog reader ${realCatalog?"real HTTPS with temporary trusted CA and explicit internal-origin mapping":"simulated"}.`);
 if(realCatalog)console.log(JSON.stringify({catalogHttps:true,catalogNegativeChecks,catalogRequests,functions:22,checks,providerSimulated:true,production:false}));
}
main().catch(error=>{console.error(error.stack);failed=true;}).finally(async()=>{if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}if(provider)await new Promise(r=>provider.close(r));if(catalogTls)await new Promise(r=>catalogTls.close(r));if(untrustedTls)await new Promise(r=>untrustedTls.close(r));if(h)await h.close();for(const tenantId of fixtureTenants){await prisma.auditLog.deleteMany({where:{tenantId}});await prisma.tenant.deleteMany({where:{id:tenantId}});}if(sdkNamespace)await prisma.connectSdkRecord.deleteMany({where:{namespace:sdkNamespace}});await prisma.$disconnect();if(failed)process.exitCode=1;});
