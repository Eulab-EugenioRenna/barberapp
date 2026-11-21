/** Controlled multi-session proof of booking/configuration serialization in disposable PostgreSQL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const base = "http://127.0.0.1:53027",
  health = await (await fetch(base + "/health")).json();
assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
const fixture = JSON.parse(
  readFileSync(".local/step10/rescheduling-http-result.json", "utf8"),
);
assert.equal(fixture.database, health.database);
const f = fixture.fixture;
const sqlArgs = [
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
];
const sql = (q) =>
  execFileSync("docker", sqlArgs, { input: q, stdio: "pipe" })
    .toString()
    .trim();
const asyncSql = (q) =>
  new Promise((resolve, reject) => {
    const job = spawn("docker", [...sqlArgs, "-c", q], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    job.stdout.on("data", (chunk) => (out += chunk));
    job.stderr.on("data", (chunk) => (err += chunk));
    job.on("error", reject);
    job.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err)),
    );
  });
async function raw(route, body, method) {
  const response = await fetch(base + route, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
async function call(route, body, method) {
  const r = await raw(route, body, method);
  assert(r.status < 300, JSON.stringify(r));
  return r.data;
}
const hours = (end) =>
  Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    isWorkingDay: true,
    startTime: "10:00",
    endTime: end,
  }));
const day = "2047-01-04",
  weekday = (new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7;
await call(
  `/collaborators/${f.personId}`,
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
      startsAt: day + "T09:00:00Z",
    },
  ],
});
const route = `/appointments/${booking.id}`,
  checks = [];
const awaitCondition = async (predicate, message) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
};
const scenarios = [
  {
    name: "location-opening-update",
    time: "12:00",
    write: () =>
      call(
        `/locations/${f.locationId}`,
        { weeklyHours: hours("12:00") },
        "PATCH",
      ),
    restore: () =>
      call(
        `/locations/${f.locationId}`,
        { weeklyHours: hours("16:00") },
        "PATCH",
      ),
    rejectNext: true,
  },
  {
    name: "direct-nested-weekly-schedule-update",
    time: "13:00",
    write: () =>
      asyncSql(
        `UPDATE "CollaboratorWeeklySchedule" SET "endTime"='12:00' WHERE "collaboratorId"='${f.personId}' AND weekday=${weekday}`,
      ),
    restore: () =>
      asyncSql(
        `UPDATE "CollaboratorWeeklySchedule" SET "endTime"='19:00' WHERE "collaboratorId"='${f.personId}' AND weekday=${weekday}`,
      ),
    rejectNext: true,
  },
  {
    name: "tenant-configuration-update",
    time: "12:00",
    write: () =>
      asyncSql(`UPDATE "Tenant" SET timezone=timezone WHERE id='__http_a'`),
    restore: async () => {},
    rejectNext: false,
  },
];
try {
  for (const scenario of scenarios) {
    const account = await call(route + "/order"),
      command = {
        idempotencyKey: randomUUID(),
        revision: account.revision,
        startsAt: `${day}T${scenario.time}:00Z`,
      };
    await call("/__qa/pause-next-plan", {});
    const moving = raw(route, command, "PATCH");
    let writing;
    try {
      await awaitCondition(
        async () => (await call("/__qa/paused-plan")).paused,
        "Booking did not reach the controlled plan barrier",
      );
      let settled = false;
      writing = scenario.write().then(
        (value) => {
          settled = true;
          return { value };
        },
        (error) => {
          settled = true;
          return { error };
        },
      );
      await awaitCondition(() => {
        assert.equal(
          settled,
          false,
          "Configuration committed before booking released the shared lock",
        );
        return (
          Number(
            sql(
              `SELECT count(*) FROM pg_stat_activity WHERE datname='${health.database}' AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND wait_event='advisory'`,
            ),
          ) >= 1
        );
      }, "Configuration transaction never waited for booking's tenant lock");
    } finally {
      await call("/__qa/release-plan", {});
    }
    const moved = await moving;
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    const written = await writing;
    if (written?.error) throw written.error;
    const current = await call(route);
    assert.equal(current.startsAt, new Date(command.startsAt).toISOString());
    if (scenario.rejectNext) {
      const rejected = await raw(
        route,
        {
          idempotencyKey: randomUUID(),
          revision: current.orderItem.sale.revision,
          startsAt: day + "T12:30:00Z",
        },
        "PATCH",
      );
      assert.equal(rejected.status, 409, scenario.name + ": " + JSON.stringify(rejected.data));
      assert.equal((await call(route)).startsAt, current.startsAt);
    }
    await scenario.restore();
    checks.push(
      `${scenario.name}-waits-in-postgresql-until-real-booking-transaction-commits-and-later-booking-sees-new-configuration`,
    );
  }
  assert.equal(
    sql(
      `SELECT count(*) FROM "PaymentEntry" WHERE "saleId"='${booking.orderId}'`,
    ),
    "0",
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM "StockMovement" WHERE "saleId"='${booking.orderId}'`,
    ),
    "0",
  );
  const result = {
    checkedAt: new Date().toISOString(),
    database: health.database,
    identity: "isolated-synthetic-http-and-postgresql-sessions",
    providerCalls: false,
    checks,
  };
  writeFileSync(
    ".local/step10/calendar-configuration-http-result.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await call("/__qa/release-plan", {});
  for (const scenario of scenarios) await scenario.restore();
  const current = await call(route + "/order");
  await call(route + "/order/cancel", {
    idempotencyKey: randomUUID(),
    revision: current.revision,
    reason: "Release owned configuration concurrency fixture",
  });
}
