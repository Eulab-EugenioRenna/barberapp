const {
  qaViewport,
  qaArtifactPath,
  qaViewportName,
  qaChecks,
} = require("./qa-viewport.cjs");
/** Fresh contexts, actual isolated HTTP/SQL backend, no Connect session or provider. */
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium, expect } = require(
  process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test",
);
(async () => {
  const base = "http://127.0.0.1:53027",
    health = await (await fetch(base + "/health")).json();
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  const fixture = JSON.parse(
    fs.readFileSync(
      ".local/step10/booking-availability-http-result.json",
      "utf8",
    ),
  ).fixture;
  const browser = await chromium.launch({ headless: true }),
    checks = [];
  try {
    const internal = await browser.newPage({
      viewport: qaViewport({ width: 1280, height: 1000 }),
    });
    internal.setDefaultTimeout(15000);
    await internal.addInitScript(() =>
      localStorage.setItem("barber.session", "owner"),
    );
    await internal.goto("http://127.0.0.1:53028/admin/#/appointments");
    await internal
      .getByRole("button", { name: "Nuova prenotazione", exact: true })
      .click();
    const editor = internal.getByRole("dialog");
    await editor
      .getByRole("combobox", { name: "Cliente", exact: true })
      .click();
    await internal
      .getByLabel("Filtra opzioni", { exact: true })
      .fill("Cliente Prova");
    await internal
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: "Cliente Prova" })
      .first()
      .click();
    await editor
      .getByRole("combobox", { name: "Servizio", exact: true })
      .click();
    await internal
      .getByLabel("Filtra opzioni", { exact: true })
      .fill(fixture.firstServiceName);
    await internal
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: fixture.firstServiceName })
      .click();
    await expect(
      editor.getByRole("combobox", { name: "Professionista", exact: true }),
    ).toContainText("Nessuna preferenza");
    await editor
      .getByRole("combobox", { name: "Aggiungi un servizio", exact: true })
      .click();
    await internal
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: fixture.secondServiceName })
      .click();
    await expect(
      editor.getByRole("combobox", {
        name: "Professionista per " + fixture.secondServiceName,
        exact: true,
      }),
    ).toContainText("Nessuna preferenza");
    const time = editor.getByRole("combobox", { name: "Orario", exact: true });
    await expect(time).toHaveAttribute("aria-disabled", "false");
    await time.click();
    await internal.getByRole("listbox").getByRole("option").first().click();
    await internal.screenshot({
      path: qaArtifactPath(".local/step10/booking-sequence-internal.png"),
    });
    const savedResponse = internal.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/appointments"),
    );
    await editor
      .getByRole("button", { name: "Crea appuntamento", exact: true })
      .click();
    const saved = await savedResponse;
    assert.equal(saved.status(), 201, await saved.text());
    const internalAck = await saved.json();
    assert.equal(internalAck.appointments.length, 2);
    assert.equal(
      internalAck.appointments[0].endsAt,
      internalAck.appointments[1].startsAt,
    );
    assert.equal(internalAck.estimatedTotal, "20.20");
    const creationBody = saved.request().postDataJSON();
    assert.deepEqual(creationBody.lines, [
      { serviceId: fixture.firstServiceId },
      { serviceId: fixture.secondServiceId },
    ]);
    await editor.waitFor({ state: "hidden" });
    const internalAccount = await (
      await fetch(base + "/sales/for-appointment/" + internalAck.id, {
        headers: { Authorization: "Bearer owner" },
      })
    ).json();
    assert.equal(internalAccount.id, internalAck.orderId);
    assert.equal(internalAccount.items.length, 2);
    assert(internalAccount.items.every((row) => !row.collaboratorId));
    checks.push(
      "internal-editor-creates-two-services-with-no-preference-and-server-validated-sequence-on-one-account",
    );
    await internal.close();
    const page = await browser.newPage({
      viewport: qaViewport({ width: 1440, height: 1000 }),
      extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.82" },
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const requests = [];
    let committed = null,
      dropped = false;
    await page.route("**/api/public/__http_a/bookings", async (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      const response = await route.fetch();
      assert.equal(response.status(), 201, await response.text());
      if (!dropped) {
        dropped = true;
        committed = await response.json();
        return route.abort("failed");
      }
      return route.fulfill({ response });
    });
    await page.goto("http://127.0.0.1:53028/booking/__http_a");
    await page
      .getByLabel("Sede della prenotazione", { exact: true })
      .selectOption(fixture.siteId);
    await page
      .getByRole("button")
      .filter({ hasText: fixture.firstServiceName })
      .click();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await page
      .locator(
        `button[data-date="${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}"]`,
      )
      .last()
      .click();
    await page
      .getByRole("combobox", { name: "Aggiungi un servizio", exact: true })
      .click();
    await page
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: fixture.secondServiceName })
      .click();
    const sequence = page.getByRole("region", { name: "Sequenza dei servizi" });
    await expect(
      sequence.getByText(fixture.secondServiceName, { exact: false }).first(),
    ).toBeVisible();
    const professional = page.getByRole("combobox", {
      name: "Professionista per " + fixture.secondServiceName,
      exact: true,
    });
    await expect(
      professional.getByText("Nessuna preferenza", { exact: true }),
    ).toBeVisible();
    const summary = page.getByRole("article", { name: "Riepilogo orario" });
    await summary.getByText(/Totale €20[.,]20/).waitFor();
    await page.screenshot({
      path: qaArtifactPath(".local/step10/booking-sequence-desktop.png"),
      fullPage: true,
    });
    checks.push(
      "public-cross-sector-sequence-shows-all-services-server-validated-times-and-gross-total",
    );
    await page.getByLabel("Nome e cognome").fill("Sequence Browser");
    await page
      .getByLabel("Email", { exact: true })
      .fill("sequence-browser-" + Date.now() + "@example.invalid");
    await page
      .getByRole("button", { name: "Richiedi la prenotazione", exact: true })
      .click();
    const retry = page.getByRole("button", {
      name: "Verifica prenotazione precedente",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    assert(committed);
    assert.equal(committed.appointments.length, 2);
    assert.deepEqual(requests[0].lines, [
      { serviceId: fixture.firstServiceId },
      { serviceId: fixture.secondServiceId },
    ]);
    assert.equal(
      committed.appointments[0].endsAt,
      committed.appointments[1].startsAt,
    );
    assert.equal(
      Date.parse(committed.appointments[1].startsAt) -
        Date.parse(committed.startsAt),
      45 * 60000,
    );
    assert(
      committed.appointments[1].roomId &&
        committed.appointments[1].collaboratorId,
    );
    await expect(professional).toHaveAttribute("aria-disabled", "true");
    await page.setViewportSize(qaViewport({ width: 390, height: 844 }));
    await page.reload();
    await page
      .getByRole("button", {
        name: "Verifica prenotazione precedente",
        exact: true,
      })
      .click();
    await page
      .getByText(
        committed.status === "confirmed"
          ? "Appuntamento confermato"
          : "Richiesta inviata",
        { exact: true },
      )
      .waitFor();
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    await expect(page.locator(".success-card")).toContainText(
      fixture.firstServiceName,
    );
    await expect(page.locator(".success-card")).toContainText(
      fixture.secondServiceName,
    );
    await page.locator(".success-card").scrollIntoViewIfNeeded();
    const accountResponse = await fetch(
      base + "/sales/for-appointment/" + committed.id,
      { headers: { Authorization: "Bearer owner" } },
    );
    assert.equal(accountResponse.status, 200);
    const account = await accountResponse.json();
    assert.equal(account.items.length, 2);
    assert.equal(account.total, "20.2");
    const secondAccount = await (
      await fetch(
        base + "/sales/for-appointment/" + committed.appointments[1].id,
        { headers: { Authorization: "Bearer owner" } },
      )
    ).json();
    assert.equal(secondAccount.id, account.id);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: qaArtifactPath(
        ".local/step10/booking-sequence-recovered-mobile.png",
      ),
      fullPage: true,
    });
    checks.push(
      "two-services-no-preference-reserve-real-resources-and-one-account-with-45-minute-exact-continuation",
    );
    checks.push(
      "lost-response-after-commit-and-mobile-reload-recover-the-identical-multiple-service-command-and-summary",
    );
    fs.writeFileSync(
      qaArtifactPath(".local/step10/booking-sequence-browser-result.json"),
      JSON.stringify(
        {
          viewportScenario: qaViewportName,
          checkedAt: new Date().toISOString(),
          identity: "isolated-synthetic-browser",
          database: health.database,
          providerCalls: false,
          checks: qaChecks(checks),
          screenshots: [
            "booking-sequence-desktop.png",
            "booking-sequence-recovered-mobile.png",
            "booking-sequence-internal.png",
          ],
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    console.log(JSON.stringify({ checks }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
