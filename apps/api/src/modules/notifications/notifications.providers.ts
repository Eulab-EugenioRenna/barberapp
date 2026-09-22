import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NotificationChannel } from "@prisma/client";
import { createTransport } from "nodemailer";
import {
  NotificationEventPayload,
  NotificationProvider,
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
  }): Promise<{ ok: boolean; providerMessageId?: string; error?: string }> {
    if (!input.target.recipientEmail) {
      return { ok: false, error: "Recipient email is missing" };
    }

    const transporter = createTransport({
      host: this.configService.get<string>("SMTP_HOST"),
      port: Number(this.configService.get<string>("SMTP_PORT") ?? 1025),
      secure: false,
      auth: this.configService.get<string>("SMTP_USER")
        ? {
            user: this.configService.get<string>("SMTP_USER"),
            pass: this.configService.get<string>("SMTP_PASS"),
          }
        : undefined,
    });

    const info = await transporter.sendMail({
      from: `${this.configService.get<string>("SMTP_FROM_NAME") ?? "Barber SaaS"} <${this.configService.get<string>("SMTP_FROM_EMAIL") ?? "no-reply@barber.test"}>`,
      to: input.target.recipientEmail,
      subject: input.target.subject ?? "Notifica Barber SaaS",
      text: input.target.message,
      html: `<p>${input.target.message}</p>`,
      headers: {
        "x-notification-history-id": input.historyId,
      },
    });

    return {
      ok: true,
      providerMessageId: info.messageId,
    };
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
  }): Promise<{ ok: boolean; providerMessageId?: string; error?: string }> {
    if (!input.target.recipientWebhookUrl) {
      return { ok: false, error: "Webhook URL is missing" };
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
          error: `Webhook returned ${response.status}`,
        };
      }

      return {
        ok: true,
        providerMessageId: response.headers.get("x-request-id") ?? undefined,
      };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error ? error.message : "Webhook request failed",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
