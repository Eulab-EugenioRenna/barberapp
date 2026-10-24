/* Read-only use of a Connect checkout; all Connect state lives in an in-memory test DB. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const checkout=process.env.CONNECT_CHECKOUT;
if(!checkout||!process.env.CATALOG_TEST_ORIGIN)throw new Error('CONNECT_CHECKOUT and CATALOG_TEST_ORIGIN required');
const load=path=>import(pathToFileURL(join(checkout,path)).href);
const {harness}=await load('tests/harness.mjs');
const {CatalogReader}=await load('apps/api/src/catalog-reader.ts');
const {functionMatrixSchema}=await load('apps/api/src/function-matrix.ts');
const {defineFunctions}=await load('packages/sdk/src/functions.ts');
process.env.CATALOG_INTERNAL_ORIGINS_JSON=JSON.stringify({'https://alora-catalog.example':process.env.CATALOG_TEST_ORIGIN});
const h=await harness();
const admin = async (...args) => {
 const response=await h.request(...args);
 assert(response.status>=200&&response.status<300, args[0]+': '+JSON.stringify(response.body));
 return response;
};
try{
 const customer=(await admin('/v1/customers','POST',{name:'ALORA isolated catalog'})).body;
 const appId='alora-catalog-test';
 const i=(await admin('/v1/application-connections','POST',{id:appId,name:'ALORA isolated',customerId:customer.id,domain:'https://alora-catalog.example',basePath:'/admin',integration:'web'})).body;
 const reader=new CatalogReader();let reads=0;
 h.setCatalogReader(async url=>{reads++;return reader.read(url);});
 const sync=()=>h.request(`/v1/applications/${appId}/catalog-sync`,'POST');
 const result=await sync();assert.equal(result.body.ok,true,JSON.stringify(result.body));assert.equal(reads,1);
 const matrix=functionMatrixSchema.parse(await reader.read('https://alora-catalog.example/admin/.well-known/eulab-connect.json'));
 assert.deepEqual(defineFunctions(matrix),matrix);
 assert.equal((await sync()).body.changed,false);
 assert.equal((await h.store.query('SELECT * FROM entitlements')).length,0);
 assert.equal((await h.store.query('SELECT * FROM role_permissions')).length,0);
 const subject=randomUUID(),role=randomUUID();
 await admin('/v1/identities','PUT',{subject,displayName:'Local collaborator',enabled:true});
 await admin('/v1/memberships','PUT',{subject,customerId:customer.id,enabled:true,roleIds:[]});
 await admin('/v1/identity-links','PUT',{installationId:i.installationId,localUserId:'alora-local-user',subject});
 await admin('/v1/roles','PUT',{id:role,customerId:customer.id,appId,name:'Agenda',reason:'Isolated acceptance',permissions:['appointments.read.all']});
 await admin('/v1/memberships','PUT',{subject,customerId:customer.id,enabled:true,roleIds:[role]});
 const plan={customerId:customer.id,appId,state:'active',expiresAt:null,features:[],reason:'Isolated acceptance'};
 await admin('/v1/licenses','PUT',plan);
 const headers={Authorization:`Bearer ${await h.token(subject,[])}`,'X-Installation-Id':i.installationId,Origin:'https://alora-catalog.example'};
 const access=()=>h.request('/v1/access','GET',undefined,headers);
 assert.deepEqual((await access()).body.functions,[]);
 await admin('/v1/licenses','PUT',{...plan,features:[{key:'appointments.read.all',purchased:true,enabled:true}]});
 assert.deepEqual((await access()).body.functions.map(item=>item.key),['appointments.read.all']);
 // Version-change probes use synthetic documents only in the isolated reader override.
 let document={...matrix,version:matrix.version+1,functions:[...matrix.functions,{key:'future.test',name:'Future synthetic test'}]};
 h.setCatalogReader(async()=>structuredClone(document));
 assert.equal((await sync()).body.ok,true);
 assert.deepEqual((await access()).body.functions.map(item=>item.key),['appointments.read.all']);
 assert.equal((await admin('/v1/authorize','POST',{installationId:i.installationId,permission:'future.test'},headers)).body.allowed,false);
 document={...document,functions:document.functions.map(item=>item.key==='future.test'?{...item,name:'Changed at same version'}:item)};
 assert.equal((await sync()).body.ok,false);
 document={...matrix};assert.equal((await sync()).body.ok,false);
 console.log('PASS: Connect isolated API imports ALORA via real CatalogReader/Nginx GET; SDK/schema valid; repeat stable; same-version changes and regressions rejected; new functions ungranted; role + entitlement required. OIDC simulated, database in memory.');
}finally{await h.close();}
