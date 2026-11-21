export interface AppointmentAutomationSettings {
  eventNotices?: {
    confirmation: boolean;
    cancellation: boolean;
    rescheduling: boolean;
  };
  initialConfirmation: boolean;
  requestResponse: boolean;
  leadMinutes: number;
  maxReminders: number;
  repeatIntervalMinutes: number;
  responseDeadlineMinutes: number;
  deliveryStart: string;
  deliveryEnd: string;
  noResponseAction: "keep_booking" | "notify_staff";
}

export type AppointmentAutomationChannel =
  | "whatsapp"
  | "email"
  | "application_notification";
/** Safe consumer projections. Provider IDs, credentials and author tokens stay on the server. */
export interface AppointmentAutomationGrantView {
  useCase: "notifications" | "customer_commands";
  id: string;
  channel: AppointmentAutomationChannel;
  status: "preparing" | "ready" | "revocation_pending" | "revoked";
  archiveId: string | null;
  sessionId: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface AppointmentAutomationWebhookView {
  id: string | null;
  url: string | null;
  status: "not_registered" | "preparing" | "ready" | "disabled";
  lastReceivedAt: string | null;
}

export interface AppointmentAutomationPolicyView {
  revision: number;
  updatedAt: string | null;
  settings: AppointmentAutomationSettings;
  status: "draft" | "active";
  activationAvailable: true;
  texts: {
    initial: string;
    reminder: string;
    confirmed: string;
    cancelled: string;
    rescheduled: string;
  };
  grants: {
    whatsapp: string | null;
    customerCommands: string | null;
    staff: string | null;
    email: string | null;
  };
  timezone: string;
}

export interface AppointmentReminderPlan {
  timezone: string;
  responseExpiresAt: string | null;
  reminders: Array<{
    sequence: number;
    nominalAt: string;
    dueAt: string;
    shifted: boolean;
  }>;
  omitted: Array<{
    sequence: number;
    reason:
      | "outside_response_window"
      | "no_future_opening"
      | "repeat_too_close";
  }>;
}
