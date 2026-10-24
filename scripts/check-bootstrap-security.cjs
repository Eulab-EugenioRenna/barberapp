// Persistent-data regression checks; run only against the disposable security database.
const { PrismaClient } = require("@prisma/client");
const { randomBytes, randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
if (
  !process.env.DATABASE_URL ||
  new URL(process.env.DATABASE_URL).pathname !== "/barber_security_test"
)
  throw new Error("Disposable barber_security_test database required");
const prisma = new PrismaClient();
const flags = [
  "--transpile-only",
  "--compiler-options",
  JSON.stringify({ module: "CommonJS", moduleResolution: "node" }),
];
function run(file, overrides = {}, secrets = []) {
  const output = execFileSync("node_modules/.bin/ts-node", [...flags, file], {
    encoding: "utf8",
    env: {
      ...process.env,
      SEED_DEMO: "0",
      PLATFORM_ADMIN_PASSWORD: "",
      DEMO_OWNER_PASSWORD: "",
      ...overrides,
    },
  });
  for (const secret of secrets)
    assert(!output.includes(secret), "Bootstrap exposed a password");
  return output;
}
async function main() {
  const plansBefore = await prisma.subscriptionPlan.findMany({
    orderBy: { id: "asc" },
  });
  const usersBefore = await prisma.user.findMany({ orderBy: { id: "asc" } });
  const tenantsBefore = await prisma.tenant.findMany({
    orderBy: { id: "asc" },
  });
  run("prisma/seed.ts");
  run("prisma/seed.ts");
  assert.deepEqual(
    await prisma.user.findMany({ orderBy: { id: "asc" } }),
    usersBefore,
  );
  assert.deepEqual(
    await prisma.tenant.findMany({ orderBy: { id: "asc" } }),
    tenantsBefore,
  );
  assert.deepEqual(
    await prisma.subscriptionPlan.findMany({
      where: { id: { in: plansBefore.map((plan) => plan.id) } },
      orderBy: { id: "asc" },
    }),
    plansBefore,
  );
  const suffix = randomUUID();
  const adminEmail = `bootstrap-admin-${suffix}@example.test`;
  const password = randomBytes(32).toString("base64url");
  run(
    "prisma/seed.ts",
    { PLATFORM_ADMIN_EMAIL: adminEmail, PLATFORM_ADMIN_PASSWORD: password },
    [password],
  );
  const admin = await prisma.user.findUniqueOrThrow({
    where: { email: adminEmail },
  });
  assert.equal(admin.role, "platform_admin");
  const nextPassword = randomBytes(32).toString("base64url");
  run(
    "prisma/seed.ts",
    { PLATFORM_ADMIN_EMAIL: adminEmail, PLATFORM_ADMIN_PASSWORD: nextPassword },
    [nextPassword],
  );
  assert.deepEqual(
    await prisma.user.findUniqueOrThrow({ where: { id: admin.id } }),
    admin,
  );
  const config = {
    DEMO_TENANT_SLUG: `bootstrap-${suffix}`,
    DEMO_OWNER_EMAIL: `bootstrap-owner-${suffix}@example.test`,
    DEMO_OWNER_PASSWORD: password,
  };
  run("scripts/create-demo-account.ts", config, [password]);
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: config.DEMO_OWNER_EMAIL },
  });
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: owner.tenantId },
  });
  run(
    "scripts/create-demo-account.ts",
    { ...config, DEMO_OWNER_PASSWORD: nextPassword },
    [nextPassword],
  );
  assert.deepEqual(
    await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }),
    owner,
  );
  assert.deepEqual(
    await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } }),
    tenant,
  );
  // Even an explicitly confirmed reset must reject missing credentials before deleting data.
  let rejected = false;
  try {
    run("scripts/create-demo-account.ts", {
      ...config,
      DEMO_OWNER_PASSWORD: "",
      DEMO_RESET: "1",
      DEMO_RESET_CONFIRM: "yes",
    });
  } catch {
    rejected = true;
  }
  assert(rejected);
  assert.deepEqual(
    await prisma.user.findUniqueOrThrow({ where: { id: owner.id } }),
    owner,
  );
  assert.deepEqual(
    await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } }),
    tenant,
  );
  console.log(
    "PASS: repeated bootstrap preserves legacy accounts/tenants/plans; explicit account creation is idempotent, credentials remain private, incomplete reset is rejected before deletion",
  );
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
