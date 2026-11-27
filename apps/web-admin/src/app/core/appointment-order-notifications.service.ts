import { selectedOperationalScope } from "./operational-context.service";
import { firstValueFrom } from "rxjs";
import { SessionStore } from "./session.store";
import { SessionRefreshService } from "./session-refresh.service";
import { Injectable, inject, signal } from "@angular/core";
import { ADMIN_API_URL } from "./api-config";
import { parseAppointmentOrderSseFrame } from "./sse.utils";

@Injectable({ providedIn: "root" })
export class AppointmentOrderNotificationsService {
  private readonly store = inject(SessionStore);
  private readonly refresh = inject(SessionRefreshService);
  readonly appointments = signal<any[]>([]);
  readonly connected = signal(false);

  private controller: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private activeToken = "";
  /** Consecutive failures, for exponential backoff (3s, 6s, … 60s). */
  private failures = 0;

  connect(token: string): void {
    if (!token || !this.store.can("sales.read")) {
      this.stop();
      return;
    }
    if (this.activeToken === token && this.controller) {
      return;
    }

    this.stop(false);
    this.activeToken = token;
    const controller = new AbortController();
    this.controller = controller;
    void this.consumeStream(token, controller);
  }

  /**
   * Opened once by the shell for the whole session: a stream already open (or
   * waiting to reconnect) is left alone, even when the access token rotates.
   */
  ensureConnected(token: string): void {
    if (this.controller || this.reconnectTimer) {
      if (!this.store.can("sales.read")) this.stop();
      return;
    }
    this.connect(token);
  }

  dismiss(appointmentId: string): void {
    this.appointments.update((items) =>
      items.filter((appointment) => appointment.id !== appointmentId),
    );
  }

  stop(clearAppointments = true): void {
    this.activeToken = "";
    this.controller?.abort();
    this.controller = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connected.set(false);
    if (clearAppointments) {
      this.appointments.set([]);
    }
  }

  private async consumeStream(
    token: string,
    controller: AbortController,
  ): Promise<void> {
    try {
      if (this.store.needsRefresh() && this.store.refreshToken())
        await firstValueFrom(this.refresh.refresh());
      if (controller.signal.aborted) return;
      token = this.store.token();
      this.activeToken = token;
      const scope = selectedOperationalScope(this.store.currentUser()?.id || "");
      const response = await fetch(`${ADMIN_API_URL}/notifications/stream`, {
        headers: {
          Accept: "text/event-stream",
          "X-Alora-Location": scope.locationId,
          "X-Alora-Sector": scope.sectorId,
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        // Expired or revoked session: renew once, never loop on rejected credentials.
        await this.handleRejected(controller, response.status);
        return;
      }
      if (!response.ok || !response.body) {
        throw new Error(`SSE connection failed (${response.status})`);
      }

      this.failures = 0;
      this.connected.set(true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder
          .decode(value, { stream: true })
          .replace(/\r\n/g, "\n");
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) {
          this.applyFrame(frame);
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        this.connected.set(false);
      }
    } finally {
      if (this.controller !== controller) {
        return;
      }
      this.controller = null;
      this.connected.set(false);
      if (!controller.signal.aborted && this.activeToken === token && this.store.token()) {
        const delay = Math.min(60_000, 3_000 * 2 ** this.failures);
        this.failures++;
        this.reconnectTimer = setTimeout(() => this.connect(this.store.token()), delay);
      }
    }
  }

  private async handleRejected(controller: AbortController, status: number): Promise<void> {
    const previous = this.store.token();
    if (status === 401 && this.store.refreshToken()) {
      try {
        await firstValueFrom(this.refresh.refresh(true));
      } catch {
        // refresh() clears the session on definitive failures.
      }
    }
    if (controller.signal.aborted || this.controller !== controller) return;
    const renewed = this.store.token();
    this.controller = null;
    if (status === 401 && renewed && renewed !== previous) {
      // New credentials: reconnect once, immediately.
      this.activeToken = "";
      this.connect(renewed);
      return;
    }
    // Still rejected: stop. The shell sends the user to login when the session is gone.
    this.stop(false);
  }

  private applyFrame(frame: string): void {
    const appointments = parseAppointmentOrderSseFrame(frame);
    if (appointments !== null) {
      this.appointments.set(appointments);
    }
  }
}
