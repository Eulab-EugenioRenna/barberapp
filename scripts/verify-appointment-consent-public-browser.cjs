/** Actual public booking form/command and persisted consent. Disposable identities only. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { randomUUID } = require("node:crypto"),
  { execFileSync } = require("node:child_process");
const { chromium, expect } = require(
  process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test",
);
(async () => {
  const base = "http://127.0.0.1:53027",
    health = await (await fetch(base + "/health")).json();
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  async function call(path, body, method = body ? "POST" : "GET") {
    const r = await fetch(base + path, {
      method,
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json();
    assert(r.ok, JSON.stringify(data));
    return data;
  }
  const site = await call("/locations", {
    name: "Synthetic public consent " + Date.now(),
    sectorName: "Consent area",
    isPublic: true,
  });
  await call(
    "/locations/" + site.id,
    {
      weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        isWorkingDay: true,
        startTime: "09:00",
        endTime: "19:00",
      })),
    },
    "PATCH",
  );
  const service = await call("/services", {
    name: "Synthetic consent service " + Date.now(),
    sectorId: site.sectors[0].id,
    durationMinutes: 30,
    basePrice: "20",
    priceMode: "legacy",
    requiresCollaborator: false,
    requiresRoom: false,
    isPublic: true,
    isBookableOnline: true,
  });
  const browser = await chromium.launch({
      headless: true,
      ...(process.env.ALORA_PLAYWRIGHT_EXECUTABLE
        ? { executablePath: process.env.ALORA_PLAYWRIGHT_EXECUTABLE }
        : {}),
    }),
    checks = [],
    errors = [],
    directory = ".local/step12/public-consent-screenshots";
  fs.mkdirSync(directory, { recursive: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    const requests = [];
    let ack,
      lost = true;
    await page.route("**/api/public/__http_a/bookings", async (route) => {
      requests.push(route.request().postDataJSON());
      const r = await route.fetch();
      assert.equal(r.status(), 201, await r.text());
      if (lost) {
        lost = false;
        ack = await r.json();
        return route.abort("failed");
      }
      return route.fulfill({ response: r });
    });
    await page.goto("http://127.0.0.1:53028/booking/__http_a");
    await page
      .getByLabel("Sede della prenotazione", { exact: true })
      .selectOption(site.id);
    await page.getByRole("button").filter({ hasText: service.name }).click();
    const tomorrow = new Date(Date.now() + 86400000),
      key = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    await page.locator(`button[data-date="${key}"]`).last().click();
    const consent = page.getByRole("checkbox", {
      name: /Desidero ricevere su WhatsApp/,
    });
    await expect(consent).not.toBeChecked();
    await page.getByLabel("Nome e cognome").fill("Synthetic Public Consent");
    await page
      .getByLabel("Email", { exact: true })
      .fill(randomUUID() + "@consent.invalid");
    await page.getByLabel("Telefono", { exact: true }).fill("+393330000002");
    await consent.check();
    for (const [name, viewport] of Object.entries({
      desktop: { width: 1440, height: 1050 },
      "tablet-landscape": { width: 1180, height: 820 },
      "tablet-portrait": { width: 820, height: 1180 },
      mobile: { width: 390, height: 844 },
    })) {
      await page.setViewportSize(viewport);
      await consent.scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 2,
        ),
        false,
      );
      await page.screenshot({ path: `${directory}/${name}.png` });
    }
    await page
      .getByRole("button", { name: "Richiedi la prenotazione", exact: true })
      .click();
    const retry = page.getByRole("button", {
      name: "Verifica prenotazione precedente",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    assert(ack);
    assert.equal(requests[0].appointmentWhatsAppConsent, true);
    await expect(consent).toBeDisabled();
    await page.reload();
    await expect(consent).toBeChecked();
    await expect(consent).toBeDisabled();
    await retry.click();
    await page.locator(".success-card").waitFor();
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    const stored = execFileSync(
      "docker",
      [
        "exec",
        "-i",
        "barber-postgres-1",
        "psql",
        "-X",
        "-U",
        "barber",
        "-d",
        health.database,
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      {
        input: `SELECT "automationContact" IS NOT NULL FROM "Sale" WHERE "appointmentId"='${ack.id}'`,
        stdio: "pipe",
      },
    )
      .toString()
      .trim();
    assert.equal(stored, "t");
    checks.push(
      "public-consent-is-off-by-default-and-explicit-opt-in-is-persisted-for-only-the-booking",
    );
    checks.push(
      "lost-public-ack-freezes-and-restores-selected-consent-and-replays-identical-command-after-reload",
    );
    checks.push(
      "public-consent-is-readable-without-horizontal-overflow-in-four-viewports",
    );
    assert.deepEqual(errors, []);
    const result = {
      checkedAt: new Date().toISOString(),
      database: health.database,
      realAngular: true,
      realDomainCommands: true,
      realAccounts: false,
      realProviderMessages: false,
      checks,
      screenshots: directory,
    };
    fs.writeFileSync(
      ".local/step12/public-consent-browser-result.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    if (page && !page.isClosed()) {
      await page.screenshot({
        path: directory + "/failure.png",
        fullPage: true,
      });
      fs.writeFileSync(
        directory + "/failure.txt",
        await page.locator("body").innerText(),
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
