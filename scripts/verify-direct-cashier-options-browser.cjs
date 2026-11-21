/** Fresh sales route; options beyond the catalog's first page must work without visiting the agenda. */
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const {
  qaViewport,
  qaArtifactPath,
  qaViewportName,
} = require("./qa-viewport.cjs");
const { chromium, expect } = require(
  process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test",
);
(async () => {
  const health = await (await fetch("http://127.0.0.1:53027/health")).json();
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  const source = JSON.parse(
    fs.readFileSync(
      ".local/step10/cashier-fulfilment-http-result.json",
      "utf8",
    ),
  );
  assert.equal(source.database, health.database);
  const f = source.fixture;
  const get = async (url) => {
    const r = await fetch("http://127.0.0.1:53027" + url, {
      headers: { Authorization: "Bearer owner" },
    });
    assert(r.ok);
    return r.json();
  };
  const actor = await get("/collaborators/" + f.actualId),
    service = (await get("/services?page=1&pageSize=200")).items.find(
      (row) => row.id === f.serviceIds[0],
    );
  assert(service);
  const first = await get("/collaborators?page=1&pageSize=200");
  assert(!first.items.some((row) => row.id === actor.id));
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage({
      viewport: qaViewport({ width: 1440, height: 1000 }),
    });
    page.setDefaultTimeout(10000);
    await page.addInitScript(() =>
      localStorage.setItem("barber.session", "owner"),
    );
    await page.goto("http://127.0.0.1:53028/admin/#/sales");
    await page
      .getByRole("button", { name: "Nuova vendita", exact: true })
      .first()
      .click();
    const cashier = page.locator(".quick-order-overlay");
    await cashier.waitFor();
    await cashier
      .locator(".service-card")
      .filter({ hasText: service.name })
      .click();
    await cashier
      .getByRole("combobox", {
        name: "Professionista per " + service.name,
        exact: true,
      })
      .click();
    const actorLabel = (actor.firstName + " " + actor.lastName).trim();
    await page
      .getByRole("textbox", { name: "Filtra opzioni", exact: true })
      .fill(actorLabel);
    await expect(
      page
        .getByRole("listbox")
        .getByRole("option")
        .filter({ hasText: actorLabel }),
    ).toBeVisible();
    await page
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: actorLabel })
      .click();
    await expect(
      cashier.getByRole("combobox", {
        name: "Professionista per " + service.name,
        exact: true,
      }),
    ).toContainText(actorLabel);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      ),
      false,
    );
    await page.screenshot({
      path: qaArtifactPath(".local/step10/direct-cashier-options.png"),
    });
    await cashier.getByRole("button", { name: "Chiudi", exact: true }).click();
    const result = {
      checkedAt: new Date().toISOString(),
      database: health.database,
      viewportScenario: qaViewportName,
      checks: [
        "fresh-sales-route-selects-authorized-performer-beyond-first-catalog-page-without-an-agenda-visit-or-horizontal-overflow",
      ],
      realAccounts: false,
      realProviders: false,
    };
    fs.writeFileSync(
      qaArtifactPath(".local/step10/direct-cashier-options-result.json"),
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    if (page)
      await page.screenshot({
        path: ".local/step13/direct-cashier-options-failure.png",
      });
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
