/** Read-only calendar navigation on disposable synthetic accounts; no provider or login flow. */
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium, expect } = require(
  process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test",
);
(async () => {
  const health = await (await fetch("http://127.0.0.1:53027/health")).json();
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  const browser = await chromium.launch({ headless: true });
  const checks = [],
    layouts = [];
  fs.mkdirSync(".local/step13/screenshots", { recursive: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    });
    page.setDefaultTimeout(15000);
    await page.addInitScript(() =>
      localStorage.setItem("barber.session", "owner"),
    );
    await page.goto("http://127.0.0.1:53028/admin/#/appointments");
    for (const [name, width, height] of [
      ["desktop", 1440, 1050],
      ["tablet-landscape", 1180, 820],
      ["tablet-portrait", 820, 1180],
      ["mobile", 390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page
        .getByRole("button", { name: "Settimana", exact: true })
        .click();
      const calendar = page.locator("barber-admin-appointments-calendar");
      const legend = calendar.getByRole("region", {
        name: "Professionisti nel calendario settimanale",
        exact: true,
      });
      await expect(legend).toBeVisible();
      const dimensions = await legend.evaluate((el) => ({
        height: el.clientHeight,
        total: el.scrollHeight,
      }));
      assert(
        dimensions.height <= Math.min(120, height * 0.2) + 2,
        name + " bounded legend",
      );
      assert(
        dimensions.total > dimensions.height,
        name + " exercises a genuinely overflowing multi-professional legend",
      );
      await legend.focus();
      await page.keyboard.press("End");
      await expect
        .poll(() => legend.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      const first = calendar.locator(".calendar-week-day-card").first(),
        date = await first.getAttribute("data-date");
      await first.locator("header").click();
      await expect(
        calendar.locator(".calendar-week-day-card.calendar-is-selected"),
      ).toHaveAttribute("data-date", date);
      const layout = await calendar
        .locator(".calendar-week-grid")
        .evaluate((el) => ({
          columns: getComputedStyle(el).gridTemplateColumns.split(" ").length,
          width: el.clientWidth,
          height: el.clientHeight,
        }));
      assert(layout.height > 100, name + " usable calendar area");
      assert.equal(
        layout.columns,
        name === "desktop" ? 7 : name === "mobile" ? 1 : 3,
        name + " calendar columns reflect available width",
      );
      layouts.push({
        name,
        viewportWidth: width,
        viewportHeight: height,
        ...layout,
      });
      await page.screenshot({
        path: ".local/step13/screenshots/calendar-" + name + ".png",
      });
      await page.getByRole("button", { name: "Mese", exact: true }).click();
      const monthLegend = calendar.getByRole("region", {
        name: "Professionisti nel calendario mensile",
        exact: true,
      });
      await expect(monthLegend).toBeVisible();
      assert(
        (await monthLegend.boundingBox()).height <=
          Math.min(120, height * 0.2) + 2,
      );
      await calendar.locator(".calendar-month-cell header").nth(10).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      );
      assert.equal(overflow, false, name + " document horizontal overflow");
    }
    checks.push(
      "week-and-month-legends-remain-bounded-keyboard-scrollable-with-many-professionals-on-four-viewport-sizes",
    );
    checks.push(
      "real-week-day-header-and-month-cell-clicks-remain-reachable-with-calendar-area-over-100-pixels-and-no-document-horizontal-overflow",
    );
    const result = {
      checkedAt: new Date().toISOString(),
      database: health.database,
      checks,
      layouts,
      fullTabletOperationalAcceptance: false,
      realAccounts: false,
      realProviders: false,
    };
    fs.writeFileSync(
      ".local/step13/calendar-viewport-result.json",
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
