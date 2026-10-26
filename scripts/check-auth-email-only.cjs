// Disposable browser context; login API is simulated, no practice is submitted.
const { createRequire } = require("node:module"),
  assert = require("node:assert/strict");
const { chromium } = createRequire(
  process.env.PLAYWRIGHT_PACKAGE_JSON || require.resolve("../package.json"),
)("@playwright/test");
const origin = process.env.ALORA_ORIGIN || "http://127.0.0.1:53020";
(async () => {
  const b = await chromium.connectOverCDP(process.env.BROWSER_CDP_ENDPOINT),
    c = await b.newContext(),
    p = await c.newPage();
  const calls = [];
  try {
    await c.route("**/api/auth/login", async (route) => {
      const body = route.request().postDataJSON();
      calls.push(body);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: "migration_required",
          onboarding: {
            version: "2026-10-21-mandatory-v1",
            email: body.email,
            firstName: body.password ? "Synthetic" : "",
            lastName: body.password ? "User" : "",
            challenge: body.password ? "c".repeat(43) : "",
            ...(!body.password ? { needsLegacyVerification: true } : {}),
          },
        }),
      });
    });
    await p.goto(origin + "/admin/#/login");
    await p.locator("[name=loginEmail]").fill("synthetic@example.test");
    assert.equal(await p.locator("form input").count(), 1);
    await p.locator("button[type=submit]").click();
    await p.locator("[name=legacyPassword]").waitFor({ state: "visible" });
    assert.deepEqual(calls[0], { email: "synthetic@example.test" });
    await p.locator("[name=legacyPassword]").fill("Synthetic-only-proof-9!");
    await p.getByRole("button", { name: "Verifica account locale" }).click();
    await p
      .getByRole("button", { name: "Invia richiesta", exact: true })
      .waitFor({ state: "visible" });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].password, "Synthetic-only-proof-9!");
    assert.equal(await p.locator("[name=legacyPassword]").count(), 0);
    console.log(
      "PASS: email-only login; explicit legacy-proof modal; existing consent flow retained. HTTP responses simulated; no practice submitted.",
    );
    // A provider callback is a full navigation, not a hash-only route change.
    await p.goto("about:blank");
    await p.goto(origin + "/admin/#/login?connect_error=access_failed");
    await p
      .getByRole("alert")
      .filter({ hasText: "cambia account" })
      .waitFor({ state: "visible" });
    console.log(
      "PASS: callback error explains account switching without automatic logout.",
    );
  } finally {
    await c.close();
    await b.close();
  }
})().catch((e) => {
  console.error("UI check failed:", e.name);
  process.exitCode = 1;
});
