/** Real Angular/API/SDK/PostgreSQL; Connect and OIDC are synthetic loopback services. */
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium, expect } = require(
  process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test",
);
const base = "http://127.0.0.1:53029",
  origin = "http://127.0.0.1:53030";
(async () => {
  const health = await (await fetch(base + "/health")).json();
  assert(health.testOnly && /^step11_qa_\d+$/.test(health.database));
  const control = async (body) => {
    const r = await fetch(base + "/_qa", {
      method: body ? "POST" : "GET",
      headers: {
        "X-Alora-QA": "step11-synthetic",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert(r.ok);
    return r.json();
  };
  await control({ connectionState: "connected" });
  const state = await control(),
    browser = await chromium.launch({ headless: true }),
    checks = [],
    errors = [],
    requests = [];
  const directory = ".local/step12/sdk-012/access-screenshots";
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  let page;
  const section = (p) => p.locator("app-appointment-automation-access");
  async function open(
    actor = "owner",
    viewport = { width: 1440, height: 1050 },
  ) {
    const p = await browser.newPage({ viewport });
    p.setDefaultTimeout(15000);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (r.url().includes("/notifications/automation-"))
        requests.push({ method: r.method(), url: r.url() });
    });
    await p.addInitScript((token) => {
      localStorage.setItem("barber.session", token);
      localStorage.removeItem("barber.refresh");
    }, state.actors[actor].session.accessToken);
    await p.goto(origin + "/admin/#/whatsapp");
    await p.getByRole("heading", { name: "WhatsApp", exact: true }).waitFor();
    return p;
  }
  const refresh = (p) =>
    section(p)
      .getByRole("button", { name: /^(Gestisci|Aggiorna) autorizzazioni$/ })
      .click();
  try {
    page = await open();
    await expect(section(page)).toBeVisible();
    assert.equal(requests.length, 0);
    await refresh(page);
    await expect(
      section(page).getByLabel("Canale da autorizzare"),
    ).toBeVisible();
    const commands = [];
    let lost = true;
    await page.route(
      "**/api/notifications/automation-grants",
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        commands.push(route.request().postDataJSON());
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        if (lost) {
          lost = false;
          return route.abort("failed");
        }
        return route.fulfill({ response });
      },
    );
    await section(page).getByLabel("Validità (giorni)").fill("3");
    await section(page)
      .getByRole("button", { name: "Registra autorizzazione", exact: true })
      .click();
    await expect(
      section(page).getByRole("button", {
        name: "Recupera la stessa autorizzazione",
      }),
    ).toBeEnabled();
    await expect(section(page).getByLabel("Validità (giorni)")).toBeDisabled();
    assert.equal(
      (await control()).automation.count,
      state.automation.count + 1,
    );
    await page.reload();
    await refresh(page);
    await section(page)
      .getByRole("button", { name: "Recupera la stessa autorizzazione" })
      .click();
    await expect(section(page).getByRole("status").first()).toHaveText(
      "Stessa richiesta recuperata.",
    );
    assert.equal(commands.length, 2);
    assert.deepEqual(commands[0], commands[1]);
    assert.equal(
      (await control()).automation.count,
      state.automation.count + 1,
    );
    await expect(section(page).locator(".grants li")).toHaveCount(
      state.automation.count + 1,
    );
    await expect(section(page).locator(".grants li").first()).toContainText(
      "Email",
    );
    checks.push(
      "explicit-load-only-and-lost-http-ack-preserves-identical-channel-duration-and-command-across-reload-with-one-remote-grant",
    );

    await section(page)
      .getByLabel("Canale da autorizzare")
      .selectOption("whatsapp");
    await section(page)
      .getByLabel("Archivio del numero", { exact: true })
      .selectOption(state.installations[0].archiveId);
    await section(page)
      .getByRole("button", { name: "Registra autorizzazione", exact: true })
      .click();
    await expect(section(page).locator(".grants li")).toHaveCount(
      state.automation.count + 2,
    );
    const wa = section(page)
      .locator(".grants li")
      .filter({ has: page.locator("strong", { hasText: "WhatsApp" }) })
      .first();
    await wa.getByRole("button", { name: "Revoca", exact: true }).click();
    await expect(wa.getByText(/Revocare l’autorizzazione/)).toBeVisible();
    await wa.getByRole("button", { name: "Mantieni autorizzazione" }).click();
    assert.equal(
      (await control()).automation.count,
      state.automation.count + 2,
    );
    await control({ flags: { loseGrantRevoke: true } });
    await wa.getByRole("button", { name: "Revoca", exact: true }).click();
    await wa.getByRole("button", { name: "Conferma revoca" }).click();
    await expect(section(page).getByRole("status").first()).toContainText(
      "Recupera la stessa richiesta",
    );
    await refresh(page);
    await expect(wa).toContainText("Revoca da completare");
    await wa.getByRole("button", { name: "Riprendi revoca" }).click();
    await wa.getByRole("button", { name: "Conferma revoca" }).click();
    await expect(wa).toContainText("Revocata");
    await expect(
      wa.getByRole("button", { name: "Revoca", exact: true }),
    ).toHaveCount(0);
    checks.push(
      "separate-WhatsApp-authorization-explicit-revocation-confirmation-lost-ack-current-status-and-resume-without-new-grant",
    );

    await control({ flags: { loseWebhookResponse: true } });
    await section(page)
      .getByRole("button", { name: "Configura ricezione delle risposte" })
      .click();
    await expect(
      section(page).getByRole("button", {
        name: "Recupera la stessa ricezione",
      }),
    ).toBeEnabled();
    await page.reload();
    await refresh(page);
    await section(page)
      .getByRole("button", { name: "Recupera la stessa ricezione" })
      .click();
    await expect(section(page).getByRole("status").first()).toHaveText(
      "Stessa richiesta recuperata.",
    );
    assert.equal((await control()).automation.webhooks.count, 1);
    await expect(section(page)).toContainText(
      "La consegna pubblica va verificata separatamente",
    );
    checks.push(
      "webhook-setup-lost-provider-response-recovers-one-endpoint-after-reload-and-does-not-claim-public-delivery",
    );

    const screenshots = [];
    for (const viewport of [
      { width: 1440, height: 1050 },
      { width: 1180, height: 820 },
      { width: 820, height: 1180 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await section(page).scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      const box = await section(page).boundingBox();
      assert(box.x >= 0 && box.width <= viewport.width);
      for (const [area, target] of [
        [
          "header",
          section(page).getByRole("heading", {
            name: "Autorizzazioni delle automazioni",
            exact: true,
          }),
        ],
        ["replies", section(page).locator(".replies")],
      ]) {
        await target.scrollIntoViewIfNeeded();
        await expect(target).toBeInViewport();
        const file = `${directory}/${viewport.width}x${viewport.height}-${area}.png`;
        await page.screenshot({ path: file });
        screenshots.push(file);
      }
    }
    checks.push(
      "four-desktop-tablet-mobile-layouts-preserve-controls-and-state-without-horizontal-overflow",
    );
    const reader = await open("reader");
    await expect(section(reader)).toHaveCount(0);
    await reader.close();
    const partial = await open("partial");
    await refresh(partial);
    await expect(section(partial).getByRole("status")).toContainText(
      "attività",
    );
    await expect(
      section(partial).getByLabel("Canale da autorizzare"),
    ).toHaveCount(0);
    await partial.close();
    assert.equal(
      (await control()).installations[0].outbox.length,
      state.installations[0].outbox.length,
    );
    assert.deepEqual(errors, []);
    const result = {
      checkedAt: new Date().toISOString(),
      database: health.database,
      realSdk: true,
      provider: "synthetic-loopback",
      realAccounts: false,
      realMessages: false,
      activationAvailable: false,
      checks,
      screenshots,
    };
    fs.writeFileSync(
      ".local/step12/sdk-012/access-browser-result.json",
      JSON.stringify(result, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({
        path: directory + "/failure.png",
        fullPage: true,
      });
      fs.writeFileSync(
        directory + "/failure.txt",
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
