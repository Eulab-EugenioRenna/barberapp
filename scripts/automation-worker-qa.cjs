/* Fresh-process proof only. Never runs against an operational database or provider. */
const database = new URL(
  process.env.DATABASE_URL || "postgres://invalid/invalid",
).pathname.slice(1);
if (
  process.env.ALORA_WHATSAPP_TEST_ONLY !== "1" ||
  !/^step11_qa_\d+$/.test(database)
)
  throw new Error("Disposable automation database required");
Object.assign(process.env, {
  NODE_ENV: "test",
  ALORA_CONNECT_SOURCE_ID: "step11-synthetic-source",
  ALORA_CONNECT_BOOTSTRAP_SECRET: "synthetic-bootstrap",
  ALORA_CONNECT_APP_ID: "alora-step11-test",
  ALORA_CONNECT_API_URL: "http://127.0.0.1:3011",
  ALORA_CONNECT_ISSUER: "http://127.0.0.1:3011/realms/test",
  ALORA_CONNECT_CLIENT_ID: "step11-client",
  ALORA_CONNECT_CALLBACK_URL: "http://127.0.0.1:53030/auth/connect/callback",
  ALORA_AUTH_RETURN_URL: "http://127.0.0.1:53030/admin/#/login",
  ALORA_CONNECT_ENCRYPTION_KEY: "c".repeat(64),
  ALORA_CONNECT_TENANTS_JSON: "{}",
});
const { PrismaClient } = require("@prisma/client");
const {
  NotificationAutomationGrantsService,
} = require("/app/dist/apps/api/modules/notifications/notification-automation-grants.service");
const {
  NotificationAutomationCommandStore,
} = require("/app/dist/apps/api/modules/notifications/notification-automation-command-store.service");
(async () => {
  const {
    NotificationAutomationWithdrawalRecovery,
  } = require("/app/dist/apps/api/modules/notifications/notification-automation-withdrawal-recovery.service");
  const prisma = new PrismaClient();
  try {
    const service = new NotificationAutomationGrantsService(
      prisma,
      new NotificationAutomationCommandStore(prisma),
    );
    if (process.argv[2] === "recover-withdrawals") {
      await new NotificationAutomationWithdrawalRecovery(
        new NotificationAutomationCommandStore(prisma),
        service,
      ).recover();
      console.log(
        JSON.stringify({ database, freshProcess: true, recovered: true }),
      );
      return;
    }
    if (process.argv[5] === "withdraw") {
      const withdrawal = await service.withdrawForWorker(
        process.argv[2],
        process.argv[3],
        JSON.parse(process.argv[4]),
      );
      console.log(JSON.stringify({ withdrawal, database, freshProcess: true }));
      return;
    }
    const verification = await service.verifyForWorker(process.argv[2]);
    if (!verification.allowed)
      throw new Error("Fresh worker authorization denied");
    const receipt = await service.sendForWorker(
      process.argv[2],
      process.argv[3],
      JSON.parse(process.argv[4]),
    );
    console.log(
      JSON.stringify({ verification, receipt, database, freshProcess: true }),
    );
  } finally {
    await prisma.$disconnect();
  }
})().catch(() => {
  console.error("Synthetic fresh-process worker failed");
  process.exitCode = 1;
});
