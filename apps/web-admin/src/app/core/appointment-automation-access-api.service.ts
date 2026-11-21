import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import type {
  AppointmentAutomationChannel,
  AppointmentAutomationGrantView,
  AppointmentAutomationWebhookView,
} from "@barber/shared/automations";
import {
  beginPendingCommand,
  clearPendingCommand,
  readPendingCommand,
  type PendingCommand,
} from "@barber/shared/utils";
import { ADMIN_API_URL } from "./api-config";
import { SessionStore } from "./session.store";

@Injectable({ providedIn: "root" })
export class AppointmentAutomationAccessApiService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  private readonly root = `${ADMIN_API_URL}/notifications/automation-`;
  private key(kind: "grants" | "webhooks") {
    const user = this.session.currentUser();
    if (!user?.id || !user.tenantId)
      throw new Error("Sessione non disponibile");
    return `alora.automation.${kind}:${user.tenantId}:${user.id}`;
  }
  pending(kind: "grants" | "webhooks") {
    try {
      return readPendingCommand(sessionStorage, this.key(kind));
    } catch {
      return { kind: "unreadable" } as const;
    }
  }
  list() {
    return firstValueFrom(
      this.http.get<AppointmentAutomationGrantView[]>(this.root + "grants"),
    );
  }
  webhook() {
    return firstValueFrom(
      this.http.get<AppointmentAutomationWebhookView>(this.root + "webhooks"),
    );
  }
  prepare(
    channel: AppointmentAutomationChannel,
    validDays: number,
    archiveId?: string,
    useCase: "notifications" | "customer_commands" = "notifications",
  ) {
    const kind = "grants",
      key = this.key(kind);
    const command = beginPendingCommand(sessionStorage, key, {
      channel,
      validDays,
      ...(useCase === "customer_commands" ? { useCase } : {}),
      ...(channel === "whatsapp" ? { archiveId } : {}),
    });
    return this.execute<AppointmentAutomationGrantView>(kind, key, command);
  }
  prepareWebhook() {
    const kind = "webhooks",
      key = this.key(kind);
    return this.execute<AppointmentAutomationWebhookView>(
      kind,
      key,
      beginPendingCommand(sessionStorage, key, {}),
    );
  }
  resume(kind: "grants" | "webhooks") {
    const pending = this.pending(kind);
    if (pending.kind !== "pending")
      throw new Error(
        "Richiesta non leggibile: verifica lo stato prima di proseguire",
      );
    return this.execute(kind, this.key(kind), pending.command);
  }
  private async execute<T>(
    kind: "grants" | "webhooks",
    key: string,
    command: PendingCommand,
  ) {
    const result = await firstValueFrom(
      this.http.post<T>(this.root + kind, command.body),
    );
    clearPendingCommand(sessionStorage, key, command.body.idempotencyKey);
    return result;
  }
  action(id: string, action: "recover" | "revoke") {
    return firstValueFrom(
      this.http.post<AppointmentAutomationGrantView>(
        `${this.root}grants/${encodeURIComponent(id)}/${action}`,
        {},
      ),
    );
  }
}
