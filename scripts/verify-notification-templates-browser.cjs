/** Actual Angular template editor and API/PG. Only unrelated WhatsApp reads are synthetic. */
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium, expect } = require(
  process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test",
);
(async () => {
  const health = await (await fetch("http://127.0.0.1:53027/health")).json();
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  const source = JSON.parse(
    fs.readFileSync(".local/step12/templates-http-result.json", "utf8"),
  );
  assert.equal(source.database, health.database);
  const browser = await chromium.launch({ headless: true }),
    checks = [],
    errors = [],
    screenshots = [];
  fs.mkdirSync(".local/step12/templates-screenshots", {
    recursive: true,
    mode: 0o700,
  });
  const requests = [];
  let page;
  async function open(actor = "owner") {
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    });
    p.setDefaultTimeout(15000);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (r.url().includes("/notifications/"))
        requests.push({ method: r.method(), url: r.url() });
    });
    await p.addInitScript((token) => {
      localStorage.setItem("barber.session", token);
      localStorage.removeItem("barber.refresh");
    }, actor);
    await p.route("**/api/whatsapp/**", (route) => {
      assert.equal(
        route.request().method(),
        "GET",
        "No WhatsApp effects authorized by this verifier",
      );
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
  const editor = (p) => p.locator("app-notification-template-editor");
  async function load(p) {
    await editor(p)
      .getByRole("button", { name: "Apri template", exact: true })
      .click();
    await editor(p)
      .getByLabel("Evento e canale")
      .selectOption(source.fixture.templateId);
  }
  try {
    page = await open();
    await load(page);
    const peer = await open();
    await load(peer);
    const body = "Ciao {{customer.firstName}}! <img src=x onerror=alert(1)>";
    await editor(page).getByLabel("Testo del template").fill(body);
    await expect(
      editor(page).getByRole("button", { name: "Salva template", exact: true }),
    ).toBeDisabled();
    await editor(page)
      .getByRole("button", {
        name: "Anteprima con dati di esempio",
        exact: true,
      })
      .click();
    await expect(editor(page).locator(".rendered")).toHaveText(
      "Ciao Giulia! <img src=x onerror=alert(1)>",
    );
    assert.equal(await editor(page).locator(".preview img").count(), 0);
    await editor(page)
      .getByRole("button", { name: "Salva template", exact: true })
      .click();
    await expect(editor(page).getByRole("status")).toContainText(
      "Template salvato per i nuovi eventi",
    );
    checks.push(
      "real-ui-preview-then-versioned-save-renders-literal-text-without-html-execution-or-message-send",
    );
    await editor(peer)
      .getByLabel("Testo del template")
      .fill("Bozza concorrente {{customer.firstName}}");
    await editor(peer)
      .getByRole("button", {
        name: "Anteprima con dati di esempio",
        exact: true,
      })
      .click();
    await expect(editor(peer).locator(".rendered")).toHaveText(
      "Bozza concorrente Giulia",
    );
    await editor(peer)
      .getByRole("button", { name: "Salva template", exact: true })
      .click();
    await expect(editor(peer).getByRole("status")).toContainText(
      "Il template è cambiato",
    );
    await expect(editor(peer).getByLabel("Testo del template")).toHaveValue(
      "Bozza concorrente {{customer.firstName}}",
    );
    await editor(peer)
      .getByRole("button", { name: "Ricarica template salvati", exact: true })
      .click();
    await expect(editor(peer).getByLabel("Testo del template")).toHaveValue(
      body,
    );
    await peer.close();
    checks.push(
      "concurrent-browser-save-conflict-retains-draft-until-explicit-reload-of-current-text",
    );
    for (const [name, viewport] of Object.entries({
      desktop: { width: 1440, height: 1050 },
      landscape: { width: 1180, height: 820 },
      portrait: { width: 820, height: 1180 },
      phone: { width: 390, height: 844 },
    })) {
      await page.setViewportSize(viewport);
      await editor(page).scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      const overflow = await editor(page).evaluate(
        (el) => el.scrollWidth > el.clientWidth,
      );
      assert.equal(overflow, false, name);
      const target = `.local/step12/templates-screenshots/${name}.png`;
      await page.screenshot({ path: target });
      screenshots.push(target);
    }
    await editor(page)
      .getByLabel("Testo del template")
      .fill("{{customer.email}}");
    await expect(
      editor(page).getByRole("button", { name: "Salva template", exact: true }),
    ).toBeDisabled();
    await editor(page)
      .getByRole("button", {
        name: "Anteprima con dati di esempio",
        exact: true,
      })
      .click();
    await expect(editor(page).getByRole("status")).toContainText(
      "Segnaposto non ammesso",
    );
    checks.push(
      "four-viewport-layouts-and-editing-invalidate-preview-with-visible-server-validation",
    );
    const denied = await open("notifications_denied");
    assert.equal(await editor(denied).count(), 0);
    await denied.close();
    const manager = await open("manager");
    await editor(manager)
      .getByRole("button", { name: "Apri template", exact: true })
      .click();
    await expect(editor(manager).getByRole("status")).toContainText(
      "accesso a tutti i settori",
    );
    assert.equal(
      await editor(manager).getByLabel("Testo del template").count(),
      0,
    );
    await manager.close();
    assert.deepEqual(errors, []);
    assert(
      requests.every((r) => r.method === "GET" || /\/templates\//.test(r.url)),
      "No provider or dispatch mutations",
    );
    checks.push(
      "function-denied-editor-is-hidden-and-partial-membership-cannot-load-shared-template-text",
    );
    const result = {
      checkedAt: new Date().toISOString(),
      database: health.database,
      templateApis: "actual",
      whatsappReads: "synthetic-empty",
      realAccounts: false,
      realProviderMessages: false,
      checks,
      screenshots,
    };
    fs.writeFileSync(
      ".local/step12/templates-browser-result.json",
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(JSON.stringify(result));
  } catch (error) {
    if (page) {
      await page.screenshot({
        path: ".local/step12/templates-screenshots/failure.png",
        fullPage: true,
      });
      fs.writeFileSync(
        ".local/step12/templates-screenshots/failure.txt",
        await page.locator("body").innerText(),
        { mode: 0o600 },
      );
    }
    throw error;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
