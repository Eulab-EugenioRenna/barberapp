// Isolated browser context only; no login, account or permission changes.
// Requires PLAYWRIGHT_PACKAGE_JSON and BROWSER_CDP_ENDPOINT (local disposable Chromium).
const { createRequire } = require("node:module"),
  assert = require("node:assert/strict");
const { chromium } = createRequire(
  process.env.PLAYWRIGHT_PACKAGE_JSON || require.resolve("../package.json"),
)("@playwright/test");
const origin = process.env.ALORA_ORIGIN || "http://127.0.0.1:53020";
(async () => {
  const browser = await chromium.connectOverCDP(
      process.env.BROWSER_CDP_ENDPOINT,
    ),
    context = await browser.newContext({ serviceWorkers: "allow" }),
    page = await context.newPage();
  let stage = "open-online";
  try {
    await context.route("**/admin/qa-legacy.html", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Legacy worker fixture</title>",
      }),
    );
    await page.goto(origin + "/admin/qa-legacy.html");
    const legacy = `self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open('alora-legacy-qa');await c.put('/admin/qa-cache-probe',new Response('QA_CACHED_VALUE'));self.skipWaiting();})()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(new URL(e.request.url).pathname==='/admin/qa-cache-probe')e.respondWith(caches.match(e.request));});`;
    await context.route("**/admin/service-worker.js", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: legacy,
        headers: { "Cache-Control": "no-store" },
      }),
    );
    stage = "install-legacy-worker";
    await page.evaluate(async () => {
      localStorage.setItem("qa-session-preservation", "preserved");
      await navigator.serviceWorker.register(
        "/admin/service-worker.js",
        { scope: "/admin/", updateViaCache: "none" },
      );
    });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForFunction(
      async () =>
        (await (await fetch("/admin/qa-cache-probe")).text()) ===
        "QA_CACHED_VALUE",
      undefined,
      { timeout: 15000 },
    );
    const stale = await page.evaluate(
      async () => await (await fetch("/admin/qa-cache-probe")).text(),
    );
    assert.equal(stale, "QA_CACHED_VALUE");
    console.log("PASS: legacy caching worker reproduced");
    await context.unroute("**/admin/service-worker.js");
    stage = "retire-legacy";
    await page.goto(origin + "/admin/#/login");
    await page
      .getByRole("heading", { name: "Bentornato nel tuo salone" })
      .waitFor();
    await page.waitForFunction(
      async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        if (registrations.length !== 1 || (await caches.keys()).length)
          return false;
        return new Promise((resolve) => {
          const channel = new MessageChannel();
          const timer = setTimeout(() => resolve(false), 500);
          channel.port1.onmessage = (e) => {
            clearTimeout(timer);
            resolve(e.data.remoteOnly === true);
          };
          navigator.serviceWorker.controller?.postMessage(
            { type: "CLEAR_CACHES" },
            [channel.port2],
          );
        });
      },
      undefined,
      { timeout: 15000 },
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("qa-session-preservation"),
      ),
      "preserved",
    );
    const probe = await page.evaluate(async () => {
      const r = await fetch("/api/auth/me");
      return { status: r.status, worker: !!navigator.serviceWorker.controller };
    });
    assert.equal(probe.status, 401);
    console.log(
      "PASS: push worker retained, zero caches; local storage preserved; API reached",
    );
    stage = "offline";
    await context.setOffline(true);
    assert.equal(
      await page.evaluate(async () => {
        try {
          await fetch("/api/auth/me");
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );
    let navigationFailed = false;
    try {
      await page.goto(origin + "/admin/?remote-qa=1#/login", { timeout: 5000 });
    } catch {
      navigationFailed = true;
    }
    assert.equal(navigationFailed, true);
    console.log(
      "PASS: offline API and navigation fail without cached fallback",
    );
    await context.setOffline(false);
    await page.goto(origin + "/admin/#/login");
    await page
      .getByRole("heading", { name: "Bentornato nel tuo salone" })
      .waitFor();
  } catch (e) {
    console.log("FAILED stage:", stage);
    console.log(e.message.split("\n")[0]);
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(() => {
  console.error("PWA browser harness unavailable");
  process.exitCode = 1;
});
