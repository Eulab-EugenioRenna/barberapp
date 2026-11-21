/** Real Angular and the disposable report/stock ledger; no account or provider changes. */
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium, expect } = require(
  process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test",
);
(async () => {
  const health = await (await fetch("http://127.0.0.1:53027/health")).json();
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  const source = JSON.parse(
    fs.readFileSync(".local/step13/valuation-http-result.json", "utf8"),
  );
  assert.equal(source.database, health.database);
  const f = source.fixture;
  const browser = await chromium.launch({ headless: true });
  const checks = [],
    screenshots = [],
    errors = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
      timezoneId: "Europe/Rome",
    });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(({ locationId }) => {
      if (!localStorage.getItem("barber.session"))
        localStorage.setItem("barber.session", "owner");
      if (!localStorage.getItem("alora.scope:__http_owner"))
        localStorage.setItem(
          "alora.scope:__http_owner",
          JSON.stringify({ locationId, sectorId: "" }),
        );
      localStorage.removeItem("barber.balance-hidden");
    }, f);
    const requests = [];
    page.on("request", (r) => {
      if (/\/dashboard\/(collaborators|services)(?:\?|$)/.test(r.url()))
        requests.push(r.url());
    });
    await page.goto("http://127.0.0.1:53028/admin/#/dashboard");
    const tax = page.getByTestId("sales-tax-report"),
      materials = page.getByTestId("materials-report"),
      inventory = page.getByTestId("inventory-value-report");
    await expect(tax).toContainText("EUR 59.97");
    await expect(tax).toContainText("EUR 13.20");
    await expect(tax).toContainText("EUR 11.00");
    await expect(materials).toContainText("EUR 9.000000");
    await expect(materials).toContainText("Non disponibile");
    await expect(materials).toContainText("3 righe");
    await expect(inventory).toContainText("EUR 75.000000");
    await expect(inventory).toContainText("EUR 2.80");
    await expect(inventory).toContainText("EUR 104.000000");
    await expect(inventory).toContainText("Non disponibile");
    assert.deepEqual(requests, []);
    checks.push(
      "actual-page-separates-known-sales-VAT-unknown-history-and-documented-material-cost-without-invented-margin-or-redundant-statistical-requests",
    );
    for (const [name, width, height] of [
      ["desktop", 1440, 1050],
      ["tablet-landscape", 1180, 820],
      ["tablet-portrait", 820, 1180],
      ["mobile", 390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await tax.scrollIntoViewIfNeeded();
      await expect(
        tax.getByRole("heading", {
          name: "Imponibile e IVA registrata",
          exact: true,
        }),
      ).toBeVisible();
      const overflowing = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            "body,main.content-scroll,alora-financial-values-panel",
          ),
        )
          .filter((el) => el.scrollWidth > el.clientWidth + 2)
          .map((el) => el.tagName),
      );
      assert.deepEqual(overflowing, [], name);
      const file = "valuation-" + name + ".png";
      await page.screenshot({ path: ".local/step13/screenshots/" + file });
      screenshots.push(file);
      await inventory.scrollIntoViewIfNeeded();
      await expect(
        inventory.getByRole("heading", {
          name: "Magazzino e acquisti registrati",
          exact: true,
        }),
      ).toBeVisible();
    }
    checks.push(
      "sales-VAT-materials-and-warehouse-sections-remain-reachable-on-four-viewports-without-horizontal-overflow",
    );
    await page
      .getByRole("button", { name: "Nascondi saldo", exact: true })
      .click();
    for (const locator of [tax, materials, inventory]) {
      const content = await locator.innerText();
      assert(
        !content.includes("59.97") &&
          !content.includes("9.000000") &&
          !content.includes("104.000000"),
      );
      assert(content.includes("**,**"));
    }
    checks.push(
      "privacy-toggle-masks-every-known-VAT-cost-and-current-stock-amount",
    );
    await page.evaluate(
      ({ destinationId }) =>
        localStorage.setItem(
          "alora.scope:__http_owner",
          JSON.stringify({ locationId: destinationId, sectorId: "" }),
        ),
      f,
    );
    await page.reload();
    await expect(materials).toContainText("EUR 1.500000");
    await expect(materials).toContainText("EUR 18.800000");
    await expect(materials).toContainText(
      "Esclude lavoro, affitto e altre spese.",
    );
    await expect(tax).toContainText("IVA 0.00%");
    await page.evaluate(() =>
      localStorage.setItem("barber.session", "cashier"),
    );
    await page.reload();
    await expect(tax).toBeVisible();
    await expect(materials).toHaveCount(0);
    await expect(inventory).toHaveCount(0);
    checks.push(
      "known-zero-rate-and-complete-tracked-material-margin-are-visible-to-authorized-user-and-cost-sections-are-absent-without-inventory-grant",
    );
    assert.deepEqual(errors, []);
    const result = {
      checkedAt: new Date().toISOString(),
      database: health.database,
      checks,
      screenshots,
      realAccounts: false,
      realProviders: false,
    };
    fs.writeFileSync(
      ".local/step13/valuation-browser-result.json",
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
