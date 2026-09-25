import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { AdminApiService } from "../core/admin-api.service";

@Injectable({ providedIn: "root" })
export class AppointmentsService {
  private readonly adminApi = inject(AdminApiService);

  async saveAppointment(form: any): Promise<void> {
    const payload = {
      customerId: form.customerId || undefined,
      customerName: form.customerName,
      email: form.email,
      phone: form.phone,
      serviceId: form.serviceId,
      collaboratorId: form.collaboratorId || undefined,
      startsAt: new Date(form.startsAt).toISOString(),
      status: form.status,
      customerNotes: form.customerNotes,
    };

    if (form.id) {
      await firstValueFrom(this.adminApi.updateAppointment(form.id, payload));
      return;
    }

    await firstValueFrom(this.adminApi.createAppointment(payload));
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
  }): Promise<void> {
    await firstValueFrom(
      this.adminApi.updateAppointment(input.id, {
        collaboratorId: input.collaboratorId,
        startsAt: new Date(input.startsAt).toISOString(),
      }),
    );
  }
}
