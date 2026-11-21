/** Existing booking editor + actual contact command, real SQL; synthetic local sessions only. */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  { randomUUID } = require("node:crypto");
const { chromium, expect } = require(
  process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test",
);
(async () => {
  const base = "http://127.0.0.1:53027",
    health = await (await fetch(base + "/health")).json();
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  const source = JSON.parse(
    fs.readFileSync(".local/step10/booking-mutation-http-result.json", "utf8"),
  );
  async function call(route, body, method = body ? "POST" : "GET") {
    const r = await fetch(base + route, {
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
  const booking = await call("/appointments", {
    idempotencyKey: randomUUID(),
    customerName: "Synthetic Contact Browser",
    email: randomUUID() + "@contact.invalid",
    phone: "+393330000002",
    appointmentWhatsAppConsent: false,
    lines: [
      {
        serviceId: source.fixture.firstServiceId,
        startsAt: new Date(
          Date.parse("2040-03-05T10:00:00Z") +
            Math.floor(Math.random() * 3000) * 86400000,
        ).toISOString(),
      },
    ],
  });
  const browser = await chromium.launch({
      headless: true,
      ...(process.env.ALORA_PLAYWRIGHT_EXECUTABLE
        ? { executablePath: process.env.ALORA_PLAYWRIGHT_EXECUTABLE }
        : {}),
    }),
    checks = [],
    errors = [],
    directory = ".local/step12/contact-screenshots";
  fs.mkdirSync(directory, { recursive: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem("barber.session", "owner");
      localStorage.removeItem("barber.refresh");
    });
    await page.goto(
      "http://127.0.0.1:53028/admin/#/appointments?detail=" + booking.id,
    );
    await page.getByRole("button", { name: "Modifica", exact: true }).click();
    const contact = page.locator("app-appointment-contact");
    await expect(contact).toContainText("Consenso non registrato");
    await expect(contact).toContainText("0002");
    const requests = [];
    let lost = true;
    await page.route(
      "**/api/appointments/*/notification-contact",
      async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        requests.push(route.request().postDataJSON());
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        if (lost) {
          lost = false;
          return route.abort("failed");
        }
        return route.fulfill({ response });
      },
    );
    await contact
      .getByRole("button", {
        name: "Registra il consenso del cliente",
        exact: true,
      })
      .click();
    await expect(
      contact.getByRole("button", {
        name: "Verifica consenso precedente",
        exact: true,
      }),
    ).toBeEnabled();
    await page.reload();
    await page.getByRole("button", { name: "Modifica", exact: true }).click();
    await contact
      .getByRole("button", {
        name: "Verifica consenso precedente",
        exact: true,
      })
      .click();
    await expect(contact).toContainText(
      "Consenso registrato per questa prenotazione",
    );
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    checks.push(
      "lost-response-freezes-contact-command-and-reload-recovers-identical-key-once-in-real-booking-editor",
    );
    await contact
      .getByRole("button", {
        name: "Revoca per questa prenotazione",
        exact: true,
      })
      .click();
    await expect(contact).toContainText("Consenso non registrato");
    assert.equal(
      (await call(`/appointments/${booking.id}/notification-contact`))
        .authorized,
      false,
    );
    for (const [name, viewport] of Object.entries({
      desktop: { width: 1440, height: 1000 },
      "tablet-landscape": { width: 1180, height: 820 },
      "tablet-portrait": { width: 820, height: 1180 },
      mobile: { width: 390, height: 844 },
    })) {
      await page.setViewportSize(viewport);
      await contact.scrollIntoViewIfNeeded();
      const b = await contact.boundingBox();
      assert(b && b.width <= viewport.width);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({ path: `${directory}/${name}.png` });
    }
    checks.push(
      "explicit-contact-revocation-and-masked-number-work-in-four-viewports",
    );
    assert.deepEqual(errors, []);
    const result = {
      checkedAt: new Date().toISOString(),
      database: health.database,
      realAngular: true,
      realDomainCommands: true,
      realAccounts: false,
      providerCalls: false,
      checks,
      screenshots: directory,
    };
    fs.writeFileSync(
      ".local/step12/contact-browser-result.json",
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
