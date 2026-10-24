/* Disposable API + Nginx check. Never loads the project's .env or mutates Connect. */
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== "/barber_security_test") throw new Error("Disposable barber_security_test database required");
if (!process.env.CATALOG_NGINX_IMAGE) throw new Error("Set CATALOG_NGINX_IMAGE to a locally available Nginx image");
const apiPort = Number(process.env.CATALOG_API_PORT || 53023);
const proxyPort = Number(process.env.CATALOG_PROXY_PORT || 53024);
const name = `alora-catalog-test-${process.pid}`;
const directory = mkdtempSync(join(tmpdir(), "alora-catalog-"));
let api;
(async () => {
  try {
    api = spawn(process.execPath, ["dist/apps/api/main.js"], {env:{...process.env,PORT:String(apiPort),ALORA_CONNECT_APP_ID:"alora-catalog-test",REDIS_HOST:"127.0.0.1",REDIS_PORT:"56389",SMTP_HOST:"127.0.0.1",SMTP_PORT:"1"},stdio:["ignore","ignore","ignore"]});
    let ready = false;
    for (let attempt=0; attempt<100; attempt++) {
      if (api.exitCode !== null) throw new Error("Test API terminated before startup");
      try { ready = (await fetch(`http://127.0.0.1:${apiPort}/health`)).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready, "Test API startup timed out");
    const config = readFileSync("docker/nginx.conf","utf8").replaceAll("api:3000",`host.docker.internal:${apiPort}`).replaceAll("web-admin:4200","host.docker.internal:53020").replaceAll("web-public-booking:4201","host.docker.internal:53020");
    writeFileSync(join(directory,"default.conf"),config);
    execFileSync("docker",["run","--rm","-d","--name",name,"-p",`127.0.0.1:${proxyPort}:80`,"-v",`${directory}/default.conf:/etc/nginx/conf.d/default.conf:ro`,process.env.CATALOG_NGINX_IMAGE],{stdio:"pipe"});
    let baseline;
    for (const path of ["/.well-known/eulab-connect.json","/admin/.well-known/eulab-connect.json","/api/.well-known/eulab-connect.json?appId=foreign&tenantId=foreign"]) {
      let response;
      for (let attempt=0;attempt<50;attempt++) {
        try { response = await fetch(`http://127.0.0.1:${proxyPort}${path}`,{redirect:"manual"}); break; } catch {await new Promise(resolve=>setTimeout(resolve,100));}
      }
      assert(response);
      assert.equal(response.status,200,path);
      assert(response.headers.get("content-type").includes("application/json"));
      assert.equal(response.headers.get("cache-control"),"no-cache");
      const matrix = await response.json();
      assert.equal(matrix.appId,"alora-catalog-test");
      if (baseline) assert.deepEqual(matrix,baseline); else baseline=matrix;
    }
    if (process.env.CONNECT_CHECKOUT) {
      execFileSync(process.execPath, ["--import", "tsx", require("node:path").resolve("scripts/check-connect-function-catalog.mjs")], {
        cwd: process.env.CONNECT_CHECKOUT,
        env: {...process.env, CATALOG_TEST_ORIGIN: `http://127.0.0.1:${proxyPort}`},
        stdio: "inherit",
        timeout: 60_000,
      });
    }
    // Optional output lets an external read-only validator consume the actual served JSON.
    if (process.env.CATALOG_OUTPUT) writeFileSync(process.env.CATALOG_OUTPUT,JSON.stringify(baseline,null,2));
    console.log(`PASS: real Nginx GET, root/admin/API aliases, JSON, no redirect, revalidation, stable server appId; ${baseline.functions.length} functions`);
  } finally {
    try {execFileSync("docker",["rm","-f",name],{stdio:"ignore"});} catch {}
    if (api && api.exitCode === null) { api.kill("SIGTERM"); await new Promise(resolve=>api.once("exit",resolve)); }
    rmSync(directory,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
