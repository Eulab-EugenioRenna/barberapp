/** Real BFF and installed SDK on disposable PostgreSQL; synthetic loopback Connect/OIDC only. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,expect}=require(process.env.ALORA_PLAYWRIGHT_TEST_MODULE||'@playwright/test');
const base='http://127.0.0.1:53029',origin='http://127.0.0.1:53030';
(async()=>{
 const health=await(await fetch(base+'/health')).json();assert(health.testOnly&&/^step11_qa_\d+$/.test(health.database));
 const control=async(body)=>{const r=await fetch(base+'/_qa',{method:body?'POST':'GET',headers:{'X-Alora-QA':'step11-synthetic','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert(r.ok);return r.json();};
 await control({connectionState:'pairing'});
 const state=await control(),browser=await chromium.launch({headless:true,...(process.env.ALORA_PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.ALORA_PLAYWRIGHT_EXECUTABLE}:{})}),checks=[];
 const errors=[];let page;
 async function open(actor,viewport={width:1440,height:1000}){
  const p=await browser.newPage({viewport});p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(token=>{localStorage.setItem('barber.session',token);localStorage.removeItem('barber.refresh');},state.actors[actor].session.accessToken);
  await p.goto(origin+'/admin/#/whatsapp');await p.getByRole('heading',{name:'WhatsApp',exact:true}).waitFor();return p;
 }
 async function refresh(p){await p.getByRole('button',{name:'Aggiorna stato',exact:true}).click();await expect(p.getByRole('button',{name:'Aggiorna stato',exact:true})).toBeEnabled();}
 function count(s){return s.installations[0].outbox.length;}
 try{
  page=await open('owner');await page.getByAltText('QR per collegare il numero WhatsApp').waitFor();
  assert.equal(await page.getByAltText('QR per collegare il numero WhatsApp').count(),1);
  await page.getByRole('button',{name:/Cliente di prova/}).click();
  await expect(page.locator('.wa-message')).toHaveCount(50);
  await expect(page.locator('.wa-message').last()).toContainText('<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('.wa-messages img').count(),0);
  await page.getByRole('button',{name:'Carica messaggi precedenti',exact:true}).click();await expect(page.locator('.wa-message')).toHaveCount(52);
  await page.locator('.wa-shell').evaluate(el=>el.parentElement.scrollTop=0);
  await page.screenshot({path:'.local/step11/whatsapp-desktop.png'});
  checks.push('actual-sdk-bff-page-qr-for-admin-conversations-safe-plain-text-and-older-message-pagination');
  const reader=await open('reader',{width:820,height:1180});
  await reader.getByRole('button',{name:/Cliente di prova/}).waitFor();
  assert.equal(await reader.getByAltText('QR per collegare il numero WhatsApp').count(),0);
  assert.equal(await reader.getByRole('button',{name:'Disconnetti',exact:true}).count(),0);
  assert.equal(await reader.getByRole('button',{name:'Invia messaggio',exact:true}).count(),0);
  await expect(reader.getByText('Per inviare messaggi occorre il permesso dedicato.')).toBeVisible();
  await reader.screenshot({path:'.local/step11/whatsapp-reader-tablet.png',fullPage:true});
  assert.equal(await reader.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);await reader.close();
  checks.push('read-only-tablet-profile-does-not-fetch-or-render-qr-connection-actions-or-send-controls-and-has-no-horizontal-overflow');
  await page.getByRole('button',{name:'Disconnetti',exact:true}).click();await expect(page.getByText(/Disconnettere questo numero/)).toBeVisible();
  await page.getByRole('button',{name:'Conferma disconnessione',exact:true}).click();await expect(page.getByText('Disconnessione in corso',{exact:true})).toBeVisible();
  await control({connectionState:'disconnected',closed:true});await refresh(page);await page.getByRole('button',{name:'Collega numero',exact:true}).click();await page.getByAltText('QR per collegare il numero WhatsApp').waitFor();
  checks.push('explicit-disconnection-confirmation-and-reconnection-use-server-state-and-preserve-conversations');
  await control({connectionState:'connected'});await refresh(page);await expect(page.getByText('Connesso',{exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.getByLabel('Numero con prefisso internazionale',{exact:true}).fill('+393330000002');
  const message='Messaggio sintetico del browser: nessun destinatario reale';
  await page.getByLabel('Messaggio',{exact:true}).fill(message);
  await page.getByLabel('Ho verificato destinatario e autorizzazione a ricevere questo messaggio.',{exact:true}).check();
  const before=count(await control()),requests=[];let lost=true;
  await page.route('**/api/whatsapp/sessions/*/messages',async route=>{
   if(route.request().method()!=='POST')return route.continue();
   requests.push({url:route.request().url(),body:route.request().postDataJSON()});
   const response=await route.fetch();assert.equal(response.status(),201);
   if(lost){lost=false;return route.abort('failed');}return route.fulfill({response});
  });
  await page.getByRole('button',{name:'Invia messaggio',exact:true}).click();
  await expect(page.getByRole('button',{name:'Verifica la stessa richiesta',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Verifica la stessa richiesta',exact:true})).toBeEnabled();
  await expect(page.getByLabel('Messaggio',{exact:true})).toBeDisabled();assert.equal(count(await control()),before+1);
  await page.reload();await page.getByRole('heading',{name:'WhatsApp',exact:true}).waitFor();
  await expect(page.locator('.wa-pending-text')).toHaveText(message);
  await expect(page.getByLabel('Messaggio',{exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Verifica la stessa richiesta',exact:true}).click();
  await expect(page.getByText(/Richiesta registrata: In coda/)).toBeVisible();assert.equal(requests.length,2);assert.deepEqual(requests[1],requests[0]);assert.equal(count(await control()),before+1);
  await expect(page.getByLabel('Messaggio',{exact:true})).toBeEnabled();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  const layout=await page.locator('.wa-shell').evaluate(el=>({scrollable:el.parentElement.scrollHeight>el.parentElement.clientHeight,hostHeight:el.parentElement.clientHeight,width:el.scrollWidth}));
  assert(layout.scrollable);assert.equal(layout.hostHeight,844);assert(layout.width<=390);
  await page.locator('.wa-compose').scrollIntoViewIfNeeded();await page.screenshot({path:'.local/step11/whatsapp-recovery-mobile.png'});
  await page.locator('.wa-shell').evaluate(el=>el.parentElement.scrollTop=0);await expect(page.getByRole('heading',{name:'WhatsApp',exact:true})).toBeInViewport();
  await page.screenshot({path:'.local/step11/whatsapp-header-mobile.png'});
  checks.push('lost-http-response-after-real-bff-queue-commit-freezes-message-and-recovers-identical-actor-bound-command-after-mobile-reload-once');
  await control({outboxState:'uncertain'});await refresh(page);await expect(page.getByText('Esito da verificare',{exact:true}).first()).toBeVisible();
  assert.equal(count(await control()),before+1);assert.equal(requests.length,2);
  await control({actor:'owner',permissions:[]});await refresh(page);
  await expect(page.locator('p.wa-feedback').first()).toContainText('Permesso esplicito richiesto');assert.equal(await page.locator('.wa-message').count(),0);assert.equal(await page.getByAltText('QR per collegare il numero WhatsApp').count(),0);
  checks.push('provider-uncertain-status-remains-visible-with-no-automatic-resend-and-central-revocation-clears-conversation-data');
  assert.deepEqual(errors,[]);
  const result={checkedAt:new Date().toISOString(),database:health.database,realSdk:true,connectProvider:'synthetic-loopback',realAccounts:false,realProviderMessages:false,checks,screenshots:['whatsapp-desktop.png','whatsapp-reader-tablet.png','whatsapp-recovery-mobile.png','whatsapp-header-mobile.png']};
  fs.writeFileSync('.local/step11/browser-result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result));
 }catch(error){if(page&&!page.isClosed()){await page.screenshot({path:'.local/step11/whatsapp-browser-failure.png',fullPage:true});fs.writeFileSync('.local/step11/whatsapp-browser-failure.txt',await page.locator('body').innerText(),{mode:0o600});}throw error;}
 finally{await control({actor:'owner',permissions:require('../dist/apps/api/common/function-catalog').ALORA_FUNCTIONS.map(f=>f.key)}).catch(()=>{});await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
