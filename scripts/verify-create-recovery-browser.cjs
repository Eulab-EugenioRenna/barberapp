/* Fresh browser contexts and disposable synthetic backend only. */
const { createRequire } = require("node:module"),
  { resolve } = require("node:path");
const fs = require("node:fs"),
  assert = require("node:assert/strict");
const { chromium, expect } = createRequire(
  process.env.ALORA_PLAYWRIGHT_PACKAGE_JSON || resolve("package.json"),
)(process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test");
(async () => {
  const base = "http://127.0.0.1:53027",
    health = await (await fetch(base + "/health")).json();
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  const call = async (route, body) => {
    const response = await fetch(base + route, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    assert(response.ok, JSON.stringify(data));
    return data;
  };
  const stamp = Date.now(),
    siteName = "Recovery browser " + stamp;
  const site = await call("/locations", {
      name: siteName,
      sectorName: "Recovery area",
    }),
    sector = site.sectors[0].id;
  const productName = "Recovery product " + stamp;
  const product = await call("/products", {
    name: productName,
    price: "100",
    priceMode: "gross",
    vatRate: "22",
  });
  const room = await call("/locations/rooms", {
    name: "Recovery room",
    sectorId: sector,
    capacity: 1,
    isPublic: true,
  });
  const person = await call("/collaborators", {
    firstName: "Recovery",
    lastName: "Professional",
    sectorId: sector,
    isPublic: true,
  });
  const serviceName = "Recovery service " + stamp;
  const service = await call("/services", {
    name: serviceName,
    sectorId: sector,
    durationMinutes: 30,
    basePrice: "20",
    priceMode: "gross",
    vatRate: "22",
    requiresCollaborator: true,
    requiresRoom: true,
    isPublic: true,
    isBookableOnline: true,
  });
  const browser = await chromium.launch({ headless: true }),
    checks = [];
  try {
    const cashier = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    });
    cashier.setDefaultTimeout(12000);
    const cashierErrors = [];
    cashier.on("pageerror", (error) => cashierErrors.push(error.message));
    await cashier.addInitScript(() =>
      localStorage.setItem("barber.session", "owner"),
    );
    let dropped = false,
      firstSale = null,
      firstSaleBody = null;
    const saleKeys = [];
    await cashier.route("**/api/sales", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      saleKeys.push(route.request().postDataJSON().idempotencyKey);
      if (!dropped) {
        dropped = true;
        const response = await route.fetch();
        assert.equal(response.status(), 201, await response.text());
        firstSale = await response.json();
        firstSaleBody = route.request().postDataJSON();
        return route.abort("failed");
      }
      return route.continue();
    });
    const openSale = async () => {
      await cashier
        .getByRole("button", { name: "Nuova vendita", exact: true })
        .last()
        .click();
      return cashier.locator(".quick-order-overlay");
    };
    await cashier.goto("http://127.0.0.1:53028/admin/#/sales");
    let modal = await openSale();
    await modal
      .getByLabel("Sede del conto", { exact: true })
      .selectOption(site.id);
    await modal.getByRole("combobox", { name: "Cliente", exact: true }).click();
    await cashier
      .getByLabel("Filtra opzioni", { exact: true })
      .fill("Cliente Prova");
    await cashier
      .getByRole("option")
      .filter({ hasText: "Cliente Prova" })
      .first()
      .click();
    await modal.getByRole("button").filter({ hasText: productName }).click();
    await modal
      .locator(".checkout-total")
      .getByText("€100.00", { exact: true })
      .waitFor();
    await modal
      .getByRole("button", { name: "Registra vendita", exact: true })
      .click();
    await modal
      .getByRole("button", { name: "Verifica vendita precedente", exact: true })
      .waitFor();
    await expect(
      modal.getByRole("button", {
        name: "Verifica vendita precedente",
        exact: true,
      }),
    ).toBeEnabled();
    await cashier.waitForFunction(
      () =>
        document
          .querySelector(
            '.quick-order-overlay [role="combobox"][aria-label="Cliente"]',
          )
          ?.getAttribute("aria-disabled") === "true",
    );
    assert(firstSale && firstSaleBody.idempotencyKey);
    const actualBefore = await call(`/sales/${firstSale.id}/payments`);
    assert.equal(actualBefore.items.length, 1);
    assert.equal(actualBefore.summary.receipts, "100.00");
    await cashier.reload();
    modal = await openSale();
    const replayResponse = cashier.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/sales"),
    );
    await modal
      .getByRole("button", { name: "Verifica vendita precedente", exact: true })
      .click();
    const replay = await replayResponse;
    assert.equal(replay.status(), 201);
    assert.deepEqual(await replay.json(), firstSale);
    await modal.waitFor({ state: "hidden" });
    assert.deepEqual(saleKeys, [
      firstSaleBody.idempotencyKey,
      firstSaleBody.idempotencyKey,
    ]);
    const actualAfter = await call(`/sales/${firstSale.id}/payments`);
    assert.equal(actualAfter.items.length, 1);
    const matching = (await call("/sales")).items.filter((sale) =>
      sale.items.some((row) => row.productId === product.id),
    );
    assert.equal(matching.length, 1);
    assert.deepEqual(cashierErrors, []);
    checks.push(
      "cashier-lost-response-after-commit-freezes-form-and-reloads-one-account-and-one-receipt",
    );
    await cashier.screenshot({
      path: ".local/step10/create-cashier-recovered.png",
      fullPage: true,
    });
    const agenda = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    agenda.setDefaultTimeout(12000);
    await agenda.addInitScript(() =>
      localStorage.setItem("barber.session", "owner"),
    );
    const agendaKeys = [];
    let agendaDropped = false,
      firstInternal = null;
    await agenda.route("**/api/appointments", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      agendaKeys.push(route.request().postDataJSON().idempotencyKey);
      if (!agendaDropped) {
        agendaDropped = true;
        const response = await route.fetch();
        assert.equal(response.status(), 201, await response.text());
        firstInternal = await response.json();
        return route.abort("failed");
      }
      return route.continue();
    });
    const openBooking = async () => {
      await agenda
        .getByRole("button", { name: "Nuova prenotazione", exact: true })
        .click();
      const dialog = agenda.getByRole("dialog");
      await dialog
        .getByRole("heading", { name: "Nuovo appuntamento", exact: true })
        .waitFor();
      return dialog;
    };
    await agenda.goto("http://127.0.0.1:53028/admin/#/appointments");
    let editor = await openBooking();
    await editor
      .getByRole("combobox", { name: "Cliente", exact: true })
      .click();
    await agenda
      .getByLabel("Filtra opzioni", { exact: true })
      .fill("Cliente Prova");
    await agenda
      .getByRole("option")
      .filter({ hasText: "Cliente Prova" })
      .first()
      .click();
    await editor
      .getByRole("combobox", { name: "Servizio", exact: true })
      .click();
    await agenda
      .getByLabel("Filtra opzioni", { exact: true })
      .fill(serviceName);
    await agenda.getByRole("option").filter({ hasText: serviceName }).click();
    await editor
      .getByRole("combobox", { name: "Professionista", exact: true })
      .click();
    await agenda
      .getByRole("option")
      .filter({ hasText: "Recovery Professional" })
      .click();
    await editor.getByRole("combobox", { name: "Orario", exact: true }).click();
    await agenda.getByRole("listbox").getByRole("option").first().click();
    await editor
      .getByRole("button", { name: "Crea appuntamento", exact: true })
      .click();
    await expect(
      editor.getByRole("button", {
        name: "Verifica prenotazione precedente",
        exact: true,
      }),
    ).toBeEnabled();
    assert(firstInternal);
    assert.equal(
      await editor
        .getByRole("combobox", { name: "Cliente", exact: true })
        .getAttribute("aria-disabled"),
      "true",
    );
    await agenda.reload();
    editor = await openBooking();
    const internalReplay = agenda.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/appointments"),
    );
    await editor
      .getByRole("button", {
        name: "Verifica prenotazione precedente",
        exact: true,
      })
      .click();
    const internalResponse = await internalReplay;
    assert.equal(internalResponse.status(), 201);
    assert.deepEqual(await internalResponse.json(), firstInternal);
    await editor.waitFor({ state: "hidden" });
    assert.equal(agendaKeys.length, 2);
    assert.equal(agendaKeys[0], agendaKeys[1]);
    const recoveredInternal = await call(
      `/sales/for-appointment/${firstInternal.id}`,
    );
    assert.equal(recoveredInternal.id, firstInternal.orderId);
    assert.equal(recoveredInternal.items.length, 1);
    checks.push(
      "internal-editor-lost-response-and-reload-recover-one-booking-and-its-original-account",
    );
    const publicPage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.71" },
    });
    publicPage.setDefaultTimeout(12000);
    const publicErrors = [];
    publicPage.on("pageerror", (error) => publicErrors.push(error.message));
    let publicDropped = false,
      firstBooking = null,
      firstBookingBody = null;
    const bookingKeys = [];
    await publicPage.route("**/api/public/__http_a/bookings", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      bookingKeys.push(route.request().postDataJSON().idempotencyKey);
      if (!publicDropped) {
        publicDropped = true;
        const response = await route.fetch();
        assert.equal(response.status(), 201, await response.text());
        firstBooking = await response.json();
        firstBookingBody = route.request().postDataJSON();
        return route.abort("failed");
      }
      return route.continue();
    });
    await publicPage.goto("http://127.0.0.1:53028/booking/__http_a");
    await publicPage
      .getByLabel("Sede della prenotazione", { exact: true })
      .selectOption(site.id);
    await publicPage
      .getByRole("button")
      .filter({ hasText: serviceName })
      .click();
    await publicPage
      .getByRole("combobox", { name: "Professionista", exact: true })
      .getByText("Nessuna preferenza", { exact: true })
      .waitFor();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await publicPage
      .locator(
        `button[data-date="${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}"]`,
      )
      .last()
      .click();
    await publicPage.getByLabel("Nome e cognome").fill("Recovery Guest");
    await publicPage
      .getByLabel("Email", { exact: true })
      .fill(`recovery-${stamp}@example.invalid`);
    await publicPage
      .getByRole("button", { name: "Richiedi la prenotazione", exact: true })
      .click();
    await publicPage
      .getByRole("button", {
        name: "Verifica prenotazione precedente",
        exact: true,
      })
      .waitFor();
    await expect(
      publicPage.getByRole("button", {
        name: "Verifica prenotazione precedente",
        exact: true,
      }),
    ).toBeEnabled();
    assert(firstBooking && firstBookingBody.idempotencyKey);
    assert(!("collaboratorId" in firstBookingBody));
    assert(firstBookingBody.lines.every((row) => !("collaboratorId" in row)));
    assert.equal(firstBooking.collaboratorId, person.id);
    assert.equal(firstBooking.roomId, room.id);
    assert(await publicPage.getByLabel("Nome e cognome").isDisabled());
    await publicPage.reload();
    const bookingReplayResponse = publicPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/bookings"),
    );
    await publicPage
      .getByRole("button", {
        name: "Verifica prenotazione precedente",
        exact: true,
      })
      .click();
    const bookingReplay = await bookingReplayResponse;
    assert.equal(bookingReplay.status(), 201);
    assert.deepEqual(await bookingReplay.json(), firstBooking);
    assert.deepEqual(bookingKeys, [
      firstBookingBody.idempotencyKey,
      firstBookingBody.idempotencyKey,
    ]);
    await publicPage
      .getByText(
        firstBooking.status === "confirmed"
          ? "Appuntamento confermato"
          : "Richiesta inviata",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await publicPage.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      ),
      false,
    );
    assert.deepEqual(publicErrors, []);
    await publicPage.screenshot({
      path: ".local/step10/create-public-recovered-mobile.png",
      fullPage: true,
    });
    checks.push(
      "public-no-preference-reserves-real-professional-and-room-without-a-client-imposed-assignment",
    );
    checks.push(
      "public-lost-response-and-mobile-reload-recover-the-original-booking-with-the-original-key",
    );
    fs.writeFileSync(
      ".local/step10/create-recovery-browser-result.json",
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          identity: "isolated-synthetic-browser",
          providerCalls: false,
          checks,
          screenshots: [
            "create-cashier-recovered.png",
            "create-public-recovered-mobile.png",
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
