/* Read-only checkout integration. Injected provider-failure state in disposable Connect PGlite. */
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
const root=resolve(process.env.CONNECT_CHECKOUT||'../eulab connect'),cwd=process.cwd();
let h,failed=false,report={at:new Date().toISOString(),providerSimulated:true,failureStateInjected:true,connectDatabase:'PGlite',production:false};
try{
 try{process.chdir(root);const {harness}=await import(pathToFileURL(join(root,'tests/harness.mjs')).href);h=await harness();}finally{process.chdir(cwd);}
 const appId='activation-action-qa',sourceId='activation-action-source';
 const source=await h.request('/v1/connect-sources','POST',{id:sourceId,appId,name:'Activation action QA',environment:'development',origins:['https://alora.example.test'],oidcCallbacks:['https://alora.example.test/callback'],deploymentIdentity:'disposable-activation-action'});
 assert.equal(source.status,201);
 const headers={Authorization:'Bearer '+source.body.secret,'X-Connect-Source':sourceId,'Content-Type':'application/json'};
 const identity={schemaVersion:1,appId,sourceId},email='activation-only@example.test';
 const submitted=await h.injectRequest('/v1/app-onboarding/requests','POST',{...identity,kind:'activation',companyName:'Requested company',applicant:{email,firstName:'New',lastName:'Applicant'},initialPassword:'Synthetic-Only-9!'},{...headers,'Idempotency-Key':'activation-action-request'});
 assert.equal(submitted.status,201);
 const [{practice_id}]=await h.store.query('SELECT practice_id FROM onboarding_requests WHERE id=$1',[submitted.body.requestId]);
 // Only the failure state is injected: routing and recovery checks below use actual Connect handlers.
 await h.store.query("UPDATE onboarding_requests SET state='failed',action_required='password_change_required',password_cipher=null,password_deleted_at=now() WHERE id=$1",[submitted.body.requestId]);
 await h.store.query("UPDATE onboarding_practices SET state='failed' WHERE id=$1",[practice_id]);
 const lookup=await h.injectRequest('/v1/app-onboarding/login-context','POST',{...identity,email},headers);
 assert.equal(lookup.status,201);assert.equal(lookup.body.status,'not_found');
 const recovery=await h.injectRequest('/v1/app-onboarding/password-recovery','POST',{...identity,requestId:submitted.body.requestId,localTenantId:randomUUID(),localUserId:randomUUID(),email,consentVersion:'2026-10-21-mandatory-v1',newPassword:'Synthetic-New-Password-9!'},{...headers,'Idempotency-Key':'activation-action-recovery'});
 report={...report,nextAction:lookup.body.request.nextAction,expectedNextAction:'contact_admin',recoveryStatus:recovery.status};
 assert.equal(lookup.body.request.nextAction,'contact_admin','Activation without a legacy account must not advertise legacy password recovery');
 assert.equal(recovery.status,409);
 const {ConnectApplication}=await import('@eulab/connect/application');
 let legacyChecks=0,storeWrites=0,provisionCalls=0;
 const application=new ConnectApplication({apiUrl:'https://connect.example.test',sourceId,appId,sourceSecret:'synthetic',issuer:'https://provider.example.test/realms/qa',clientId:'qa',redirectUri:'https://alora.example.test/callback',appOrigin:'https://alora.example.test',encryptionKey:'a'.repeat(64),store:{transaction:async()=>{storeWrites++;throw Error('Unexpected store write');}},accounts:{verifyLegacy:async()=>{legacyChecks++;return null;},provision:async()=>{provisionCalls++;throw Error('Unexpected provisioning');},restrict:async()=>false},catalog:{schemaVersion:1,version:1,appId,functions:[]}});
 application.source.loginContext=async()=>lookup.body;
 for(const input of [{email,password:'Synthetic-Only-9!'},{email}]){
  const result=await application.auth.signIn(input,{origin:'https://alora.example.test',cookies:{}});
  assert.equal(result.status,'pending');
  assert.equal(result.request.nextAction,'contact_admin');
  assert.equal(result.challenge,undefined);
  assert.equal(result.session,undefined);
  assert.ok(!result.cookies?.length);
 }
 assert.equal(legacyChecks,0);assert.equal(storeWrites,0);assert.equal(provisionCalls,0);
 report={...report,pendingWithAndWithoutPassword:true,legacyChecks,storeWrites,provisionCalls};
}catch(error){failed=true;console.error(error.message);}
finally{
 let cleanupVerified=true;try{if(h)await h.close();}catch{cleanupVerified=false;failed=true;}
 await mkdir('docs/verification',{recursive:true});await writeFile('docs/verification/connect-activation-action.json',JSON.stringify({...report,status:failed?'failed':'passed',cleanupVerified},null,2)+'\n');
 if(failed)process.exitCode=1;else console.log('PASS: activation without legacy account routes to administrator assistance.');
}
