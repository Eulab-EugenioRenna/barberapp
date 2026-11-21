/** Real disposable PostgreSQL/HTTP + installed SDK; Connect and OIDC are synthetic loopback services. */
import {execFileSync} from 'node:child_process';
import {createServer,request as proxyRequest} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync,statSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const stamp=Date.now(),database='step11_qa_'+stamp,container='alora-step11-qa-'+stamp,directory='.local/step11/http-'+stamp;
mkdirSync(directory,{recursive:true,mode:0o700});
const docker=(args,input)=>execFileSync('docker',args,{input,stdio:'pipe',maxBuffer:32*1024*1024});
const base='http://127.0.0.1:53029',browserOrigin='http://127.0.0.1:53030';
let created=false,running=false,web,failed=false;const checks=[];
const control=async(body)=>{const r=await fetch(base+'/_qa',{method:body?'POST':'GET',headers:{'X-Alora-QA':'step11-synthetic','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert(r.ok);return r.json();};
let state;
async function call(route,body,{actor='owner',status=body?201:200,method=body?'POST':'GET',origin=browserOrigin,headers={}}={}){
 const r=await fetch(base+route,{method,headers:{Authorization:'Bearer '+state.actors[actor].session.accessToken,'Content-Type':'application/json',Origin:origin,...headers},...(body?{body:JSON.stringify(body)}:{})});
 const raw=await r.text();assert.equal(r.status,status,route+': '+raw);assert(!raw.includes('synthetic-installation-secret'));assert(!raw.includes('must-not-project'));assert(!raw.includes('authorization_cipher'));return {data:raw?JSON.parse(raw):null,response:r};
}
try{
 docker(['exec','barber-postgres-1','createdb','-U','barber',database]);created=true;
 docker(['run','--rm','--network','barber_app','--entrypoint','node','-e',`DATABASE_URL=postgresql://barber:barber@postgres:5432/${database}?schema=public`,'-v',path.resolve('prisma')+':/app/prisma:ro','barber-api','/app/node_modules/prisma/build/index.js','migrate','deploy','--schema','/app/prisma/schema.prisma']);
 docker(['run','-d','--name',container,'--network','barber_app','-p','127.0.0.1:53029:3000','-e',`DATABASE_URL=postgresql://barber:barber@postgres:5432/${database}?schema=public`,'-e','ALORA_WHATSAPP_TEST_ONLY=1','-e','ALORA_APPOINTMENT_WORKFLOW_TEST_ONLY='+Number(process.argv.includes('--workflow')),'-e','NODE_PATH=/app/node_modules','-v',path.resolve('scripts')+':/qa:ro','-v',path.resolve('dist/apps/api')+':/app/dist/apps/api:ro','-v',path.resolve('prisma')+':/app/prisma:ro','-v',path.resolve('vendor/eulab-connect-0.12.0-rc.2.tgz')+':/qa-sdk.tgz:ro','--entrypoint','sh','barber-api','-c','node /qa/check-qa-runtime-sdk.cjs >/tmp/sdk-check.log 2>&1 && node node_modules/prisma/build/index.js generate --schema prisma/schema.prisma >/tmp/prisma-generate.log 2>&1 && exec node /qa/whatsapp-qa-server.cjs']);running=true;
 let ready=false;for(let i=0;i<240;i++){try{const r=await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});ready=r.ok&&Boolean((await r.json()).testOnly);}catch{}if(ready)break;if(i%10===9 && docker(['inspect','--format','{{.State.Running}}',container]).toString().trim()==='false')break;await new Promise(r=>setTimeout(r,200));}
 if(!ready){docker(['cp',container+':/tmp',path.resolve(directory+'/startup-tmp')]);const logs=docker(['logs','--tail','25',container]).toString();throw Error('QA did not become ready: '+logs);}
 assert.equal((await (await fetch(base+'/health')).json()).sdkVersion,'0.12.0-rc.2');
 state=await control();
 const installation=state.installations[0],foreign=state.installations[1],sessionId=installation.session.id,archiveId=installation.archiveId;
 const sessions=await call('/whatsapp/sessions');assert.equal(sessions.response.headers.get('cache-control'),'no-store');assert.equal(sessions.data[0].id,sessionId);assert(!('runnerId' in sessions.data[0]));
 const qr=await call(`/whatsapp/sessions/${sessionId}/qr`);assert(qr.data.qr.startsWith('data:image/png;base64,'));
 await call(`/whatsapp/sessions/${sessionId}/qr`,undefined,{actor:'reader',status:403});
 await call(`/whatsapp/sessions/${foreign.session.id}/qr`,undefined,{status:404});
 await control({flags:{unsafeQr:true}});await call(`/whatsapp/sessions/${sessionId}/qr`,undefined,{status:502});await control({flags:{unsafeQr:false}});
 const archives=(await call('/whatsapp/archives')).data;assert.equal(archives.length,1);assert.equal(archives[0].id,archiveId);assert(!('installation_id'in archives[0]));
 assert.deepEqual((await call(`/whatsapp/archives/${foreign.archiveId}/conversations`)).data,[]);
 const conversations=(await call(`/whatsapp/archives/${archiveId}/conversations`)).data;assert.equal(conversations[0].name,'Cliente di prova');assert.equal(conversations[0].direction,'inbound');assert(!('avatar'in conversations[0]));
 const chat=conversations[0].chatId,latest=(await call(`/whatsapp/archives/${archiveId}/messages?chat=${encodeURIComponent(chat)}`)).data;assert.equal(latest.length,50);assert.equal(latest[0].direction,'outbound');
 const older=(await call(`/whatsapp/archives/${archiveId}/messages?chat=${encodeURIComponent(chat)}&before=${latest.at(-1).id}`)).data;assert.equal(older.length,2);
 await call(`/whatsapp/archives/${archiveId}/messages?chat=a&chat=b`,undefined,{status:400});
 await call(`/whatsapp/archives/${archiveId}/messages?before=not-a-uuid`,undefined,{status:400});
 await call(`/whatsapp/archives/${archiveId}/messages?installationId=${foreign.id}`,undefined,{status:400});
 checks.push('real-sdk-session-authentication-and-installation-scope-safe-qr-archives-conversations-and-50-message-pagination');
 for(const actor of ['partial','none'])await call('/whatsapp/sessions',undefined,{actor,status:403});
 await call(`/whatsapp/sessions/${sessionId}/disconnect`,{},{actor:'reader',status:403});
 await call(`/whatsapp/sessions/${sessionId}/messages`,{to:'+393330000002',text:'synthetic',idempotencyKey:randomUUID(),recipientAuthorized:true},{actor:'administrator',status:403});
 await call(`/whatsapp/sessions/${sessionId}/disconnect`,{},{origin:'https://foreign.invalid',status:403});
 await call('/whatsapp/sessions/invalid/disconnect',{},{status:400});
 await call(`/whatsapp/sessions/${sessionId}/messages`,{to:'+393330000002',text:'synthetic',idempotencyKey:randomUUID(),recipientAuthorized:true,installationId:foreign.id},{status:400});
 await call(`/whatsapp/sessions/${sessionId}/messages`,{to:'+393330000002',text:'synthetic',idempotencyKey:randomUUID(),recipientAuthorized:false},{status:400});
 checks.push('explicit-independent-grants-whole-company-sector-access-origin-and-strict-payload-boundaries');
 await control({connectionState:'connected'});
 const input={to:'+393330000002',text:'Messaggio di prova isolata',idempotencyKey:randomUUID(),recipientAuthorized:true};
 const first=(await call(`/whatsapp/sessions/${sessionId}/messages`,input)).data;
 const replay=(await call(`/whatsapp/sessions/${sessionId}/messages`,input)).data;assert.deepEqual(replay,first);assert.equal(first.state,'queued');
 await call(`/whatsapp/sessions/${sessionId}/messages`,{...input,text:'different'},{status:409});
 const other=(await call(`/whatsapp/sessions/${sessionId}/messages`,input,{actor:'sender'})).data;assert.notEqual(other.id,first.id);
 state=await control();assert.equal(state.installations[0].outbox.length,2);assert.notEqual(state.installations[0].outbox[0].key,state.installations[0].outbox[1].key);
 checks.push('stable-actor-bound-provider-idempotency-original-acknowledgement-no-inferred-delivery-and-conflicting-payload-rejected');
 await control({flags:{loseNextSend:true}});
 const uncertain={...input,idempotencyKey:randomUUID(),text:'Risposta persa dopo la registrazione'};
 await call(`/whatsapp/sessions/${sessionId}/messages`,uncertain,{status:503});
 state=await control();assert.equal(state.installations[0].outbox.length,3);
 const recovered=(await call(`/whatsapp/sessions/${sessionId}/messages`,uncertain)).data;assert.equal(recovered.id,state.installations[0].outbox[2].id);
 state=await control();assert.equal(state.installations[0].outbox.length,3);
 await control({flags:{hangNextSend:true}});const timed={...input,idempotencyKey:randomUUID(),text:'Provider timeout after queue commit'},started=Date.now();
 await call(`/whatsapp/sessions/${sessionId}/messages`,timed,{status:503});assert(Date.now()-started>=9000);assert(Date.now()-started<15000);state=await control();assert.equal(state.installations[0].outbox.length,4);
 const timedRecovery=(await call(`/whatsapp/sessions/${sessionId}/messages`,timed)).data;assert.equal(timedRecovery.id,state.installations[0].outbox[3].id);assert.equal((await control()).installations[0].outbox.length,4);
 checks.push('real-sdk-request-deadline-bounds-hung-provider-after-commit-and-same-key-recovery-does-not-requeue');
 await control({outboxState:'uncertain'});const outbox=(await call('/whatsapp/outbox')).data;assert(outbox.every(o=>o.state==='uncertain'));assert(outbox.every(o=>!('payload'in o)));
 checks.push('lost-provider-response-after-queue-commit-explicit-same-command-recovery-no-duplicate-and-provider-uncertain-state-retained');
 await control({actor:'reader',permissions:[]});await call('/whatsapp/sessions',undefined,{actor:'reader',status:403});await control({actor:'reader',permissions:['whatsapp.read']});
 await control({flags:{unavailable:true}});await call('/whatsapp/sessions',undefined,{status:503});await control({flags:{unavailable:false}});await call('/whatsapp/sessions');
 await control({flags:{malformed:true}});await call('/whatsapp/sessions',undefined,{status:503});await control({flags:{malformed:false}});await call('/whatsapp/sessions');
 checks.push('current-central-revocation-and-transient-or-malformed-provider-failures-deny-request-without-destroying-valid-sdk-session');
 await call(`/whatsapp/sessions/${sessionId}/disconnect`,{});assert.equal((await call('/whatsapp/sessions')).data[0].state,'disconnecting');
 await control({connectionState:'disconnected',closed:true});const connected=await call('/whatsapp/sessions',{});assert.equal(connected.data.state,'queued');const newId=(await call('/whatsapp/sessions')).data[0].id;assert.notEqual(newId,sessionId);
 await control({connectionState:'failed'});await call(`/whatsapp/sessions/${newId}/reconnect`,{});assert.equal((await call('/whatsapp/sessions')).data[0].state,'queued');
 await control({connectionState:'pairing'});
 checks.push('explicit-connect-disconnect-and-reconnect-use-existing-provider-state-machine-and-preserve-archive');
 const sql=q=>docker(['exec','-i','barber-postgres-1','psql','-X','-U','barber','-d',database,'-At','-v','ON_ERROR_STOP=1'],q).toString().trim();
 const audit=sql('SELECT coalesce(jsonb_agg(to_jsonb(a))::text,\'[]\') FROM "AuditLog" a');assert(!audit.includes(input.text));assert(!audit.includes(input.to));assert(!audit.includes('idempotencyKey'));
 checks.push('mutations-audited-without-message-content-phone-token-or-command-key');
 await control({actor:'none',revoked:true});await call('/auth/me',undefined,{actor:'none',status:401});await control({actor:'none',revoked:false});await call('/auth/me',undefined,{actor:'none',status:401});
 checks.push('definitive-connect-access-revocation-invalidates-sdk-session-and-does-not-silently-restore-it');
 const result={checkedAt:new Date().toISOString(),database,realSdk:true,sdkVersion:'0.12.0-rc.2',connectProvider:'synthetic-loopback',realAccounts:false,realProviderMessages:false,checks};writeFileSync(directory+'/result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});writeFileSync('.local/step11/http-result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result));
 if(process.argv.includes('--browser')){
  const root=path.resolve('dist/apps/web-admin/browser');
  web=createServer((req,res)=>{if(req.url.startsWith('/api/')){const upstream=proxyRequest(base+req.url.slice(4),{method:req.method,headers:{...req.headers,host:'127.0.0.1:53030'}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{res.statusCode=502;res.end();});req.pipe(upstream);return;}
   const decoded=decodeURIComponent(new URL(req.url,browserOrigin).pathname);let file=path.resolve(root,decoded.replace(/^\/admin\/?/,''));if(!file.startsWith(root+path.sep)&&file!==root){res.statusCode=404;res.end();return;}if(!existsSync(file)||statSync(file).isDirectory())file=path.join(root,'index.html');res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(readFileSync(file));});
  await new Promise(resolve=>web.listen(53030,'127.0.0.1',resolve));console.log('Browser QA ready on 53030. Send done to close and clean the disposable runtime.');await new Promise(resolve=>{process.stdin.resume();process.stdin.once('data',resolve);});process.stdin.pause();
 }
}catch(error){failed=true;console.error(error.message);process.exitCode=1;}
finally{
 if(web)await new Promise(resolve=>web.close(resolve));
 if(running)try{docker(['rm','-f',container]);}catch{failed=true;process.exitCode=1;}
 if(created)try{docker(['exec','barber-postgres-1','dropdb','-U','barber','--force',database]);}catch{failed=true;process.exitCode=1;}
 writeFileSync(directory+'/cleanup.json',JSON.stringify({checkedAt:new Date().toISOString(),status:failed?'failed':'passed',containerRemoved:running,databaseRemoved:created})+'\n',{mode:0o600});
}
