/* Read-only setup diagnostics delegated to the official application facade. */
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);
try{process.loadEnvFile();}catch(error){if(error.code!=='ENOENT')throw Error('Unable to read local environment file');}
const presenter=!!(process.env.ALORA_CONNECT_PRESENTER_ID||process.env.ALORA_CONNECT_PRESENTER_SECRET);
const required=['ALORA_CONNECT_APP_ID','ALORA_CONNECT_API_URL','ALORA_CONNECT_CALLBACK_URL','ALORA_AUTH_RETURN_URL','ALORA_CONNECT_ENCRYPTION_KEY','ALORA_CONNECT_SOURCE_ID',...(presenter?['ALORA_CONNECT_PRESENTER_ID','ALORA_CONNECT_PRESENTER_SECRET']:['ALORA_CONNECT_ISSUER','ALORA_CONNECT_CLIENT_ID','ALORA_CONNECT_BOOTSTRAP_SECRET'])];
const missing=required.filter(name=>!process.env[name]?.trim());
const result={status:'configuration_missing',missing,online:false,readOnly:true,operationalAcceptance:false};
async function main(){
 if(missing.length){process.exitCode=1;return;}
 let runtime;
 try{runtime=require('../dist/apps/api/common/connect-runtime.js');}
 catch{result.status='api_build_required';process.exitCode=1;return;}
 try{runtime.connectApplicationConfig();}
 catch{result.status='configuration_invalid';process.exitCode=1;return;}
 result.status='configuration_valid';
 if(!process.argv.includes('--online'))return;
 result.online=true;
 let prisma,close;
 try{
  const {PrismaClient}=require('@prisma/client');
  const {connectApplication,closeConnectApplication}=require('../dist/apps/api/common/connect-application.js');close=closeConnectApplication;
  // Construction does not connect to PostgreSQL; diagnose itself is read-only and does not use the store.
  prisma=new PrismaClient();
  const application=await connectApplication(prisma);
  const report=await application.diagnose('setup-probe-'+randomUUID()+'@example.invalid');
  result.checks=report.checks;
  result.status=report.checks.some(check=>check.status==='failed')?'setup_check_failed':'setup_checks_passed';
  if(result.status==='setup_check_failed')process.exitCode=1;
 }catch{
  result.status='setup_check_failed';
  process.exitCode=1;
 }finally{
  if(close&&prisma)await close(prisma);
  if(prisma)await prisma.$disconnect();
 }
}
await main();
console.log(JSON.stringify(result,null,2));
