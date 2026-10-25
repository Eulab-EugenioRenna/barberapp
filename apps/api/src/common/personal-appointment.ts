/** Public personal view contract: no customer history, internal notes, cost or payment fields. */
export const PERSONAL_APPOINTMENT_SELECT = {
  id: true, startsAt: true, endsAt: true, status: true, customerNotes: true,
  customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
  service: { select: { id: true, name: true, durationMinutes: true } },
  collaborator: { select: { id: true, firstName: true, lastName: true, calendarColor: true } },
  room: { select: { id: true, name: true } },
} as const;
export const PERSONAL_STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: [], requested: ["confirmed"], confirmed: ["checked_in", "completed", "no_show"],
  checked_in: ["completed"], completed: [], cancelled: [], no_show: [], rescheduled: [],
};
export interface PersonalAppointment {
  id: string; startsAt: string; endsAt: string; status: string; customerNotes: string | null;
  customer: { id: string; firstName: string; lastName: string; phone: string | null };
  service: { id: string; name: string; durationMinutes: number };
  collaborator: { id: string; firstName: string; lastName: string; calendarColor: string } | null;
  room: { id: string; name: string } | null;
}
export interface PersonalDashboard {
  professional: { firstName: string; lastName: string };
  referenceDate: string; timezone: string;
  range: { start: string; end: string };
  activity: { totalAppointments: number; completedAppointments: number; cancelledAppointments: number; noShows: number; attributedServices: number };
  values: { registeredServiceLineTotal: string; currency: string } | null;
  appointments: { items: PersonalAppointment[]; total: number; page: number; pageSize: number; hasMore: boolean };
}
