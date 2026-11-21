import { createServer, type Socket } from "node:net";
import { createServer as createHttpServer } from "node:http";
import type { ConfigService } from "@nestjs/config";
import {
  EmailNotificationProvider,
  WebhookNotificationProvider,
} from "./notifications.providers";

async function smtp(mode: "accept" | "reject" | "drop_after_data") {
  const sockets = new Set<Socket>();
  const messages: string[] = [];
  let connections = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    connections++;
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.write("220 local synthetic SMTP\r\n");
    let buffer = "",
      collecting = false,
      message = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (collecting) {
          if (line === ".") {
            messages.push(message);
            collecting = false;
            if (mode === "drop_after_data") socket.destroy();
            else socket.write("250 queued locally\r\n");
          } else message += line + "\r\n";
        } else if (/^(EHLO|HELO)/.test(line))
          socket.write("250 local synthetic SMTP\r\n");
        else if (/^MAIL FROM/.test(line))
          socket.write(
            mode === "reject"
              ? "550 sender rejected\r\n"
              : "250 sender accepted\r\n",
          );
        else if (/^RCPT TO/.test(line))
          socket.write("250 recipient accepted\r\n");
        else if (line === "DATA") {
          collecting = true;
          message = "";
          socket.write("354 send message\r\n");
        } else if (line === "QUIT") socket.end("221 goodbye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Missing synthetic SMTP address");
  const values: Record<string, unknown> = {
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: address.port,
    SMTP_FROM_EMAIL: "sender@example.invalid",
  };
  const provider = new EmailNotificationProvider({
    get: (name: string) => values[name],
  } as ConfigService);
  return {
    provider,
    messages,
    connections: () => connections,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
const input = {
  historyId: "synthetic-history",
  target: {
    recipientEmail: "recipient@example.invalid",
    subject: "Local test",
    message: "<b>Plain synthetic content</b>",
  },
};

describe("Notification transport outcomes on synthetic loopback servers", () => {
  it("records SMTP acceptance and sends plain text without interpolating HTML", async () => {
    const server = await smtp("accept");
    try {
      const result = await server.provider.send(input);
      expect(result.ok).toBe(true);
      expect(result.providerMessageId).toEqual(expect.any(String));
      expect(server.messages).toHaveLength(1);
      expect(server.messages[0]).toContain("Content-Type: text/plain");
      expect(server.messages[0]).not.toContain("Content-Type: text/html");
    } finally {
      await server.close();
    }
  });
  it("does not infer a safe retry when SMTP closes after DATA before the acknowledgement", async () => {
    const server = await smtp("drop_after_data");
    try {
      const result = await server.provider.send(input);
      expect(server.messages).toHaveLength(1);
      expect(result).toMatchObject({
        ok: false,
        outcome: "uncertain",
        retrySafe: false,
      });
    } finally {
      await server.close();
    }
  });
  it("classifies an explicit SMTP envelope rejection before DATA as not started", async () => {
    const server = await smtp("reject");
    try {
      expect(await server.provider.send(input)).toMatchObject({
        ok: false,
        outcome: "not_started",
        retrySafe: false,
      });
      expect(server.messages).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
  it("rejects a combined recipient field before opening an SMTP connection", async () => {
    const server = await smtp("accept");
    try {
      expect(
        await server.provider.send({
          ...input,
          target: {
            ...input.target,
            recipientEmail: "one@example.invalid,two@example.invalid",
          },
        }),
      ).toMatchObject({ ok: false, outcome: "not_started" });
      expect(server.connections()).toBe(0);
    } finally {
      await server.close();
    }
  });
  it("allows a retry only when the TCP connect syscall definitively failed", async () => {
    const listener = createServer();
    await new Promise<void>((resolve) =>
      listener.listen(0, "127.0.0.1", resolve),
    );
    const address = listener.address();
    if (!address || typeof address === "string")
      throw Error("Missing synthetic address");
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    const provider = new EmailNotificationProvider({
      get: (name: string) =>
        name === "SMTP_HOST"
          ? "127.0.0.1"
          : name === "SMTP_PORT"
            ? address.port
            : undefined,
    } as ConfigService);
    expect(await provider.send(input)).toMatchObject({
      ok: false,
      outcome: "not_started",
      retrySafe: true,
    });
  });
  it("keeps a webhook outcome uncertain after the receiver records a POST and drops the response", async () => {
    let received = 0;
    const server = createHttpServer(async (request, response) => {
      for await (const _chunk of request) {
        /* drain synthetic request */
      }
      received++;
      response.destroy();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Missing synthetic webhook address");
    try {
      const provider = new WebhookNotificationProvider({
        get: () => 1000,
      } as unknown as ConfigService);
      expect(
        await provider.send({
          historyId: "synthetic",
          target: {
            recipientWebhookUrl: `http://127.0.0.1:${address.port}/event`,
          },
          payload: { tenantId: "synthetic", eventType: "synthetic" },
        }),
      ).toMatchObject({ ok: false, outcome: "uncertain" });
      expect(received).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
