import { Injectable } from "@nestjs/common";
import { NotificationChannel } from "@prisma/client";
import {
  EmailNotificationProvider,
  InAppNotificationProvider,
  WebhookNotificationProvider,
} from "./notifications.providers";
import { NotificationProvider } from "./notifications.types";
import { NotificationsService } from "./notifications.service";

@Injectable()
export class NotificationsDispatchService {
  private readonly providers: NotificationProvider[];

  constructor(
    private readonly notificationsService: NotificationsService,
    inAppProvider: InAppNotificationProvider,
    emailProvider: EmailNotificationProvider,
    webhookProvider: WebhookNotificationProvider,
  ) {
    this.providers = [inAppProvider, emailProvider, webhookProvider];
  }

  async dispatchHistory(notificationHistoryId: string): Promise<void> {
    const history = await this.notificationsService.getHistoryById(
      notificationHistoryId,
    );

    if (history.channel === NotificationChannel.in_app) {
      await this.notificationsService.markHistoryAsSent(
        history.id,
        `in-app:${history.id}`,
      );
      return;
    }

    const provider = this.providers.find(
      (item) =>
        item.channel === history.channel &&
        item.providerKey ===
          (typeof (history.payload as Record<string, unknown> | null)?.[
            "providerKey"
          ] === "string"
            ? ((history.payload as Record<string, unknown>)[
                "providerKey"
              ] as string)
            : item.providerKey),
    );

    if (!provider) {
      await this.notificationsService.markHistoryAsSkipped(
        history.id,
        `Provider not found for ${history.channel}`,
      );
      return;
    }

    const payload = (history.payload ?? {}) as Record<string, unknown>;
    const result = await provider.send({
      historyId: history.id,
      target: {
        channel: history.channel,
        providerKey:
          typeof payload["providerKey"] === "string"
            ? (payload["providerKey"] as string)
            : provider.providerKey,
        recipientType:
          (payload["recipientType"] as
            | "user"
            | "collaborator"
            | "customer"
            | "webhook"
            | null) ?? "user",
        recipientUserId: history.recipientUserId ?? undefined,
        customerId: history.customerId ?? undefined,
        recipientEmail:
          typeof payload["recipientEmail"] === "string"
            ? (payload["recipientEmail"] as string)
            : undefined,
        recipientWebhookUrl:
          typeof payload["recipientWebhookUrl"] === "string"
            ? (payload["recipientWebhookUrl"] as string)
            : undefined,
        title:
          typeof payload["renderedTitle"] === "string"
            ? payload["renderedTitle"]
            : undefined,
        subject:
          typeof payload["renderedSubject"] === "string"
            ? payload["renderedSubject"]
            : undefined,
        message:
          typeof payload["renderedMessage"] === "string"
            ? payload["renderedMessage"]
            : history.eventType,
      },
      payload: payload as never,
    });

    if (result.ok) {
      await this.notificationsService.markHistoryAsSent(
        history.id,
        result.providerMessageId,
      );
      return;
    }

    await this.notificationsService.markHistoryAsFailed(
      history.id,
      result.error ?? "Notification dispatch failed",
    );

    throw new Error(result.error ?? "Notification dispatch failed");
  }
}
