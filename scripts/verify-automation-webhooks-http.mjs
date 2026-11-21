/** Real SDK, original HTTP bytes and isolated PostgreSQL. Signing/provider are synthetic. */
import assert from "node:assert/strict";
import { randomUUID, createDecipheriv } from "node:crypto";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const base = "http://127.0.0.1:53029",
  root = "/notifications/automation-webhooks";
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
  assert.equal(r.status, 200);
  return r.json();
}
const state = await control(),
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
function open(cipher) {
  const [version, iv, tag, encrypted] = cipher.split(".");
  assert.equal(version, "v1");
  const d = createDecipheriv(
    "aes-256-gcm",
    Buffer.from("c".repeat(64), "hex"),
    Buffer.from(iv, "base64url"),
  );
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    d.update(Buffer.from(encrypted, "base64url")),
    d.final(),
  ]).toString("utf8");
}
const rows = (table) =>
  JSON.parse(
    sql(`SELECT coalesce(jsonb_agg(to_jsonb(r))::text,'[]') FROM "${table}" r`),
  );
async function call(
  body,
  {
    actor = "owner",
    status = body ? 201 : 200,
    origin = "http://127.0.0.1:53030",
  } = {},
) {
  const r = await fetch(base + root, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + state.actors[actor].session.accessToken,
      Origin: origin,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  assert.equal(r.status, status, text);
  assert(
    !/synthetic-webhook-secret|secretCipher|actorSubject|requestKey|endpointId/.test(
      text,
    ),
  );
  return JSON.parse(text);
}
const command = () => ({ idempotencyKey: randomUUID() });
assert.equal((await call()).status, "not_registered");
await call({ ...command(), secret: "injected" }, { status: 400 });
await call(command(), { origin: "https://foreign.invalid", status: 403 });
for (const actor of ["reader", "sender", "administrator", "partial"])
  await call(command(), { actor, status: 403 });
assert.equal(rows("NotificationAutomationWebhook").length, 0);
const input = command();
const [one, two] = await Promise.all([call(input), call(input)]);
assert.deepEqual(one, two);
assert.equal(one.status, "ready");
let row = rows("NotificationAutomationWebhook")[0];
assert.equal(row.id, one.id);
assert(
  row.secretCipher && !row.secretCipher.includes("synthetic-webhook-secret"),
);
assert.equal((await control()).automation.webhooks.count, 1);
await call(command());
assert.equal((await control()).automation.webhooks.count, 1);
await control({ flags: { malformedWebhook: true } });
await call(command(), { status: 502 });
await control({ flags: { malformedWebhook: false } });
assert.equal(
  rows("NotificationAutomationWebhook")[0].secretCipher,
  row.secretCipher,
);
assert.deepEqual(await call(undefined, { actor: "automation_manager" }), one);
checks.push(
  "whole-company-personal-author-origin-strict-input-concurrent-registration-and-encrypted-stable-recovery",
);

await control({ flags: { loseWebhookResponse: true } });
await call(command(), { actor: "foreign", status: 503 });
const pending = rows("NotificationAutomationWebhook").find(
  (r) => r.tenantId === state.actors.foreign.tenantId,
);
assert.equal(pending.status, "preparing");
assert.equal(pending.secretCipher, null);
async function post(id, raw, headers = {}, status = 202) {
  const r = await fetch(base + root + "/" + id + "/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: raw,
  });
  const text = await r.text();
  assert.equal(r.status, status, text);
  assert(!text.includes("synthetic-webhook-secret"));
  return text;
}
await post(pending.id, "{}", {}, 503);
const foreign = await call(command(), { actor: "foreign" });
assert.equal(foreign.id, pending.id);
assert.equal(foreign.status, "ready");
assert.equal((await control()).automation.webhooks.count, 2);
checks.push(
  "lost-provider-ack-keeps-preparing-receipt-and-recovers-same-endpoint-without-rotating-secret",
);

const installation = state.installations[0],
  now = () => new Date().toISOString();
function event(extra = {}) {
  return {
    id: randomUUID(),
    installationId: installation.id,
    sessionId: installation.session.id,
    kind: "message.interactive_response",
    createdAt: now(),
    payload: {
      messageId: randomUUID(),
      providerId: "synthetic-provider-id",
      sessionId: installation.session.id,
      messageSessionId: installation.session.id,
      archiveId: installation.archiveId,
      chatId: "393330000002@c.us",
      direction: "in",
      fromMe: false,
      senderId: "393330000002@c.us",
      recipientId: "393330000001@c.us",
      occurredAt: now(),
      observedAt: now(),
      timestampSource: "provider",
      source: "whatsapp_provider",
      addressingVerified: true,
      kind: "buttons_response",
      body: {
        text: "PRIVATE-TEXT-MUST-NOT-PERSIST",
        selectedButtonId: "synthetic-opaque-action",
        media: "PRIVATE-MEDIA-MUST-NOT-PERSIST",
      },
    },
    ...extra,
  };
}
async function signed(
  e,
  {
    raw = JSON.stringify(e),
    timestamp = String(Math.floor(Date.now() / 1000)),
    id = row.id,
    endpointId = row.endpointId,
    headers = {},
    status = 202,
  } = {},
) {
  const { signature } = await control({
    signWebhook: { endpointId, raw, timestamp },
  });
  return post(
    id,
    raw,
    {
      "X-Eulab-Event-Id": e.id,
      "X-Eulab-Timestamp": timestamp,
      "X-Eulab-Signature": signature,
      ...headers,
    },
    status,
  );
}
await post(randomUUID(), "{}", {}, 404);
const valid = event(),
  raw = JSON.stringify(valid, null, 2);
await signed(valid, {
  raw,
  headers: { Origin: "https://browser.invalid" },
  status: 403,
});
await signed(valid, {
  raw,
  headers: { "Sec-Fetch-Site": "none" },
  status: 403,
});
await signed(valid, {
  raw,
  timestamp: String(Math.floor(Date.now() / 1000) - 400),
  status: 401,
});
await signed(valid, {
  raw,
  headers: { "X-Eulab-Signature": "0".repeat(64) },
  status: 401,
});
await signed(valid, {
  raw,
  headers: { "X-Eulab-Event-Id": randomUUID() },
  status: 400,
});
await signed(event({ installationId: state.installations[1].id }), {
  status: 400,
});
await signed(valid, { raw: "{invalid", status: 400 });
const signedRaw = await control({
  signWebhook: {
    endpointId: row.endpointId,
    raw,
    timestamp: String(Math.floor(Date.now() / 1000)),
  },
});
await post(
  row.id,
  raw + " ",
  {
    "X-Eulab-Event-Id": valid.id,
    "X-Eulab-Timestamp": String(Math.floor(Date.now() / 1000)),
    "X-Eulab-Signature": signedRaw.signature,
  },
  401,
);
assert.equal(rows("NotificationAutomationWebhookEvent").length, 0);
checks.push(
  "signature-over-original-bytes-no-browser-ingress-expiry-json-and-installation-validation-before-durable-storage",
);

const counts = sql(
  'SELECT (SELECT count(*) FROM "Appointment")::text || \':\' || (SELECT count(*) FROM "Sale")::text',
);
await Promise.all([
  signed(valid, { raw }),
  signed(valid, { raw }),
  signed(valid, { raw }),
]);
let receipts = rows("NotificationAutomationWebhookEvent");
assert.equal(receipts.length, 1);
assert.equal(receipts[0].status, "received");
assert(receipts[0].payloadCipher);
assert(!JSON.stringify(receipts).includes("PRIVATE-"));
const minimal = JSON.parse(open(receipts[0].payloadCipher));
assert.equal(minimal.selectedButtonId, valid.payload.body.selectedButtonId);
assert(!JSON.stringify(minimal).includes("PRIVATE-"));
assert(!("body" in minimal));
await signed(
  { ...valid, payload: { ...valid.payload, providerId: "different" } },
  { status: 409 },
);
if (valid.id !== valid.id.toUpperCase())
  await signed({ ...valid, id: valid.id.toUpperCase() }, { status: 409 });
assert.equal(rows("NotificationAutomationWebhookEvent").length, 1);
assert.equal(
  sql(
    'SELECT (SELECT count(*) FROM "Appointment")::text || \':\' || (SELECT count(*) FROM "Sale")::text',
  ),
  counts,
);
assert.throws(() =>
  sql(
    `UPDATE "NotificationAutomationWebhookEvent" SET "bodyHash"=repeat('0',64) WHERE id=${quote(receipts[0].id)}`,
  ),
);
assert.throws(() =>
  sql(
    `DELETE FROM "NotificationAutomationWebhookEvent" WHERE id=${quote(receipts[0].id)}`,
  ),
);
assert.throws(() =>
  sql(
    `UPDATE "NotificationAutomationWebhook" SET "secretCipher"='replacement' WHERE id=${quote(row.id)}`,
  ),
);
checks.push(
  "durable-encrypted-minimal-interactive-receipt-concurrent-dedup-conflict-detection-sql-immutability-no-booking-or-money-effect",
);

for (const patch of [
  { direction: "out" },
  { fromMe: true },
  { addressingVerified: false },
  { timestampSource: "connect" },
  { sessionId: randomUUID() },
  { occurredAt: new Date(Date.now() + 600000).toISOString() },
  { body: { text: "no action", selectedButtonId: null } },
]) {
  const e = event();
  e.payload = { ...e.payload, ...patch };
  await signed(e);
}
await signed(event({ kind: "message.received" }));
const large = event({ kind: "message.media" });
large.payload = { media: "x".repeat(200000) };
await signed(large);
receipts = rows("NotificationAutomationWebhookEvent");
assert.equal(receipts.filter((r) => r.status === "received").length, 1);
assert(
  receipts
    .filter((r) => r.status === "ignored")
    .every((r) => !r.payloadCipher && r.processedAt),
);
const normal = await fetch(base + root, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ large: "x".repeat(200000) }),
});
assert.equal(normal.status, 413);
await post(
  row.id,
  gzipSync(Buffer.from(JSON.stringify(event()))),
  { "Content-Encoding": "gzip" },
  415,
);
checks.push(
  "outgoing-ambiguous-addressing-connect-timestamps-and-noninteractive-events-ignored-without-payload-normal-api-size-limit-and-uncompressed-signature-boundary",
);

await control({ disableWebhooks: true });
const disabled = await call(command());
assert.equal(disabled.status, "disabled");
await call(command());
assert.equal((await control()).automation.webhooks.count, 2);
const ignored = event();
await signed(ignored);
assert.equal(
  rows("NotificationAutomationWebhookEvent").find(
    (r) => r.eventId === ignored.id,
  ).reason,
  "webhook_disabled",
);
assert.throws(() =>
  sql(
    `UPDATE "NotificationAutomationWebhook" SET status='ready' WHERE id=${quote(row.id)}`,
  ),
);
checks.push(
  "central-disabled-endpoint-recovery-never-reenables-and-subsequent-events-close-with-visible-reason",
);
const result = {
  checkedAt: now(),
  database: health.database,
  sdkVersion: health.sdkVersion,
  realSdk: true,
  realDatabase: true,
  provider: "synthetic-loopback",
  publicWebhookDelivery: false,
  realAccounts: false,
  realMessages: false,
  customerActionsApplied: false,
  checks,
};
mkdirSync(".local/step12/sdk-012-rc2", { recursive: true });
writeFileSync(
  ".local/step12/sdk-012-rc2/webhooks-http-result.json",
  JSON.stringify(result, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(result, null, 2));
