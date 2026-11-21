import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NotificationChannel } from "@prisma/client";
import { createTransport } from "nodemailer";
import { isEmail } from "class-validator";
import {
  NotificationEventPayload,
  NotificationProvider,
  NotificationProviderResult,
} from "./notifications.types";
import { NOTIFICATION_PROVIDER_KEYS } from "./notifications.constants";

@Injectable()
export class InAppNotificationProvider implements NotificationProvider {
  readonly channel = NotificationChannel.in_app;

  readonly providerKey = NOTIFICATION_PROVIDER_KEYS.inApp;

  async send(): Promise<{ ok: boolean; providerMessageId: string }> {
    return {
      ok: true,
      providerMessageId: `in-app:${Date.now()}`,
    };
  }
}

@Injectable()
export class EmailNotificationProvider implements NotificationProvider {
  readonly channel = NotificationChannel.email;

  readonly providerKey = NOTIFICATION_PROVIDER_KEYS.email;

  constructor(private readonly configService: ConfigService) {}

  async send(input: {
    historyId: string;
    target: { recipientEmail?: string; subject?: string; message: string };
  }): Promise<NotificationProviderResult> {
    if (!input.target.recipientEmail || !isEmail(input.target.recipientEmail)) {
      return {
        ok: false,
        outcome: "not_started",
        error: "Recipient email is missing",
      };
    }

    const transporter = createTransport({
      host: this.configService.get<string>("SMTP_HOST"),
      port: Number(this.configService.get<string>("SMTP_PORT") ?? 1025),
      secure: false,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: this.configService.get<string>("SMTP_USER")
        ? {
            user: this.configService.get<string>("SMTP_USER"),
            pass: this.configService.get<string>("SMTP_PASS"),
          }
        : undefined,
    });

    try {
      const info = await transporter.sendMail({
        from: `${this.configService.get<string>("SMTP_FROM_NAME") ?? "ALORA by EULAB"} <${this.configService.get<string>("SMTP_FROM_EMAIL") ?? "no-reply@barber.test"}>`,
        to: input.target.recipientEmail,
        subject: input.target.subject ?? "Notifica ALORA by EULAB",
        text: input.target.message,
        headers: {
          "x-notification-history-id": input.historyId,
        },
      });

      if (!info.accepted.length)
        return {
          ok: false,
          outcome: "not_started",
          error: "Recipient was not accepted",
        };
      return { ok: true, providerMessageId: info.messageId };
    } catch (error) {
      const failure = error as { code?: string; syscall?: string };
      const notStarted =
        failure.syscall === "connect" ||
        ["EAUTH", "EENVELOPE", "EDNS"].includes(failure.code || "");
      return {
        ok: false,
        outcome: notStarted ? "not_started" : "uncertain",
        retrySafe:
          notStarted &&
          failure.code !== "EAUTH" &&
          failure.code !== "EENVELOPE",
        error: "SMTP outcome requires verification",
      };
    }
  }
}

@Injectable()
export class WebhookNotificationProvider implements NotificationProvider {
  readonly channel = NotificationChannel.webhook;

  readonly providerKey = NOTIFICATION_PROVIDER_KEYS.webhook;

  constructor(private readonly configService: ConfigService) {}

  async send(input: {
    historyId: string;
    target: { recipientWebhookUrl?: string };
    payload: NotificationEventPayload;
  }): Promise<NotificationProviderResult> {
    if (!input.target.recipientWebhookUrl) {
      return {
        ok: false,
        outcome: "not_started",
        error: "Webhook URL is missing",
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(this.configService.get<string>("WEBHOOK_TIMEOUT_MS") ?? 5000),
    );

    try {
      const response = await fetch(input.target.recipientWebhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-notification-id": input.historyId,
          "x-notification-event": String(
            input.payload["eventType"] ?? "unknown",
          ),
        },
        body: JSON.stringify(input.payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          ok: false,
          outcome: "uncertain",
          error: `Webhook returned ${response.status}`,
        };
      }

      return {
        ok: true,
        providerMessageId: response.headers.get("x-request-id") ?? undefined,
      };
    } catch {
      return {
        ok: false,
        outcome: "uncertain",
        error: "Webhook outcome requires verification",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
