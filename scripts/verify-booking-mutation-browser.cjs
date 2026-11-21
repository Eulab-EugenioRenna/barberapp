const {
  qaViewport,
  qaArtifactPath,
  qaViewportName,
  qaChecks,
} = require("./qa-viewport.cjs");
/** Actual disposable API/SQL and fresh browser storage; no provider or real identity. */
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
  const fixture = JSON.parse(
    fs.readFileSync(".local/step10/booking-mutation-http-result.json", "utf8"),
  ).fixture;
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
  const booking = await call("/appointments", {
    idempotencyKey: randomUUID(),
    customerId: "__http_customer",
    lines: [
      { serviceId: fixture.firstServiceId, startsAt: "2039-03-04T10:00:00Z" },
      { serviceId: fixture.secondServiceId, startsAt: "2039-03-04T11:00:00Z" },
    ],
  });
  await call(`/sales/${booking.orderId}/payments`, {
    idempotencyKey: randomUUID(),
    revision: booking.orderRevision,
    kind: "receive",
    entries: [{ amount: "4.00", method: "cash" }],
  });
  const browser = await chromium.launch({ headless: true }),
    checks = [];
  try {
    const page = await browser.newPage({
      viewport: qaViewport({ width: 1440, height: 1000 }),
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() =>
      localStorage.setItem("barber.session", "owner"),
    );
    const requests = [];
    let dropRevision = true,
      revisionAck;
    await page.route("**/api/appointments/*/order", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      requests.push({
        url: route.request().url(),
        body: route.request().postDataJSON(),
      });
      const response = await route.fetch();
      assert.equal(response.status(), 200, await response.text());
      if (dropRevision) {
        dropRevision = false;
        revisionAck = await response.json();
        return route.abort("failed");
      }
      return route.fulfill({ response });
    });
    const list = async () => {
      await page
        .getByRole("button", { name: "Lista appuntamenti", exact: true })
        .click();
    };
    const open = async (id) => {
      await page.locator(`button[data-appointment-id="${id}"]`).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("heading", { name: "Gestisci la prenotazione", exact: true })
        .waitFor();
      return dialog;
    };
    await page.goto("http://127.0.0.1:53028/admin/#/appointments");
    await list();
    let editor = await open(booking.id);
    await editor
      .getByLabel("Inizio servizio 1", { exact: true })
      .fill("2039-03-04T12:00");
    await editor
      .getByLabel("Inizio servizio 2", { exact: true })
      .fill("2039-03-04T11:00");
    await editor
      .getByRole("combobox", {
        name: "Aggiungi un servizio alla prenotazione",
        exact: true,
      })
      .click();
    const thirdName = (await call("/services")).items.find(
      (row) => row.id === fixture.thirdServiceId,
    ).name;
    await page
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: thirdName })
      .click();
    await editor
      .getByRole("button", { name: "Ricalcola orari in sequenza", exact: true })
      .click();
    const previewResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/order/preview"),
    );
    await editor
      .getByRole("button", { name: "Verifica disponibilità", exact: true })
      .click();
    assert.equal((await previewResponse).status(), 201);
    await editor
      .getByRole("article", { name: "Disponibilità verificata" })
      .waitFor();
    const economic = editor.getByRole("article", {
      name: "Anteprima conto",
      exact: true,
    });
    await expect(economic).toContainText("Totale conto");
    await expect(economic).toContainText(
      /Incasso netto già registrato €4[.,]00/,
    );
    await expect(economic).toContainText("Residuo della proposta");
    await page.screenshot({
      path: qaArtifactPath(".local/step10/booking-mutation-desktop.png"),
    });
    await economic.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: qaArtifactPath(".local/step10/booking-economics-desktop.png"),
    });
    await editor
      .getByRole("button", { name: "Salva intera prenotazione", exact: true })
      .click();
    await expect(
      editor.getByRole("button", {
        name: "Verifica modifica precedente",
        exact: true,
      }),
    ).toBeEnabled();
    assert(revisionAck);
    assert.equal(revisionAck.appointments.length, 3);
    assert(
      await editor
        .getByLabel("Inizio servizio 1", { exact: true })
        .isDisabled(),
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.lines.length, 3);
    assert(!("collaboratorId" in requests[0].body.lines[2]));
    await page.reload();
    await list();
    editor = await open(booking.appointments[1].id);
    const recovered = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith("/order"),
    );
    await editor
      .getByRole("button", {
        name: "Verifica modifica precedente",
        exact: true,
      })
      .click();
    const response = await recovered;
    assert.equal(response.status(), 200);
    assert.deepEqual(await response.json(), revisionAck);
    await editor.waitFor({ state: "hidden" });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    let account = await call(`/sales/for-appointment/${booking.id}`);
    assert.equal(account.items.length, 3);
    assert.equal(account.total, "25.2");
    assert(account.items.every((row) => !row.collaboratorId));
    assert.equal(
      (await call(`/sales/${booking.orderId}/payments`)).items.length,
      1,
    );
    checks.push(
      "whole-booking-editor-validates-and-appends-service-with-existing-deposit-and-no-actual-performer-inference",
    );
    checks.push(
      "lost-revision-response-after-commit-reloads-from-another-service-and-recovers-identical-anchor-command-and-row-ids",
    );
    await page.setViewportSize(qaViewport({ width: 390, height: 844 }));
    editor = await open(booking.id);
    await editor
      .getByLabel("Motivo annullamento prenotazione", { exact: true })
      .fill(
        "Synthetic whole-booking cancellation without automatic refund or physical stock return",
      );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      ),
      false,
    );
    let cancellationAck,
      dropCancellation = true;
    const cancellations = [];
    await page.route("**/api/appointments/*/order/cancel", async (route) => {
      cancellations.push(route.request().postDataJSON());
      const response = await route.fetch();
      assert.equal(response.status(), 201, await response.text());
      if (dropCancellation) {
        dropCancellation = false;
        cancellationAck = await response.json();
        return route.abort("failed");
      }
      return route.fulfill({ response });
    });
    await editor
      .getByRole("button", {
        name: "Annulla tutta la prenotazione",
        exact: true,
      })
      .click();
    await expect(
      editor.getByRole("button", {
        name: "Verifica modifica precedente",
        exact: true,
      }),
    ).toBeEnabled();
    assert(cancellationAck);
    assert.equal(cancellationAck.cancelledAppointmentIds.length, 3);
    await page.reload();
    await list();
    editor = await open(booking.appointments[1].id);
    const cancelReplay = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/order/cancel"),
    );
    await editor
      .getByRole("button", {
        name: "Verifica modifica precedente",
        exact: true,
      })
      .click();
    const replay = await cancelReplay;
    assert.deepEqual(await replay.json(), cancellationAck);
    assert.deepEqual(cancellations, [cancellations[0], cancellations[0]]);
    await editor.waitFor({ state: "hidden" });
    account = await call(`/sales/for-appointment/${booking.id}`);
    assert.equal(account.orderStatus, "cancelled");
    assert.equal(account.total, "25.2");
    assert.equal(account.items.length, 3);
    const ledger = await call(`/sales/${booking.orderId}/payments`);
    assert.equal(ledger.items.length, 1);
    assert.equal(ledger.summary.refunds, "0.00");
    const free = await call("/public/__http_a/availability", {
      lines: [{ serviceId: fixture.firstServiceId }],
      date: "2039-03-04",
    });
    assert(
      free.slots.some(
        (row) =>
          row.startsAt ===
          revisionAck.appointments.find((row) => row.id === booking.id)
            .startsAt,
      ),
    );
    checks.push(
      "mobile-cancellation-recovers-after-lost-response-releases-resources-and-preserves-all-service-rows-and-deposit",
    );
    editor = await open(booking.id);
    await editor
      .getByRole("button", { name: "Apri conto", exact: true })
      .click();
    const cashier = page.locator(".quick-order-overlay");
    await cashier
      .getByRole("heading", { name: "Conto conservato", exact: true })
      .waitFor();
    assert.equal(
      await cashier
        .getByRole("button", { name: "Registra vendita", exact: true })
        .count(),
      0,
    );
    const payments = cashier.locator("alora-account-payments");
    await payments.locator("summary").click();
    await payments
      .getByText("Differenza rispetto al valore originario", { exact: true })
      .waitFor();
    assert.equal(
      await payments
        .getByLabel("Operazione incasso", { exact: true })
        .inputValue(),
      "refund",
    );
    assert.equal(
      await payments
        .getByLabel("Operazione incasso", { exact: true })
        .locator('option[value="receive"]')
        .count(),
      0,
    );
    await payments
      .getByLabel("Importo incasso 1", { exact: true })
      .fill("4.00");
    await payments
      .getByLabel("Incasso originale 1", { exact: true })
      .selectOption(ledger.items[0].id);
    await payments
      .getByLabel("Motivazione incasso", { exact: true })
      .fill("Explicit synthetic refund of original deposit after cancellation");
    const recordRefund = payments.getByRole("button", {
      name: "Registra rimborso effettuato",
      exact: true,
    });
    await expect(recordRefund).toBeEnabled();
    await recordRefund.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: qaArtifactPath(".local/step10/booking-refund-before-submit.png"),
    });
    const [refund] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/sales/${booking.orderId}/payments`),
      ),
      recordRefund.click(),
    ]);
    assert.equal(refund.status(), 201, await refund.text());
    await payments
      .getByText("Operazione registrata. Gli incassi sono aggiornati.")
      .waitFor();
    const final = await call(`/sales/${booking.orderId}/payments`);
    assert.equal(final.summary.refunds, "4.00");
    assert.equal(final.summary.netReceived, "0.00");
    assert.equal(
      (await call(`/sales/for-appointment/${booking.id}`)).orderStatus,
      "cancelled",
    );
    await payments.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: qaArtifactPath(
        ".local/step10/booking-cancelled-account-mobile.png",
      ),
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    checks.push(
      "cancelled-account-is-read-only-and-offers-an-explicit-linked-refund-without-new-receipts-or-reopening",
    );
    const exactStart = "2039-03-05T10:15:32.125Z";
    const precise = await call("/appointments", {
      idempotencyKey: randomUUID(),
      customerId: "__http_customer",
      serviceId: fixture.firstServiceId,
      startsAt: exactStart,
    });
    try {
      await page.reload();
      await list();
      editor = await open(precise.id);
      const preciseResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().endsWith(`/appointments/${precise.id}/order`),
      );
      await editor
        .getByRole("button", { name: "Salva intera prenotazione", exact: true })
        .click();
      const preciseSaved = await preciseResponse;
      assert.equal(preciseSaved.status(), 200);
      const preciseResult = await preciseSaved.json();
      assert.equal(
        preciseSaved.request().postDataJSON().lines[0].startsAt,
        new Date(exactStart).toISOString(),
      );
      assert.equal(
        preciseResult.appointments[0].startsAt,
        new Date(exactStart).toISOString(),
      );
      await editor.waitFor({ state: "hidden" });
      checks.push(
        "unchanged-booking-edit-keeps-non-grid-seconds-and-milliseconds-without-silently-shifting-the-original-instant",
      );
    } finally {
      const latest = await call(`/appointments/${precise.id}/order`);
      await call(`/appointments/${precise.id}/order/cancel`, {
        idempotencyKey: randomUUID(),
        revision: latest.revision,
        reason:
          "Release exact-time synthetic browser fixture after verification",
      });
    }
    const restrictedBooking = await call("/appointments", {
      idempotencyKey: randomUUID(),
      customerId: "__http_customer",
      lines: [
        { serviceId: fixture.firstServiceId, startsAt: "2044-01-04T10:00:00Z" },
        {
          serviceId: fixture.secondServiceId,
          startsAt: "2044-01-04T11:00:00Z",
        },
      ],
    });
    const scheduler = await browser.newPage({
      viewport: qaViewport({ width: 1280, height: 720 }),
      extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.88" },
    });
    const schedulerResponses = [];
    scheduler.on("response", async (response) => {
      if (!response.url().includes("/api/appointments")) return;
      schedulerResponses.push({
        url: response.url(),
        status: response.status(),
        body: await response.json().catch(() => null),
      });
    });
    try {
      const schedulerErrors = [];
      scheduler.on("pageerror", (error) => schedulerErrors.push(error.message));
      await scheduler.addInitScript(() =>
        localStorage.setItem("barber.session", "scheduler"),
      );
      await scheduler.goto("http://127.0.0.1:53028/admin/#/appointments");
      await scheduler
        .getByRole("button", { name: "Lista appuntamenti", exact: true })
        .click();
      await scheduler
        .locator(`button[data-appointment-id="${restrictedBooking.id}"]`)
        .click();
      const restrictedEditor = scheduler.getByRole("dialog");
      await restrictedEditor
        .getByRole("heading", { name: "Gestisci la prenotazione", exact: true })
        .waitFor();
      assert.equal(
        await restrictedEditor
          .getByRole("button", { name: "Chiudi il conto", exact: true })
          .count(),
        0,
      );
      const resourcePreview = scheduler.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/order/preview"),
      );
      await restrictedEditor
        .getByRole("button", { name: "Verifica disponibilità", exact: true })
        .click();
      const resourceResponse = await resourcePreview;
      assert.equal(resourceResponse.status(), 201);
      assert.equal("economics" in (await resourceResponse.json()), false);
      await restrictedEditor
        .getByRole("article", { name: "Disponibilità verificata", exact: true })
        .waitFor();
      assert.equal(
        await restrictedEditor
          .getByRole("article", { name: "Anteprima conto", exact: true })
          .count(),
        0,
      );
      await expect(restrictedEditor).toContainText(
        "Per vedere importi e residuo occorre l'accesso alla cassa.",
      );
      assert.deepEqual(schedulerErrors, []);
      await scheduler.screenshot({
        path: qaArtifactPath(
          ".local/step10/booking-preview-without-financial-grant.png",
        ),
      });
      checks.push(
        "scheduling-grant-without-sales-read-can-preview-resources-without-receiving-or-rendering-financial-summary",
      );
    } catch (error) {
      fs.writeFileSync(
        qaArtifactPath(".local/step10/booking-mutation-scheduler-failure.json"),
        JSON.stringify(
          {
            target: restrictedBooking.id,
            responses: schedulerResponses,
            text: await scheduler.locator("body").innerText(),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      throw error;
    } finally {
      await scheduler.close();
      const latest = await call(`/appointments/${restrictedBooking.id}/order`);
      await call(`/appointments/${restrictedBooking.id}/order/cancel`, {
        idempotencyKey: randomUUID(),
        revision: latest.revision,
        reason: "Release restricted-preview synthetic fixture",
      });
    }
    fs.writeFileSync(
      qaArtifactPath(".local/step10/booking-mutation-browser-result.json"),
      JSON.stringify(
        {
          viewportScenario: qaViewportName,
          database: health.database,
          checkedAt: new Date().toISOString(),
          identity: "isolated-synthetic-browser",
          providerCalls: false,
          checks: qaChecks(checks),
          screenshots: [
            "booking-mutation-desktop.png",
            "booking-cancelled-account-mobile.png",
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
