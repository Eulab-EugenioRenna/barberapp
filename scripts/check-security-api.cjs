/* Isolated HTTP/DB regression check. Requires a disposable test database. */
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("bcrypt");
const { spawn } = require("node:child_process");
if (
  !process.env.DATABASE_URL ||
  new URL(process.env.DATABASE_URL).pathname !== "/barber_security_test"
)
  throw new Error("Use only disposable barber_security_test database");
const prisma = new PrismaClient();
const port = process.env.SECURITY_TEST_PORT || "53019";
const base = `http://127.0.0.1:${port}`;
let child;
let checks = 0;
async function request(path, token, method = "GET", body, expected = 200) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json();
  assert.equal(
    res.status,
    expected,
    `${method} ${path}: ${JSON.stringify(data)}`,
  );
  checks++;
  assert(
    !JSON.stringify(data).includes("passwordHash"),
    `Secret exposed by ${path}`,
  );
  return data;
}
async function login(user) {
  return request(
    "/auth/login",
    null,
    "POST",
    { email: user.email, password: "test-password" },
    201,
  );
}
async function main() {
  const suffix = randomUUID();
  const companies = await Promise.all(
    ["a", "b"].map((name) =>
      prisma.tenant.create({
        data: { name, slug: `security-${name}-${suffix}` },
      }),
    ),
  );
  const passwordHash = await hash("test-password", 4);
  const users = [];
  for (const [index, role] of [
    "owner",
    "owner",
    "collaborator",
    "manager",
    "reception",
    "platform_admin",
  ].entries()) {
    users.push(
      await prisma.user.create({
        data: {
          email: `security-${index}-${suffix}@example.test`,
          passwordHash,
          firstName: "Test",
          lastName: role,
          role,
          tenantId:
            role === "platform_admin"
              ? null
              : companies[index === 1 ? 1 : 0].id,
        },
      }),
    );
  }
  const [a, b] = companies;
  const customers = await Promise.all(
    companies.map((tenant) =>
      prisma.customer.create({
        data: {
          tenantId: tenant.id,
          firstName: "Test",
          lastName: "Customer",
          totalSpent: 999,
        },
      }),
    ),
  );
  const services = await Promise.all(
    companies.map((tenant) =>
      prisma.service.create({
        data: {
          tenantId: tenant.id,
          name: "Test Service",
          durationMinutes: 30,
          basePrice: 25,
        },
      }),
    ),
  );
  const collaborators = await Promise.all(
    companies.map((tenant, i) =>
      prisma.collaborator.create({
        data: {
          tenantId: tenant.id,
          firstName: "Test",
          lastName: "Collaborator",
          ...(i === 0 ? { userId: users[2].id } : {}),
        },
      }),
    ),
  );
  const products = await Promise.all(
    companies.map((tenant) =>
      prisma.product.create({
        data: { tenantId: tenant.id, name: "Test product", price: 10 },
      }),
    ),
  );
  const room = await prisma.room.create({
    data: { tenantId: b.id, name: "Other company room" },
  });
  const appointments = await Promise.all(
    companies.map((tenant, i) =>
      prisma.appointment.create({
        data: {
          tenantId: tenant.id,
          customerId: customers[i].id,
          serviceId: services[i].id,
          collaboratorId: collaborators[i].id,
          startsAt: new Date("2026-10-20T09:00:00Z"),
          endsAt: new Date("2026-10-20T09:30:00Z"),
        },
      }),
    ),
  );
  const unassigned = await prisma.appointment.create({
    data: {
      tenantId: a.id,
      customerId: customers[0].id,
      serviceId: services[0].id,
      startsAt: new Date("2026-10-20T11:00:00Z"),
      endsAt: new Date("2026-10-20T11:30:00Z"),
    },
  });
  child = spawn(process.execPath, ["dist/apps/api/main.js"], {
    env: {
      ...process.env,
      PORT: port,
      ALORA_CONNECT_APP_ID: "alora-security-test",
      REDIS_HOST: "127.0.0.1",
      REDIS_PORT: process.env.SECURITY_REDIS_PORT || "56389",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (data) => {
    errors += data.toString();
  });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw new Error(`API startup failed: ${errors}`);
    try {
      if ((await fetch(base + "/health")).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const owner = await login(users[0]);
  assert.notEqual(owner.accessToken, owner.refreshToken);
  assert.equal(Buffer.from(owner.accessToken, "base64url").length, 32);
  const stored = await prisma.localSession.findFirst({
    where: { userId: users[0].id },
  });
  assert.notEqual(stored.accessHash, owner.accessToken);
  assert.notEqual(stored.refreshHash, owner.refreshToken);
  await request(
    "/auth/me",
    `barber-session:${users[0].id}`,
    "GET",
    undefined,
    401,
  );
  await request("/auth/me", owner.accessToken);
  const matrix = await request("/.well-known/eulab-connect.json");
  assert.equal(matrix.appId, "alora-security-test");
  assert.equal(matrix.schemaVersion, 1);
  assert(matrix.functions.some(item => item.key === "appointments.read.own"));
  assert(matrix.functions.every(item => !Object.hasOwn(item, "legacy") && !Object.hasOwn(item, "aliases")));
  const agendaReader = await login(users[3]);
  await prisma.user.update({where:{id:users[3].id},data:{permissions:["appointments.read.all"]}});
  const operationalContext = await request("/tenant/context", agendaReader.accessToken);
  assert.equal(operationalContext.id, a.id);
  assert(!Object.hasOwn(operationalContext, "publicDomain"));
  const agendaContext = await request("/appointments/context", agendaReader.accessToken);
  assert(agendaContext.services.every(item => item.id === services[0].id));
  assert(agendaContext.collaborators.every(item => !Object.hasOwn(item, "email") && !Object.hasOwn(item, "phone")));
  await request("/tenant/settings", agendaReader.accessToken, "GET", undefined, 403);
  await request("/dashboard/revenue", agendaReader.accessToken, "GET", undefined, 403);
  await request("/customers", agendaReader.accessToken, "GET", undefined, 403);
  await request("/services", agendaReader.accessToken, "GET", undefined, 403);
  await prisma.user.update({where:{id:users[3].id},data:{permissions:[]}});
  for (const [route, records] of [
    ["services", services],
    ["products", products],
    ["customers", customers],
    ["collaborators", collaborators],
  ]) {
    await request(
      `/${route}/${records[1].id}`,
      owner.accessToken,
      "PATCH",
      { name: "Cross tenant attempt" },
      404,
    );
    await request(
      `/${route}/${records[1].id}`,
      owner.accessToken,
      "DELETE",
      undefined,
      404,
    );
    assert.equal(
      (
        await prisma[
          route === "services"
            ? "service"
            : route === "products"
              ? "product"
              : route === "customers"
                ? "customer"
                : "collaborator"
        ].findUnique({ where: { id: records[1].id } })
      ).tenantId,
      b.id,
    );
  }
  await request(
    `/services/${services[0].id}/products`,
    owner.accessToken,
    "POST",
    { productId: products[1].id },
    400,
  );
  await request(
    `/services/${services[1].id}/products`,
    owner.accessToken,
    "POST",
    { productId: products[0].id },
    400,
  );
  const validBooking = {
    customerId: customers[0].id,
    serviceId: services[0].id,
    startsAt: "2026-10-22T10:00:00Z",
  };
  for (const reference of [
    { customerId: customers[1].id },
    { serviceId: services[1].id },
    { collaboratorId: collaborators[1].id },
    { roomId: room.id },
  ]) {
    await request(
      "/appointments",
      owner.accessToken,
      "POST",
      { ...validBooking, ...reference },
      400,
    );
  }
  await request(
    `/appointments/${appointments[1].id}/status`,
    owner.accessToken,
    "POST",
    { status: "completed" },
    403,
  );
  await request(
    `/appointments/${appointments[1].id}`,
    owner.accessToken,
    "DELETE",
    undefined,
    403,
  );
  await request(
    "/products",
    owner.accessToken,
    "POST",
    { name: "Invalid", price: -1 },
    400,
  );
  await request(
    "/services",
    owner.accessToken,
    "POST",
    { name: "Invalid", isPublic: "false" },
    400,
  );
  await request("/auth/login", null, "POST", { email: 123, password: [] }, 400);
  await request("/appointments", owner.accessToken); // prime company cache
  const professional = await login(users[2]);
  for (const route of [
    "/dashboard/revenue",
    "/sales",
    "/customers",
    "/users",
    "/collaborators",
    "/tenant/settings",
    "/notifications/stream",
  ])
    await request(route, professional.accessToken, "GET", undefined, 403);
  const own = await request("/appointments", professional.accessToken);
  assert.equal(own.length, 1);
  assert.equal(own[0].id, appointments[0].id);
  assert(!("totalSpent" in own[0].customer));
  await request(`/appointments/${unassigned.id}`, owner.accessToken);
  await request(
    `/appointments/${unassigned.id}`,
    professional.accessToken,
    "GET",
    undefined,
    403,
  );
  // Prime owner detail cache then attempt another person's appointment.
  await request(
    `/appointments/${appointments[1].id}`,
    (await login(users[1])).accessToken,
  );
  await request(
    `/appointments/${appointments[1].id}`,
    professional.accessToken,
    "GET",
    undefined,
    403,
  );
  await request(
    `/appointments/${appointments[0].id}/status`,
    professional.accessToken,
    "POST",
    { status: "checked_in" },
    201,
  );
  for (const index of [3, 4]) {
    const limited = await login(users[index]);
    await request("/sales", limited.accessToken, "GET", undefined, 403);
    await prisma.user.update({
      where: { id: users[index].id },
      data: { permissions: ["sales.read"] },
    });
    await request("/sales", limited.accessToken);
    await request("/sales", limited.accessToken, "POST", { items: [] }, 403);
  }
  const admin = await login(users[5]);
  await request("/users", admin.accessToken);
  await request(`/platform-admin/tenants/${a.id}`, admin.accessToken);
  await request(
    "/platform-admin/tenants",
    owner.accessToken,
    "GET",
    undefined,
    403,
  );
  await request("/services", admin.accessToken, "GET", undefined, 403);
  await request(`/platform-admin/tenants/${a.id}/export`, admin.accessToken);
  await request(
    `/platform-admin/tenants/${a.id}/import?mode=merge`,
    admin.accessToken,
    "POST",
    { products: [{ ...products[1], name: "Foreign overwrite" }] },
    400,
  );
  await request(
    `/platform-admin/tenants/${a.id}/import?mode=merge`,
    admin.accessToken,
    "POST",
    {
      collaborators: [
        {
          id: randomUUID(),
          firstName: "Bad",
          lastName: "Link",
          userId: users[1].id,
        },
      ],
    },
    400,
  );
  await request(
    `/platform-admin/tenants/${a.id}/import?mode=replace`,
    admin.accessToken,
    "POST",
    {
      products: [
        { id: randomUUID(), name: "Bad", tenant: { connect: { id: b.id } } },
      ],
    },
    400,
  );
  assert(await prisma.product.findUnique({ where: { id: products[0].id } }));
  // Runtime ORM validation after clearing must also roll back the whole replacement.
  await request(
    `/platform-admin/tenants/${a.id}/import?mode=replace`,
    admin.accessToken,
    "POST",
    { products: [{ id: randomUUID(), name: 123 }] },
    400,
  );
  assert(await prisma.product.findUnique({ where: { id: products[0].id } }));
  await request("/payments/prepare-intent", owner.accessToken, "POST", {}, 501);
  const sale = await request(
    "/sales",
    owner.accessToken,
    "POST",
    {
      customerId: customers[0].id,
      items: [{ productId: products[0].id, quantity: 1, unitPrice: 10 }],
      paymentStatus: "paid",
    },
    201,
  );
  assert.equal(Number(sale.total), 10);
  await request(`/sales/${sale.id}`, owner.accessToken);
  await request(
    "/sales",
    owner.accessToken,
    "POST",
    {
      customerId: customers[1].id,
      items: [{ productId: products[0].id, quantity: 1, unitPrice: 10 }],
    },
    400,
  );
  await request(
    "/sales",
    owner.accessToken,
    "POST",
    {
      customerId: customers[0].id,
      items: [{ productId: products[1].id, quantity: 1, unitPrice: 10 }],
    },
    400,
  );
  const session = await login(users[0]);
  const rotated = await request(
    "/auth/refresh",
    null,
    "POST",
    { refreshToken: session.refreshToken },
    201,
  );
  assert.notEqual(session.refreshToken, rotated.refreshToken);
  await request("/auth/me", session.accessToken, "GET", undefined, 401);
  await request("/auth/me", rotated.accessToken);
  await request(
    "/auth/refresh",
    null,
    "POST",
    { refreshToken: session.refreshToken },
    401,
  );
  await request("/auth/me", rotated.accessToken, "GET", undefined, 401);
  const expired = await login(users[0]);
  await prisma.localSession.updateMany({
    where: { userId: users[0].id },
    data: { accessExpiresAt: new Date(0) },
  });
  await request("/auth/me", expired.accessToken, "GET", undefined, 401);
  const renewed = await request(
    "/auth/refresh",
    null,
    "POST",
    { refreshToken: expired.refreshToken },
    201,
  );
  await request("/auth/logout", renewed.accessToken, "POST", {}, 201);
  await request("/auth/me", renewed.accessToken, "GET", undefined, 401);
  await request(
    "/auth/refresh",
    null,
    "POST",
    { refreshToken: renewed.refreshToken },
    401,
  );
  const revoked = await login(users[2]);
  const freshOwner = await login(users[0]);
  await request(
    `/users/${users[2].id}/sessions`,
    freshOwner.accessToken,
    "DELETE",
  );
  await request("/auth/me", revoked.accessToken, "GET", undefined, 401);
  const concurrent = await login(users[0]);
  const attempts = await Promise.all(
    [1, 2].map(() =>
      fetch(base + "/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: concurrent.refreshToken }),
      }),
    ),
  );
  assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 401]);
  const winner = await attempts.find((r) => r.status === 201).json();
  await request("/auth/me", winner.accessToken, "GET", undefined, 401);
  const suspended = await login(users[1]);
  await request(
    `/platform-admin/tenants/${b.id}/suspend`,
    admin.accessToken,
    "POST",
    {},
    201,
  );
  await request("/auth/me", suspended.accessToken, "GET", undefined, 401);
  await request(
    `/platform-admin/tenants/${b.id}/reactivate`,
    admin.accessToken,
    "POST",
    {},
    201,
  );
  await request(
    "/auth/refresh",
    null,
    "POST",
    { refreshToken: suspended.refreshToken },
    401,
  );
  const inactive = await login(users[3]);
  await prisma.user.update({
    where: { id: users[3].id },
    data: { isActive: false },
  });
  await request("/auth/me", inactive.accessToken, "GET", undefined, 401);
  await request(
    "/auth/refresh",
    null,
    "POST",
    { refreshToken: inactive.refreshToken },
    401,
  );
  const signup = await request(
    "/auth/signup",
    null,
    "POST",
    {
      email: `signup-${suffix}@example.test`,
      password: "test-password",
      firstName: "New",
      lastName: "Owner",
      companyName: `New ${suffix}`,
    },
    201,
  );
  await request("/auth/me", signup.accessToken);
  const audit = await prisma.auditLog.findMany({ where: { tenantId: a.id } });
  assert(audit.some((entry) => entry.action === "auth.login"));
  assert(audit.some((entry) => entry.action === "SalesController.create"));
  assert(!JSON.stringify(audit).includes("test-password"));
  console.log(
    `PASS: ${checks} HTTP security checks, refresh concurrency, Quick Order, audit and token storage on isolated PostgreSQL`,
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    child?.kill("SIGTERM");
    await prisma.$disconnect();
  });
