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
          revision: form.orderRevision,
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
        lines: [{ serviceId, collaboratorId }, ...additionalLines],
      }),
    );
  }

  async cancelAppointment(id: string): Promise<void> {
    await firstValueFrom(
      this.adminApi.cancelAppointment(id, {
        reason: "Annullato dalla direzione del salone",
      }),
    );
  }

  async removeAppointment(id: string): Promise<void> {
    await firstValueFrom(this.adminApi.deleteAppointment(id));
  }

  async moveAppointment(input: {
    id: string;
    collaboratorId: string;
    startsAt: string;
    revision: number;
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
