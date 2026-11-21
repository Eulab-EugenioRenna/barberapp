/** Actual Angular, API, SDK and private PostgreSQL. No message to a real provider. */
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { chromium, expect } = require(
  process.env.ALORA_PLAYWRIGHT_TEST_MODULE || "@playwright/test",
);
const base = "http://127.0.0.1:53029",
  origin = "http://127.0.0.1:53030";
(async () => {
  const health = await (await fetch(base + "/health")).json();
  assert(health.testOnly && /^step11_qa_\d+$/.test(health.database));
  async function control(body) {
    const r = await fetch(base + "/_qa", {
      method: body ? "POST" : "GET",
      headers: {
        "X-Alora-QA": "step11-synthetic",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert(r.ok);
    return r.json();
  }
  const state = await control(),
    workflow = await control({ workflow: {} }),
    checks = [],
    errors = [],
    directory = ".local/step12/workflow-screenshots";
  fs.mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.ALORA_PLAYWRIGHT_EXECUTABLE
      ? { executablePath: process.env.ALORA_PLAYWRIGHT_EXECUTABLE }
      : {}),
  });
  let page;
  async function open(actor = "owner") {
    const p = await browser.newPage({
      viewport: { width: 1440, height: 1050 },
    });
    p.on("pageerror", (e) => errors.push(e.message));
    p.setDefaultTimeout(15000);
    await p.addInitScript((token) => {
      localStorage.setItem("barber.session", token);
      localStorage.removeItem("barber.refresh");
    }, state.actors[actor].session.accessToken);
    await p.goto(origin + "/admin/#/whatsapp");
    await p.getByRole("heading", { name: "WhatsApp", exact: true }).waitFor();
    return p;
  }
  const policy = (p) => p.locator("app-appointment-automation-policy"),
    access = (p) => p.locator("app-appointment-automation-access"),
    monitor = (p) => p.locator("app-appointment-automation-monitor");
  async function load(p) {
    await policy(p)
      .getByRole("button", { name: "Configura promemoria", exact: true })
      .click();
    await expect(
      policy(p).getByLabel("Anticipo del primo promemoria (minuti)", {
        exact: true,
      }),
    ).toBeVisible();
  }
  try {
    page = await open();
    await load(page);
    const peer = await open();
    await load(peer);
    const text =
      "Ciao {{customer.firstName}}, confermi {{service.name}} del {{appointment.startsAt}}? " +
      Date.now();
    await policy(page)
      .getByLabel("Messaggio iniziale", { exact: true })
      .fill(text);
    await policy(page)
      .getByRole("checkbox", {
        name: "Avvisa quando l’appuntamento viene confermato",
        exact: true,
      })
      .check();
    await policy(page)
      .getByRole("checkbox", {
        name: "Avvisa quando l’appuntamento viene annullato",
        exact: true,
      })
      .check();
    await policy(page)
      .getByRole("checkbox", {
        name: "Avvisa subito dopo una riprogrammazione",
        exact: true,
      })
      .uncheck();
    await policy(page)
      .getByLabel("Avviso di conferma", { exact: true })
      .fill("CONFERMA UI {{customer.firstName}} {{appointment.startsAt}}");
    await policy(page)
      .getByLabel("Avviso di annullamento", { exact: true })
      .fill("ANNULLAMENTO UI {{customer.firstName}} {{service.name}}");
    await expect(
      policy(page).getByRole("button", {
        name: "Attiva per le nuove prenotazioni",
        exact: true,
      }),
    ).toBeDisabled();
    await policy(page)
      .getByRole("button", { name: "Salva bozza della policy", exact: true })
      .click();
    await expect(policy(page).getByRole("status")).toHaveText(
      "Bozza salvata. Gli invii restano non attivi.",
    );
    await policy(peer)
      .getByLabel("Messaggio iniziale", { exact: true })
      .fill("Bozza concorrente da conservare");
    await policy(peer)
      .getByRole("button", { name: "Salva bozza della policy", exact: true })
      .click();
    await expect(policy(peer).getByRole("status")).toContainText(
      "La policy è cambiata",
    );
    await expect(
      policy(peer).getByLabel("Messaggio iniziale", { exact: true }),
    ).toHaveValue("Bozza concorrente da conservare");
    await peer.close();
    await page.reload();
    await load(page);
    await expect(
      policy(page).getByLabel("Messaggio iniziale", { exact: true }),
    ).toHaveValue(text);
    await expect(
      policy(page).getByRole("checkbox", {
        name: "Avvisa quando l’appuntamento viene confermato",
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      policy(page).getByRole("checkbox", {
        name: "Avvisa subito dopo una riprogrammazione",
        exact: true,
      }),
    ).not.toBeChecked();
    const date = new Date(Date.now() + 3 * 86400000);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Rome",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(date)
        .map((p) => [p.type, p.value]),
    );
    await policy(page)
      .getByLabel("Data e ora dell’appuntamento di esempio", { exact: true })
      .fill(`${parts.year}-${parts.month}-${parts.day}T11:00`);
    await policy(page)
      .getByRole("button", {
        name: "Calcola gli orari di esempio",
        exact: true,
      })
      .click();
    await expect(
      policy(page).getByLabel("Piano di esempio", { exact: true }),
    ).toContainText("Ciao Giulia, confermi Taglio e piega");
    await expect(
      policy(page).getByLabel("Piano di esempio", { exact: true }),
    ).toContainText("CONFERMA UI Giulia");
    await expect(
      policy(page).getByLabel("Piano di esempio", { exact: true }),
    ).toContainText("ANNULLAMENTO UI Giulia");
    checks.push(
      "real-ui-persists-template-reload-retains-conflicting-draft-and-previews-with-production-renderer",
    );
    checks.push(
      "event-choices-and-five-message-templates-persist-and-preview-from-real-policy-api",
    );
    await access(page)
      .getByRole("button", { name: "Gestisci autorizzazioni", exact: true })
      .click();
    await access(page)
      .getByLabel("Canale da autorizzare", { exact: true })
      .selectOption("application_notification");
    await access(page)
      .getByLabel("Finalità", { exact: true })
      .selectOption("customer_commands");
    await access(page)
      .getByRole("button", { name: "Registra autorizzazione", exact: true })
      .click();
    await expect(access(page).getByRole("status").first()).toContainText(
      "Autorizzazione registrata",
    );
    checks.push(
      "agenda-authority-can-be-created-from-ui-separately-from-native-notifications",
    );
    await policy(page)
      .getByRole("button", { name: "Ricarica policy salvata", exact: true })
      .click();
    await policy(page)
      .getByRole("button", {
        name: "Attiva per le nuove prenotazioni",
        exact: true,
      })
      .click();
    await expect(policy(page).getByRole("status")).toHaveText(
      "Promemoria attivi per le nuove prenotazioni autorizzate.",
    );
    await expect(policy(page)).toContainText("Promemoria attivi.");
    await monitor(page)
      .getByRole("button", { name: "Apri esiti e richieste", exact: true })
      .click();
    await expect(monitor(page).locator("ol > li").first()).toBeVisible();
    await expect(monitor(page)).toContainText("Inviato");
    const outstanding = monitor(page)
      .locator("ol > li")
      .filter({
        has: page.getByRole("button", {
          name: "Segna richiesta gestita",
          exact: true,
        }),
      });
    if (await outstanding.count()) {
      await outstanding
        .first()
        .getByRole("button", { name: "Segna richiesta gestita", exact: true })
        .click();
      await expect(monitor(page).getByRole("status")).toContainText(
        "L’agenda non è stata modificata",
      );
    }
    await monitor(page)
      .getByRole("button", { name: "Richieste da gestire", exact: true })
      .click();
    await expect(
      monitor(page).getByRole("button", {
        name: "Richieste da gestire",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await monitor(page)
      .getByRole("button", { name: "Ultime prenotazioni", exact: true })
      .click();
    checks.push(
      "explicit-policy-activation-and-durable-monitor-show-real-domain-states-and-review-without-calendar-mutation",
    );
    for (const [name, viewport] of Object.entries({
      desktop: { width: 1440, height: 1050 },
      "tablet-landscape": { width: 1180, height: 820 },
      "tablet-portrait": { width: 820, height: 1180 },
      mobile: { width: 390, height: 844 },
    })) {
      await page.setViewportSize(viewport);
      await policy(page).scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      const bounds = await policy(page).boundingBox();
      assert(bounds && bounds.width <= viewport.width);
      await page.screenshot({ path: `${directory}/policy-${name}.png` });
      await monitor(page).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${directory}/monitor-${name}.png` });
    }
    await policy(page)
      .getByRole("button", {
        name: "Ferma i promemoria da inviare",
        exact: true,
      })
      .click();
    await expect(policy(page).getByRole("status")).toContainText(
      "Nuovi invii fermati",
    );
    checks.push(
      "policy-and-monitor-work-in-four-viewports-and-explicit-stop-closes-new-dispatch",
    );
    const reader = await open("reader");
    assert.equal(await policy(reader).count(), 0);
    assert.equal(await access(reader).count(), 0);
    assert.equal(await monitor(reader).count(), 0);
    await reader.close();
    assert.deepEqual(errors, []);
    const result = {
      checkedAt: new Date().toISOString(),
      database: health.database,
      realAngular: true,
      realSdk: true,
      provider: "synthetic-loopback",
      realAccounts: false,
      realProviderMessages: false,
      checks,
      screenshots: directory,
    };
    fs.writeFileSync(
      ".local/step12/workflow-browser-result.json",
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
