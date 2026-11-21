/** Real consumer/SDK/SQL and fresh recovery process. Connect transport is synthetic, never a real runner. */
import assert from "node:assert/strict";
import { randomUUID, createDecipheriv } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const base = "http://127.0.0.1:53029",
  health = await (await fetch(base + "/health")).json();
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
  return { status: r.status, data: await r.json() };
}
const state = (await control({ connectionState: "connected" })).data,
  checks = [];
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
const row = (id) =>
  JSON.parse(
    sql(
      `SELECT row_to_json(c) FROM "NotificationAutomationCommand" c WHERE "tenantId"=${quote(state.actors.automation_manager.tenantId)} AND "commandId"=${quote(id)}`,
    ),
  );
const worker = async (action, id, commandId, payload, status = 200) => {
  const result = await control({ worker: action, id, commandId, payload });
  assert.equal(result.status, status, JSON.stringify(result.data));
  return result.data;
};
async function api(path, body, actor = "automation_manager") {
  const r = await fetch(base + "/notifications/automation-grants" + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + state.actors[actor].session.accessToken,
      Origin: "http://127.0.0.1:53030",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  assert.equal(r.status, 201, JSON.stringify(data));
  return data;
}
const grant = await api("", {
  idempotencyKey: randomUUID(),
  channel: "whatsapp",
  archiveId: state.installations[0].archiveId,
  validDays: 3,
});
const payload = {
  kind: "text",
  to: "+393330000002",
  text: "PRIVATE ORIGINAL SYNTHETIC REMINDER",
};
const sendCalls = async () =>
  (await control()).data.calls.filter(
    (c) => c.method === "POST" && c.route.endsWith("/messages"),
  ).length;
const count = async () => (await control()).data.installations[0].outbox.length;
const queued = randomUUID(),
  message = await worker("send", grant.id, queued, payload);
const withdrawn = await worker("withdraw", grant.id, queued, payload);
assert.equal(withdrawn.outcome, "withdrawn");
assert.equal(withdrawn.message.state, "cancelled");
assert.equal(withdrawn.message.id, message.id);
const beforeReplay = await sendCalls();
assert.deepEqual(
  await worker("withdraw", grant.id, queued, payload),
  withdrawn,
);
assert.equal(
  (await worker("send", grant.id, queued, payload)).state,
  "cancelled",
);
assert.equal(await sendCalls(), beforeReplay);
const stored = row(queued);
assert(
  stored.sendStartedAt &&
    stored.withdrawRequestedAt &&
    stored.withdrawResolvedAt,
);
assert.equal(stored.withdrawOutcome, "withdrawn");
assert(!JSON.stringify(stored).includes(payload.text));
assert(!stored.payloadCipher.includes(payload.to));
const [version, iv, tag, body] = stored.payloadCipher.split(".");
assert.equal(version, "v1");
const decipher = createDecipheriv(
  "aes-256-gcm",
  Buffer.from("c".repeat(64), "hex"),
  Buffer.from(iv, "base64url"),
);
decipher.setAuthTag(Buffer.from(tag, "base64url"));
assert.deepEqual(
  JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString(),
  ),
  payload,
);
checks.push(
  "queued-command-withdrawn-with-original-key-id-and-encrypted-payload-durable-receipt-and-no-send-on-replay",
);

const absent = randomUUID(),
  beforeAbsent = await count();
const withdrawals = await Promise.all(
  Array.from({ length: 3 }, () =>
    worker("withdraw", grant.id, absent, payload),
  ),
);
const preventive = withdrawals[0];
withdrawals.forEach((value) => assert.deepEqual(value, preventive));
assert.equal(preventive.outcome, "withdrawn");
assert.equal(await count(), beforeAbsent + 1);
assert.equal(row(absent).sendStartedAt, null);
assert.equal(
  (
    await worker("send", grant.id, absent, {
      text: payload.text,
      to: payload.to,
      kind: payload.kind,
    })
  ).id,
  preventive.message.id,
);
assert.equal(await sendCalls(), beforeReplay);
await worker(
  "withdraw",
  grant.id,
  absent,
  { ...payload, text: "different" },
  409,
);
const replacement = await api("", {
  idempotencyKey: randomUUID(),
  channel: "whatsapp",
  archiveId: state.installations[0].archiveId,
  validDays: 3,
});
await worker("withdraw", replacement.id, absent, payload, 409);
assert.equal((await worker("message", grant.id, absent)).state, "cancelled");
checks.push(
  "concurrent-preventive-withdrawals-create-one-original-command-and-outbox-tombstone-canonical-input-replay-and-different-payload-or-grant-conflicts",
);

for (const status of ["sending", "sent", "uncertain", "failed", "cancelled"]) {
  const id = randomUUID(),
    receipt = await worker("send", grant.id, id, payload);
  await control({
    delegatedMessage: {
      id: receipt.id,
      state: status,
      error: status === "cancelled" ? "revoked_before_dispatch" : null,
    },
  });
  const result = await worker("withdraw", grant.id, id, payload);
  assert.equal(
    result.outcome,
    ["failed", "cancelled"].includes(status)
      ? "already_terminal"
      : "effect_started",
  );
  assert.equal(result.message.state, status);
  assert.equal(result.message.id, receipt.id);
  assert.equal(row(id).withdrawOutcome, result.outcome);
}
checks.push(
  "all-acquired-and-terminal-states-return-typed-current-outcome-without-falsely-declaring-cancellation",
);

const revoked = await api("", {
  idempotencyKey: randomUUID(),
  channel: "whatsapp",
  archiveId: state.installations[0].archiveId,
  validDays: 3,
});
await api("/" + revoked.id + "/revoke", {});
await control({
  flags: { centralGrantDenied: true, advanceGrantClockMs: 10 * 86400000 },
});
const afterRevocation = randomUUID();
assert.equal(
  (await worker("withdraw", revoked.id, afterRevocation, payload)).outcome,
  "withdrawn",
);
assert.equal(
  (await worker("message", revoked.id, afterRevocation)).state,
  "cancelled",
);
await worker("send", revoked.id, randomUUID(), payload, 403);
await control({ flags: { centralGrantDenied: false, advanceGrantClockMs: 0 } });
checks.push(
  "revoked-expired-and-currently-denied-grant-still-allows-withdrawal-and-receipt-ownership-without-authorizing-new-send",
);

const lost = randomUUID();
await worker("send", grant.id, lost, payload);
await control({ flags: { loseWithdrawalResponse: true } });
await worker("withdraw", grant.id, lost, payload, 503);
assert(row(lost).withdrawRequestedAt);
assert.equal(row(lost).withdrawResolvedAt, null);
assert.equal(row(lost).lastReceipt.state, "queued");
sql(
  `UPDATE "NotificationAutomationCommand" SET "nextAttemptAt"=now()-interval '1 minute' WHERE "commandId"=${quote(lost)}`,
);
await control({ expireTokenActor: "automation_manager" });
const fresh = () =>
  JSON.parse(
    execFileSync(
      "docker",
      [
        "exec",
        "alora-step11-qa-" + health.database.slice("step11_qa_".length),
        "node",
        "/qa/automation-worker-qa.cjs",
        "recover-withdrawals",
      ],
      { stdio: "pipe", encoding: "utf8", timeout: 20000 },
    ),
  );
const callsBeforeRecovery = await sendCalls();
assert.equal(fresh().freshProcess, true);
assert.equal(row(lost).withdrawOutcome, "withdrawn");
assert.equal(row(lost).lastReceipt.state, "cancelled");
assert.equal(await sendCalls(), callsBeforeRecovery);
checks.push(
  "lost-withdrawal-ack-retains-durable-pending-request-and-fresh-session-free-process-recovers-same-command-without-any-send",
);

for (const flag of ["deferDelegatedCommit", "delayDelegatedAck"]) {
  const id = randomUUID();
  await control({ flags: { [flag]: true } });
  const pendingSend = worker("send", grant.id, id, payload);
  for (
    let i = 0;
    i < 50 && !(await control()).data.automation.deferredMessage;
    i++
  )
    await new Promise((r) => setTimeout(r, 20));
  assert((await control()).data.automation.deferredMessage);
  const stopped = await worker("withdraw", grant.id, id, payload);
  await control({ releaseMessageCommit: true });
  const late = await pendingSend;
  assert.equal(stopped.outcome, "withdrawn");
  assert.equal(late.id, stopped.message.id);
  assert.equal(late.state, "cancelled");
  assert.equal(row(id).lastReceipt.state, "cancelled");
}
checks.push(
  "consumer-concurrency-before-provider-commit-and-late-queued-ack-keeps-cancelled-receipt-with-original-identity",
);

const malformed = randomUUID();
await control({ flags: { malformedWithdrawal: true } });
await worker("withdraw", grant.id, malformed, payload, 502);
assert.equal(row(malformed).withdrawOutcome, null);
assert.equal(row(malformed).lastReceipt, null);
await control({ flags: { malformedWithdrawal: false } });
sql(
  `UPDATE "NotificationAutomationCommand" SET "nextAttemptAt"=now()-interval '1 minute' WHERE "commandId"=${quote(malformed)}`,
);
fresh();
assert.equal(row(malformed).withdrawOutcome, "withdrawn");
checks.push(
  "malformed-positive-withdrawal-pair-never-completes-local-request-and-is-reconciled-from-persisted-original",
);

assert.throws(() =>
  sql(
    `UPDATE "NotificationAutomationCommand" SET "payloadCipher"='replacement' WHERE "commandId"=${quote(queued)}`,
  ),
);
assert.throws(() =>
  sql(
    `UPDATE "NotificationAutomationCommand" SET "withdrawRequestedAt"=null WHERE "commandId"=${quote(queued)}`,
  ),
);
assert.throws(() =>
  sql(
    `DELETE FROM "NotificationAutomationCommand" WHERE "commandId"=${quote(queued)}`,
  ),
);
assert.throws(() =>
  sql(
    `UPDATE "NotificationAutomationCommand" SET "lastReceipt"=jsonb_set("lastReceipt",'{state}','"queued"') WHERE "commandId"=${quote(queued)}`,
  ),
);
const tenant = state.actors.automation_manager.tenantId;
sql(
  `BEGIN; DELETE FROM "Tenant" WHERE id=${quote(tenant)}; DO $$ BEGIN IF EXISTS(SELECT 1 FROM "NotificationAutomationCommand" WHERE "tenantId"=${quote(tenant)}) THEN RAISE EXCEPTION 'Command orphan'; END IF; END $$; ROLLBACK;`,
);
assert.equal(row(queued).withdrawOutcome, "withdrawn");
const audit = sql(
  `SELECT coalesce(jsonb_agg(to_jsonb(a))::text,'[]') FROM "AuditLog" a`,
);
assert(!audit.includes(payload.text) && !audit.includes(payload.to));
const traces = (await control()).data.calls.filter((c) =>
  c.route.endsWith("/withdraw"),
);
assert(
  traces.length &&
    traces.every((c) => !c.personalToken && c.delegationCredential),
);
checks.push(
  "SQL-fences-freeze-command-and-terminal-receipt-retain-activity-owned-history-and-allow-only-complete-tenant-cascade-no-payload-in-audit",
);
const result = {
  checkedAt: new Date().toISOString(),
  sdkVersion: health.sdkVersion,
  database: health.database,
  realSdk: true,
  realPostgresql: true,
  connectTransport: "synthetic-loopback",
  providerLockEngineVerifiedByConsumer: false,
  freshRecoveryProcess: true,
  realAccounts: false,
  realMessages: false,
  checks,
};
mkdirSync(".local/step12/sdk-012-rc2", { recursive: true, mode: 0o700 });
writeFileSync(
  ".local/step12/sdk-012-rc2/withdrawals-http-result.json",
  JSON.stringify(result, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(result, null, 2));
