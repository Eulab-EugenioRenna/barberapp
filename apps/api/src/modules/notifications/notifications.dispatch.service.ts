import { Injectable } from "@nestjs/common";
import { NotificationChannel } from "@prisma/client";
import {
  EmailNotificationProvider,
  InAppNotificationProvider,
  WebhookNotificationProvider,
} from "./notifications.providers";
import { NotificationProvider } from "./notifications.types";
import { NotificationsService } from "./notifications.service";
import { AppointmentAutomationDispatch } from "./appointment-automation-dispatch.service";

@Injectable()
export class NotificationsDispatchService {
  private readonly providers: NotificationProvider[];

  constructor(
    private readonly notificationsService: NotificationsService,
    inAppProvider: InAppNotificationProvider,
    emailProvider: EmailNotificationProvider,
    webhookProvider: WebhookNotificationProvider,
    private readonly automations: AppointmentAutomationDispatch,
  ) {
    this.providers = [inAppProvider, emailProvider, webhookProvider];
  }

  async dispatchHistory(notificationHistoryId: string): Promise<void> {
    if (
      await this.automations.dispatchIfKnown(
        notificationHistoryId,
        this.notificationsService,
      )
    )
      return;
    const history = await this.notificationsService.claimHistory(
      notificationHistoryId,
    );
    if (!history?.dispatchToken) return;
    const token = history.dispatchToken;
    let effectStarted = false;
    let acceptedId: string | undefined;
    let accepted = false;
    try {
      if (
        !(await this.automations.authorizeHistory(history)) ||
        !(await this.notificationsService.dispatchPolicyActive(history))
      ) {
        await this.notificationsService.finishHistory(history.id, token, {
          status: "skipped",
          reason:
            "Recipient, scope or notification policy no longer permits dispatch",
        });
        return;
      }
      if (history.channel === NotificationChannel.in_app) {
        await this.notificationsService.finishHistory(history.id, token, {
          status: "sent",
          providerMessageId: `in-app:${history.id}`,
        });
        return;
      }
      const provider = this.providers.find(
        (item) =>
          item.channel === history.channel &&
          item.providerKey === history.providerKey,
      );
      if (!provider) {
        await this.notificationsService.finishHistory(history.id, token, {
          status: "skipped",
          reason: "Notification provider not available",
        });
        return;
      }
      const payload = (history.payload ?? {}) as Record<string, unknown>;
      effectStarted = true;
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

      accepted = result.ok;
      acceptedId = result.providerMessageId;
      await this.notificationsService.finishHistory(
        history.id,
        token,
        result.ok
          ? { status: "sent", providerMessageId: result.providerMessageId }
          : result.outcome === "not_started"
            ? {
                status: "failed",
                retrySafe: result.retrySafe === true,
                reason: "Provider rejected before dispatch started",
              }
            : {
                status: "uncertain",
                reason: "Provider outcome not confirmed; no automatic resend",
              },
      );
    } catch {
      await this.notificationsService.finishHistory(
        history.id,
        token,
        accepted
          ? { status: "sent", providerMessageId: acceptedId }
          : effectStarted
            ? {
                status: "uncertain",
                reason: "Dispatch outcome not confirmed; no automatic resend",
              }
            : {
                status: "failed",
                retrySafe: true,
                reason: "Dispatch preparation failed before external effect",
              },
      );
    }
  }
}
