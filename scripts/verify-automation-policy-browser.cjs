/** Actual policy UI/API/PG. Unrelated WhatsApp reads are empty synthetic responses. */
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium, expect } = require(
  process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test",
);
(async () => {
  const health = await (await fetch("http://127.0.0.1:53027/health")).json();
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  const source = JSON.parse(
    fs.readFileSync(".local/step12/policy-http-result.json", "utf8"),
  );
  assert.equal(source.database, health.database);
  fs.mkdirSync(".local/step12/policy-screenshots", {
    recursive: true,
    mode: 0o700,
  });
  const browser = await chromium.launch({ headless: true }),
    checks = [],
    errors = [],
    mutations = [],
    screenshots = [];
  let page;
  const section = (p) => p.locator("app-appointment-automation-policy");
  const lead = (p) =>
    section(p).getByLabel("Anticipo del primo promemoria (minuti)", {
      exact: true,
    });
  async function open(actor = "owner") {
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    });
    p.setDefaultTimeout(15000);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (r.url().includes("/api/") && !["GET", "OPTIONS"].includes(r.method()))
        mutations.push(r.url());
    });
    await p.addInitScript((token) => {
      localStorage.setItem("barber.session", token);
      localStorage.removeItem("barber.refresh");
    }, actor);
    await p.route("**/api/whatsapp/**", (route) => {
      assert.equal(route.request().method(), "GET");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    });
    await p.goto("http://127.0.0.1:53028/admin/#/whatsapp");
    await p.getByRole("heading", { name: "WhatsApp", exact: true }).waitFor();
    return p;
  }
  async function load(p) {
    await section(p)
      .getByRole("button", { name: "Configura promemoria", exact: true })
      .click();
    await expect(lead(p)).toBeVisible();
  }
  try {
    page = await open();
    await load(page);
    const peer = await open();
    await load(peer);
    await lead(page).fill("1200");
    await section(page)
      .getByRole("button", { name: "Salva bozza della policy", exact: true })
      .click();
    await expect(section(page).getByRole("status")).toHaveText(
      "Bozza salvata. Gli invii restano non attivi.",
    );
    await page.reload();
    await load(page);
    await expect(lead(page)).toHaveValue("1200");
    assert.equal(
      await section(page)
        .getByRole("button", { name: /attiva/i })
        .count(),
      0,
    );
    checks.push(
      "real-policy-ui-saves-and-restores-draft-across-reload-without-activation-or-outbound-message",
    );
    await lead(peer).fill("2880");
    await section(peer)
      .getByRole("button", { name: "Salva bozza della policy", exact: true })
      .click();
    await expect(section(peer).getByRole("status")).toContainText(
      "La policy è cambiata",
    );
    await expect(lead(peer)).toHaveValue("2880");
    await section(peer)
      .getByRole("button", { name: "Ricarica policy salvata", exact: true })
      .click();
    await expect(lead(peer)).toHaveValue("1200");
    await peer.close();
    checks.push(
      "second-browser-conflict-retains-draft-and-only-explicit-reload-replaces-it-with-current-version",
    );
    await section(page)
      .getByLabel("Settore dell’esempio", { exact: true })
      .selectOption(source.fixture.sectorId);
    await section(page)
      .getByLabel("Data e ora dell’appuntamento di esempio", { exact: true })
      .fill(source.fixture.localStartsAt);
    await section(page)
      .getByRole("button", {
        name: "Calcola gli orari di esempio",
        exact: true,
      })
      .click();
    await expect(
      section(page).getByLabel("Piano di esempio", { exact: true }),
    ).toContainText("Promemoria 1");
    await expect(
      section(page).getByLabel("Piano di esempio", { exact: true }),
    ).toContainText("anticipato alla precedente apertura");
    for (const [name, viewport] of Object.entries({
      desktop: { width: 1440, height: 1050 },
      landscape: { width: 1180, height: 820 },
      portrait: { width: 820, height: 1180 },
      phone: { width: 390, height: 844 },
    })) {
      await page.setViewportSize(viewport);
      await section(page)
        .getByRole("button", {
          name: "Calcola gli orari di esempio",
          exact: true,
        })
        .scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.equal(
        await section(page).evaluate((el) => el.scrollWidth > el.clientWidth),
        false,
      );
      const path = `.local/step12/policy-screenshots/${name}.png`;
      await page.screenshot({ path });
      screenshots.push(path);
    }
    await section(page)
      .getByLabel("Richiedi risposta al cliente", { exact: true })
      .uncheck();
    await expect(
      section(page).getByLabel("Piano di esempio", { exact: true }),
    ).toHaveCount(0);
    await expect(
      section(page).getByLabel(
        "Scadenza risposta prima dell’appuntamento (minuti)",
        { exact: true },
      ),
    ).toBeDisabled();
    await section(page)
      .getByRole("button", {
        name: "Calcola gli orari di esempio",
        exact: true,
      })
      .click();
    await expect(
      section(page).getByLabel("Piano di esempio", { exact: true }),
    ).toContainText("Promemoria 1");
    assert(
      !(
        await section(page).getByLabel("Piano di esempio").innerText()
      ).includes("Risposte entro"),
    );
    checks.push(
      "live-calendar-preview-is-usable-in-four-viewports-and-editing-invalidates-it-with-response-controls-matching-the-policy",
    );
    const denied = await open("notifications_denied");
    assert.equal(await section(denied).count(), 0);
    await denied.close();
    const manager = await open("manager");
    await section(manager)
      .getByRole("button", { name: "Configura promemoria", exact: true })
      .click();
    await expect(section(manager).getByRole("status")).toContainText(
      "accesso a tutti i settori",
    );
    assert.equal(await lead(manager).count(), 0);
    await manager.close();
    assert(
      mutations.every((url) =>
        url.includes("/notifications/appointment-policy"),
      ),
      JSON.stringify(mutations),
    );
    assert.deepEqual(errors, []);
    checks.push(
      "current-function-and-whole-activity-membership-restrict-policy-UI-and-no-provider-account-or-booking-mutations-occur",
    );
    const result = {
      checkedAt: new Date().toISOString(),
      database: health.database,
      policyApis: "actual",
      whatsappReads: "synthetic-empty",
      realAccounts: false,
      realProviderMessages: false,
      checks,
      screenshots,
    };
    fs.writeFileSync(
      ".local/step12/policy-browser-result.json",
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(JSON.stringify(result));
  } catch (e) {
    if (page) {
      await page.screenshot({
        path: ".local/step12/policy-screenshots/failure.png",
        fullPage: true,
      });
      fs.writeFileSync(
        ".local/step12/policy-screenshots/failure.txt",
        await page.locator("body").innerText(),
        { mode: 0o600 },
      );
    }
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
