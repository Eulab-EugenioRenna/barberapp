/* Real isolated PostgreSQL + HTTP consumer checks. Connect/OIDC endpoints are SIMULATED. */
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID, createHash, randomBytes } = require('node:crypto');
const { hash, compare } = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== '/barber_security_test') throw new Error('Disposable barber_security_test database required');
const prisma = new PrismaClient(), port = Number(process.env.CONNECT_TEST_PORT || 53025), base = `http://127.0.0.1:${port}`;
const password = 'Synthetic-only-Password-9!', digest = value => createHash('sha256').update(value).digest('hex');
let sdkNamespace, child, provider, checks = 0, refreshCalls = 0, requestCalls = 0, unavailable = false, malformedSource = false, revoked = false, wrongIdentity = false;
const fixtureTenants=[];
const contexts = new Map(), codes = new Map(), tokens = new Map(), requests = new Map();
const json = (res, status, data) => { res.writeHead(status, {'content-type':'application/json'}); res.end(JSON.stringify(data)); };
async function main() {
 const {generateKeyPair,exportJWK,SignJWT}=await import("jose"); const keys=await generateKeyPair("RS256"),jwk=await exportJWK(keys.publicKey);jwk.kid="alora-qa-id";
 sdkNamespace="alora:"+createHash("sha256").update(JSON.stringify(["test","alora-test-source","alora-onboarding-test"])).digest("hex");
 const suffix = randomUUID(), tenant = await prisma.tenant.create({data:{name:'Migration gate test',slug:'gate-'+suffix}});
 fixtureTenants.push(tenant.id);
 const passwordHash = await hash(password, 4), users = [];
 for (let i=0;i<2;i++) users.push(await prisma.user.create({data:{tenantId:tenant.id,email:`gate-${i}-${suffix}@example.test`,passwordHash,firstName:'Old',lastName:'Profile',role:'owner'}}));
 const installationId = randomUUID(), customerId = randomUUID(), secret = 'synthetic-installation-secret';
 const makeContext = (user, company=tenant) => ({tenant:{id:company.id,name:company.name,slug:company.slug},binding:{customerId,installationId,secret},user:{id:user.id,subject:'subject-'+user.id,email:user.email,firstName:'SSO',lastName:'Profile',role:'reception',permissions:['appointments.read.all']}});
 const newcomer = {id:randomUUID(),email:`connect-only-${suffix}@example.test`}, newTenant = {id:randomUUID(),name:'Approved new company',slug:'approved-'+suffix};
 fixtureTenants.push(newTenant.id);
 const newcomerContext = makeContext(newcomer,newTenant);
 newcomerContext.binding = {customerId:randomUUID(),installationId:randomUUID(),secret};
 let providerOrigin;
 const makeTokens = async (id,nonce) => { const access='provider-access-'+randomUUID(),refresh='provider-refresh-'+randomUUID();tokens.set(access,id);tokens.set(refresh,id);const context=[...contexts.values()].find(c=>c.user.id===id);const id_token=await new SignJWT({nonce}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(providerOrigin+"/realms/test").setAudience("alora-client-test").setSubject(context.user.subject).setIssuedAt().setExpirationTime("5m").sign(keys.privateKey);return {access_token:access,refresh_token:refresh,id_token,expires_in:300}; };
 provider = http.createServer(async(req,res) => {
  try {
   const url = new URL(req.url,providerOrigin);let raw='';for await (const chunk of req) raw+=chunk;
   if (url.pathname.startsWith('/v1/app-onboarding/')) {
    assert.equal(req.headers.authorization,'Bearer synthetic-bootstrap-secret');assert.equal(req.headers['x-connect-source'],'alora-test-source');
    if (unavailable) return json(res,503,{});
    const body=JSON.parse(raw);assert.equal(body.appId,'alora-onboarding-test');assert.equal(body.schemaVersion,1);
    if (url.pathname.endsWith('/login-context')) {
     if (revoked) return json(res,403,{});
     if(malformedSource)return json(res,200,{status:'connect',context:{user:{id:'foreign'}}});
     const context=contexts.get(body.email);
     return json(res,200,context?{status:'connect',context}:{status:'not_found',...(requests.has(body.email)?{request:requests.get(body.email)}:{})});
    }
    if (url.pathname.endsWith('/requests')) {
     assert.equal(body.initialPassword,password);assert(!body.tenantId);assert(req.headers['idempotency-key']);requestCalls++;
     const email=body.kind==='migration'?body.localUser.email:body.applicant.email;
     if (!requests.has(email)) requests.set(email,{requestId:randomUUID(),state:'pending'});
     return json(res,201,requests.get(email));
    }
   }
   if (url.pathname==='/v1/access') {
    const id=tokens.get((req.headers.authorization||'').replace('Bearer ',''));if(!id)return json(res,401,{});
    const context=[...contexts.values()].find(c=>c.user.id===id);assert(context);
    assert.equal(req.headers['x-installation-id'],context.binding.installationId);assert.equal(req.headers['x-installation-secret'],secret);
    return json(res,200,{installationId:context.binding.installationId,appId:'alora-onboarding-test',subject:wrongIdentity?'foreign-subject':context.user.subject,localUserId:id,canLogin:!revoked,functions:[{key:'appointments.read.all',name:'Agenda'}],catalogVersion:1,functionsStatus:'ready'});
   }
   if (url.pathname.endsWith('/auth')) {
    const context=contexts.get(url.searchParams.get('login_hint'));assert(context);
    const code=randomUUID();codes.set(code,{challenge:url.searchParams.get('code_challenge'),userId:context.user.id,nonce:url.searchParams.get('nonce')});
    const location=new URL(url.searchParams.get('redirect_uri'));location.searchParams.set('state',url.searchParams.get('state'));location.searchParams.set('code',code);
    res.writeHead(302,{location:location.href});return res.end();
   }
   if(url.pathname.endsWith('/certs'))return json(res,200,{keys:[jwk]});
   if(url.pathname.endsWith('/logout'))return json(res,200,{});
   if (url.pathname.endsWith('/token')) {
    const body=new URLSearchParams(raw);assert.equal(body.get('client_id'),'alora-client-test');
    if(body.get('grant_type')==='refresh_token') {refreshCalls++;const id=tokens.get(body.get('refresh_token'));if(!id)return json(res,400,{});tokens.delete(body.get('refresh_token'));return json(res,200,await makeTokens(id,"refresh"));}
    const code=codes.get(body.get('code'));codes.delete(body.get('code'));if(!code)return json(res,400,{});
    assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'),code.challenge);
    return json(res,200,await makeTokens(code.userId,code.nonce));
   }
   json(res,404,{});
  } catch { json(res,500,{message:'Synthetic provider assertion failed'}); }
 });
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));providerOrigin=`http://127.0.0.1:${provider.address().port}`;
 child=spawn(process.execPath,['dist/apps/api/main.js'],{env:{...process.env,NODE_ENV:'test',PORT:String(port),REDIS_HOST:'127.0.0.1',REDIS_PORT:'56389',SMTP_HOST:'127.0.0.1',SMTP_PORT:'1',ALORA_CONNECT_SOURCE_ID:'alora-test-source',ALORA_CONNECT_BOOTSTRAP_SECRET:'synthetic-bootstrap-secret',ALORA_CONNECT_APP_ID:'alora-onboarding-test',ALORA_CONNECT_API_URL:providerOrigin,ALORA_CONNECT_ISSUER:providerOrigin+'/realms/test',ALORA_CONNECT_CLIENT_ID:'alora-client-test',ALORA_CONNECT_CALLBACK_URL:base+'/auth/connect/callback',ALORA_AUTH_RETURN_URL:base+'/admin/#/login',ALORA_CONNECT_ENCRYPTION_KEY:'b'.repeat(64),ALORA_CONNECT_TENANTS_JSON:'{}'},stdio:['ignore','ignore','ignore']});
 let ready=false;for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('Test API exited before startup');try{ready=(await fetch(base+'/health')).ok;}catch{}if(ready)break;await new Promise(resolve=>setTimeout(resolve,100));}assert(ready);
 const jar=new Map();
 async function request(path,{method='GET',body,token,cookie,origin=base,expected=200}={}) {
  const res=await fetch(base+path,{method,headers:{'content-type':'application/json',...(method==='POST'&&origin?{origin}:{}),...(token?{authorization:'Bearer '+token}:{}),...((cookie||jar.size)?{cookie:cookie||[...jar].map(([k,v])=>k+'='+v).join('; ')}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
  for(const cookie of res.headers.getSetCookie()){const [pair]=cookie.split(';'),at=pair.indexOf('=');jar.set(pair.slice(0,at),pair.slice(at+1));}
  const text=await res.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  assert.equal(res.status,expected,path+': '+text);assert(!text.includes(password));assert(!text.includes('passwordHash'));assert(!text.includes(secret));checks++;return {data,res};
 }
 await request('/auth/login',{method:'POST',body:{email:users[0].email,password},origin:null,expected:403});
 await request('/auth/login',{method:'POST',body:{email:users[0].email,password},origin:'https://foreign.example',expected:403});
 const login=(email,pw=password,expected=201)=>request('/auth/login',{method:'POST',body:{email,...(pw?{password:pw}:{})},expected});
 // Previously issued local tokens and their refresh tokens are blocked immediately, before activation.
 const oldAccess=randomBytes(32).toString('base64url'),oldRefresh=randomBytes(32).toString('base64url');
 await prisma.localSession.create({data:{userId:users[0].id,familyId:randomUUID(),accessHash:digest(oldAccess),refreshHash:digest(oldRefresh),accessExpiresAt:new Date(Date.now()+60000),refreshExpiresAt:new Date(Date.now()+60000)}});
 await request('/auth/me',{token:oldAccess,expected:401});await request('/appointments',{token:oldAccess,expected:401});await request('/auth/refresh',{method:'POST',body:{refreshToken:oldRefresh},expected:401});
 const local=(await login(users[0].email)).data;assert.equal(local.status,'migration_required');assert.equal(local.accessToken,undefined);assert(local.onboarding.challenge);assert.equal(requestCalls,0);
 await request('/auth/me',{token:local.onboarding.challenge,expected:401});
 const submission={firstName:'Confirmed',lastName:'Profile',password,challenge:local.onboarding.challenge,accepted:true,consentVersion:local.onboarding.version};
 await request('/auth/connect/accept',{method:'POST',body:{...submission,accepted:false},expected:400});
 await request('/auth/connect/accept',{method:'POST',body:{...submission,password:'wrong'},expected:401});
 await request('/auth/connect/accept',{method:'POST',body:{...submission,tenantId:randomUUID()},expected:400});
 submission.challenge=(await login(users[0].email)).data.onboarding.challenge;
 const pending=(await request('/auth/connect/accept',{method:'POST',body:submission,expected:201})).data;assert.equal(pending.status,'migration_pending');assert.equal(pending.request.state,'pending');assert.equal(pending.accessToken,undefined);
 await request('/auth/connect/accept',{method:'POST',body:submission,expected:401});
 const repeat=(await login(users[0].email)).data;assert.equal(repeat.onboarding.request.requestId,pending.request.requestId);assert.equal(requestCalls,1);
 const expired=(await login(users[1].email)).data.onboarding;
 await prisma.connectSdkRecord.update({where:{namespace_id:{namespace:sdkNamespace,id:'challenge:'+createHash('sha256').update(expired.challenge).digest('base64url')}},data:{expiresAt:new Date(0)}});
 await request('/auth/connect/accept',{method:'POST',body:{...submission,challenge:expired.challenge},expected:401});
 await login('unknown-'+suffix+'@example.test','wrong',401);
 unavailable=true;
 await login(users[1].email,password,503);
 await login('unknown-'+suffix+'@example.test','wrong',503);unavailable=false;
 revoked=true;await login(users[0].email,password,403);revoked=false;
 malformedSource=true;await login(users[1].email,password,503);malformedSource=false;
 // Signup only creates a remote practice. No local account, company or session is created.
 const signupEmail='signup-'+suffix+'@example.test';
 const signup=(await request('/auth/signup',{method:'POST',body:{email:signupEmail,password,companyName:'Requested Company',firstName:'New',lastName:'Applicant'},expected:201})).data;
 assert.equal(signup.status,'migration_pending');assert.equal(await prisma.user.count({where:{email:signupEmail}}),0);
 assert.equal(await prisma.tenant.count({where:{name:'Requested Company'}}),0);
 contexts.set(users[0].email,makeContext(users[0]));contexts.set(newcomer.email,newcomerContext);
 async function begin(email) {
  const start=await login(email,null);assert.equal(start.data.status,'connect_redirect');assert.equal(start.data.accessToken,undefined);
  const cookie=start.res.headers.get('set-cookie').split(';')[0];assert(start.res.headers.get('set-cookie').includes('HttpOnly'));
  const auth=await fetch(start.data.redirectUrl,{redirect:'manual'});assert.equal(auth.status,302);const callback=new URL(auth.headers.get('location'));
  return {cookie,callback};
 }
 async function finish(flow) {
  const returned=await request(flow.callback.pathname+flow.callback.search,{cookie:flow.cookie,expected:303});
  const handoff=new URLSearchParams(new URL(returned.res.headers.get('location')).hash.split('?')[1]).get('alora_connect');assert(handoff);
  await request('/auth/connect/exchange',{method:'POST',body:{handoff},cookie:[...jar.keys()].find(k=>k.endsWith('_handoff'))+'='+'x'.repeat(43),expected:401});
  const activated=(await request('/auth/connect/exchange',{method:'POST',body:{handoff},expected:201})).data;
  await request('/auth/connect/exchange',{method:'POST',body:{handoff},expected:401});return activated;
 }
 // Connect-only user is NOT created by discovery, nor by an authenticated callback with wrong subject.
 const wrong=await begin(newcomer.email);assert.equal(await prisma.user.count({where:{id:newcomer.id}}),0);
 wrongIdentity=true;const denied=await request(wrong.callback.pathname+wrong.callback.search,{cookie:wrong.cookie,expected:303});wrongIdentity=false;
 assert(new URL(denied.res.headers.get('location')).searchParams.has('connect_error'));assert.equal(await prisma.user.count({where:{id:newcomer.id}}),0);
 const next=await begin(newcomer.email);
 const flowName=next.cookie.split('=')[0];
 const badFlow=await request(next.callback.pathname+next.callback.search,{cookie:flowName+'='+'x'.repeat(43),expected:303});assert(new URL(badFlow.res.headers.get('location')).searchParams.has('connect_error'));
 const connected=await finish(await begin(newcomer.email));
 const created=await prisma.user.findUnique({where:{id:newcomer.id}});assert(created.connectActivatedAt);assert.equal(created.tenantId,newTenant.id);assert.equal(created.role,'reception');assert.equal(await compare(password,created.passwordHash),false);
 const newMe=(await request('/auth/me',{token:connected.accessToken})).data;assert.equal(newMe.id,newcomer.id);assert.equal(newMe.tenantId,newTenant.id);
 await request('/appointments',{token:connected.accessToken});await request('/services',{token:connected.accessToken,expected:403});
 const binding=await prisma.connectTenantBinding.findUnique({where:{tenantId:newTenant.id}});assert(binding.secretCipher.startsWith('v1.'));assert(!binding.secretCipher.includes(secret));
 let activated=await finish(await begin(users[0].email));
 const preserved=await prisma.user.findUnique({where:{id:users[0].id}});assert.equal(preserved.id,users[0].id);assert.equal(preserved.passwordHash,passwordHash);assert.equal(preserved.role,'owner');assert.equal(preserved.firstName,'Old');
 await request('/auth/me',{token:activated.accessToken});await request('/services',{token:activated.accessToken,expected:403});
 // A conflicting remote local ID never merges the existing account on email.
 const validContext=contexts.get(users[1].email);contexts.set(users[1].email,{...makeContext(users[1]),user:{...makeContext(users[1]).user,id:randomUUID()}});
 const conflict=await begin(users[1].email);const conflictReturn=await request(conflict.callback.pathname+conflict.callback.search,{cookie:conflict.cookie,expected:303});const conflictHandoff=new URLSearchParams(new URL(conflictReturn.res.headers.get('location')).hash.split('?')[1]).get('alora_connect');assert(conflictHandoff);await request('/auth/connect/exchange',{method:'POST',body:{handoff:conflictHandoff},expected:403});assert.equal((await prisma.user.findUnique({where:{email:users[1].email}})).id,users[1].id);if(validContext)contexts.set(users[1].email,validContext);else contexts.delete(users[1].email);
 const stored=await prisma.localSession.findUnique({where:{accessHash:digest(activated.accessToken)}});
 await Promise.all([request('/auth/me',{token:activated.accessToken}),request('/auth/me',{token:activated.accessToken})]);
 activated=(await request('/auth/refresh',{method:'POST',body:{refreshToken:activated.refreshToken},expected:201})).data;assert.equal(refreshCalls,1);
 revoked=true;await request('/auth/me',{token:activated.accessToken,expected:403});revoked=false;
 await request('/auth/logout',{method:'POST',token:activated.accessToken,expected:201});await request('/auth/me',{token:activated.accessToken,expected:401});
 await request('/auth/refresh',{method:'POST',body:{refreshToken:activated.refreshToken},expected:401});
 const audit=JSON.stringify(await prisma.auditLog.findMany({where:{tenantId:{in:[tenant.id,newTenant.id]}}}));assert(!audit.includes(password));assert(!audit.includes(secret));assert(!audit.includes('provider-refresh'));assert(audit.includes('profile_created'));
 const flows=JSON.stringify(await prisma.connectAuthFlow.findMany({where:{installationId:{in:[installationId,newcomerContext.binding.installationId]}}}));assert(!flows.includes(password));
 console.log(`PASS: ${checks} HTTP checks. Mandatory gate, request-only signup, Connect-first routing, Connect-only local provisioning, state/PKCE/cookie binding, secret redaction, permission intersection, refresh and logout. Connect/OIDC provider is SIMULATED.`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}if(provider)await new Promise(resolve=>provider.close(resolve));for(const tenantId of fixtureTenants){await prisma.auditLog.deleteMany({where:{tenantId}});await prisma.tenant.deleteMany({where:{id:tenantId}});}
 if(sdkNamespace)await prisma.connectSdkRecord.deleteMany({where:{namespace:sdkNamespace}});await prisma.$disconnect();});
