import { BadRequestException } from "@nestjs/common";
import { NotificationChannel } from "@prisma/client";
import { DEFAULT_NOTIFICATION_TEMPLATES } from "./notifications.templates";

// Only operational fields: contact details, arbitrary event data and prototype paths
// are deliberately unavailable to newly edited templates.
export const TEMPLATE_PLACEHOLDERS = [
  "customer.firstName",
  "customer.lastName",
  "service.name",
  "appointment.startsAt",
  "appointment.endsAt",
  "appointment.status",
  "collaborator.firstName",
  "collaborator.lastName",
  "tenant.name",
] as const;

export const TEMPLATE_SAMPLE = {
  customer: { firstName: "Giulia", lastName: "Esempio" },
  service: { name: "Taglio e piega" },
  appointment: {
    startsAt: "2030-06-18T09:00:00.000Z",
    endsAt: "2030-06-18T10:00:00.000Z",
    status: "confirmed",
  },
  collaborator: { firstName: "Andrea", lastName: "Esempio" },
  tenant: { name: "Salone di esempio" },
};

export function validateTemplateInput(
  eventType: string,
  channel: NotificationChannel,
  input: Record<string, unknown>,
  saving = false,
) {
  if (
    !DEFAULT_NOTIFICATION_TEMPLATES.some(
      (t) => t.eventType === eventType && t.channel === channel,
    )
  )
    throw new BadRequestException(
      "Evento o canale del template non supportato",
    );
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) =>
        ![
          "subject",
          "title",
          "body",
          ...(saving ? ["expectedUpdatedAt"] : []),
        ].includes(k),
    )
  )
    throw new BadRequestException("Campi del template non validi");
  const text = (key: "subject" | "title" | "body", max: number) => {
    const value = input[key] ?? (key === "body" ? undefined : "");
    if (
      typeof value !== "string" ||
      value.length > max ||
      (key === "body" && !value.trim()) ||
      (key !== "body" && /[\r\n]/.test(value))
    )
      throw new BadRequestException(`Campo ${key} non valido`);
    return validateOperationalTemplateText(value);
  };
  const template = {
    subject: text("subject", 200),
    title: text("title", 200),
    body: text("body", 16000),
  };
  if (
    saving &&
    (typeof input["expectedUpdatedAt"] !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(
        input["expectedUpdatedAt"],
      ) ||
      !Number.isFinite(Date.parse(input["expectedUpdatedAt"])))
  )
    throw new BadRequestException(
      "Ricarica la versione corrente del template prima di salvare",
    );
  return template;
}

/** Shared operational placeholder validator for notification and WhatsApp policy texts. */
export function validateOperationalTemplateText(value: string) {
    const remaining = value.replace(
      /{{\s*([a-zA-Z0-9_.]+)\s*}}/g,
      (_, path: string) => {
        if (!(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(path))
          throw new BadRequestException(`Segnaposto non ammesso: ${path}`);
        return "";
      },
    );
    if (remaining.includes("{{") || remaining.includes("}}"))
      throw new BadRequestException("Sintassi dei segnaposto non valida");
    return value;
}
