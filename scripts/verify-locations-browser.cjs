/* Run against verify-locations-http.mjs --browser. Uses synthetic QA data only. */
const { createRequire } = require("node:module");
const { resolve } = require("node:path");
const fs = require("node:fs");
const { chromium } = createRequire(
  process.env.ALORA_PLAYWRIGHT_PACKAGE_JSON || resolve("package.json"),
)(process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test");
(async () => {
  const health = await (await fetch("http://127.0.0.1:53027/health")).json();
  if (!health.testOnly || !/^step7_http_\d+$/.test(health.database))
    throw Error("Requires isolated QA database");
  const context = await (
    await fetch("http://127.0.0.1:53027/locations/context", {
      headers: { Authorization: "Bearer owner" },
    })
  ).json();
  const initial = context.find((row) => row.name === "Collaudo Studio");
  if (!initial) throw Error("Missing initial synthetic location");
  const sectorName = "Percorsi corpo " + Date.now();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: { "X-Forwarded-For": "198.51.100.70" },
    });
    page.setDefaultTimeout(10000);
    await page.addInitScript(() =>
      localStorage.setItem("barber.session", "owner"),
    );
    await page.goto("http://127.0.0.1:53028/admin/#/locations");
    await page.getByText("Studio sul porto", { exact: true }).waitFor();
    await page.screenshot({
      path: ".local/step7/locations-desktop.png",
      fullPage: true,
    });
    const location = page.locator(".location-card").filter({
      has: page.getByRole("heading", {
        name: "Studio sul porto",
        exact: true,
      }),
    });
    await location
      .getByLabel("Nuovo settore", { exact: true })
      .fill(sectorName);
    await location
      .locator("form.inline-form")
      .last()
      .getByRole("button", { name: "Aggiungi", exact: true })
      .click();
    const sector = page.locator(".sector-card").filter({
      has: page.getByRole("heading", { name: sectorName, exact: true }),
    });
    await sector
      .getByRole("heading", { name: sectorName, exact: true })
      .waitFor();
    await sector
      .getByLabel("Nome della risorsa", { exact: true })
      .fill("Lettino");
    await sector.getByRole("button", { name: "Aggiungi", exact: true }).click();
    await sector
      .getByText("Lettino · capienza 1 · interno", { exact: true })
      .waitFor();
    await sector
      .getByRole("button", { name: "Abilita online", exact: true })
      .click();
    await sector
      .getByText("Lettino · capienza 1 · online e interno", { exact: true })
      .waitFor();
    await sector.getByRole("button", { name: "Configura settore" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Usa gli orari della sede").uncheck();
    await dialog.getByLabel("Lunedì", { exact: true }).check();
    await dialog.getByLabel("Apertura Lunedì").fill("10:00");
    await dialog.getByLabel("Chiusura Lunedì").fill("18:00");
    await dialog.getByLabel("Giorni di chiusura").fill("2030-11-25");
    await dialog.getByRole("button", { name: "Salva configurazione" }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByText("Configurazione salvata.", { exact: true }).waitFor();
    const professional = page.locator(".professional-row").filter({
      has: page.getByRole("heading", { name: "Anna Prova", exact: true }),
    });
    await professional
      .getByLabel("Studio sul porto · " + sectorName, { exact: true })
      .check();
    await professional
      .getByRole("button", { name: "Salva appartenenze" })
      .click();
    await sector.getByText("Anna Prova", { exact: true }).waitFor();
    const visibility = page.locator(".visibility-row").filter({
      has: page.getByRole("heading", {
        name: "Collaudo manager",
        exact: true,
      }),
    });
    await visibility
      .getByLabel("Studio sul porto · Consulenze", { exact: true })
      .check();
    await visibility.getByRole("button", { name: "Salva visibilità" }).click();
    await page.getByText("Configurazione salvata.", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: ".local/step7/locations-mobile.png",
      fullPage: true,
    });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error("Mobile overflow");
    await page.goto("http://127.0.0.1:53028/booking/__http_a");
    await page.getByLabel("Sede della prenotazione").waitFor();
    await page.getByLabel("Sede della prenotazione").selectOption(initial.id);
    await page
      .getByLabel("Settore della prenotazione")
      .selectOption({ label: "Laboratorio" });
    await page
      .getByRole("button")
      .filter({ hasText: "Percorso autonomo" })
      .click();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await page
      .locator(
        `button[data-date="${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}"]`,
      )
      .last()
      .click();
    await page.getByLabel("Nome e cognome").fill("Collaudo percorso autonomo");
    const bookingResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/bookings") &&
        response.request().method() === "POST",
    );
    await page.locator("button[type=submit]").click();
    const response = await bookingResponse;
    if (!response.ok())
      throw new Error(
        "Public resource-only booking failed: " +
          response.status() +
          " " +
          (await response.text()),
      );
    const booking = await response.json();
    if (booking.collaboratorId !== null || !booking.roomId)
      throw new Error("Resource-only booking attribution is invalid");

    await page
      .getByRole("button", { name: "Nuova prenotazione", exact: true })
      .click();

    await page
      .getByLabel("Sede della prenotazione")
      .selectOption({ label: "Studio sul porto · Piazza del Porto 12" });
    await page.getByRole("button").filter({ hasText: "Consulenza" }).waitFor();
    await page
      .getByLabel("Settore della prenotazione")
      .selectOption({ label: "Consulenze" });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error("Public mobile overflow");
    await page.getByLabel("Sede della prenotazione").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: ".local/step7/public-mobile.png",
      fullPage: true,
    });
    const result = {
      checkedAt: new Date().toISOString(),
      identity: "synthetic-local-test-sessions",
      providerCalls: false,
      checks: [
        "desktop-render",
        "sector-creation",
        "resource-creation-and-public-toggle",
        "weekly-hours-and-closure-save",
        "multi-sector-professional-assignment",
        "explicit-manager-operational-visibility",
        "mobile-390-no-horizontal-overflow",
        "public-location-and-sector-selector",
        "public-resource-only-booking-without-hidden-professional-assignment",
      ],
      screenshots: [
        "locations-desktop.png",
        "locations-mobile.png",
        "public-mobile.png",
      ],
    };
    fs.writeFileSync(
      ".local/step7/browser-result.json",
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
