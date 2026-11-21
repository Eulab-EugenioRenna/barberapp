/** Business professional profiles only, on the disposable synthetic DB. Never changes Connect accounts. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const base = "http://127.0.0.1:53027",
  health = await (await fetch(base + "/health")).json();
assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
const source = JSON.parse(
  readFileSync(".local/step10/cashier-fulfilment-http-result.json", "utf8"),
);
assert.equal(source.database, health.database);
const sectorId = JSON.parse(
  execFileSync(
    "docker",
    [
      "exec",
      "barber-postgres-1",
      "psql",
      "-X",
      "-U",
      "barber",
      "-d",
      health.database,
      "-Atqc",
      `SELECT to_json("sectorId") FROM "Service" WHERE id='${source.fixture.serviceIds[0]}'`,
    ],
    { stdio: "pipe" },
  )
    .toString()
    .trim(),
);
const ids = Array.from({ length: 205 }, () => randomUUID());
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
    "-v",
    "ON_ERROR_STOP=1",
  ],
  {
    input: `BEGIN; INSERT INTO "Collaborator" (id,"tenantId","firstName","lastName") VALUES ${ids.map((id, i) => `('${id}','__http_a','AAAA Operational ${i}','Padding')`).join(",")}; INSERT INTO "CollaboratorSector" ("collaboratorId","sectorId") VALUES ${ids.map((id) => `('${id}','${sectorId}')`).join(",")}; COMMIT;`,
    stdio: "pipe",
  },
);
const response = await fetch(
  base + "/collaborators/" + source.fixture.actualId,
  {
    method: "PATCH",
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ firstName: "ZZZ Beyond Catalog Page" }),
  },
);
assert(response.ok, await response.text());
const first = await (
  await fetch(base + "/collaborators?page=1&pageSize=200", {
    headers: { Authorization: "Bearer owner" },
  })
).json();
assert.equal(first.items.length, 200);
assert(first.hasMore);
assert(!first.items.some((row) => row.id === source.fixture.actualId));
const checks = ["operational-target-is-outside-the-first-200-catalog-entries"];
async function options(subject = "owner", headers = {}, status = 200) {
  const r = await fetch(base + "/collaborators/options", {
    headers: { Authorization: "Bearer " + subject, ...headers },
  });
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
const all = await options();
assert(all.length > 200);
assert(all.some((row) => row.id === source.fixture.actualId));
assert.equal(new Set(all.map((row) => row.id)).size, all.length);
for (const row of all) {
  assert.equal(
    Object.keys(row).sort().join(","),
    "firstName,id,lastName,sectors",
  );
  assert(row.sectors.every((s) => Object.keys(s).join(",") === "sectorId"));
}
checks.push(
  "complete-active-professional-projection-is-unique-and-contains-only-names-IDs-and-permitted-sector-IDs",
);
await options("catalog_denied", {}, 403);
assert(
  !(await options("foreign")).some((row) => row.id === source.fixture.actualId),
);
execFileSync(
  "docker",
  [
    "exec",
    "barber-postgres-1",
    "psql",
    "-X",
    "-U",
    "barber",
    "-d",
    health.database,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `INSERT INTO "UserSectorAccess" ("userId","sectorId") VALUES ('__http_manager','${sectorId}') ON CONFLICT DO NOTHING`,
  ],
  { stdio: "pipe" },
);
const limited = await options("manager", { "X-Alora-Sector": sectorId });
assert(limited.some((row) => row.id === source.fixture.actualId));
assert(
  limited.every((row) => row.sectors.every((s) => s.sectorId === sectorId)),
);
execFileSync(
  "docker",
  [
    "exec",
    "barber-postgres-1",
    "psql",
    "-X",
    "-U",
    "barber",
    "-d",
    health.database,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `DELETE FROM "UserSectorAccess" WHERE "userId"='__http_manager' AND "sectorId"='${sectorId}'`,
  ],
  { stdio: "pipe" },
);
assert(
  !(await options("manager")).some((row) => row.id === source.fixture.actualId),
);
await options("manager", { "X-Alora-Sector": sectorId }, 403);
checks.push(
  "explicit-function-tenant-and-current-operational-membership-are-enforced-without-cached-revoked-options",
);
for (const active of [false, true]) {
  const r = await fetch(base + "/collaborators/" + source.fixture.actualId, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ isActive: active }),
  });
  assert(r.ok, await r.text());
  assert.equal(
    (await options()).some((row) => row.id === source.fixture.actualId),
    active,
  );
}
checks.push(
  "inactive-professionals-are-excluded-from-new-operational-choices-and-explicit-reactivation-is-reflected",
);
const result = {
  checkedAt: new Date().toISOString(),
  database: health.database,
  checks,
  paddingProfiles: ids.length,
  firstPageProfiles: first.items.length,
  targetBeyondFirstPage: true,
  realConnectAccountsModified: false,
  fixture: { actualId: source.fixture.actualId, sectorId },
};
writeFileSync(
  ".local/step13/operational-options-fixture.json",
  JSON.stringify(result, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify({ ...result, fixture: undefined }));
