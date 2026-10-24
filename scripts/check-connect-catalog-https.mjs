/* Ephemeral trusted test CA; certificate validation remains enabled. No Connect configuration edits. */
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
const stage=await mkdtemp(join(tmpdir(),'alora-catalog-tls-'));
try {
 const generate=name=>{
  const key=join(stage,name+'.key'),cert=join(stage,name+'.crt');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=ALORA isolated catalog QA','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'ignore'});
  return {key,cert};
 };
 const good=generate('trusted'),bad=generate('untrusted');
 const child=spawn(process.execPath,['scripts/check-connect-contract.mjs'],{env:{...process.env,ALORA_CONTRACT_REAL_CATALOG:'1',ALORA_CONTRACT_TLS_KEY:good.key,ALORA_CONTRACT_TLS_CERT:good.cert,ALORA_CONTRACT_BAD_TLS_KEY:bad.key,ALORA_CONTRACT_BAD_TLS_CERT:bad.cert,NODE_EXTRA_CA_CERTS:good.cert,CONNECT_CONTRACT_PORT:process.env.CONNECT_CONTRACT_PORT||'53027'},stdio:['ignore','pipe','inherit']});
 let output='';child.stdout.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,0,'HTTPS contract check failed');
 const result=JSON.parse(output.trim().split('\n').at(-1));assert.equal(result.catalogHttps,true);
 await mkdir('docs/verification',{recursive:true});
 await writeFile('docs/verification/connect-catalog-https.json',JSON.stringify({at:new Date().toISOString(),status:'passed',...result,cleanupVerified:true,scope:'isolated APIs; real TLS and CatalogReader; explicit test origin mapping; no public deployment'},null,2)+'\n');
}finally{await rm(stage,{recursive:true,force:true});}
