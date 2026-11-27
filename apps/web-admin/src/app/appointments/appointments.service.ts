import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { AdminApiService } from "../core/admin-api.service";
import { ADMIN_API_URL } from "../core/api-config";

/** Booking calls of the agenda: one editor, a few plain requests. */
@Injectable({ providedIn: "root" })
export class AppointmentsService {
  private readonly adminApi = inject(AdminApiService);
  private readonly http = inject(HttpClient);

  private url(id: string, tail = ""): string {
    return `${ADMIN_API_URL}/appointments/${encodeURIComponent(id)}${tail}`;
  }

  /** The whole booking (all its services) of one appointment, any date. */
  loadBooking(id: string): Promise<any> {
    return firstValueFrom(this.http.get(this.url(id, "/order")));
  }

  /** One appointment with notes and customer, also outside the agenda window. */
  loadAppointment(id: string): Promise<any> {
    return firstValueFrom(this.http.get(this.url(id)));
  }

  create(payload: Record<string, unknown>): Promise<any> {
    return firstValueFrom(this.adminApi.createAppointment(payload));
  }

  /** One appointment: status, time, people, notes and customer in one save. */
  patch(id: string, body: Record<string, unknown>): Promise<any> {
    return firstValueFrom(this.adminApi.updateAppointment(id, body));
  }

  /** Several services at once (added rows, moves in sequence). */
  reviseBooking(id: string, body: Record<string, unknown>): Promise<any> {
    return firstValueFrom(this.http.patch(this.url(id, "/order"), body));
  }

  slots(input: {
    appointmentId?: string;
    date: string;
    locationId?: string;
    line: { serviceId: string; collaboratorId?: string; roomId?: string };
  }): Promise<any> {
    if (input.appointmentId)
      return firstValueFrom(
        this.adminApi.reschedulingAvailability(input.appointmentId, {
          date: input.date,
          lines: [input.line],
        }),
      );
    return firstValueFrom(
      this.adminApi.bookingAvailability({
        date: input.date,
        ...(input.locationId ? { locationId: input.locationId } : {}),
        lines: [input.line],
      }),
    );
  }

  async moveAppointment(input: {
    id: string;
    collaboratorId: string;
    startsAt: string;
    /** Sent when known; the server checks it only for price changes. */
    revision?: number;
  }): Promise<void> {
    await firstValueFrom(
      this.adminApi.updateAppointment(input.id, {
        revision: input.revision,
        collaboratorId: input.collaboratorId,
        startsAt: input.startsAt,
      }),
    );
  }
}
