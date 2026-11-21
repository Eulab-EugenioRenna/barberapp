/* TEST ONLY. Read-only planner invocation in the disposable QA database. */
if (
  process.env.ALORA_STEP7_TEST_ONLY !== "1" ||
  !/^\/step7_http_\d+$/.test(
    new URL(process.env.DATABASE_URL || "postgres://invalid/invalid").pathname,
  )
)
  throw Error("Requires disposable QA database");
const { PrismaService } = require("/app/dist/apps/api/prisma/prisma.service");
const {
  BookingResourcesService,
} = require("/app/dist/apps/api/modules/orders/booking-resources.service");
const {
  CollaboratorScheduleService,
} = require("/app/dist/apps/api/modules/availability/collaborator-schedule.service");
const {
  lockOperationalTenant,
} = require("/app/dist/apps/api/common/operational-lock");
(async () => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input);
  const prisma = new PrismaService();
  try {
    const planner = new BookingResourcesService(
      new CollaboratorScheduleService(prisma),
    );
    const rows = await prisma.$transaction(async (tx) => {
      await lockOperationalTenant(tx, "__http_a");
      return planner.plan(
        tx,
        "__http_a",
        "Europe/Rome",
        request.lines.map((row) => ({
          ...row,
          startsAt: new Date(row.startsAt),
        })),
        { publicOnly: request.publicOnly === true, scope: request.scope },
      );
    });
    process.stdout.write(
      JSON.stringify({
        rows: rows.map((row) => ({
          serviceId: row.serviceId,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          collaboratorId: row.collaboratorId,
          roomId: row.roomId,
        })),
      }),
    );
  } catch (error) {
    if (typeof error.getStatus !== "function") throw error;
    process.stdout.write(
      JSON.stringify({
        error: { status: error.getStatus(), response: error.getResponse() },
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
