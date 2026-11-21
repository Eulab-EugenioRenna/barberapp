/** Boots candidate images only, on an internal network and disposable tmpfs PostgreSQL/Redis.
 * No host port, production volume, real account or external provider is used.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const runtimeOnlyCandidate = process.env.ALORA_RUNTIME_ONLY_CANDIDATE === "1";
const eventNoticesCandidate = runtimeOnlyCandidate || process.env.ALORA_STEP12_EVENT_NOTICES_CANDIDATE === "1";
const workflowCandidate = eventNoticesCandidate || process.env.ALORA_STEP12_WORKFLOW_CANDIDATE === "1";
const templatesCandidate = process.env.ALORA_STEP12_TEMPLATES_CANDIDATE === "1";
const policyCandidate = process.env.ALORA_STEP12_POLICY_CANDIDATE === "1";
const withdrawalCandidate =
  workflowCandidate || process.env.ALORA_STEP12_WITHDRAWAL_CANDIDATE === "1";
const connectCandidate =
  withdrawalCandidate || process.env.ALORA_STEP12_CONNECT_CANDIDATE === "1";
const sdkVersion = withdrawalCandidate ? "0.12.0-rc.2" : "0.12.0-rc.1";
const imageDate = workflowCandidate
  ? "20261111"
  : connectCandidate
    ? "20261110"
    : "20261109";
const imagePrefix = runtimeOnlyCandidate ? "alora-runtime-only-" : eventNoticesCandidate ? "alora-step12-events-candidate-" : workflowCandidate
  ? "alora-step12-workflow-candidate-"
  : withdrawalCandidate
    ? "alora-step12-withdrawal-candidate-"
    : connectCandidate
      ? "alora-step12-connect-candidate-"
      : policyCandidate
        ? "alora-step12-policy-candidate-"
        : templatesCandidate
          ? "alora-step12-templates-candidate-"
          : "alora-step13-candidate-";
const evidenceRoot = runtimeOnlyCandidate ? ".local/runtime-only-20261111" : eventNoticesCandidate ? ".local/step12/events-docker" : workflowCandidate
  ? ".local/step12/workflow-docker"
  : withdrawalCandidate
    ? ".local/step12/withdrawal-docker"
    : connectCandidate
      ? ".local/step12/connect-docker"
      : policyCandidate
        ? ".local/step12/policy-docker"
        : templatesCandidate
          ? ".local/step12/templates-docker"
          : ".local/step13/docker";
const stamp = Date.now(),
  prefix =
    (eventNoticesCandidate ? "alora-step12-events-runtime-" : workflowCandidate
      ? "alora-step12-workflow-runtime-"
      : withdrawalCandidate
        ? "alora-step12-withdrawal-runtime-"
        : connectCandidate
          ? "alora-step12-connect-runtime-"
          : policyCandidate
            ? "alora-step12-policy-runtime-"
            : templatesCandidate
              ? "alora-step12-templates-runtime-"
              : "alora-step13-runtime-") + stamp,
  network = prefix + "-net";
const db = prefix + "-db",
  redis = prefix + "-redis",
  api = prefix + "-api",
  admin = prefix + "-admin",
  booking = prefix + "-booking";
const root = evidenceRoot + "/runtime-" + stamp;
mkdirSync(root, { recursive: true, mode: 0o700 });
const created = [];
let networkCreated = false;
const checks = [];
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
const run = (name, args) => {
  docker(["run", "-d", "--name", name, "--network", network, ...args]);
  created.push(name);
};
const exec = (name, args) => docker(["exec", name, ...args]);
async function ready(action) {
  let last;
  for (let i = 0; i < 60; i++) {
    try {
      return action();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw last;
}
try {
  for (const name of ["api", "admin", "booking"])
    docker(["image", "inspect", imagePrefix + name + ":" + imageDate]);
  docker(["network", "create", "--internal", network]);
  networkCreated = true;
  run(db, [
    "--tmpfs",
    "/var/lib/postgresql/data:rw,nosuid,size=256m",
    "-e",
    "POSTGRES_DB=step13_runtime",
    "-e",
    "POSTGRES_USER=step13",
    "-e",
    "POSTGRES_PASSWORD=isolated-runtime-only",
    "postgres:16-alpine",
  ]);
  run(redis, [
    "--tmpfs",
    "/data:rw,nosuid,size=64m",
    "redis:7-alpine",
    "redis-server",
    "--save",
    "",
    "--appendonly",
    "no",
  ]);
  await ready(() =>
    exec(db, ["pg_isready", "-U", "step13", "-d", "step13_runtime"]),
  );
  await ready(() => assert.equal(exec(redis, ["redis-cli", "ping"]), "PONG"));
  run(api, [
    "-e",
    `DATABASE_URL=postgresql://step13:isolated-runtime-only@${db}:5432/step13_runtime?schema=public`,
    "-e",
    `DB_HOST=${db}`,
    "-e",
    "DB_PORT=5432",
    "-e",
    `REDIS_HOST=${redis}`,
    "-e",
    "REDIS_PORT=6379",
    "-e",
    "SMTP_HOST=127.0.0.1",
    "-e",
    "SMTP_PORT=9",
    "-e",
    "ADMIN_APP_URL=http://127.0.0.1:53020",
    "-e",
    "PUBLIC_APP_URL=http://127.0.0.1:53020",
    imagePrefix + "api:" + imageDate,
  ]);
  const probe = (url, status = 200) =>
    exec(api, [
      "node",
      "-e",
      `fetch(${JSON.stringify(url)}).then(async r=>{if(r.status!==${status})throw Error('HTTP '+r.status);console.log(JSON.stringify({status:r.status,contentType:r.headers.get('content-type')}))}).catch(e=>{console.error(e.message);process.exit(1)})`,
    ]);
  await ready(() => probe("http://127.0.0.1:3000/health"));
  checks.push(
    "full-candidate-AppModule-starts-with-isolated-Redis-and-empty-PostgreSQL-migrations",
  );
  const schema = exec(db, [
    "psql",
    "-X",
    "-U",
    "step13",
    "-d",
    "step13_runtime",
    "-Atqc",
    `SELECT to_regclass('public."NotificationDomainEvent"') IS NOT NULL, (SELECT count(*) FROM _prisma_migrations WHERE migration_name LIKE '20261109%'), (SELECT count(*) FROM "Tenant"), (SELECT count(*) FROM "User"), (SELECT count(*) FROM "Sale");`,
  ]);
  assert.equal(
    schema,
    `t|${policyCandidate || connectCandidate ? 3 : 2}|0|0|0`,
  );
  checks.push(
    "entrypoint-applies-pending-notification-migrations-and-does-not-seed-accounts-tenants-or-sales",
  );
  const anonymous = exec(api, [
    "node",
    "-e",
    "fetch('http://127.0.0.1:3000/collaborators/options').then(r=>{if(![401,403].includes(r.status))throw Error('Unexpected '+r.status);console.log(r.status)}).catch(e=>{console.error(e.message);process.exit(1)})",
  ]);
  assert(["401", "403"].includes(anonymous));
  checks.push(
    "actual-global-guards-deny-anonymous-operational-options-without-an-account-or-Connect-login",
  );
  if (templatesCandidate || policyCandidate || connectCandidate) {
    const guarded = exec(api, [
      "node",
      "-e",
      `(async()=>{for(const [path,method] of [['/notifications/templates','GET'],['/notifications/templates/appointment.confirmed/email/preview','POST'],['/notifications/templates/appointment.confirmed/email','PATCH']]){const r=await fetch('http://127.0.0.1:3000'+path,{method,headers:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:'{}'})});if(![401,403].includes(r.status))throw Error(path+': '+r.status)}console.log('PASS')})().catch(e=>{console.error(e.message);process.exit(1)})`,
    ]);
    assert.equal(guarded, "PASS");
    checks.push(
      "actual-global-guards-deny-anonymous-template-read-preview-and-save-without-seeding-identities",
    );
  }
  if (policyCandidate || connectCandidate) {
    assert.equal(
      exec(db, [
        "psql",
        "-X",
        "-U",
        "step13",
        "-d",
        "step13_runtime",
        "-Atqc",
        'SELECT count(*) FROM "AppointmentAutomationPolicy"',
      ]),
      "0",
    );
    assert.equal(
      exec(api, [
        "node",
        "-e",
        `(async()=>{for(const [path,method] of [['/notifications/appointment-policy','GET'],['/notifications/appointment-policy','PATCH'],['/notifications/appointment-policy/preview','POST']]){const r=await fetch('http://127.0.0.1:3000'+path,{method,headers:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:'{}'})});if(![401,403].includes(r.status))throw Error(path+': '+r.status)}console.log('PASS')})().catch(e=>{console.error(e.message);process.exit(1)})`,
      ]),
      "PASS",
    );
    checks.push(
      "draft-policy-migration-does-not-create-configuration-or-work-and-real-guards-deny-anonymous-policy-read-save-and-preview",
    );
  }
  if (connectCandidate) {
    assert.equal(
      exec(db, [
        "psql",
        "-X",
        "-U",
        "step13",
        "-d",
        "step13_runtime",
        "-Atqc",
        `SELECT (SELECT count(*) FROM _prisma_migrations WHERE migration_name LIKE '20261110%' AND finished_at IS NOT NULL), (SELECT count(*) FROM "NotificationAutomationGrant"), (SELECT count(*) FROM "NotificationAutomationWebhook"), (SELECT count(*) FROM "NotificationAutomationWebhookEvent");`,
      ]),
      `${workflowCandidate ? 5 : withdrawalCandidate ? 3 : 2}|0|0|0`,
    );
    assert.equal(
      exec(api, [
        "node",
        "-e",
        `(async()=>{const fs=require('node:fs');if(JSON.parse(fs.readFileSync('node_modules/@eulab/connect/package.json')).version!==${JSON.stringify(sdkVersion)})throw Error('Wrong SDK');for(const [path,method] of [['/notifications/automation-grants','GET'],['/notifications/automation-grants','POST'],['/notifications/automation-webhooks','GET'],['/notifications/automation-webhooks','POST']]){const r=await fetch('http://127.0.0.1:3000'+path,{method,headers:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:'{}'})});if(![401,403].includes(r.status))throw Error(path+': '+r.status)}const url='http://127.0.0.1:3000/notifications/automation-webhooks/00000000-0000-4000-8000-000000000000/events';for(const [headers,status]of [[{},404],[{Origin:'https://browser.invalid'},403]]){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({large:'x'.repeat(200000)})});if(r.status!==status)throw Error('Raw ingress '+r.status)}const ordinary=await fetch('http://127.0.0.1:3000/notifications/automation-grants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({large:'x'.repeat(200000)})});if(ordinary.status!==413)throw Error('Ordinary body limit');console.log('PASS')})().catch(e=>{console.error(e.message);process.exit(1)})`,
      ]),
      "PASS",
    );
    checks.push(
      workflowCandidate ? "SDK-012-rc2-five-empty-automation-migrations-current-guards-public-raw-webhook-route-and-ordinary-body-limit" : withdrawalCandidate
        ? "SDK-012-rc2-three-empty-automation-migrations-current-guards-public-raw-webhook-route-and-ordinary-body-limit"
        : "SDK-012-rc1-two-empty-automation-migrations-current-guards-public-raw-webhook-route-and-ordinary-body-limit",
    );
  }
  if (withdrawalCandidate) {
    assert.equal(
      exec(db, [
        "psql",
        "-X",
        "-U",
        "step13",
        "-d",
        "step13_runtime",
        "-Atqc",
        'SELECT count(*) FROM "NotificationAutomationCommand"',
      ]),
      "0",
    );
    assert.equal(
      exec(api, [
        "node",
        "-e",
        "if(!require('@prisma/client').Prisma.dmmf.datamodel.models.some(m=>m.name==='NotificationAutomationCommand'))throw Error('Command client stale');console.log('PASS')",
      ]),
      "PASS",
    );
    checks.push(
      "durable-command-journal-and-withdrawal-recovery-module-start-empty-without-provider-effects",
    );
  }
  const native = exec(api, [
    "node",
    "-e",
    `const fs=require('node:fs'),{Prisma}=require('@prisma/client'),b=require('bcrypt');if(!Prisma.dmmf.datamodel.models.some(m=>m.name==='NotificationDomainEvent'))throw Error('Client stale');if(!b.compareSync('isolated-runtime-check',b.hashSync('isolated-runtime-check',4)))throw Error('Native bcrypt');if(fs.readdirSync('/app/scripts').sort().join(',')!=='${runtimeOnlyCandidate ? "prisma-bootstrap.js" : "create-demo-account.ts,prisma-bootstrap.js"}')throw Error('Runtime scripts');console.log('PASS')`,
  ]);
  assert.equal(native, "PASS");
  checks.push(
    "generated-Linux-Prisma-client-and-native-bcrypt-work-and-QA-server-scripts-are-excluded",
  );
  if (workflowCandidate) {
    assert.equal(
      exec(db, [
        "psql",
        "-X",
        "-U",
        "step13",
        "-d",
        "step13_runtime",
        "-Atqc",
        `SELECT (SELECT count(*) FROM "AppointmentAutomationRun")||'|'||(SELECT count(*) FROM "AppointmentAutomationAction")||'|'||(SELECT count(*) FROM "AppointmentAutomationDelivery")`,
      ]),
      "0|0|0",
    );
    assert.equal(
      exec(api, [
        "node",
        "-e",
        `(async()=>{for(const [path,method] of [['/notifications/appointment-automations','GET'],['/notifications/appointment-policy/activate','POST'],['/notifications/appointment-policy/deactivate','POST'],['/appointments/synthetic/notification-contact','GET'],['/appointments/synthetic/notification-contact','PATCH']]){const r=await fetch('http://127.0.0.1:3000'+path,{method,headers:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:'{}'})});if(![401,403].includes(r.status))throw Error(path+': '+r.status);}if(!require('@prisma/client').Prisma.dmmf.datamodel.models.some(m=>m.name==='AppointmentAutomationRun'))throw Error('Workflow client stale');console.log('PASS')})().catch(e=>{console.error(e.message);process.exit(1)})`,
      ]),
      "PASS",
    );
    checks.push(
      "actual-full-app-wires-workflow-and-customer-commands-with-empty-plans-and-guards-all-new-operations",
    );
  }
  if(eventNoticesCandidate){
    assert.equal(exec(db,["psql","-X","-U","step13","-d","step13_runtime","-Atqc",`SELECT (SELECT count(*) FROM _prisma_migrations WHERE migration_name='20261111200000_appointment_event_notices' AND finished_at IS NOT NULL)||'|'||(SELECT count(*) FROM "AppointmentAutomationDelivery" WHERE "noticeContext" IS NOT NULL)`]),"1|0");
    assert.equal(exec(api,["node","-e",`const m=require('@prisma/client').Prisma.dmmf.datamodel.models.find(m=>m.name==='AppointmentAutomationDelivery');if(!m.fields.some(f=>f.name==='noticeContext')||m.fields.find(f=>f.name==='runId').isRequired)throw Error('Stale event notice client');console.log('PASS')`]),"PASS");
    checks.push("event-notice-migration-and-nullable-run-client-start-without-inferred-deliveries");
  }
  run(admin, [imagePrefix + "admin:" + imageDate]);
  run(booking, [imagePrefix + "booking:" + imageDate]);
  for (const name of [admin, booking]) {
    await ready(() => probe("http://" + name + "/"));
    const assets = exec(api, [
      "node",
      "-e",
      `(async()=>{const root='http://${name}/',r=await fetch(root),html=await r.text(),paths=[...html.matchAll(/src="([^"]+[.]js)"/g)].map(m=>m[1].split('/').pop());if(!paths.length)throw Error('No bundle');for(const p of paths){const s=await fetch(root+p);if(s.status!==200||!(s.headers.get('content-type')||'').includes('javascript'))throw Error('Invalid asset '+p)}console.log(paths.length)})().catch(e=>{console.error(e.message);process.exit(1)})`,
    ]);
    assert(Number(assets) > 0);
  }
  checks.push(
    "both-candidate-Nginx-images-serve-real-HTML-and-JavaScript-assets-on-the-private-network",
  );
  writeFileSync(root + "/api.log", docker(["logs", api]), { mode: 0o600 });
  const result = {
    checkedAt: new Date().toISOString(),
    imagePrefix,
    checks,
    identity: "empty disposable database; no auth session created",
    networkInternal: true,
    hostPortsPublished: false,
    realAccounts: false,
    realProviders: false,
    mainDatabaseModified: false,
    mainRuntimeUpdated: false,
  };
  writeFileSync(root + "/result.json", JSON.stringify(result, null, 2) + "\n", {
    mode: 0o600,
  });
  writeFileSync(
    evidenceRoot + "/runtime-result.json",
    JSON.stringify({ ...result, evidence: root + "/result.json" }, null, 2) +
      "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  for (const name of created)
    try {
      writeFileSync(
        root + "/" + name.slice(prefix.length + 1) + ".log",
        docker(["logs", name]),
        { mode: 0o600 },
      );
    } catch {}
  throw error;
} finally {
  for (const name of created.reverse()) docker(["rm", "-f", name]);
  if (networkCreated) docker(["network", "rm", network]);
  writeFileSync(
    root + "/cleanup.json",
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      allOwnedContainersRemoved: created.every(
        (name) => !docker(["ps", "-aq", "--filter", "name=^/" + name + "$"]),
      ),
      networkRemoved: !docker([
        "network",
        "ls",
        "-q",
        "--filter",
        "name=^" + network + "$",
      ]),
    }) + "\n",
    { mode: 0o600 },
  );
}
