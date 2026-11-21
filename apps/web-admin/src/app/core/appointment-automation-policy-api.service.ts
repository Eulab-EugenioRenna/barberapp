import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import type {
  AppointmentAutomationPolicyView,
  AppointmentAutomationSettings,
  AppointmentReminderPlan,
} from "@barber/shared/automations";
import type { LocationContext } from "./operational-context.service";
import { ADMIN_API_URL } from "./api-config";

@Injectable({ providedIn: "root" })
export class AppointmentAutomationPolicyApiService {
  private readonly http = inject(HttpClient);
  private readonly root = `${ADMIN_API_URL}/notifications/appointment-policy`;
  get() {
    return firstValueFrom(
      this.http.get<AppointmentAutomationPolicyView>(this.root),
    );
  }
  locations() {
    return firstValueFrom(
      this.http.get<LocationContext[]>(`${ADMIN_API_URL}/locations/context`),
    );
  }
  save(
    settings: AppointmentAutomationSettings,
    expectedRevision: number,
    texts: AppointmentAutomationPolicyView["texts"],
  ) {
    return firstValueFrom(
      this.http.patch<AppointmentAutomationPolicyView>(this.root, {
        settings,
        expectedRevision,
        texts,
      }),
    );
  }
  monitor(view: "recent" | "open_requests" = "recent") {
    return firstValueFrom(
      this.http.get<AppointmentAutomationRunView[]>(
        `${ADMIN_API_URL}/notifications/appointment-automations`,
        { params: { view } },
      ),
    );
  }
  review(id: string, expectedUpdatedAt: string) {
    return firstValueFrom(
      this.http.post(
        `${ADMIN_API_URL}/notifications/appointment-automations/${encodeURIComponent(id)}/review`,
        { expectedUpdatedAt },
      ),
    );
  }
  activate(
    expectedRevision: number,
    grants: {
      whatsapp: string;
      customerCommands: string;
      staff: string;
      email: string;
    },
  ) {
    return firstValueFrom(
      this.http.post<AppointmentAutomationPolicyView>(this.root + "/activate", {
        expectedRevision,
        whatsappGrantId: grants.whatsapp,
        actionGrantId: grants.customerCommands || null,
        staffGrantId: grants.staff || null,
        emailGrantId: grants.email || null,
      }),
    );
  }
  deactivate(expectedRevision: number) {
    return firstValueFrom(
      this.http.post<AppointmentAutomationPolicyView>(
        this.root + "/deactivate",
        { expectedRevision },
      ),
    );
  }
  preview(
    settings: AppointmentAutomationSettings,
    sectorId: string,
    localStartsAt: string,
    texts: AppointmentAutomationPolicyView["texts"],
  ) {
    return firstValueFrom(
      this.http.post<
        AppointmentReminderPlan & {
          sampleOnly: true;
          status: "draft";
          messagePreview: AppointmentAutomationPolicyView["texts"];
        }
      >(this.root + "/preview", { settings, sectorId, localStartsAt, texts }),
    );
  }
}

export interface AppointmentAutomationRunView {
  kind?:"reminder_plan"|"event_notice";
  eventType?:string;
  id: string;
  orderId: string;
  appointmentId: string;
  status: string;
  startsAt: string;
  expiresAt: string;
  responseAction: string | null;
  respondedAt: string | null;
  reviewedAt: string | null;
  updatedAt: string;
  staffNoticeReason: string | null;
  plan: {
    customer: { firstName: string; lastName: string };
    appointments: Array<{
      id: string;
      service: string;
      startsAt: string;
      endsAt: string;
    }>;
  };
  deliveries: Array<{
    sequence: number;
    dueAt: string;
    status: string;
    reason: string | null;
    providerState: string | null;
    withdrawOutcome: string | null;
    withdrawRequested: boolean;
  }>;
}
