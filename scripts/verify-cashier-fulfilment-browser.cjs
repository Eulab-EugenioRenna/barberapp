const {
  qaViewport,
  qaArtifactPath,
  qaViewportName,
  qaChecks,
} = require("./qa-viewport.cjs");
/** Browser -> real disposable API/SQL; no Connect identities, mail or payment providers. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { chromium, expect } = require(
  process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test",
);
(async () => {
  const base = "http://127.0.0.1:53027",
    health = await (await fetch(base + "/health")).json();
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  const source = JSON.parse(
    fs.readFileSync(
      ".local/step10/cashier-fulfilment-http-result.json",
      "utf8",
    ),
  );
  assert.equal(source.database, health.database);
  const fixture = source.fixture;
  async function call(route, body) {
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
  }
  const sql = (query) =>
    execFileSync(
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
      { input: query, stdio: "pipe" },
    )
      .toString()
      .trim();
  const offset = Number(
    sql(
      `SELECT count(*) FROM "Appointment" WHERE "serviceId"='${fixture.serviceIds[0]}'`,
    ),
  );
  const booking = await call("/appointments", {
    idempotencyKey: randomUUID(),
    customerId: "__http_customer",
    lines: fixture.serviceIds.slice(0, 2).map((serviceId, i) => ({
      serviceId,
      startsAt: new Date(
        Date.UTC(2041, 2, 4 + offset * 2, 10 + i),
      ).toISOString(),
      collaboratorId: fixture.plannedId,
    })),
  });
  let account = await call(`/sales/${booking.orderId}`);
  const stopped = account.items.find(
    (row) => row.serviceId === fixture.serviceIds[1],
  );
  assert.equal(stopped.booking.status, "confirmed");
  await call(`/appointments/${stopped.booking.id}/cancel`, {
    idempotencyKey: randomUUID(),
    revision: account.revision,
    reason: "Synthetic browser partial cancellation",
  });
  const services = (await call("/services")).items,
    products = (await call("/products")).items;
  const actor = await call(`/collaborators/${fixture.actualId}`);
  const actualLabel = `${actor.firstName} ${actor.lastName}`.trim();
  const serviceName = (id) => services.find((row) => row.id === id).name;
  const productName = products.find((row) => row.id === fixture.retailId).name;
  const browser = await chromium.launch({ headless: true }),
    checks = [];
  let page;
  try {
    page = await browser.newPage({
      viewport: qaViewport({ width: 1440, height: 1000 }),
      extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.87" },
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() =>
      localStorage.setItem("barber.session", "owner"),
    );
    const load = async () => {
      const url = "http://127.0.0.1:53028/admin/#/appointments";
      if (page.url() === url) await page.reload();
      else await page.goto(url);
      await page
        .getByRole("button", { name: "Lista appuntamenti", exact: true })
        .click();
    };
    const open = async (id = booking.id) => {
      await page.locator(`button[data-appointment-id="${id}"]`).click();
      const editor = page.getByRole("dialog").filter({
        has: page.getByRole("heading", {
          name: "Gestisci la prenotazione",
          exact: true,
        }),
      });
      await editor
        .getByRole("button", { name: "Chiudi il conto", exact: true })
        .click();
      const cashier = page.locator(".quick-order-overlay");
      await cashier.waitFor();
      return cashier;
    };
    await load();
    await page.locator(`button[data-appointment-id="${booking.id}"]`).click();
    let checkinEditor = page.getByRole("dialog").filter({
      has: page.getByRole("heading", {
        name: "Gestisci la prenotazione",
        exact: true,
      }),
    });
    await checkinEditor
      .getByRole("button", { name: "Torna al servizio", exact: true })
      .click();
    checkinEditor = page.getByRole("dialog");
    await checkinEditor
      .getByRole("combobox", { name: "Stato", exact: true })
      .click();
    await page
      .getByRole("listbox")
      .getByRole("option", { name: "Cliente arrivato", exact: true })
      .click();
    const checkinResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/appointments/${booking.id}`),
    );
    await checkinEditor
      .getByRole("button", { name: "Salva modifiche", exact: true })
      .click();
    const checked = await checkinResponse;
    assert.equal(checked.status(), 200, await checked.text());
    assert.equal(
      (await call(`/appointments/${booking.id}`)).status,
      "checked_in",
    );
    assert.equal(
      sql(
        `SELECT count(*) FROM "StockMovement" WHERE "saleId"='${account.id}'`,
      ),
      "0",
    );
    assert.equal((await call(`/sales/${account.id}/payments`)).items.length, 0);
    await checkinEditor.waitFor({ state: "hidden" });
    checks.push(
      "actual-editor-check-in-updates-only-the-scheduled-state-without-execution-stock-or-money",
    );
    await load();
    let cashier = await open();
    await expect(
      cashier.getByRole("combobox", {
        name: "Professionista per " + serviceName(fixture.serviceIds[0]),
        exact: true,
      }),
    ).toHaveText(/Non dichiarato/);
    const stoppedLine = cashier.locator(".cart-line").filter({
      has: page.getByText(serviceName(fixture.serviceIds[1]), {
        exact: true,
      }),
    });
    await expect(
      stoppedLine.getByText(
        "Servizio non eseguito. Non genera consumi o resi automatici.",
        { exact: true },
      ),
    ).toBeVisible();
    assert.equal(
      await stoppedLine
        .getByRole("combobox", { name: /^Professionista per / })
        .count(),
      0,
    );
    await expect(
      stoppedLine.getByRole("button", { name: "Rimuovi", exact: true }),
    ).toBeDisabled();
    await cashier
      .locator(".service-card")
      .filter({ hasText: serviceName(fixture.serviceIds[2]) })
      .click();
    await cashier
      .locator(".product-card")
      .filter({ hasText: productName })
      .click();
    await expect(
      cashier.getByRole("button", { name: "Registra vendita", exact: true }),
    ).toBeDisabled();
    await expect(
      cashier.getByRole("button", { name: "Salva conto aperto", exact: true }),
    ).toBeEnabled();
    await cashier
      .getByRole("button", { name: "Salva conto aperto", exact: true })
      .click();
    await cashier.waitFor({ state: "hidden" });
    account = await call(`/sales/${booking.orderId}`);
    assert.equal(account.orderStatus, "open");
    assert(
      account.items
        .filter((row) => row.serviceId)
        .every((row) => !row.collaboratorId),
    );
    assert.equal(
      sql(
        `SELECT count(*) FROM "StockMovement" WHERE "saleId"='${account.id}'`,
      ),
      "0",
    );
    checks.push(
      "open-counter-explicitly-retains-unknown-performers-added-service-and-retail-with-no-execution-or-stock",
    );
    await load();
    cashier = await open();
    let payments = cashier.locator("alora-account-payments");
    await payments.locator("summary").click();
    await payments.getByText("Totale del conto salvato").waitFor();
    const depositResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/sales/${account.id}/payments`),
    );
    await payments.getByLabel("Importo incasso 1", { exact: true }).fill("5");
    await payments
      .getByRole("button", { name: "Registra importi ricevuti", exact: true })
      .click();
    const depositAck = await depositResponse;
    assert.equal(depositAck.status(), 201, await depositAck.text());
    const deposit = await depositAck.json();
    await payments
      .getByText("Operazione registrata. Gli incassi sono aggiornati.", {
        exact: true,
      })
      .waitFor();
    assert.equal(deposit.summary.netReceived, "5.00");
    assert.equal(
      sql(
        `SELECT count(*) FROM "StockMovement" WHERE "saleId"='${account.id}'`,
      ),
      "0",
    );
    assert.equal((await call(`/sales/${account.id}`)).orderStatus, "open");
    checks.push(
      "actual-booked-account-deposit-before-completion-keeps-one-open-account-without-material-execution",
    );
    const selectActual = async (serviceId) => {
      await cashier
        .getByRole("combobox", {
          name: "Professionista per " + serviceName(serviceId),
          exact: true,
        })
        .click();
      await page
        .getByRole("listbox")
        .getByRole("option")
        .filter({ hasText: actualLabel })
        .click();
    };
    await selectActual(fixture.serviceIds[0]);
    await selectActual(fixture.serviceIds[2]);
    await expect(
      cashier.getByRole("button", { name: "Registra vendita", exact: true }),
    ).toBeDisabled();
    await cashier
      .locator('input[aria-label^="Motivo quota non eseguita"]')
      .fill("Explicit synthetic cancellation fee confirmed in browser");
    await expect(
      cashier.getByRole("button", { name: "Registra vendita", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: qaArtifactPath(".local/step10/cashier-fulfilment-desktop.png"),
    });
    const sent = [];
    let lose = true,
      ack;
    await page.route(`**/api/sales/${account.id}`, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      sent.push(route.request().postDataJSON());
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      if (lose) {
        lose = false;
        ack = await response.json();
        return route.abort("failed");
      }
      return route.fulfill({ response });
    });
    await cashier
      .getByRole("button", { name: "Registra vendita", exact: true })
      .click();
    const retry = cashier.getByRole("button", {
      name: "Verifica modifica precedente",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    await expect(
      cashier.locator('input[aria-label^="Motivo quota non eseguita"]'),
    ).toBeDisabled();
    const done = await call(`/sales/${account.id}`);
    assert.equal(done.orderStatus, "confirmed");
    const paidAtCompletion = await call(`/sales/${account.id}/payments`);
    assert.equal(paidAtCompletion.summary.netReceived, "5.00");
    assert.equal(paidAtCompletion.items.length, 1);
    checks.push(
      "completion-preserves-explicit-deposit-without-inventing-a-cash-settlement",
    );
    const stateBefore = sql(
      `SELECT json_build_array((SELECT count(*) FROM "Appointment" WHERE "orderItemId" IN (SELECT id FROM "SaleItem" WHERE "saleId"='${account.id}')),(SELECT count(*) FROM "StockMovement" WHERE "saleId"='${account.id}'),(SELECT count(*) FROM "OrderOperation" WHERE "saleId"='${account.id}'))`,
    );
    await page.setViewportSize(qaViewport({ width: 390, height: 844 }));
    await load();
    cashier = await open(stopped.booking.id);
    await expect(
      cashier.getByRole("button", {
        name: "Verifica modifica precedente",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      cashier.getByRole("button", { name: "Salva vendita", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: qaArtifactPath(
        ".local/step10/cashier-fulfilment-recovery-mobile.png",
      ),
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      ),
      false,
    );
    await cashier
      .getByRole("button", {
        name: "Verifica modifica precedente",
        exact: true,
      })
      .click();
    await cashier.waitFor({ state: "hidden" });
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1], sent[0]);
    assert.equal(ack.id, account.id);
    assert.equal(
      sql(
        `SELECT json_build_array((SELECT count(*) FROM "Appointment" WHERE "orderItemId" IN (SELECT id FROM "SaleItem" WHERE "saleId"='${account.id}')),(SELECT count(*) FROM "StockMovement" WHERE "saleId"='${account.id}'),(SELECT count(*) FROM "OrderOperation" WHERE "saleId"='${account.id}'))`,
      ),
      stateBefore,
    );
    checks.push(
      "checkout-requires-explicit-actual-performer-and-nonperformance-fee-declaration",
    );
    checks.push(
      "lost-update-response-freezes-inputs-and-recovers-exact-persisted-command-after-mobile-reload-from-another-service-of-the-same-account",
    );
    account = await call(`/sales/${account.id}`);
    const performed = account.items.find(
      (row) => row.serviceId === fixture.serviceIds[0],
    );
    assert.equal(performed.collaboratorId, fixture.actualId);
    assert.equal(performed.booking.collaboratorId, fixture.plannedId);
    assert.equal(
      account.items.find((row) => row.serviceId === fixture.serviceIds[2])
        .booking.status,
      "completed",
    );
    assert.equal(
      account.items.find((row) => row.id === stopped.id).booking.status,
      "cancelled",
    );
    await load();
    cashier = await open();
    const activeLine = cashier.locator(".cart-line").filter({
      has: page.getByText(serviceName(fixture.serviceIds[0]), {
        exact: true,
      }),
    });
    await expect(
      activeLine.getByRole("combobox", { name: /^Professionista per / }),
    ).toContainText(actualLabel);
    await expect(
      cashier.getByRole("button", { name: "Salva vendita", exact: true }),
    ).toBeEnabled();
    await activeLine.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: qaArtifactPath(
        ".local/step10/cashier-fulfilment-completed-mobile.png",
      ),
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      ),
      false,
    );
    payments = cashier.locator("alora-account-payments");
    await payments.locator("summary").click();
    await payments.getByText("Totale del conto salvato").waitFor();
    const originalStockCount = sql(
      `SELECT count(*) FROM "StockMovement" WHERE "saleId"='${account.id}'`,
    );
    const originalRows = sql(
      `SELECT string_agg(id,',' ORDER BY id) FROM "SaleItem" WHERE "saleId"='${account.id}'`,
    );
    let paymentResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/sales/${account.id}/payments`),
    );
    await payments.getByLabel("Importo incasso 1", { exact: true }).fill("20");
    await payments
      .getByRole("button", {
        name: "Aggiungi metodo per pagamento misto",
        exact: true,
      })
      .click();
    await payments.getByLabel("Importo incasso 2", { exact: true }).fill("25");
    await payments
      .getByLabel("Metodo incasso 2", { exact: true })
      .selectOption("card");
    await payments
      .getByRole("button", { name: "Registra importi ricevuti", exact: true })
      .click();
    let paymentAck = await paymentResponse;
    assert.equal(paymentAck.status(), 201, await paymentAck.text());
    let paymentResult = await paymentAck.json();
    assert.equal(paymentResult.summary.netReceived, "50.00");
    assert.equal(paymentResult.summary.remaining, "0.00");
    await expect(
      payments
        .locator(".balance > div")
        .filter({ has: page.getByText("Residuo", { exact: true }) })
        .locator("dd"),
    ).toContainText("0.00");
    await expect(
      payments.getByText(
        "Operazione registrata. Gli incassi sono aggiornati.",
        { exact: true },
      ),
    ).toBeVisible();
    await payments
      .getByLabel("Operazione incasso", { exact: true })
      .selectOption("refund");
    await payments.getByLabel("Importo incasso 1", { exact: true }).fill("5");
    await payments
      .getByLabel("Incasso originale 1", { exact: true })
      .selectOption(deposit.entries[0].id);
    await payments
      .getByLabel("Motivazione incasso", { exact: true })
      .fill("Explicit synthetic refund of original tablet deposit");
    paymentResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/sales/${account.id}/payments`),
    );
    await payments
      .getByRole("button", {
        name: "Registra rimborso effettuato",
        exact: true,
      })
      .click();
    paymentAck = await paymentResponse;
    assert.equal(paymentAck.status(), 201, await paymentAck.text());
    paymentResult = await paymentAck.json();
    assert.equal(paymentResult.summary.netReceived, "45.00");
    assert.equal(paymentResult.summary.remaining, "5.00");
    await expect(
      payments.getByText(
        "Operazione registrata. Gli incassi sono aggiornati.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      payments
        .locator(".balance > div")
        .filter({ has: page.getByText("Residuo", { exact: true }) })
        .locator("dd"),
    ).toContainText("5.00");
    assert.equal(
      sql(
        `SELECT count(*) FROM "StockMovement" WHERE "saleId"='${account.id}'`,
      ),
      originalStockCount,
    );
    assert.equal(
      sql(
        `SELECT string_agg(id,',' ORDER BY id) FROM "SaleItem" WHERE "saleId"='${account.id}'`,
      ),
      originalRows,
    );
    assert.equal((await call(`/sales/${account.id}`)).orderStatus, "confirmed");
    checks.push(
      "actual-booked-account-mixed-cash-card-settlement-and-original-deposit-refund-preserve-order-lines-performers-and-material-movements",
    );
    await page.screenshot({
      path: qaArtifactPath(".local/step10/cashier-fulfilment-payments.png"),
    });
    assert.deepEqual(
      page.viewportSize(),
      qaViewport({ width: 390, height: 844 }),
    );
    assert.deepEqual(errors, []);
    checks.push(
      "completed-counter-displays-actual-distinct-from-planned-actor-and-preserves-cancelled-row-mobile-without-overflow",
    );
    const result = {
      viewportScenario: qaViewportName,
      checkedAt: new Date().toISOString(),
      database: health.database,
      checks: qaChecks(checks),
    };
    fs.writeFileSync(
      qaArtifactPath(".local/step10/cashier-fulfilment-browser-result.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (page) {
      fs.writeFileSync(
        qaArtifactPath(".local/step10/cashier-browser-failure.txt"),
        await page.locator("body").innerText(),
      );
      await page.screenshot({
        path: qaArtifactPath(".local/step10/cashier-browser-failure.png"),
      });
    }
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
