import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer, request as proxyRequest } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const stamp = Date.now(),
  database = "step7_http_" + stamp,
  container = "alora-step7-qa-" + stamp;
const directory = path.resolve(".local/step7/http-" + stamp);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const command = (args, input) =>
  execFileSync("docker", args, { input, maxBuffer: 32 * 1024 * 1024 });
const apiBase = "http://127.0.0.1:53027";
const checks = [];
const call = async (route, body, options = {}) => {
  if (body && options.method === "PATCH" && /^\/sales\/[^/]+$/.test(route))
    body = { idempotencyKey: randomUUID(), ...body };
  if (
    body &&
    (route === "/appointments" ||
      route === "/sales" ||
      /\/bookings$/.test(route)) &&
    (!options.method || options.method === "POST")
  )
    body = { idempotencyKey: randomUUID(), ...body };
  // Existing-fixture adapter; the dedicated rescheduling verifier sends raw commands for negative/race tests.
  if (
    body &&
    options.method === "PATCH" &&
    /^\/appointments\/[^/]+$/.test(route)
  ) {
    const current = await (
      await fetch(apiBase + route, {
        headers: { Authorization: "Bearer owner" },
      })
    ).json();
    body = {
      revision: current?.orderItem?.sale?.revision ?? 0,
      idempotencyKey: randomUUID(),
      ...body,
    };
  }
  const response = await fetch(apiBase + route, {
    method: options.method || (body === undefined ? "GET" : "POST"),
    headers: {
      Authorization: "Bearer " + (options.subject || "owner"),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (options.status)
    assert.equal(response.status, options.status, JSON.stringify(result));
  else
    assert(
      response.ok,
      `${route}: ${response.status} ${JSON.stringify(result)}`,
    );
  return result;
};
let web;
try {
  command(["exec", "barber-postgres-1", "createdb", "-U", "barber", database]);
  // Fresh empty DB exercises all migrations, independently of real account data.
  command([
    "run", "--rm", "--network", "barber_app",
    "-e", `DATABASE_URL=postgresql://barber:barber@postgres:5432/${database}?schema=public`,
    "-v", `${path.resolve("prisma")}:/app/prisma:ro`,
    "--entrypoint", "node", "barber-api",
    "/app/node_modules/prisma/build/index.js", "migrate", "deploy",
    "--schema", "/app/prisma/schema.prisma",
  ]);
  command([
    "run",
    "-d",
    "--name",
    container,
    "--network",
    "barber_app",
    "-p",
    "127.0.0.1:53027:3000",
    "-e",
    `DATABASE_URL=postgresql://barber:barber@postgres:5432/${database}?schema=public`,
    "-e",
    "ALORA_STEP7_TEST_ONLY=1",
    "-e",
    "NODE_PATH=/app/node_modules",
    "-v",
    `${path.resolve("scripts")}:/qa:ro`,
    "-v",
    `${path.resolve("dist/apps/api")}:/app/dist/apps/api:ro`,
    "-e", "ALORA_STEP12_TEST_ONLY=1",
    "-v", `${path.resolve("prisma")}:/app/prisma:ro`,
    "--entrypoint", "sh",
    "barber-api", "-c",
    "node node_modules/prisma/build/index.js generate --schema prisma/schema.prisma && exec node /qa/locations-qa-server.cjs",
  ]);
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const health = await fetch(apiBase + "/health");
      if (health.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const context = await call("/locations/context");
  const initial = context[0],
    sectorA = initial.sectors[0].id;
  const second = await call("/locations", {
    name: "Studio sul porto",
    sectorName: "Consulenze",
    address: "Piazza del Porto 12",
  });
  const sectorB = second.sectors[0].id;
  const sectorC = (
    await call(`/locations/${initial.id}/sectors`, { name: "Laboratorio" })
  ).id;
  const professional = await call("/collaborators", {
    firstName: "Anna",
    lastName: "Prova",
    sectorId: sectorA,
    isPublic: true,
  });
  await call(`/locations/professionals/${professional.id}/sectors`, {
    sectorIds: [sectorA, sectorB, sectorC],
  });
  const serviceA = await call("/services", {
    name: "Analisi",
    sectorId: sectorA,
    durationMinutes: 30,
    basePrice: 0.1,
    internalDescription: "fixture-service-private",
    isPublic: true,
    isBookableOnline: true,
  });
  const serviceB = await call("/services", {
    name: "Consulenza",
    sectorId: sectorB,
    durationMinutes: 30,
    basePrice: 0.2,
    isPublic: true,
    isBookableOnline: true,
  });
  const product = await call("/products", { name: "Materiale", price: 0.2 });
  checks.push("location-sector-resource-professional-and-catalog-crud");
  const selected = await call("/services", undefined, {
    headers: { "X-Alora-Location": second.id },
  });
  assert.deepEqual(
    selected.items.map((item) => item.id),
    [serviceB.id],
  );
  const restricted = await call("/services", undefined, { subject: "manager" });
  assert.deepEqual(
    restricted.items.map((item) => item.id),
    [serviceA.id],
  );
  await call("/services", undefined, {
    subject: "manager",
    headers: { "X-Alora-Location": second.id },
    status: 403,
  });
  await call(
    `/services/${serviceB.id}`,
    { name: "No" },
    { subject: "manager", method: "PATCH", status: 403 },
  );
  await call(
    `/availability?serviceId=${serviceB.id}&date=2030-11-11`,
    undefined,
    { subject: "manager", status: 400 },
  );
  const foreign = await call("/services", undefined, { subject: "foreign" });
  assert.equal(foreign.items.length, 0);
  checks.push(
    "tenant-and-operational-membership-isolation-including-cache-and-forged-headers",
  );
  const appointmentA = await call("/appointments", {
    customerId: "__http_customer",
    serviceId: serviceA.id,
    collaboratorId: professional.id,
    startsAt: "2030-11-11T11:00:00+01:00",
  });
  assert.equal(appointmentA.sectorId, sectorA);
  assert.equal(appointmentA.locationId, initial.id);
  const appointmentB = await call("/appointments", {
    customerId: "__http_customer",
    serviceId: serviceB.id,
    collaboratorId: professional.id,
    startsAt: "2030-11-11T12:00:00+01:00",
  });
  await call("/customers/__http_customer/history");
  const restrictedHistory = await call(
    "/customers/__http_customer/history",
    undefined,
    { subject: "manager" },
  );
  assert.deepEqual(
    restrictedHistory.appointments.map((row) => row.id),
    [appointmentA.id],
  );
  await call(`/appointments/${appointmentB.id}`, undefined, {
    subject: "manager",
    status: 403,
  });
  const conflict = await fetch(apiBase + "/appointments", {
    method: "POST",
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotencyKey: randomUUID(),
      customerId: "__http_customer",
      serviceId: serviceB.id,
      collaboratorId: professional.id,
      startsAt: "2030-11-11T11:00:00+01:00",
    }),
  });
  assert.equal(conflict.status, 409);
  const publicServices = await call("/public/__http_a/services");
  assert(
    publicServices.every((service) =>
      service.collaborators.some((person) => person.id === professional.id),
    ),
  );
  assert(
    publicServices.every((service) => !("internalDescription" in service)),
  );
  const publicSlots = await call(
    `/public/__http_a/availability?serviceId=${serviceB.id}&date=2030-11-12&collaboratorId=${professional.id}`,
  );
  assert(publicSlots.slots.length > 0);
  const body = {
    serviceId: serviceB.id,
    collaboratorId: professional.id,
    startsAt: publicSlots.slots[0].startsAt,
    customerName: "Cliente di prova",
  };
  const races = await Promise.all([
    fetch(apiBase + "/public/__http_a/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, idempotencyKey: randomUUID() }),
    }),
    fetch(apiBase + "/public/__http_a/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, idempotencyKey: randomUUID() }),
    }),
  ]);
  const statuses = races.map((response) => response.status).sort();
  assert.equal(statuses.filter((status) => status === 201).length, 1);
  assert(
    statuses.some((status) => [400, 409].includes(status)),
    JSON.stringify(statuses),
  );
  checks.push(
    "internal-and-public-booking-attribution-cross-location-conflict-and-concurrent-write-rejection",
  );
  const room = await call("/locations/rooms", {
    name: "Postazione",
    sectorId: sectorC,
    isPublic: true,
  });
  const roomService = await call("/services", {
    name: "Percorso autonomo",
    sectorId: sectorC,
    durationMinutes: 30,
    basePrice: 0,
    requiresCollaborator: false,
    requiresRoom: true,
    isPublic: true,
    isBookableOnline: true,
  });
  const roomSlots = await call(
    `/public/__http_a/availability?serviceId=${roomService.id}&date=2030-11-15`,
  );
  assert(roomSlots.slots.length > 0);
  assert.equal(roomSlots.slots[0].roomId, room.id);
  const roomBooking = await call("/public/__http_a/bookings", {
    serviceId: roomService.id,
    startsAt: roomSlots.slots[0].startsAt,
    customerName: "Risorsa prova",
  });
  assert.equal(roomBooking.roomId, room.id);
  assert.equal(roomBooking.sectorId, sectorC);
  const internalResource = await call("/appointments", {
    customerId: "__http_customer",
    serviceId: roomService.id,
    startsAt: "2030-11-19T11:00:00+01:00",
  });
  assert.equal(internalResource.roomId, room.id);
  const privateSlots = await call(
    `/public/__http_a/availability?serviceId=${roomService.id}&date=2030-11-16`,
  );
  const acknowledgement = await call("/public/__http_a/bookings", {
    serviceId: roomService.id,
    startsAt: privateSlots.slots[0].startsAt,
    customerName: "Input Only",
    email: "fixture-private@example.invalid",
  });
  assert.deepEqual(acknowledgement.customer, {
    firstName: "Input",
    lastName: "Only",
  });
  assert(!JSON.stringify(acknowledgement).includes("fixture-private"));
  assert(!("internalNotes" in acknowledgement));
  assert(!("id" in acknowledgement.customer));
  checks.push(
    "public-projections-exclude-existing-crm-and-internal-service-data",
  );
  await call(
    "/appointments",
    {
      customerId: "__http_customer",
      serviceId: serviceA.id,
      collaboratorId: professional.id,
      roomId: room.id,
      startsAt: "2030-11-15T14:00:00+01:00",
    },
    { status: 400 },
  );
  await call(
    `/locations/sectors/${sectorC}`,
    { closures: ["2030-11-18"] },
    { method: "PATCH" },
  );
  const closed = await call(
    `/public/__http_a/availability?serviceId=${roomService.id}&date=2030-11-18`,
  );
  assert.equal(closed.slots.length, 0);
  await call(
    `/locations/rooms/${room.id}`,
    { sectorId: sectorB },
    { method: "PATCH", status: 400 },
  );
  await call(
    `/locations/professionals/${professional.id}/sectors`,
    { sectorIds: [sectorB] },
    { status: 400 },
  );
  if (!/^[0-9a-f-]+$/.test(roomService.id))
    throw Error("Unexpected fixture ID");
  command(
    [
      "exec",
      "-i",
      "barber-postgres-1",
      "psql",
      "-U",
      "barber",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
    ],
    `UPDATE "Service" SET "bufferAfterMinutes"=30 WHERE id='${roomService.id}' AND "tenantId"='__http_a';`,
  );
  await call(
    `/locations/${initial.id}`,
    {
      weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        isWorkingDay: true,
        startTime: "00:00",
        endTime: "23:59",
      })),
    },
    { method: "PATCH" },
  );
  await call("/appointments", {
    customerId: "__http_customer",
    serviceId: roomService.id,
    startsAt: "2030-11-21T23:20:00+01:00",
  });
  const nightSlots = await call(
    `/public/__http_a/availability?serviceId=${roomService.id}&date=2030-11-22`,
  );
  assert(!nightSlots.slots.some((slot) => slot.label === "00:00"));
  assert(nightSlots.slots.some((slot) => slot.label === "00:30"));
  checks.push(
    "sector-resource-allocation-closure-intersection-controlled-reassignment-and-cross-day-buffers",
  );

  const sale = await call("/sales", {
    paymentStatus: "paid",
    paymentMethod: "cash",
    customerId: "__http_customer",
    locationId: initial.id,
    soldAt: "2030-11-13T11:00:00+01:00",
    items: [
      {
        serviceId: serviceA.id,
        collaboratorId: professional.id,
        quantity: 1,
        unitPrice: 0.1,
      },
      { productId: product.id, sectorId: sectorC, quantity: 1, unitPrice: 0.2 },
    ],
  });
  assert.equal(sale.locationId, initial.id);
  assert.equal(sale.total, "0.3");
  assert.deepEqual(
    sale.items.map((item) => item.sectorId).sort(),
    [sectorA, sectorC].sort(),
  );
  const totals = await call("/locations/totals");
  assert.equal(totals.registeredLineTotal, "0.30");
  await call(
    `/services/${serviceA.id}`,
    { sectorId: sectorB },
    { method: "PATCH" },
  );
  const edited = await call(
    `/sales/${sale.id}`,
    {
      customerId: "__http_customer",
      items: sale.items.map((item) => ({
        id: item.id,
        serviceId: item.serviceId || undefined,
        productId: item.productId || undefined,
        collaboratorId: item.collaboratorId || undefined,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      })),
    },
    { method: "PATCH", headers: { "X-Alora-Sector": sectorC } },
  );
  assert.deepEqual(
    edited.items.map((item) => [item.id, item.sectorId]).sort(),
    sale.items.map((item) => [item.id, item.sectorId]).sort(),
  );
  const bookedSale = await call(
    "/sales",
    {
      customerId: "__http_customer",
      appointmentId: appointmentA.id,
      items: [
        {
          serviceId: serviceA.id,
          collaboratorId: professional.id,
          sectorId: sectorA,
          quantity: 1,
          unitPrice: 0.1,
        },
      ],
    },
    { headers: { "X-Alora-Location": initial.id } },
  );
  assert.equal(bookedSale.locationId, initial.id);
  assert.equal(bookedSale.items[0].sectorId, sectorA);
  checks.push(
    "quick-order-exact-decimal-reconciliation-and-historical-attribution-after-service-move",
  );
  await call(
    `/locations/${second.id}`,
    { isActive: false },
    { method: "PATCH" },
  );
  const settings = await call("/public/__http_a/settings");
  assert(!settings.locations.some((location) => location.id === second.id));
  const history = await call("/appointments");
  assert(history.some((appointment) => appointment.id === appointmentA.id));
  assert(history.some((appointment) => appointment.id === appointmentB.id));
  await call(
    "/appointments",
    {
      customerId: "__http_customer",
      serviceId: serviceB.id,
      collaboratorId: professional.id,
      startsAt: "2030-11-14T11:00:00+01:00",
    },
    { status: 400 },
  );
  await call(
    `/locations/${second.id}`,
    { isActive: true },
    { method: "PATCH" },
  );
  checks.push(
    "deactivation-removes-public-booking-and-preserves-authorized-history",
  );
  // Browser exercise uses the built apps and this isolated API. No real identities or provider.
  web = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      const proxy = proxyRequest(
        apiBase + req.url.slice(4),
        { method: req.method, headers: req.headers },
        (upstream) => {
          res.writeHead(upstream.statusCode, upstream.headers);
          upstream.pipe(res);
        },
      );
      req.pipe(proxy);
      proxy.on("error", () => res.end());
      return;
    }
    const admin = url.pathname.startsWith("/admin");
    const root = path.resolve(
      admin
        ? "dist/apps/web-admin/browser"
        : "dist/apps/web-public-booking/browser",
    );
    const requested = path.join(
      root,
      decodeURIComponent(
        admin ? url.pathname.slice(6) : url.pathname.replace(/^\/booking/, ""),
      ),
    );
    const file =
      existsSync(requested) && path.extname(requested)
        ? requested
        : path.join(root, "index.html");
    try {
      const data = readFileSync(file);
      res.setHeader(
        "Content-Type",
        {
          ".js": "application/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
          ".png": "image/png",
        }[path.extname(file)] || "text/html",
      );
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => web.listen(53028, "127.0.0.1", resolve));
  writeFileSync(
    path.join(directory, "result.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        database: "isolated-empty-fixture-database",
        identity: "synthetic-local-test-sessions",
        providerCalls: false,
        checks,
        statuses,
        fixture: {
          initial: initial.id,
          sectorA,
          sectorB,
          sectorC,
          second: second.id,
          professional: professional.id,
          serviceA: serviceA.id,
          serviceB: serviceB.id,
        },
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      {
        checks,
        statuses,
        browser: "http://127.0.0.1:53028/admin/#/locations",
        evidence: path.join(directory, "result.json"),
      },
      null,
      2,
    ),
  );
  if (process.argv.includes("--browser")) {
    console.log(
      "BROWSER_READY: send a line on stdin to stop and remove only the QA container and database.",
    );
    process.stdin.resume();
    await new Promise((resolve) => {
      process.stdin.once("data", resolve);
      process.once("SIGTERM", resolve);
    });
    process.stdin.pause();
  }
} catch (error) {
  try {
    writeFileSync(
      path.join(directory, "container.log"),
      command(["logs", container]),
      { mode: 0o600 },
    );
  } catch {}
  throw error;
} finally {
  if (web) await new Promise((resolve) => web.close(resolve));
  try {
    command(["rm", "-f", container]);
  } catch {}
  command(["exec", "barber-postgres-1", "dropdb", "-U", "barber", database]);
}
