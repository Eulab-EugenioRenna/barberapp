import { Injectable, signal } from "@angular/core";
import { ADMIN_API_URL } from "./api-config";
import { parseAppointmentOrderSseFrame } from "./sse.utils";

@Injectable({ providedIn: "root" })
export class AppointmentOrderNotificationsService {
  readonly appointments = signal<any[]>([]);
  readonly connected = signal(false);

  private controller: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private activeToken = "";

  connect(token: string): void {
    if (!token) {
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
      const response = await fetch(`${ADMIN_API_URL}/notifications/stream`, {
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`SSE connection failed (${response.status})`);
      }

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
      if (!controller.signal.aborted && this.activeToken === token) {
        this.reconnectTimer = setTimeout(() => this.connect(token), 3_000);
      }
    }
  }

  private applyFrame(frame: string): void {
    const appointments = parseAppointmentOrderSseFrame(frame);
    if (appointments !== null) {
      this.appointments.set(appointments);
    }
  }
}
