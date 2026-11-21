/* Isolated context; edits only the generated resource fixture. */
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
const { chromium } = createRequire(
  process.env.ALORA_PLAYWRIGHT_PACKAGE_JSON || resolve("package.json"),
)(process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test");
(async () => {
  const base = "http://127.0.0.1:53027",
    health = await (await fetch(base + "/health")).json();
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  const name = "Browser capacità " + Date.now();
  const response = await fetch(base + "/locations", {
    method: "POST",
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, sectorName: "Resource browser fixture" }),
  });
  assert.equal(response.status, 201);
  const site = await response.json();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() =>
      localStorage.setItem("barber.session", "owner"),
    );
    await page.goto("http://127.0.0.1:53028/admin/#/locations");
    const card = page
      .locator(".location-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await card
      .getByLabel("Nome della risorsa", { exact: true })
      .fill("Risorsa condivisa");
    await card.getByLabel("Capienza", { exact: true }).fill("2");
    await card
      .getByRole("button", { name: "Aggiungi", exact: true })
      .first()
      .click();
    const row = card
      .locator(".resource")
      .filter({ hasText: "Risorsa condivisa" });
    await row
      .getByText("Risorsa condivisa · capienza 2 · interno", { exact: true })
      .waitFor();
    await row
      .getByLabel("Capienza di Risorsa condivisa", { exact: true })
      .fill("3");
    await row
      .getByRole("button", { name: "Salva capienza", exact: true })
      .click();
    await row
      .getByText("Risorsa condivisa · capienza 3 · interno", { exact: true })
      .waitFor();
    const result = await (
      await fetch(base + "/locations", {
        headers: { Authorization: "Bearer owner" },
      })
    ).json();
    const stored = result
      .find((loc) => loc.id === site.id)
      .sectors[0].rooms.find((room) => room.name === "Risorsa condivisa");
    assert.equal(stored.capacity, 3);
    await card.screenshot({ path: ".local/step10/resources-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await row.scrollIntoViewIfNeeded();
    await card.screenshot({ path: ".local/step10/resources-mobile.png" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      ".local/step10/resources-browser-result.json",
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          identity: "isolated-synthetic-browser",
          providerCalls: false,
          checks: [
            "capacity-input-creates-actual-two-place-resource",
            "capacity-change-persists-through-existing-location-form",
            "desktop-and-mobile-resource-configuration-no-horizontal-overflow",
          ],
          screenshots: ["resources-desktop.png", "resources-mobile.png"],
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    console.log("PASS: resource capacity browser");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
