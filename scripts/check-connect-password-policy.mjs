/* Real provider rejection in an ephemeral Keycloak. Never changes the operational realm. */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl||new URL(databaseUrl).pathname!=='/barber_security_test')throw Error('Requires isolated barber_security_test');
const name='alora-policy-qa-'+randomUUID().slice(0,8),secret=randomBytes(32).toString('hex');
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
let created=false,result,failed=false;
try{
 docker(['run','--detach','--rm','--name',name,'--publish','127.0.0.1::8080','--env','KC_BOOTSTRAP_ADMIN_USERNAME=qa-admin','--env','KC_BOOTSTRAP_ADMIN_PASSWORD='+secret,'eulab-connect-keycloak:latest','start-dev','--hostname-strict=false']);created=true;
 const port=JSON.parse(docker(['inspect',name]))[0].NetworkSettings.Ports['8080/tcp'][0].HostPort;
 const base='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<180;i++){
  assert.equal(JSON.parse(docker(['inspect',name]))[0].State.Running,true,'Disposable Keycloak exited');
  try{ready=(await fetch(base+'/realms/master',{signal:AbortSignal.timeout(1000)})).ok;}catch{}
  if(ready)break;await new Promise(resolve=>setTimeout(resolve,1000));
  if(i>0&&i%30===0)console.log('Waiting for disposable Keycloak ('+i+' seconds).');
 }
 assert(ready,'Disposable Keycloak startup timed out');
 const tokenResponse=await fetch(base+'/realms/master/protocol/openid-connect/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username:'qa-admin',password:secret})});
 assert(tokenResponse.ok,'Disposable realm bootstrap failed');const token=(await tokenResponse.json()).access_token;
 async function admin(path,method='GET',body){
  const response=await fetch(base+'/admin'+path,{method,headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  assert(response.ok,'Disposable provider administration failed: HTTP '+response.status);const text=await response.text();return text?JSON.parse(text):null;
 }
 await admin('/realms','POST',{realm:'alora-policy-qa',enabled:true,passwordPolicy:'length(64)'});
 const realm='/realms/alora-policy-qa';
 assert.equal((await admin(realm)).passwordPolicy,'length(64)');
 await admin(realm+'/clients','POST',{clientId:'connect-identity-admin',enabled:true,publicClient:false,serviceAccountsEnabled:true,standardFlowEnabled:false,directAccessGrantsEnabled:false,secret});
 const service=(await admin(realm+'/clients?clientId=connect-identity-admin'))[0];
 const account=await admin(realm+'/clients/'+service.id+'/service-account-user');
 const management=(await admin(realm+'/clients?clientId=realm-management'))[0];
 const roles=await admin(realm+'/clients/'+management.id+'/roles');
 await admin(realm+'/users/'+account.id+'/role-mappings/clients/'+management.id,'POST',roles.filter(role=>['manage-users','view-users','query-users'].includes(role.name)));
 const child=spawn(process.execPath,['scripts/check-connect-contract.mjs'],{env:{...process.env,ALORA_CONTRACT_REAL_PASSWORD_POLICY:'1',ALORA_CONTRACT_REAL_CATALOG:'0',ALORA_POLICY_PROVIDER_URL:base+'/realms/alora-policy-qa',OIDC_IDENTITY_ADMIN_SECRET:secret,CONNECT_CONTRACT_PORT:'53028'},stdio:['ignore','pipe','inherit']});
 let output='';child.stdout.on('data',chunk=>output+=chunk);
 const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(status,0,'Provider policy contract failed');
 result=JSON.parse(output.trim().split('\n').at(-1));assert.equal(result.passwordPolicyRejected,true);
 const users=await admin(realm+'/users?max=100');const people=users.filter(user=>!user.username.startsWith('service-account-'));assert.equal(people.length,1,'Recovery must create exactly one provider identity');assert.equal(people[0].email,result.recoveredEmail);delete result.recoveredEmail;assert.equal(result.recoveryExecuted,true);
 // Positive control proves rejection came from length policy, rather than a broken identity service.
 const email='policy-positive@example.test';
 await admin(realm+'/users','POST',{username:email,email,enabled:true,credentials:[{type:'password',value:randomBytes(48).toString('hex'),temporary:false}]});
 assert.equal((await admin(realm+'/users?username='+encodeURIComponent(email)+'&exact=true')).length,1);
 result.positiveControlAccepted=true;result.noRejectedProviderIdentity=true;result.checks+=2;
}catch(error){failed=true;console.error(error.message);}
finally{
 let cleanupVerified=true;
 if(created)try{docker(['rm','--force',name]);}catch{cleanupVerified=false;failed=true;console.error('Disposable Keycloak cleanup failed: '+name);}
 result??={incomplete:true,realKeycloak:true,production:false};
 await mkdir('docs/verification',{recursive:true});
 await writeFile('docs/verification/connect-password-policy.json',JSON.stringify({at:new Date().toISOString(),...result,cleanupVerified,status:failed?'failed':'passed'},null,2)+'\n');
 if(failed)process.exitCode=1;
 else console.log('PASS: '+result.checks+' checks; real Keycloak password-policy rejection and recovery approval, transient credential deletion, blocked ALORA access before approval and preserved local profile; disposable provider removed. Connect PGlite/admin OIDC simulated.');
}
