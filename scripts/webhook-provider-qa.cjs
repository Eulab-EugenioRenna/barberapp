/* Synthetic HTTPS registration and signing; never dispatches to the declared public URL. */
const { randomUUID, createHmac } = require("node:crypto");
module.exports = ({ json, flags }) => {
  const commands = new Map(),
    endpoints = new Map();
  return {
    summary: () => ({ count: endpoints.size }),
    disable: () => {
      for (const endpoint of endpoints.values()) endpoint.enabled = false;
    },
    sign(id, raw, timestamp) {
      const endpoint = endpoints.get(id);
      if (!endpoint) throw new Error("Synthetic endpoint missing");
      return createHmac("sha256", endpoint.secret)
        .update(`${timestamp}.${raw}`)
        .digest("hex");
    },
    handle(req, res, route, body, { installationId, actor, userId, context }) {
      if (!route.startsWith("/webhooks")) return false;
      if (
        !actor ||
        actor.revoked ||
        context?.binding.installationId !== installationId ||
        !actor.permissions.includes("whatsapp.manage")
      ) {
        json(res, 403, {});
        return true;
      }
      const response = (endpoint) =>
        flags.malformedWebhook
          ? { ...endpoint, url: "https://wrong.invalid/callback" }
          : endpoint;
      if (route.startsWith("/webhooks/by-key/")) {
        const key = decodeURIComponent(route.slice("/webhooks/by-key/".length));
        const endpoint = commands.get(
          JSON.stringify([installationId, userId, key]),
        );
        json(res, endpoint ? 200 : 404, endpoint ? response(endpoint) : {});
        return true;
      }
      if (route === "/webhooks" && req.method === "POST") {
        const key = req.headers["idempotency-key"],
          receipt = JSON.stringify([installationId, userId, key]);
        const old = commands.get(receipt);
        if (old && old.url !== body.url) {
          json(res, 409, {});
          return true;
        }
        const endpoint = old || {
          id: randomUUID(),
          url: body.url,
          enabled: true,
          secret: "synthetic-webhook-secret-" + randomUUID(),
        };
        commands.set(receipt, endpoint);
        endpoints.set(endpoint.id, endpoint);
        if (flags.loseWebhookResponse) {
          flags.loseWebhookResponse = false;
          res.destroy();
          return true;
        }
        json(res, old ? 200 : 201, response(endpoint));
        return true;
      }
      json(res, 404, {});
      return true;
    },
  };
};
