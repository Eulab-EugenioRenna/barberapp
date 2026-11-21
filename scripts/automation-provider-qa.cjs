/* Synthetic Connect automations transport only. Real SDK/consumer persistence are tested separately. */
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
module.exports = function automationProvider({
  contexts,
  actors,
  tokens,
  installations,
  flags,
  calls,
  json,
}) {
  const grants = new Map(),
    keys = new Map();
  const hooks = require("/qa/webhook-provider-qa.cjs")({ json, flags });
  let releaseCommit, releaseMessage;
  const stable = (value) =>
    JSON.stringify(value, (_key, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, v[k]]),
          )
        : v,
    );
  const active = (grant) => {
    const actor = Object.values(actors).find(
      (a) => a.userId === grant.actorUserId,
    );
    return (
      actor &&
      !actor.revoked &&
      !flags.centralGrantDenied &&
      !grant.delegation.revokedAt &&
      Date.parse(grant.delegation.expiresAt) >
        Date.now() + (flags.advanceGrantClockMs || 0) &&
      grant.delegation.functions.every((key) => actor.permissions.includes(key))
    );
  };
  const response = (grant) => {
    const value = structuredClone({
      delegation: grant.delegation,
      credential: grant.credential,
    });
    if (flags.malformedGrant) value.delegation.actor = "wrong-subject";
    return value;
  };
  return {
    summary: () => ({
      webhooks: hooks.summary(),
      count: grants.size,
      revoked: [...grants.values()].filter((g) => g.delegation.revokedAt)
        .length,
      deferredCommit: !!releaseCommit,
      deferredMessage: !!releaseMessage,
    }),
    sign: (...args) => hooks.sign(...args),
    disableHooks: () => hooks.disable(),
    releaseMessage: () => {
      releaseMessage?.();
      releaseMessage = undefined;
    },
    release: () => {
      releaseCommit?.();
      releaseCommit = undefined;
    },
    async handle(req, res, url, raw) {
      const match = /^\/v1\/installations\/([^/]+)\/automations(\/.*)$/.exec(
        url.pathname,
      );
      if (!match) return false;
      const installationId = match[1],
        route = match[2];
      const binding = [...contexts.values()].find(
        (c) => c.binding.installationId === installationId,
      )?.binding;
      if (
        !binding ||
        req.headers["x-installation-id"] !== installationId ||
        req.headers["x-installation-secret"] !== binding.secret
      ) {
        json(res, 401, {});
        return true;
      }
      assert(!req.headers.origin && !req.headers["sec-fetch-site"]);
      const userId = tokens.get(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
      );
      const actor = Object.values(actors).find((a) => a.userId === userId);
      const context = [...contexts.values()].find((c) => c.user.id === userId);
      const body = raw ? JSON.parse(raw) : undefined;
      if (
        hooks.handle(req, res, route, body, {
          installationId,
          actor,
          userId,
          context,
        })
      )
        return true;
      calls.push({
        route: "automations" + route,
        method: req.method,
        personalToken: !!req.headers.authorization,
        delegationCredential: !!req.headers["x-connect-delegation"],
      });
      if (route === "/delegations" && req.method === "POST") {
        if (
          !actor ||
          actor.revoked ||
          context.binding.installationId !== installationId ||
          !body.functions.every((k) => actor.permissions.includes(k))
        ) {
          json(res, 403, {});
          return true;
        }
        const key = req.headers["idempotency-key"];
        assert(/^[A-Za-z0-9_-]{8,128}$/.test(key));
        const receipt = stable([installationId, userId, key]),
          fingerprint = stable(body);
        const existing = keys.get(receipt);
        if (existing) {
          json(
            res,
            existing.fingerprint === fingerprint ? 200 : 409,
            existing.fingerprint === fingerprint ? response(existing) : {},
          );
          return true;
        }
        const create = () => {
          const grant = {
            fingerprint,
            actorUserId: userId,
            credential: "synthetic-grant-secret-" + randomUUID(),
            delegation: {
              id: randomUUID(),
              installationId,
              appId: "alora-step11-test",
              actor: context.user.subject,
              ...body,
              archiveId: body.archiveId || null,
              revision: 1,
              revokedAt: null,
              createdAt: new Date().toISOString(),
            },
          };
          keys.set(receipt, grant);
          grants.set(grant.delegation.id, grant);
          return grant;
        };
        if (flags.deferGrantCommit) {
          flags.deferGrantCommit = false;
          res.destroy();
          await new Promise((resolve) => {
            releaseCommit = resolve;
          });
          create();
          return true;
        }
        const grant = create();
        if (flags.loseGrantResponse) {
          flags.loseGrantResponse = false;
          res.destroy();
          return true;
        }
        json(res, 201, response(grant));
        return true;
      }
      if (route.startsWith("/delegations/by-key/")) {
        if (!actor || actor.revoked) {
          json(res, 403, {});
          return true;
        }
        const grant = keys.get(
          stable([
            installationId,
            userId,
            decodeURIComponent(route.slice("/delegations/by-key/".length)),
          ]),
        );
        if (grant && !active(grant)) {
          json(res, 403, {});
          return true;
        }
        json(res, grant ? 200 : 404, grant ? response(grant) : {});
        return true;
      }
      const parts = /^\/delegations\/([^/]+)(.*)$/.exec(route),
        grant = parts && grants.get(parts[1]);
      if (!grant || grant.delegation.installationId !== installationId) {
        json(res, 404, {});
        return true;
      }
      const credential = req.headers["x-connect-delegation"];
      if (credential !== grant.credential && userId !== grant.actorUserId) {
        json(res, 403, {});
        return true;
      }
      if (parts[2] === "" && req.method === "DELETE") {
        grant.delegation.revokedAt ||= new Date().toISOString();
        if (flags.loseGrantRevoke) {
          flags.loseGrantRevoke = false;
          res.destroy();
          return true;
        }
        json(res, 200, grant.delegation);
        return true;
      }
      if (parts[2] === "" && req.method === "GET") {
        json(res, 200, grant.delegation);
        return true;
      }
      if (parts[2] === "/verify") {
        if (flags.malformedVerification) {
          json(res, 200, { allowed: "yes", reason: "must-not-project" });
          return true;
        }
        json(res, 200, {
          allowed:
            !!active(grant) &&
            body.purpose === grant.delegation.purpose &&
            body.channel === grant.delegation.channel &&
            stable([...body.functions].sort()) ===
              stable([...grant.delegation.functions].sort()),
          reason: active(grant) ? "allowed" : "denied",
        });
        return true;
      }
      const withdrawal = /^\/messages\/by-key\/([^/]+)\/withdraw$/.exec(
        parts[2],
      );
      if (withdrawal && req.method === "POST") {
        assert.equal(credential, grant.credential);
        const key = decodeURIComponent(withdrawal[1]),
          installation = installations.get(installationId);
        let message = installation.outbox.get(key);
        const fingerprint = stable([grant.delegation.id, body]);
        if (message && message.fingerprint !== fingerprint) {
          json(res, 409, {});
          return true;
        }
        if (
          !message &&
          (grant.delegation.channel !== "whatsapp" ||
            body.purpose !== grant.delegation.purpose ||
            installation.session.id !== body.sessionId ||
            installation.session.archive_id !== grant.delegation.archiveId)
        ) {
          json(res, 409, {});
          return true;
        }
        if (!message) {
          const value = {
            id: randomUUID(),
            sessionId: body.sessionId,
            state: "cancelled",
            providerId: null,
            error: "command_withdrawn",
            createdAt: new Date().toISOString(),
          };
          message = {
            id: value.id,
            session_id: body.sessionId,
            state: value.state,
            fingerprint,
            grantId: grant.delegation.id,
            delegatedStatus: value,
          };
          installation.outbox.set(key, message);
        }
        if (message.delegatedStatus.state === "queued") {
          message.state = "cancelled";
          message.delegatedStatus = {
            ...message.delegatedStatus,
            state: "cancelled",
            error: "command_withdrawn",
          };
        }
        const state = message.delegatedStatus.state;
        const outcome = ["sending", "sent", "uncertain"].includes(state)
          ? "effect_started"
          : state === "cancelled" &&
              message.delegatedStatus.error === "command_withdrawn"
            ? "withdrawn"
            : "already_terminal";
        if (flags.loseWithdrawalResponse) {
          flags.loseWithdrawalResponse = false;
          res.destroy();
          return true;
        }
        json(
          res,
          200,
          flags.malformedWithdrawal
            ? {
                outcome: "withdrawn",
                message: { ...message.delegatedStatus, state: "sent" },
              }
            : { outcome, message: message.delegatedStatus },
        );
        return true;
      }
      if (parts[2].startsWith("/messages/by-key/")) {
        const key = decodeURIComponent(
            parts[2].slice("/messages/by-key/".length),
          ),
          message = installations.get(installationId).outbox.get(key);
        if (!message || message.grantId !== grant.delegation.id) {
          json(res, 404, {});
          return true;
        }
        json(res, 200, message.delegatedStatus);
        return true;
      }
      if (parts[2] === "/messages" && req.method === "POST") {
        const installation = installations.get(installationId),
          key = req.headers["idempotency-key"];
        if (flags.deferDelegatedCommit) {
          flags.deferDelegatedCommit = false;
          await new Promise((resolve) => {
            releaseMessage = resolve;
          });
        }
        const fingerprint = stable([grant.delegation.id, body]),
          existing = installation.outbox.get(key);
        if (existing) {
          json(
            res,
            existing.fingerprint === fingerprint ? 200 : 409,
            existing.fingerprint === fingerprint
              ? existing.delegatedStatus
              : {},
          );
          return true;
        }
        if (!active(grant) || grant.delegation.channel !== "whatsapp") {
          json(res, 403, {});
          return true;
        }
        assert.equal(body.purpose, grant.delegation.purpose);
        if (
          !installation.session ||
          installation.session.id !== body.sessionId ||
          installation.session.archive_id !== grant.delegation.archiveId ||
          installation.session.state !== "connected"
        ) {
          json(res, 409, {});
          return true;
        }
        const value = {
          id: randomUUID(),
          sessionId: body.sessionId,
          state: "queued",
          providerId: null,
          error: null,
          createdAt: new Date().toISOString(),
        };
        installation.outbox.set(key, {
          id: value.id,
          session_id: body.sessionId,
          state: value.state,
          fingerprint,
          grantId: grant.delegation.id,
          delegatedStatus: value,
        });
        if (flags.delayDelegatedAck) {
          flags.delayDelegatedAck = false;
          await new Promise((resolve) => {
            releaseMessage = resolve;
          });
        }
        if (flags.loseDelegatedSend) {
          flags.loseDelegatedSend = false;
          res.destroy();
          return true;
        }
        json(res, 201, value);
        return true;
      }
      json(res, 404, {});
      return true;
    },
  };
};
