const { randomUUID } = require("node:crypto");
/* Full compiled UI against the isolated synthetic QA API/database. No real login or providers. */
const { createRequire } = require("node:module"),
  { resolve } = require("node:path"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
const { chromium } = createRequire(
  process.env.ALORA_PLAYWRIGHT_PACKAGE_JSON || resolve("package.json"),
)(process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test");
(async () => {
  const health = await (await fetch("http://127.0.0.1:53027/health")).json();
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  const fixture = JSON.parse(
    fs.readFileSync(".local/step9/http-result.json", "utf8"),
  ).fixture;
  const call = async (route, body) => {
    if (
      body &&
      (route === "/appointments" ||
        route === "/sales" ||
        /\/bookings$/.test(route))
    )
      body = { idempotencyKey: randomUUID(), ...body };
    const r = await fetch("http://127.0.0.1:53027" + route, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer owner",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const d = await r.json();
    assert(r.ok, JSON.stringify(d));
    return d;
  };
  const balance = async () =>
    (await call(`/inventory/balances?locationId=${fixture.locationA}`)).find(
      (row) => row.id === fixture.productId,
    );
  const before = await balance(),
    browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    await page.addInitScript(() => {
      localStorage.setItem("barber.session", "owner");
      localStorage.removeItem("alora.scope:__http_owner");
    });
    await page.goto("http://127.0.0.1:53028/admin/#/inventory");
    await page
      .getByRole("heading", { name: "Magazzino", exact: true })
      .waitFor();
    await page
      .getByLabel("Sede", { exact: true })
      .selectOption(fixture.locationA);
    await page
      .locator("button.stock-card")
      .filter({ hasText: fixture.productName || "Prodotto tracciato" })
      .click();
    await page
      .getByLabel("Operazione", { exact: true })
      .selectOption("receipt");
    await page.getByLabel("Quantità", { exact: true }).fill("1");
    await page
      .getByLabel("Costo unitario di acquisto", { exact: true })
      .fill("6");
    await page
      .getByLabel("Modalità costo", { exact: true })
      .selectOption("net");
    await page.getByLabel("IVA acquisto (%)", { exact: true }).fill("0");
    await page
      .getByLabel("Motivo", { exact: true })
      .fill("Carico dal collaudo browser");
    const posted = page.waitForResponse(
      (r) =>
        r.url().endsWith("/inventory/operations") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Registra movimento", exact: true })
      .click();
    assert.equal((await posted).status(), 201);
    await page
      .getByText("Movimento registrato e giacenza riconciliata", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      Number((await balance()).quantity),
      Number(before.quantity) + 1,
    );
    await page.screenshot({
      path: ".local/step9/inventory-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Mobile page overflows",
    );
    await page.screenshot({
      path: ".local/step9/inventory-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("http://127.0.0.1:53028/admin/#/services");
    await page
      .locator("button.list-card")
      .filter({ hasText: fixture.productName || "Prodotto tracciato" })
      .click();
    const dialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", {
        name: "Modifica prodotto",
        exact: true,
      }),
    });
    await dialog
      .getByLabel("Modalità prezzo", { exact: true })
      .selectOption("net");
    await dialog.getByLabel("IVA vendita (%)", { exact: true }).fill("4");
    await dialog.getByLabel("Prezzo di vendita", { exact: true }).fill("10");
    await dialog.getByLabel("Costo di acquisto", { exact: true }).fill("12.20");
    await dialog
      .getByLabel("Modalità costo", { exact: true })
      .selectOption("gross");
    await dialog.getByLabel("IVA acquisto (%)", { exact: true }).fill("22");
    await dialog
      .getByLabel("Motivo aggiornamento listino", { exact: true })
      .fill("Listino dal collaudo browser");
    const changed = page.waitForResponse(
      (r) =>
        r.url().endsWith("/products/" + fixture.productId) &&
        r.request().method() === "PATCH",
    );
    await dialog
      .getByRole("button", { name: "Salva prodotto", exact: true })
      .click();
    assert.equal((await changed).status(), 200);
    await dialog.waitFor({ state: "hidden" });
    await page
      .locator("button.list-card")
      .filter({ hasText: fixture.productName || "Prodotto tracciato" })
      .click();
    await dialog
      .getByRole("button", { name: "Storico prezzi", exact: true })
      .click();
    await dialog
      .getByText("Listino dal collaudo browser", { exact: true })
      .waitFor();
    await page.screenshot({
      path: ".local/step9/catalog-price-history.png",
      fullPage: true,
    });
    const history = await call(`/products/${fixture.productId}/prices`);
    assert.equal(history.items[0].snapshot.priceMode, "net");
    assert.equal(history.items[0].snapshot.vatRate, 4);
    assert.equal(history.items[0].snapshot.purchaseVatRate, 22);
    const serviceName = "Browser conto IVA " + Date.now();
    const service = await call("/services", {
      name: serviceName,
      sectorId: fixture.sectorA,
      basePrice: "10",
      priceMode: "net",
      vatRate: "4",
      durationMinutes: 30,
      requiresCollaborator: false,
    });
    await call(`/services/${service.id}/products`, {
      productId: fixture.productId,
      mode: "optional",
      consumptionUnits: "0.500",
    });
    const booking = await call("/appointments", {
      customerId: "__http_customer",
      serviceId: service.id,
      startsAt: "2032-11-19T11:00:00+01:00",
    });
    const original = await call(`/sales/for-appointment/${booking.id}`);
    await page.goto("http://127.0.0.1:53028/admin/#/appointments");
    await page
      .getByRole("button", { name: "Lista appuntamenti", exact: true })
      .click();
    await page
      .locator("button.list-card")
      .filter({ hasText: serviceName })
      .click();
    await page
      .getByRole("button", { name: "Chiudi il conto", exact: true })
      .last()
      .click();
    const checkout = page.locator(".quick-order-overlay");
    await checkout.waitFor();
    await checkout
      .getByLabel("Sconto complessivo sul totale", { exact: true })
      .fill("1.04");
    await checkout.getByText("€9.36", { exact: true }).waitFor();
    await page.screenshot({
      path: ".local/step9/checkout-vat-discount.png",
      fullPage: true,
    });
    const confirmed = page.waitForResponse(
      (r) =>
        r.url().endsWith("/sales/" + original.id) &&
        r.request().method() === "PATCH",
    );
    await checkout
      .getByRole("button", { name: "Registra vendita", exact: true })
      .click();
    assert.equal((await confirmed).status(), 200);
    const final = await call(`/sales/for-appointment/${booking.id}`);
    assert.equal(final.id, original.id);
    assert.equal(final.items[0].id, original.items[0].id);
    assert.equal(final.total, "9.36");
    assert.equal(final.taxTotal, "0.36");
    assert.equal(final.orderDiscount, "1.04");
    const result = {
      checkedAt: new Date().toISOString(),
      identity: "synthetic-local-test-sessions",
      providerCalls: false,
      checks: [
        "authorized-inventory-route-and-location-selection",
        "receipt-through-real-form-and-updated-balance",
        "mobile-390-no-horizontal-overflow",
        "independent-purchase-sale-vat-and-persistent-price-history",
        "server-quoted-order-discount-and-vat-on-existing-booked-row",
      ],
      screenshots: [
        "inventory-desktop.png",
        "inventory-mobile.png",
        "catalog-price-history.png",
        "checkout-vat-discount.png",
      ],
    };
    fs.writeFileSync(
      ".local/step9/browser-result.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(JSON.stringify(result));
  } catch (error) {
    if (page)
      await page.screenshot({
        path: ".local/step9/browser-error.png",
        fullPage: true,
      });
    throw error;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
