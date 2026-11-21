import { BadRequestException } from "@nestjs/common";
import type { AppointmentAutomationSettings } from "../../common/appointment-automation-policy";
import { intersectBusinessHours } from "../locations/operational-hours";
import { validateOperationalTemplateText } from "./notification-template-editor";
import { renderTemplate } from "./notifications.utils";
import type { currentAutomationPlan } from "./appointment-automation-state";

export const DEFAULT_AUTOMATION_TEXTS = {
  confirmed:
    "Ciao {{customer.firstName}}, il tuo appuntamento per {{service.name}} del {{appointment.startsAt}} presso {{tenant.name}} è confermato.",
  cancelled:
    "Ciao {{customer.firstName}}, l’appuntamento per {{service.name}} del {{appointment.startsAt}} presso {{tenant.name}} è stato annullato.",
  rescheduled:
    "Ciao {{customer.firstName}}, l’appuntamento per {{service.name}} presso {{tenant.name}} è stato riprogrammato al {{appointment.startsAt}}.",
  initial:
    "Ciao {{customer.firstName}}, abbiamo registrato {{service.name}} per il {{appointment.startsAt}} presso {{tenant.name}}.",
  reminder:
    "Ciao {{customer.firstName}}, ti ricordiamo {{service.name}} del {{appointment.startsAt}} presso {{tenant.name}}.",
};
export function automationTexts(
  input: unknown,
): typeof DEFAULT_AUTOMATION_TEXTS {
  if (input === null || input === undefined)
    return { ...DEFAULT_AUTOMATION_TEXTS };
  if (
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) => !Object.keys(DEFAULT_AUTOMATION_TEXTS).includes(k),
    )
  )
    throw new BadRequestException("Testi WhatsApp non validi");
  const row: Record<string, unknown> = {
    ...DEFAULT_AUTOMATION_TEXTS,
    ...input,
  };
  for (const key of Object.keys(DEFAULT_AUTOMATION_TEXTS))
    if (
      typeof row[key] !== "string" ||
      !(row[key] as string).trim() ||
      (row[key] as string).length > 3500
    )
      throw new BadRequestException(
        "Il testo WhatsApp deve contenere da 1 a 3.500 caratteri",
      );
  return {
    confirmed: validateOperationalTemplateText(String(row["confirmed"])),
    cancelled: validateOperationalTemplateText(String(row["cancelled"])),
    rescheduled: validateOperationalTemplateText(String(row["rescheduled"])),
    initial: validateOperationalTemplateText(String(row["initial"])),
    reminder: validateOperationalTemplateText(String(row["reminder"])),
  };
}
type Plan = NonNullable<Awaited<ReturnType<typeof currentAutomationPlan>>>;
export function renderAutomationMessage(plan: Plan, text: string) {
  return renderAutomationText(
    text,
    {
      customer: plan.order.customer!,
      service: {
        name: plan.appointments.map((a) => a.service.name).join(" · "),
      },
      appointment: {
        startsAt: plan.appointments[0].startsAt,
        endsAt: new Date(
          Math.max(...plan.appointments.map((a) => a.endsAt.getTime())),
        ),
        status: plan.appointments[0].status,
      },
      collaborator: plan.appointments[0].collaborator,
      tenant: plan.order.tenant,
    },
    plan.order.tenant.timezone,
  );
}
export function renderAutomationText(
  text: string,
  sample: {
    customer: { firstName: string; lastName: string };
    service: { name: string };
    appointment: { startsAt: Date; endsAt: Date; status: string };
    collaborator: { firstName: string; lastName: string } | null;
    tenant: { name: string };
  },
  timezone: string,
) {
  const format = (date: Date) =>
    new Intl.DateTimeFormat("it-IT", {
      timeZone: timezone,
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  return renderTemplate(text, {
    ...sample,
    appointment: {
      ...sample.appointment,
      startsAt: format(sample.appointment.startsAt),
      endsAt: format(sample.appointment.endsAt),
    },
  });
}

type OpeningPlan = {
  order: { tenant: { timezone: string } };
  appointments: Array<{
    location: { weeklyHours: unknown; closures: unknown };
    sector: { weeklyHours: unknown; closures: unknown };
  }>;
};
function openingCheck(
  plan: OpeningPlan,
  settings: AppointmentAutomationSettings,
  holidays: string[],
) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: plan.order.tenant.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const policy = {
    weeklyHours: Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      isWorkingDay: true,
      startTime: settings.deliveryStart,
      endTime: settings.deliveryEnd,
    })),
    closures: [],
  };
  const calendars = [
      ...plan.appointments.flatMap((a) => [a.location, a.sector]),
      policy,
    ],
    closed = new Set(holidays),
    windows = new Map<string, ReturnType<typeof intersectBusinessHours>>();
  return (at: Date) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(at).map((p) => [p.type, p.value]),
    );
    const date = `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
    if (!windows.has(date))
      windows.set(
        date,
        closed.has(date) ? null : intersectBusinessHours(date, calendars),
      );
    const window = windows.get(date),
      minute = Number(parts["hour"]) * 60 + Number(parts["minute"]);
    return (
      !!window && minute >= window.startMinutes && minute < window.endMinutes
    );
  };
}
export function automationIsOpen(
  plan: OpeningPlan,
  settings: AppointmentAutomationSettings,
  at: Date,
  holidays: string[],
) {
  return openingCheck(plan, settings, holidays)(at);
}
export function automationNextOpening(
  plan: OpeningPlan,
  settings: AppointmentAutomationSettings,
  now: Date,
  until: Date,
  holidays: string[],
) {
  const isOpen = openingCheck(plan, settings, holidays);
  for (
    let cursor = Math.ceil(now.getTime() / 60000) * 60000;
    cursor < Math.min(until.getTime(), now.getTime() + 31 * 86400000);
    cursor += 60000
  )
    if (isOpen(new Date(cursor))) return new Date(cursor);
  return null;
}
export function automationWindowEnd(
  plan: OpeningPlan,
  settings: AppointmentAutomationSettings,
  at: Date,
  until: Date,
  holidays: string[],
) {
  const isOpen = openingCheck(plan, settings, holidays);
  let cursor = Math.floor(at.getTime() / 60000) * 60000;
  while (cursor < until.getTime() && isOpen(new Date(cursor))) cursor += 60000;
  return new Date(Math.min(cursor, until.getTime()));
}
