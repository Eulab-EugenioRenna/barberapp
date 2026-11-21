/** Real ALORA controller, SDK 0.12 and encrypted PostgreSQL receipts; provider is synthetic. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const base = "http://127.0.0.1:53029",
  root = "/notifications/automation-grants";
const health = await (await fetch(base + "/health")).json();
assert(health.testOnly && /^step11_qa_\d+$/.test(health.database));
assert.equal(health.sdkVersion, "0.12.0-rc.2");
async function control(body) {
  const r = await fetch(base + "/_qa", {
    method: body ? "POST" : "GET",
    headers: {
      "X-Alora-QA": "step11-synthetic",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  return { status: r.status, data };
}
let state = (await control()).data;
async function call(
  path,
  body,
  {
    actor = "owner",
    status = body ? 201 : 200,
    origin = "http://127.0.0.1:53030",
  } = {},
) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + state.actors[actor].session.accessToken,
      Origin: origin,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  assert.equal(r.status, status, path + ": " + text);
  assert(
    !/synthetic-grant-secret|credentialCipher|actorSubject|requestKey|sdkSessionCipher/.test(
      text,
    ),
  );
  return JSON.parse(text);
}
const sql = (q) =>
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
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: q, stdio: "pipe" },
  )
    .toString()
    .trim();
const quote = (s) => "'" + s.replaceAll("'", "''") + "'";
const grant = (id) =>
  JSON.parse(
    sql(
      `SELECT row_to_json(g) FROM "NotificationAutomationGrant" g WHERE id=${quote(id)}`,
    ),
  );
const worker = async (action, id, extra = {}, status = 200) => {
  const r = await control({ worker: action, id, ...extra });
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};
const checks = [],
  installation = state.installations.find(
    (i) => i.id !== state.installations[1].id,
  ),
  archiveId = installation.archiveId;
const input = (extra = {}) => ({
  idempotencyKey: randomUUID(),
  channel: "whatsapp",
  archiveId,
  validDays: 3,
  ...extra,
});
const before = (await control()).data.automation.count;
await control({ connectionState: "pairing" });
await call(root, input(), { status: 409 });
assert.equal(sql('SELECT count(*) FROM "NotificationAutomationGrant"'), "0");
await control({ connectionState: "connected" });
const command = input();
const parallel = await Promise.all([call(root, command), call(root, command)]);
assert.equal(parallel[0].id, parallel[1].id);
const first = parallel[0];
assert.equal(first.status, "ready");
assert.equal((await control()).data.automation.count, before + 1);
const stored = grant(first.id);
assert(
  stored.credentialCipher &&
    !stored.credentialCipher.includes("synthetic-grant-secret"),
);
assert.equal(stored.actorSubject, "subject-" + state.actors.owner.userId);
assert.equal((await call(root, command)).id, first.id);
assert.equal((await worker("verify", first.id)).allowed, true);
checks.push(
  "two-concurrent-create-commands-and-replays-share-one-remote-grant-with-encrypted-server-credential-and-safe-public-projection",
);
await call(root, { ...command, validDays: 4 }, { status: 409 });
await call(root, input({ channel: "email" }), { status: 400 });
await call(root, input({ functions: ["whatsapp.send"] }), { status: 400 });
await call(root, input(), { actor: "reader", status: 403 });
await call(root, input(), { actor: "administrator", status: 403 });
await call(root, input(), { actor: "partial", status: 403 });
await call(root, input(), { origin: "https://wrong.invalid", status: 403 });
await call(
  root + "/" + first.id + "/recover",
  {},
  { actor: "foreign", status: 404 },
);
await call(
  root + "/" + first.id + "/recover",
  {},
  { actor: "automation_manager", status: 403 },
);
const identity = JSON.stringify({
  request: stored.request,
  requestKey: stored.requestKey,
  sessionId: stored.sessionId,
});
assert.throws(() =>
  sql(
    `UPDATE "NotificationAutomationGrant" SET "installationId"='foreign' WHERE id=${quote(first.id)}`,
  ),
);
assert.throws(() =>
  sql(
    `UPDATE "NotificationAutomationGrant" SET "credentialCipher"='replacement' WHERE id=${quote(first.id)}`,
  ),
);
checks.push(
  "strict-payload-current-function-origin-whole-company-author-and-tenant-boundaries-and-SQL-immutable-identity",
);
const lost = input();
await control({ flags: { loseGrantResponse: true } });
await call(root, lost, { status: 503 });
const pending = (await call(root)).find((g) => g.status === "preparing");
assert(pending);
const persistedBefore = grant(pending.id);
assert.equal(persistedBefore.credentialCipher, null);
const recovered = await call(root, lost);
assert.equal(recovered.id, pending.id);
assert.equal(recovered.status, "ready");
assert.deepEqual(grant(recovered.id).request, persistedBefore.request);
assert.equal((await control()).data.automation.count, before + 2);
await control({ flags: { malformedGrant: true } });
const malformed = input();
await call(root, malformed, { status: 502 });
const malformedPending = (await call(root)).find(
  (g) => g.status === "preparing",
);
assert.equal(grant(malformedPending.id).credentialCipher, null);
await control({ flags: { malformedGrant: false } });
await call(root + "/" + malformedPending.id + "/recover", {});
checks.push(
  "lost-grant-ack-recovers-original-frozen-request-and-credential-and-malformed-actor-cannot-be-persisted-as-authorized",
);
const payload = {
  kind: "text",
  to: "393330000002@c.us",
  text: "Synthetic delegated appointment notification",
};
const messageCommand = randomUUID(),
  countBefore = (await control()).data.installations[0].outbox.length;
await control({ flags: { loseDelegatedSend: true } });
await worker("send", first.id, { commandId: messageCommand, payload }, 503);
assert.equal(
  (await control()).data.installations[0].outbox.length,
  countBefore + 1,
);
const receipt = await worker("message", first.id, {
  commandId: messageCommand,
});
assert.equal(receipt.state, "queued");
assert.equal(
  (await worker("send", first.id, { commandId: messageCommand, payload })).id,
  receipt.id,
);
await worker(
  "send",
  first.id,
  { commandId: messageCommand, payload: { ...payload, text: "conflict" } },
  409,
);
await worker("send", recovered.id, { commandId: messageCommand, payload }, 409);
assert.equal(
  (await control()).data.installations[0].outbox.length,
  countBefore + 1,
);
await control({ outboxState: "uncertain" });
assert.equal(
  (await worker("message", first.id, { commandId: messageCommand })).state,
  "uncertain",
);
assert.equal(
  (await control()).data.installations[0].outbox.length,
  countBefore + 1,
);
checks.push(
  "session-free-worker-keeps-same-domain-key-across-timeout-retry-and-replacement-grant-and-recovers-uncertain-receipt-without-requeue",
);
await control({ flags: { centralGrantDenied: true } });
assert.equal((await worker("verify", first.id)).allowed, false);
await worker("send", first.id, { commandId: randomUUID(), payload }, 403);
await control({
  flags: { centralGrantDenied: false, malformedVerification: true },
});
assert.equal((await worker("verify", first.id)).allowed, false);
await control({
  flags: { malformedVerification: false, advanceGrantClockMs: 4 * 86400000 },
});
assert.equal((await worker("verify", first.id)).allowed, false);
await control({ flags: { advanceGrantClockMs: 0 } });
const owner = state.actors.owner;
sql(`UPDATE "User" SET "isActive"=false WHERE id=${quote(owner.userId)}`);
assert.equal((await worker("verify", first.id)).allowed, false);
sql(`UPDATE "User" SET "isActive"=true WHERE id=${quote(owner.userId)}`);
sql(`UPDATE "Tenant" SET "isSuspended"=true WHERE id=${quote(owner.tenantId)}`);
assert.equal((await worker("verify", first.id)).allowed, false);
sql(
  `UPDATE "Tenant" SET "isSuspended"=false WHERE id=${quote(owner.tenantId)}`,
);
const managerGrant = await call(root, input(), { actor: "automation_manager" });
const managerId = state.actors.automation_manager.userId;
const access = JSON.parse(
  sql(
    `SELECT row_to_json(a) FROM "UserSectorAccess" a WHERE "userId"=${quote(managerId)} LIMIT 1`,
  ),
);
sql(
  `DELETE FROM "UserSectorAccess" WHERE "userId"=${quote(managerId)} AND "sectorId"=${quote(access.sectorId)}`,
);
assert.equal((await worker("verify", managerGrant.id)).allowed, false);
sql(
  `INSERT INTO "UserSectorAccess"("userId","sectorId") VALUES(${quote(managerId)},${quote(access.sectorId)})`,
);
assert.equal((await worker("verify", managerGrant.id)).allowed, true);
checks.push(
  "current-central-denial-expiry-malformed-positive-local-user-suspension-and-sector-revocation-fail-closed-before-send",
);
for (const channel of ["email", "application_notification"]) {
  const separate = await call(root, {
    idempotencyKey: randomUUID(),
    channel,
    validDays: 3,
  });
  assert.equal(grant(separate.id).request.archiveId, undefined);
  assert.deepEqual(grant(separate.id).request.functions, [
    "notifications.manage",
  ]);
  await worker("send", separate.id, { commandId: randomUUID(), payload }, 403);
  assert.equal((await worker("verify", separate.id)).allowed, true);
}
checks.push(
  "email-and-application-notification-use-distinct-function-scoped-grants-and-cannot-authorize-a-WhatsApp-send",
);
await control({ flags: { loseGrantRevoke: true } });
await call(root + "/" + first.id + "/revoke", {}, { status: 503 });
assert.equal(grant(first.id).status, "revocation_pending");
assert.equal((await worker("verify", first.id)).allowed, false);
assert.equal(
  (await worker("message", first.id, { commandId: messageCommand })).id,
  receipt.id,
);
assert.equal(
  (await call(root + "/" + first.id + "/revoke", {})).status,
  "revoked",
);
assert.equal((await call(root, command)).status, "revoked");
await call(root + "/" + managerGrant.id + "/revoke", {});
assert.equal(grant(managerGrant.id).status, "revoked");
checks.push(
  "lost-revoke-response-stops-local-sends-immediately-and-reconciles-repeatably-while-original-receipts-remain-readable",
);
await control({ flags: { deferGrantCommit: true } });
const deferred = input();
await call(root, deferred, { status: 503 });
const deferredPending = (await call(root)).find(
  (g) => g.status === "preparing",
);
assert(deferredPending);
assert.equal(
  (await call(root + "/" + deferredPending.id + "/revoke", {})).status,
  "revocation_pending",
);
await control({ releaseGrantCommit: true });
for (let i = 0; i < 20 && (await control()).data.automation.deferredCommit; i++)
  await new Promise((r) => setTimeout(r, 20));
assert.equal(
  (await call(root + "/" + deferredPending.id + "/revoke", {})).status,
  "revoked",
);
assert(grant(deferredPending.id).credentialCipher);
checks.push(
  "revoke-during-unknown-create-stays-pending-until-late-provider-commit-is-found-persisted-and-revoked",
);
assert.equal(
  JSON.stringify({
    request: grant(first.id).request,
    requestKey: grant(first.id).requestKey,
    sessionId: grant(first.id).sessionId,
  }),
  identity,
);
await control({ expireTokenActor: "owner" });
assert.equal((await worker("verify", recovered.id)).allowed, true);
const afterExpiryCommand = randomUUID();
const afterExpiryReceipt = await worker("send", recovered.id, {
  commandId: afterExpiryCommand,
  payload,
});
assert.equal(afterExpiryReceipt.state, "queued");
await call(root, undefined, { status: 401 });
assert.equal((await worker("verify", recovered.id)).allowed, true);
const freshWorker = JSON.parse(
  execFileSync(
    "docker",
    [
      "exec",
      "alora-step11-qa-" + health.database.slice("step11_qa_".length),
      "node",
      "/qa/automation-worker-qa.cjs",
      recovered.id,
      afterExpiryCommand,
      JSON.stringify(payload),
    ],
    { stdio: "pipe", encoding: "utf8", timeout: 20000 },
  ),
);
assert.equal(freshWorker.freshProcess, true);
assert.equal(freshWorker.receipt.id, afterExpiryReceipt.id);
const logs = (await control()).data.calls.filter(
  (c) =>
    c.route.startsWith("automations/") &&
    (c.route.endsWith("/verify") || c.route.includes("/messages")),
);
assert(
  logs.length > 0 &&
    logs.every((c) => !c.personalToken && c.delegationCredential),
);
const audit = sql(
  `SELECT coalesce(jsonb_agg(to_jsonb(a))::text,'[]') FROM "AuditLog" a`,
);
assert(
  !audit.includes("synthetic-grant-secret") &&
    !audit.includes("credentialCipher") &&
    !audit.includes(payload.text),
);
checks.push(
  "expired-and-invalidated-UI-session-does-not-power-worker-SDK-calls-and-no-credential-or-message-content-is-in-public-output-or-audit",
);
const result = {
  checkedAt: new Date().toISOString(),
  database: health.database,
  sdkVersion: health.sdkVersion,
  realSdk: true,
  provider: "synthetic-loopback",
  realAccounts: false,
  realProviderMessages: false,
  checks,
};
mkdirSync(".local/step12/sdk-012-rc2", { recursive: true, mode: 0o700 });
writeFileSync(
  ".local/step12/sdk-012-rc2/grants-http-result.json",
  JSON.stringify(result, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(result));
