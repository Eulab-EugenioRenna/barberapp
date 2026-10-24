import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
test('setup diagnostics: SDK lookup only, explicit failures and no secret output',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'alora-setup-check-')),requests=[];
 let mode='ok';
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  requests.push({path:req.url,method:req.method,body:raw?JSON.parse(raw):undefined,authorization:req.headers.authorization});
  res.setHeader('content-type','application/json');
  if(req.url==='/realms/qa/.well-known/openid-configuration')return res.end(JSON.stringify({issuer:mode==='issuer-mismatch'?'https://wrong.invalid':base+'/realms/qa',code_challenge_methods_supported:['S256']}));
  assert.equal(req.url,'/v1/app-onboarding/login-context');assert.equal(req.method,'POST');
  res.statusCode=mode==='forbidden'?403:200;res.end(JSON.stringify(mode==='forbidden'?{message:'synthetic-secret-canary'}:{status:'not_found'}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const inherited=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('ALORA_')));
 const configured={...inherited,NODE_ENV:'test',ALORA_CONNECT_APP_ID:'setup-qa',ALORA_CONNECT_API_URL:base,ALORA_CONNECT_ISSUER:base+'/realms/qa',ALORA_CONNECT_CLIENT_ID:'qa-client',ALORA_CONNECT_CALLBACK_URL:base+'/auth/connect/callback',ALORA_AUTH_RETURN_URL:base+'/admin/#/login',ALORA_CONNECT_ENCRYPTION_KEY:'a'.repeat(64),ALORA_CONNECT_SOURCE_ID:'qa-source',ALORA_CONNECT_BOOTSTRAP_SECRET:'synthetic-secret-canary'};
 async function run(env,online=false){
  const child=spawn(process.execPath,[fileURLToPath(new URL('./check-connect-configuration.mjs',import.meta.url)),...(online?['--online']:[])],{cwd:directory,env,stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  assert(!output.includes(configured.ALORA_CONNECT_BOOTSTRAP_SECRET));assert(!errors.includes(configured.ALORA_CONNECT_BOOTSTRAP_SECRET));
  return {code,result:JSON.parse(output)};
 }
 try{
  await t.test('lists missing variable names without network requests',async()=>{
   const {code,result}=await run(inherited,true);assert.equal(code,1);assert.equal(result.status,'configuration_missing');assert(result.missing.includes('ALORA_CONNECT_SOURCE_ID'));assert.equal(requests.length,0);
  });
  await t.test('validates offline with the runtime configuration rules',async()=>{
   const {code,result}=await run(configured);assert.equal(code,0);assert.equal(result.status,'configuration_valid');assert.equal(requests.length,0);
  });
  await t.test('rejects invalid callback before network access',async()=>{
   const {code,result}=await run({...configured,ALORA_AUTH_RETURN_URL:'https://other.invalid/admin'},true);assert.equal(code,1);assert.equal(result.status,'configuration_invalid');assert.equal(requests.length,0);
  });
  await t.test('performs discovery and one SDK lookup without submitting requests',async()=>{
   const {code,result}=await run(configured,true);assert.equal(code,0);assert.equal(result.status,'setup_checks_passed');assert.equal(result.operationalAcceptance,false);
   assert.equal(requests.length,2);assert.equal(requests[0].authorization,undefined);
   assert.equal(requests[1].authorization,'Bearer '+configured.ALORA_CONNECT_BOOTSTRAP_SECRET);
   assert.equal(requests[1].body.sourceId,'qa-source');assert.equal(requests[1].body.appId,'setup-qa');assert(requests[1].body.email.endsWith('@example.invalid'));requests.length=0;
  });
  await t.test('SDK reports issuer mismatch without certifying authorization',async()=>{
   mode='issuer-mismatch';const {code,result}=await run(configured,true);assert.equal(code,1);assert.equal(result.status,'setup_check_failed');assert(result.checks.some(check=>check.code==='discovery'&&check.status==='failed'));assert.equal(requests.length,2);requests.length=0;
  });
  await t.test('SDK source reachability with 403 never certifies user authorization or exposes remote errors',async()=>{
   mode='forbidden';const {code,result}=await run(configured,true);assert.equal(code,0);assert.equal(result.status,'setup_checks_passed');assert(result.checks.some(check=>check.code==='authorization'&&check.status==='not_checked'));assert.equal(result.operationalAcceptance,false);assert.equal(requests.length,2);
  });
 }finally{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
