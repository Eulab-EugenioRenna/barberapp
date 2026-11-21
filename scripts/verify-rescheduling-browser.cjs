/** Real browser drag/drop -> disposable API/SQL; no Connect identities or providers. */
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
  const source = JSON.parse(
    fs.readFileSync(".local/step10/rescheduling-http-result.json", "utf8"),
  );
  assert.equal(source.database, health.database);
  const f = source.fixture;
  async function call(route, body, method) {
    const r = await fetch(base + route, {
      method: method || (body ? "POST" : "GET"),
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
  const sql = (q) =>
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
      { input: q, stdio: "pipe" },
    )
      .toString()
      .trim();
  const now = new Date(),
    monday = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - ((now.getUTCDay() + 6) % 7),
      ),
    ),
    day = new Date(monday.getTime() + 2 * 86400000).toISOString().slice(0, 10),
    next = new Date(monday.getTime() + 3 * 86400000).toISOString().slice(0, 10),
    last = new Date(monday.getTime() + 4 * 86400000).toISOString().slice(0, 10);
  for (const id of [f.personId, f.otherId])
    await call(
      `/collaborators/${id}`,
      {
        weeklySchedules: Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          isWorkingDay: true,
          startTime: "09:00",
          endTime: "19:00",
        })),
      },
      "PATCH",
    );
  const booking = await call("/appointments", {
    idempotencyKey: randomUUID(),
    customerId: "__http_customer",
    lines: [
      {
        serviceId: f.firstServiceId,
        collaboratorId: f.personId,
        roomId: f.roomA,
        startsAt: day + "T09:07:00.123Z",
      },
      {
        serviceId: f.secondServiceId,
        collaboratorId: f.personId,
        roomId: f.roomB,
        startsAt: day + "T11:00:00Z",
      },
    ],
  });
  const id = booking.id,
    route = `/appointments/${id}`,
    before = await call(route + "/order"),
    sibling = before.appointments.find((row) => row.id !== id);
  const counts = () =>
      sql(
        `SELECT json_build_array((SELECT count(*) FROM "Sale" WHERE id='${booking.orderId}'),(SELECT count(*) FROM "SaleItem" WHERE "saleId"='${booking.orderId}'),(SELECT count(*) FROM "Appointment" WHERE "orderItemId" IN (SELECT id FROM "SaleItem" WHERE "saleId"='${booking.orderId}')),(SELECT count(*) FROM "PaymentEntry" WHERE "saleId"='${booking.orderId}'),(SELECT count(*) FROM "StockMovement" WHERE "saleId"='${booking.orderId}'))`,
      ),
    originalCounts = counts();
  const browser = await chromium.launch({ headless: true }),
    checks = [];
  let page;
  try {
    page = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
      timezoneId: "Europe/Rome",
      extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.89" },
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() =>
      localStorage.setItem("barber.session", "owner"),
    );
    const requests = [];
    let lose = true;
    await page.route(`**/api/appointments/${id}`, async (interception) => {
      if (interception.request().method() !== "PATCH")
        return interception.continue();
      const response = await interception.fetch(),
        entry = {
          body: interception.request().postDataJSON(),
          headers: Object.fromEntries(
            Object.entries(interception.request().headers()).filter(([key]) =>
              key.startsWith("x-alora-"),
            ),
          ),
          status: response.status(),
        };
      requests.push(entry);
      if (lose && response.status() === 200) {
        lose = false;
        return interception.abort("failed");
      }
      return interception.fulfill({ response });
    });
    await page.goto("http://127.0.0.1:53028/admin/#/appointments");
    const week = async () => {
      await page
        .getByRole("button", { name: "Settimana", exact: true })
        .click();
    };
    const card = () =>
      page.locator(
        `barber-admin-appointments-calendar button[data-appointment-id="${id}"]`,
      );
    const dropWeek = async (date) => {
      await week();
      await card().waitFor();
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
      await card().dispatchEvent("dragstart", { dataTransfer });
      await page
        .locator(`.calendar-week-day-card[data-date="${date}"]`)
        .dispatchEvent("drop", { dataTransfer });
      return page.getByRole("dialog").filter({
        has: page.getByRole("heading", {
          name: "Scegli il nuovo orario",
          exact: true,
        }),
      });
    };
    let modal = await dropWeek(next);
    await expect(
      modal.getByRole("button", { name: "Conferma", exact: true }),
    ).toBeEnabled();
    await expect(
      modal.getByRole("combobox", { name: "Orario", exact: true }),
    ).toContainText(
      new Intl.DateTimeFormat("it-IT", {
        timeZone: "Europe/Rome",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(day + "T09:07:00.123Z")),
    );
    await modal
      .getByRole("combobox", { name: "Professionista", exact: true })
      .click();
    await page
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: "Nessuna preferenza" })
      .click();
    await expect(
      modal.getByRole("button", { name: "Conferma", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: ".local/step10/rescheduling-server-slots-desktop.png",
    });
    await modal.getByRole("button", { name: "Conferma", exact: true }).click();
    await expect(
      modal.getByRole("button", {
        name: "Verifica spostamento precedente",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      modal.getByRole("button", { name: "Conferma", exact: true }),
    ).toBeDisabled();
    await expect(modal.locator(".calendar-trigger")).toBeDisabled();
    let saved = await call(route);
    assert.equal(saved.startsAt, next + "T09:07:00.123Z");
    assert.equal(
      Date.parse(saved.endsAt) - Date.parse(saved.startsAt),
      3600000,
    );
    assert([f.personId, f.otherId].includes(saved.collaboratorId));
    assert.equal(
      sql(
        `SELECT "collaboratorId" IS NULL FROM "SaleItem" WHERE id='${saved.orderItemId}'`,
      ),
      "t",
    );
    checks.push(
      "actual-week-drag-uses-server-slots-preserves-milliseconds-and-duration-and-reserves-real-staff-for-no-preference-without-declaring-actual-execution",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const retry = page.getByRole("button", {
      name: "Verifica spostamento precedente",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    await retry.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: ".local/step10/rescheduling-recovery-mobile.png",
    });
    await retry.click();
    await expect(retry).toHaveCount(0);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].body, requests[0].body);
    assert.deepEqual(requests[1].headers, requests[0].headers);
    assert.equal(counts(), originalCounts);
    assert.deepEqual(
      (await call(route + "/order")).appointments.find(
        (row) => row.id === sibling.id,
      ),
      sibling,
    );
    checks.push(
      "lost-single-move-response-after-commit-recovers-identical-command-and-scope-after-mobile-reload-without-duplicating-booking-account-rows-or-money",
    );
    await page.setViewportSize({ width: 1440, height: 1050 });
    await week();
    await page
      .locator(`.calendar-week-day-card[data-date="${next}"] header`)
      .click();
    await page.getByRole("button", { name: "Giorno", exact: true }).click();
    saved = await call(route);
    const destination =
      saved.collaboratorId === f.personId ? f.otherId : f.personId;
    await card().waitFor();
    const target = page.locator(
      `.calendar-day-track[data-collaborator-id="${destination}"]`,
    );
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    assert(box);
    const dayTransfer = await page.evaluateHandle(() => new DataTransfer());
    await card().dispatchEvent("dragstart", { dataTransfer: dayTransfer });
    const dayResponse = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        r.url().endsWith(`/appointments/${id}`),
    );
    await target.dispatchEvent("drop", {
      dataTransfer: dayTransfer,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height * 0.525,
    });
    assert.equal((await dayResponse).status(), 200);
    await expect
      .poll(async () => (await call(route)).collaboratorId)
      .toBe(destination);
    saved = await call(route);
    assert.equal(
      saved.startsAt,
      await page.evaluate(
        (date) => new Date(date + "T14:00:00").toISOString(),
        next,
      ),
    );
    assert.equal(saved.roomId, f.roomA);
    assert.equal(
      Date.parse(saved.endsAt) - Date.parse(saved.startsAt),
      3600000,
    );
    assert.deepEqual(
      (await call(route + "/order")).appointments.find(
        (row) => row.id === sibling.id,
      ),
      sibling,
    );
    assert.equal(counts(), originalCounts);
    checks.push(
      "actual-day-drag-reassigns-only-target-planned-professional-and-keeps-room-account-line-duration-sibling-and-ledger",
    );
    await page
      .getByRole("button", { name: "Lista appuntamenti", exact: true })
      .click();
    await page.locator(`button[data-appointment-id="${id}"]`).click();
    let editor = page.getByRole("dialog");
    await editor
      .getByRole("button", { name: "Torna al servizio", exact: true })
      .click();
    await editor
      .getByRole("heading", { name: "Aggiorna appuntamento", exact: true })
      .waitFor();
    const exactBefore = (await call(route)).startsAt;
    await editor
      .locator('textarea[name="appointmentCustomerNotes"]')
      .fill("Explicit legacy editor correction");
    lose = true;
    await editor
      .getByRole("button", { name: "Salva modifiche", exact: true })
      .click();
    await expect(
      editor.getByRole("button", {
        name: "Verifica spostamento precedente",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      editor.locator('textarea[name="appointmentCustomerNotes"]'),
    ).toBeDisabled();
    await editor
      .getByRole("button", {
        name: "Verifica spostamento precedente",
        exact: true,
      })
      .click();
    await editor.waitFor({ state: "hidden" });
    assert.deepEqual(requests[4].body, requests[3].body);
    assert.equal((await call(route)).startsAt, exactBefore);
    assert.equal(
      (await call(route)).customerNotes,
      "Explicit legacy editor correction",
    );
    assert.equal(counts(), originalCounts);
    checks.push(
      "legacy-editor-uses-same-recovery-command-freezes-unknown-update-and-recovers-without-altering-calendar-or-common-customer",
    );
    await page.getByRole("button", { name: "Calendario", exact: true }).click();
    modal = await dropWeek(last);
    await expect(
      modal.getByRole("button", { name: "Conferma", exact: true }),
    ).toBeEnabled();
    const latest = await call(route);
    await call(
      route,
      {
        idempotencyKey: randomUUID(),
        revision: latest.orderItem.sale.revision,
        customerNotes: "Concurrent synthetic correction",
      },
      "PATCH",
    );
    const stale = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        r.url().endsWith(`/appointments/${id}`),
    );
    await modal.getByRole("button", { name: "Conferma", exact: true }).click();
    assert.equal((await stale).status(), 409);
    await expect(modal).toContainText("Il conto è cambiato");
    assert.equal((await call(route)).startsAt, exactBefore);
    assert.equal(
      (await call(route)).customerNotes,
      "Concurrent synthetic correction",
    );
    assert.equal(
      await modal
        .getByRole("button", {
          name: "Verifica spostamento precedente",
          exact: true,
        })
        .count(),
      0,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: ".local/step10/rescheduling-stale-mobile.png",
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 2,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    checks.push(
      "stale-quick-move-revision-is-rejected-without-overwriting-concurrent-correction-or-silently-refreshing-intent",
    );
    const result = {
      checkedAt: new Date().toISOString(),
      database: health.database,
      identity: "isolated-synthetic-browser",
      providerCalls: false,
      checks,
      screenshots: [
        "rescheduling-server-slots-desktop.png",
        "rescheduling-recovery-mobile.png",
        "rescheduling-stale-mobile.png",
      ],
    };
    fs.writeFileSync(
      ".local/step10/rescheduling-browser-result.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (page) {
      fs.writeFileSync(
        ".local/step10/rescheduling-browser-failure.txt",
        await page.locator("body").innerText(),
      );
      await page.screenshot({
        path: ".local/step10/rescheduling-browser-failure.png",
      });
    }
    throw error;
  } finally {
    await browser.close();
    const latest = await call(route + "/order");
    if (
      latest.appointments.some(
        (row) => !["cancelled", "no_show", "completed"].includes(row.status),
      )
    )
      await call(route + "/order/cancel", {
        idempotencyKey: randomUUID(),
        revision: latest.revision,
        reason: "Release owned synthetic drag-and-drop fixture",
      });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
