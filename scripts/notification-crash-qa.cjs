/** A killed isolated dispatch process must leave a durable uncertain attempt, never a safe retry. */
const assert = require("node:assert/strict");
const database = new URL(process.env.DATABASE_URL).pathname.slice(1);
assert(
  process.env.ALORA_STEP12_TEST_ONLY === "1" &&
    /^step7_http_\d+$/.test(database),
);
const load = (p) => require("/app/dist/apps/api/" + p);
const { PrismaClient } = require("@prisma/client");
const { NotificationsService } = load(
  "modules/notifications/notifications.service",
);
const { NotificationsDispatchService } = load(
  "modules/notifications/notifications.dispatch.service",
);
const prisma = new PrismaClient();
const notifications = new NotificationsService(prisma, {
  get: async () => null,
  set: async () => {},
  del: async () => {},
});
const provider = {
  channel: "email",
  providerKey: "email.smtp",
  send: async (input) => {
    await prisma.$executeRaw`INSERT INTO "__step12_provider_attempt" ("historyId") VALUES (${input.historyId})`;
    process.kill(process.pid, "SIGKILL");
  },
};
(async () => {
  await require('/qa/appointment-automation-qa-runtime.cjs')({prisma,notifications,queue:{},providers:[{},provider,{}]}).dispatch.dispatchHistory(process.argv[2]);
  throw Error("Synthetic crash point was not reached");
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
