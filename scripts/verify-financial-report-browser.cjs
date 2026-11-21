/** Actual Angular page -> disposable API/PostgreSQL; no account or provider operations. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium, expect } = require(
  process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test",
);
(async () => {
  const health = await (await fetch("http://127.0.0.1:53027/health")).json();
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  const source = JSON.parse(
    fs.readFileSync(".local/step13/financial-http-result.json", "utf8"),
  );
  assert.equal(source.database, health.database);
  const fixture = source.fixture;
  assert(fixture);
  fs.mkdirSync(".local/step13/screenshots", { recursive: true, mode: 0o700 });
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  const screenshots = [];
  const errors = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(15000);
    await page.addInitScript(({ locationId }) => {
      localStorage.setItem("barber.session", "owner");
      localStorage.setItem(
        "alora.scope:__http_owner",
        JSON.stringify({ locationId, sectorId: "" }),
      );
      localStorage.removeItem("barber.balance-hidden");
    }, fixture);
    await page.goto("http://127.0.0.1:53028/admin/#/dashboard");
    const dashboard = page.locator("barber-admin-dashboard-page");
    await expect(
      dashboard.getByRole("heading", {
        name: "Venduto e incassi",
        exact: true,
      }),
    ).toBeVisible();
    const choosePeriod = async (label) => {
      await dashboard
        .getByRole("combobox", { name: "Periodo", exact: true })
        .click();
      await page
        .getByRole("listbox")
        .getByRole("option", { name: label, exact: true })
        .click();
    };
    await choosePeriod("Tutto");
    const metric = (label) =>
      dashboard
        .locator(".metric-card")
        .filter({ has: page.getByText(label, { exact: true }) });
    await expect(metric("Venduto nel periodo")).toContainText("EUR 500.00");
    await expect(metric("Incassi nel periodo")).toContainText("EUR 50.00");
    await expect(metric("Rimborsi nel periodo")).toContainText("EUR 5.00");
    await expect(dashboard.getByTestId("account-reconciliation")).toContainText(
      "€315.00",
    );
    await expect(dashboard.getByTestId("account-reconciliation")).toContainText(
      "1 conti storici",
    );
    checks.push(
      "actual-angular-page-separates-sold-cash-refunds-and-current-cohort-balance-with-unknown-history",
    );
    const professional = dashboard.getByRole("combobox", {
      name: "Professionista",
      exact: true,
    });
    await professional.click();
    assert.equal(
      await page.getByRole("listbox").getByRole("option").count(),
      fixture.optionIds.length + 1,
    );
    await page
      .getByRole("textbox", { name: "Filtra opzioni", exact: true })
      .fill("Report " + (fixture.optionIds.length - 1));
    await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("listbox").getByRole("option")).toContainText(
      "non attivo",
    );
    await page.getByRole("listbox").getByRole("option").click();
    await expect(metric("Incassi nel periodo")).toContainText("Non attribuiti");
    await expect(
      dashboard.getByText("Il venduto comprende le righe selezionate.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(dashboard.getByTestId("account-reconciliation")).toContainText(
      "I pagamenti non sono ripartiti per riga.",
    );
    checks.push(
      "professional-dropdown-searches-all-profiles-beyond-catalog-first-page-including-history-and-line-view-explains-unattributed-payments",
    );
    await professional.click();
    await page
      .getByRole("listbox")
      .getByRole("option", { name: "Tutta la squadra", exact: true })
      .click();
    await expect(metric("Venduto nel periodo")).toContainText("EUR 500.00");
    let releaseOld,
      held = false;
    const gate = new Promise((resolve) => (releaseOld = resolve));
    await page.route("**/dashboard/revenue?**", async (route) => {
      if (
        !held &&
        new URL(route.request().url()).searchParams.get("period") === "month"
      ) {
        held = true;
        const response = await route.fetch();
        await gate;
        await route.fulfill({ response });
      } else await route.continue();
    });
    await choosePeriod("Mese");
    await expect.poll(() => held).toBeTruthy();
    await choosePeriod("Tutto");
    await expect(metric("Venduto nel periodo")).toContainText("EUR 500.00");
    const oldResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/dashboard/revenue") &&
        new URL(response.url()).searchParams.get("period") === "month",
    );
    releaseOld();
    await (await oldResponse).finished();
    await page.unrouteAll({ behavior: "wait" });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect(metric("Venduto nel periodo")).toContainText("EUR 500.00");
    checks.push(
      "late-month-response-cannot-overwrite-newer-all-period-financial-report",
    );
    for (const [name, width, height] of [
      ["desktop", 1440, 1000],
      ["tablet-landscape", 1180, 820],
      ["tablet-portrait", 820, 1180],
      ["mobile", 390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await expect(
        dashboard.getByRole("heading", {
          name: "Venduto e incassi",
          exact: true,
        }),
      ).toBeVisible();
      const overflowing = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            "body,main.content-scroll,barber-admin-dashboard-page",
          ),
        )
          .map((el) => ({
            tag: el.tagName,
            client: el.clientWidth,
            scroll: el.scrollWidth,
          }))
          .filter((x) => x.scroll > x.client + 2),
      );
      assert.deepEqual(
        overflowing,
        [],
        name + ": " + JSON.stringify(overflowing),
      );
      await professional.click();
      await page
        .getByRole("textbox", { name: "Filtra opzioni", exact: true })
        .fill("Report " + (fixture.optionIds.length - 2));
      await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(
        1,
      );
      const bounds = await page.getByRole("listbox").boundingBox();
      assert(
        bounds.x >= 0 && bounds.x + bounds.width <= width + 2,
        name + " select bounds",
      );
      await page.keyboard.press("Escape");
      const shot = "financial-" + name + ".png";
      await page.screenshot({
        path: ".local/step13/screenshots/" + shot,
        fullPage: true,
      });
      screenshots.push(shot);
    }
    checks.push(
      "desktop-landscape-tablet-portrait-tablet-and-phone-have-readable-financial-sections-and-usable-full-select-without-horizontal-overflow",
    );
    await dashboard
      .getByRole("button", { name: "Nascondi saldo", exact: true })
      .click();
    await expect(metric("Venduto nel periodo")).toContainText("**,**");
    assert(
      !(
        await dashboard.getByTestId("account-reconciliation").innerText()
      ).includes("315.00"),
    );
    await expect(
      dashboard.getByRole("button", { name: "Mostra saldo", exact: true }),
    ).toBeVisible();
    checks.push(
      "privacy-toggle-masks-financial-metrics-and-account-reconciliation-on-mobile",
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
      ".local/step13/financial-browser-result.json",
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
