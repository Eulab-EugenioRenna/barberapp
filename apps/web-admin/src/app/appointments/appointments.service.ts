import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { AdminApiService } from "../core/admin-api.service";
import { bookingInstant } from "./booking-local-time";

@Injectable({ providedIn: "root" })
export class AppointmentsService {
  private readonly adminApi = inject(AdminApiService);

  async saveAppointment(
    form: any,
    additionalLines: Array<{ serviceId: string; collaboratorId?: string }> = [],
  ): Promise<any> {
    const payload = {
      customerId: form.customerId || undefined,
      customerName: form.customerName,
      email: form.email,
      phone: form.phone,
      appointmentWhatsAppConsent: form.appointmentWhatsAppConsent === true,
      serviceId: form.serviceId,
      collaboratorId: form.collaboratorId || undefined,
      startsAt: bookingInstant(
        form.startsAt,
        form.heldStartsAt,
        form.heldLocal,
      ),
      status: form.status,
      customerNotes: form.customerNotes,
    };

    if (!payload.startsAt) throw new Error("Orario civile non valido");
    if (form.id) {
      return firstValueFrom(
        this.adminApi.updateAppointment(form.id, {
          revision: Number.isInteger(form.orderRevision)
            ? form.orderRevision
            : undefined,
          customerId: form.customerId || undefined,
          serviceId: form.serviceId,
          collaboratorId: form.collaboratorId || null,
          startsAt: payload.startsAt,
          status: form.status,
          customerNotes: form.customerNotes,
        }),
      );
    }

    const { serviceId, collaboratorId, ...common } = payload;
    return firstValueFrom(
      this.adminApi.createAppointment({
        ...common,
        // Services are performed by their activity at this location.
        ...(form.locationId ? { locationId: form.locationId } : {}),
        lines: [{ serviceId, collaboratorId }, ...additionalLines],
      }),
    );
  }

  async cancelAppointment(id: string): Promise<void> {
    await firstValueFrom(
      // The server records «Annullato dall'agenda»: no reason to type.
      this.adminApi.cancelAppointment(id, {}),
    );
  }

  async removeAppointment(id: string): Promise<void> {
    await firstValueFrom(this.adminApi.deleteAppointment(id));
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
