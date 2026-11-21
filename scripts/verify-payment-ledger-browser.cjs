const {
  qaViewport,
  qaArtifactPath,
  qaViewportName,
  qaChecks,
} = require("./qa-viewport.cjs");
const { randomUUID } = require("node:crypto");
/* Isolated browser context and synthetic QA server only. */
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = createRequire(
  process.env.ALORA_PLAYWRIGHT_PACKAGE_JSON || resolve("package.json"),
)(process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test");
(async () => {
  const base = "http://127.0.0.1:53027";
  const health = await (await fetch(base + "/health")).json();
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  const call = async (route, body) => {
    if (body && route === "/sales")
      body = { idempotencyKey: randomUUID(), ...body };
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
  const name = "Browser incassi " + Date.now();
  const location = await call("/locations", {
    name,
    sectorName: "Cassa di prova",
  });
  const product = await call("/products", {
    name,
    price: "100",
    priceMode: "gross",
    vatRate: "22",
  });
  const sourceSale = await call("/sales", {
    customerId: "__http_customer",
    locationId: location.id,
    paymentStatus: "unpaid",
    items: [
      { productId: product.id, quantity: 1, sectorId: location.sectors[0].id },
    ],
  });
  const { cloneLegacySale } = await import("./payment-ledger-qa-fixtures.mjs");
  const sale = {
    ...sourceSale,
    id: cloneLegacySale(health, sourceSale.id),
  };
  const apiRoute = `/sales/${sale.id}/payments`;
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({
      viewport: qaViewport({ width: 1440, height: 1050 }),
    });
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() =>
      localStorage.setItem("barber.session", "owner"),
    );
    const open = async () => {
      await page.goto("http://127.0.0.1:53028/admin/#/sales");
      await page.locator(`button.list-card[data-sale-id="${sale.id}"]`).click();
      await page
        .getByRole("button", { name: "Modifica vendita", exact: true })
        .click();
      await page.locator(".quick-order-overlay").waitFor();
      const panel = page.locator("alora-account-payments");
      await panel.locator("summary").click();
      await panel.getByText("Totale del conto salvato").waitFor();
      return panel;
    };
    let panel = await open();
    await panel.getByLabel("Importo incasso 1", { exact: true }).fill("0");
    await panel
      .getByLabel("Motivazione incasso", { exact: true })
      .fill("Storico verificato nel collaudo sintetico");
    await panel
      .getByRole("button", { name: "Riconcilia saldo storico", exact: true })
      .click();
    await panel
      .getByText("Operazione registrata. Gli incassi sono aggiornati.")
      .waitFor();
    assert.equal((await call(apiRoute)).summary.netReceived, "0.00");
    let dropOnce = true,
      received = null;
    await page.route("**" + apiRoute, async (route) => {
      if (dropOnce && route.request().method() === "POST") {
        dropOnce = false;
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        received = await response.json();
        await route.abort("failed");
      } else await route.continue();
    });
    await panel.getByLabel("Importo incasso 1", { exact: true }).fill("20,10");
    await panel
      .getByRole("button", { name: "Registra importi ricevuti", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Verifica e riprova", exact: true })
      .waitFor();
    assert.equal((await call(apiRoute)).summary.netReceived, "20.10");
    assert(
      await panel.getByLabel("Importo incasso 1", { exact: true }).isDisabled(),
    );
    await page.reload();
    panel = await open();
    await panel
      .getByRole("button", { name: "Verifica e riprova", exact: true })
      .click();
    await panel
      .getByText("Operazione registrata. Gli incassi sono aggiornati.")
      .waitFor();
    let ledger = await call(apiRoute);
    assert.equal(ledger.items.length, 2);
    assert(ledger.items.some((row) => row.id === received.entries[0].id));
    assert.equal(ledger.summary.remaining, "79.90");
    await panel.getByLabel("Importo incasso 1", { exact: true }).fill("29.90");
    await panel
      .getByRole("button", {
        name: "Aggiungi metodo per pagamento misto",
        exact: true,
      })
      .click();
    await panel.getByLabel("Importo incasso 2", { exact: true }).fill("50");
    await panel
      .getByLabel("Metodo incasso 2", { exact: true })
      .selectOption("card");
    await panel
      .getByRole("button", { name: "Registra importi ricevuti", exact: true })
      .click();
    await panel
      .getByText("Operazione registrata. Gli incassi sono aggiornati.")
      .waitFor();
    ledger = await call(apiRoute);
    assert.equal(ledger.summary.status, "paid");
    assert.equal(ledger.items.length, 4);
    await panel.scrollIntoViewIfNeeded();
    fs.mkdirSync(".local/step10", { recursive: true, mode: 0o700 });
    await page.screenshot({
      path: qaArtifactPath(".local/step10/payments-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize(qaViewport({ width: 390, height: 844 }));
    await panel
      .getByLabel("Operazione incasso", { exact: true })
      .selectOption("refund");
    await panel.getByLabel("Importo incasso 1", { exact: true }).fill("5.10");
    await panel
      .getByLabel("Incasso originale 1", { exact: true })
      .selectOption(received.entries[0].id);
    await panel
      .getByLabel("Motivazione incasso", { exact: true })
      .fill("Rimborso manuale sintetico");
    await panel
      .getByRole("button", {
        name: "Registra rimborso effettuato",
        exact: true,
      })
      .click();
    await panel
      .getByText("Operazione registrata. Gli incassi sono aggiornati.")
      .waitFor();
    ledger = await call(apiRoute);
    assert.equal(ledger.summary.netReceived, "94.90");
    assert.equal(ledger.summary.remaining, "5.10");
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: qaArtifactPath(".local/step10/payments-mobile.png"),
      fullPage: true,
    });
    assert.equal(
      await panel.evaluate((node) => node.scrollWidth > node.clientWidth + 2),
      false,
      "Payment panel horizontal overflow",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 2,
      ),
      false,
      "Page horizontal overflow",
    );
    assert.deepEqual(
      page.viewportSize(),
      qaViewport({ width: 390, height: 844 }),
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      qaArtifactPath(".local/step10/payments-browser-result.json"),
      JSON.stringify(
        {
          viewportScenario: qaViewportName,
          checkedAt: new Date().toISOString(),
          identity: "isolated-synthetic-browser",
          database: health.database,
          providerCalls: false,
          checks: qaChecks([
            "explicit-legacy-opening-and-saved-account-balance",
            "lost-http-response-after-commit-reload-recovers-original-operation-once",
            "deposit-and-mixed-payment-in-same-account",
            "manual-refund-original-reference-and-residual",
            "desktop-and-mobile-no-horizontal-overflow",
          ]),
          screenshots: ["payments-desktop.png", "payments-mobile.png"],
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    console.log("PASS: payments browser, reload/replay and mobile");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
