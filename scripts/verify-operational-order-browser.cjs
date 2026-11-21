const { randomUUID } = require("node:crypto");
/* Uses only the explicitly isolated synthetic QA server, never user browser storage. */
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = createRequire(
  process.env.ALORA_PLAYWRIGHT_PACKAGE_JSON || resolve("package.json"),
)(process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test");
(async () => {
  const fixture = JSON.parse(
    fs.readFileSync(".local/step8/http-result.json", "utf8"),
  ).fixture;
  const health = await (await fetch("http://127.0.0.1:53027/health")).json();
  assert(health.testOnly && health.database.startsWith("step7_http_"));
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
  const serviceName = "Browser ordine unico " + Date.now();
  const service = await call("/services", {
    name: serviceName,
    sectorId: fixture.sectorId,
    basePrice: 18.93,
    durationMinutes: 30,
    requiresCollaborator: false,
  });
  const booking = await call("/appointments", {
    customerId: "__http_customer",
    serviceId: service.id,
    startsAt: "2032-11-12T11:00:00+01:00",
  });
  const original = await call(`/sales/for-appointment/${booking.id}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(10000);
    await page.addInitScript(() =>
      localStorage.setItem("barber.session", "owner"),
    );
    await page.goto("http://127.0.0.1:53028/admin/#/appointments");
    await page
      .getByRole("button", { name: "Lista appuntamenti", exact: true })
      .click();
    const open = async () => {
      await page
        .locator("button.list-card")
        .filter({ hasText: serviceName })
        .click();
      await page
        .getByRole("button", { name: "Chiudi il conto", exact: true })
        .last()
        .click();
      await page.locator(".quick-order-overlay").waitFor();
    };
    await open();
    const modal = page.locator(".quick-order-overlay");
    const price = modal.getByLabel("Prezzo", { exact: true });
    await price.waitFor();
    assert.equal(await price.count(), 1);
    await price.fill("21.49");
    await modal
      .getByRole("heading", { name: "Conto prenotato", exact: true })
      .click();
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        r.url().endsWith("/sales/" + original.id),
    );
    await modal
      .getByRole("button", { name: "Salva conto aperto", exact: true })
      .click();
    assert.equal((await saved).status(), 200);
    await modal.waitFor({ state: "hidden" });
    const draft = await call(`/sales/for-appointment/${booking.id}`);
    assert.equal(draft.id, original.id);
    assert.equal(draft.items[0].id, original.items[0].id);
    assert.equal(draft.orderStatus, "open");
    assert.equal(draft.total, "21.49");
    await open();
    await page.screenshot({
      path: ".local/step8/checkout-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await modal
      .getByRole("button", { name: "Registra vendita", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: ".local/step8/checkout-mobile.png",
      fullPage: true,
    });
    const payments = modal.locator("alora-account-payments");
    await payments.locator("summary").click();
    await payments
      .getByLabel("Importo incasso 1", { exact: true })
      .fill("21.49");
    const receiptResponse = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().endsWith(`/sales/${original.id}/payments`),
    );
    await payments
      .getByRole("button", { name: "Registra importi ricevuti", exact: true })
      .click();
    const receiptResult = await receiptResponse;
    assert.equal(
      receiptResult.status(),
      201,
      JSON.stringify(await receiptResult.json()),
    );
    await payments
      .getByText("Operazione registrata. Gli incassi sono aggiornati.")
      .waitFor();
    const confirmed = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        r.url().endsWith("/sales/" + original.id),
    );
    await modal
      .getByRole("button", { name: "Registra vendita", exact: true })
      .click();
    assert.equal((await confirmed).status(), 200);
    await modal.waitFor({ state: "hidden" });
    const final = await call(`/sales/for-appointment/${booking.id}`);
    assert.equal(final.id, original.id);
    assert.equal(final.items[0].id, original.items[0].id);
    assert.equal(final.items.length, 1);
    assert.equal(final.orderStatus, "confirmed");
    assert.equal(final.paymentStatus, "paid");
    const result = {
      checkedAt: new Date().toISOString(),
      identity: "synthetic-local-test-sessions",
      providerCalls: false,
      checks: [
        "open-canonical-order-from-agenda",
        "save-open-order-without-changing-order-or-row-id",
        "reopen-and-register-same-order-without-duplicating-lines",
        "desktop-and-mobile-checkout",
      ],
      screenshots: ["checkout-desktop.png", "checkout-mobile.png"],
    };
    fs.writeFileSync(
      ".local/step8/browser-result.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
