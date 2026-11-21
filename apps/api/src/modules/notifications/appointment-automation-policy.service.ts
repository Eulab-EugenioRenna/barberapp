import { AutomationClock } from "../../common/automation-clock";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  AppointmentAutomationPolicyView,
  AppointmentAutomationSettings,
} from "../../common/appointment-automation-policy";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { parseZonedDateTime, zonedDateParts } from "../../common/zoned-time";
import { planAppointmentReminders } from "./appointment-reminder-plan";
import {
  NotificationAutomationGrantsService,
  CUSTOMER_COMMAND_PURPOSE,
} from "./notification-automation-grants.service";
import {
  automationTexts,
  renderAutomationText,
} from "./appointment-automation-messages";
import {
  appointmentPhone,
  stopAutomationRuns,
  stopAutomationNotices,
} from "./appointment-automation-state";
import { lockOperationalTenant } from "../../common/operational-lock";

const defaults: AppointmentAutomationSettings = {
  eventNotices: {
    confirmation: false,
    cancellation: false,
    rescheduling: true,
  },
  initialConfirmation: true,
  requestResponse: true,
  leadMinutes: 1440,
  maxReminders: 1,
  repeatIntervalMinutes: 120,
  responseDeadlineMinutes: 30,
  deliveryStart: "09:00",
  deliveryEnd: "19:00",
  noResponseAction: "notify_staff",
};
function object(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new BadRequestException("Campi della policy non validi");
  return value as Record<string, unknown>;
}
export function validateAutomationSettings(
  value: unknown,
): AppointmentAutomationSettings {
  const row = object(value, Object.keys(defaults));
  for (const key of ["initialConfirmation", "requestResponse"])
    if (typeof row[key] !== "boolean")
      throw new BadRequestException("Impostazioni di conferma non valide");
  const labels = {
    leadMinutes: "Anticipo",
    maxReminders: "Numero di promemoria",
    repeatIntervalMinutes: "Intervallo tra i promemoria",
    responseDeadlineMinutes: "Scadenza della risposta",
  };
  for (const [key, min, max] of [
    ["leadMinutes", 2, 43200],
    ["maxReminders", 0, 5],
    ["repeatIntervalMinutes", 15, 10080],
    ["responseDeadlineMinutes", 1, 10080],
  ] as const)
    if (
      !Number.isInteger(row[key]) ||
      Number(row[key]) < min ||
      Number(row[key]) > max
    )
      throw new BadRequestException(
        `${labels[key]}: inserisci un intero fra ${min} e ${max}`,
      );
  if (
    row["requestResponse"] &&
    Number(row["responseDeadlineMinutes"]) >= Number(row["leadMinutes"])
  )
    throw new BadRequestException(
      "La scadenza della risposta deve essere successiva al primo promemoria",
    );
  for (const key of ["deliveryStart", "deliveryEnd"])
    if (
      typeof row[key] !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(row[key]))
    )
      throw new BadRequestException("Fascia oraria non valida");
  if (String(row["deliveryStart"]) >= String(row["deliveryEnd"]))
    throw new BadRequestException(
      "La fascia di invio deve iniziare e finire nella stessa giornata",
    );
  if (
    !["keep_booking", "notify_staff"].includes(String(row["noResponseAction"]))
  )
    throw new BadRequestException("Azione per mancata risposta non valida");
  const eventNotices =
    row["eventNotices"] === undefined
      ? { confirmation: false, cancellation: false, rescheduling: true }
      : object(row["eventNotices"], [
          "confirmation",
          "cancellation",
          "rescheduling",
        ]);
  if (
    Object.keys(eventNotices).length !== 3 ||
    Object.values(eventNotices).some((v) => typeof v !== "boolean")
  )
    throw new BadRequestException("Tipologie di evento non valide");
  return { ...row, eventNotices } as unknown as AppointmentAutomationSettings;
}

function localPreviewTime(value: unknown, timezone: string): Date {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
    throw new BadRequestException("Data e ora di esempio non valide");
  const calendarCheck = new Date(value + ":00.000Z");
  if (
    !Number.isFinite(calendarCheck.getTime()) ||
    calendarCheck.toISOString().slice(0, 16) !== value
  )
    throw new BadRequestException("Data e ora di esempio non valide");
  const instant = parseZonedDateTime(value, timezone)!;
  const key = (d: Date) => {
    const p = zonedDateParts(d, timezone);
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  };
  if (!instant || !Number.isFinite(instant.getTime()) || key(instant) !== value)
    throw new BadRequestException(
      "La data o l’ora non esiste nel fuso dell’attività",
    );
  for (let offset = -180; offset <= 180; offset += 15)
    if (offset && key(new Date(instant.getTime() + offset * 60000)) === value)
      throw new BadRequestException(
        "Ora ambigua al cambio dell’ora: scegli un altro orario per l’esempio",
      );
  return instant;
}

@Injectable()
export class AppointmentAutomationPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: NotificationAutomationGrantsService,
    private readonly clock: AutomationClock,
  ) {}
  async get(
    tenantId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<AppointmentAutomationPolicyView> {
    const [policy, tenant] = await Promise.all([
      client.appointmentAutomationPolicy.findUnique({ where: { tenantId } }),
      client.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { timezone: true },
      }),
    ]);
    return {
      revision: policy?.revision || 0,
      updatedAt: policy?.updatedAt.toISOString() || null,
      settings: policy
        ? validateAutomationSettings(policy.settings)
        : { ...defaults },
      status: policy?.enabled ? "active" : "draft",
      activationAvailable: true,
      texts: automationTexts(policy?.texts),
      grants: {
        whatsapp: policy?.whatsappGrantId || null,
        customerCommands: policy?.actionGrantId || null,
        staff: policy?.staffGrantId || null,
        email: policy?.emailGrantId || null,
      },
      timezone: tenant.timezone,
    };
  }
  async save(tenantId: string, actorId: string, input: unknown) {
    const body = object(input, ["settings", "expectedRevision", "texts"]),
      settings = validateAutomationSettings(body["settings"]);
    const expected = body["expectedRevision"];
    if (
      !Number.isInteger(expected) ||
      Number(expected) < 0 ||
      Number(expected) >= 2147483647
    )
      throw new BadRequestException("Revisione non valida");
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockOperationalTenant(tx, tenantId);
        const texts =
          body["texts"] === undefined
            ? undefined
            : automationTexts(body["texts"]);
        if (expected === 0)
          await tx.appointmentAutomationPolicy.create({
            data: {
              tenantId,
              revision: 1,
              settings: settings as unknown as Prisma.InputJsonValue,
              updatedByUserId: actorId,
              texts: texts || undefined,
            },
          });
        else {
          const saved = await tx.appointmentAutomationPolicy.updateMany({
            where: { tenantId, revision: Number(expected) },
            data: {
              settings: settings as unknown as Prisma.InputJsonValue,
              revision: { increment: 1 },
              updatedByUserId: actorId,
              texts: texts || undefined,
              enabled: false,
              enabledAt: null,
            },
          });
          if (!saved.count)
            throw new ConflictException(
              "La policy è cambiata. Ricarica la versione corrente prima di salvare.",
            );
        }
        const runs = await tx.appointmentAutomationRun.findMany({
          where: { tenantId, status: "waiting" },
          select: { id: true },
        });
        await stopAutomationRuns(
          tx,
          tenantId,
          runs.map((r) => r.id),
          "superseded",
          "Policy salvata come nuova bozza",
        );
        await stopAutomationNotices(
          tx,
          tenantId,
          "Policy salvata come nuova bozza",
        );
        return this.get(tenantId, tx);
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      )
        throw new ConflictException(
          "La policy è cambiata. Ricarica la versione corrente prima di salvare.",
        );
      throw e;
    }
  }
  async activate(
    auth: string | undefined,
    tenantId: string,
    actorId: string,
    input: unknown,
  ) {
    const body = object(input, [
      "expectedRevision",
      "whatsappGrantId",
      "actionGrantId",
      "staffGrantId",
      "emailGrantId",
    ]);
    if (
      !Number.isInteger(body["expectedRevision"]) ||
      Number(body["expectedRevision"]) < 1
    )
      throw new BadRequestException("Salva prima una bozza della policy");
    const policy = await this.prisma.appointmentAutomationPolicy.findUnique({
      where: { tenantId },
    });
    if (!policy || policy.revision !== body["expectedRevision"])
      throw new ConflictException(
        "La policy è cambiata: ricarica prima di attivare",
      );
    const settings = validateAutomationSettings(policy.settings);
    const required = [
      {
        key: "whatsappGrantId",
        channel: "whatsapp",
        purpose: "appointments.automation",
        needed: true,
      },
      {
        key: "actionGrantId",
        channel: "application_notification",
        purpose: CUSTOMER_COMMAND_PURPOSE,
        needed: settings.requestResponse,
      },
      {
        key: "staffGrantId",
        channel: "application_notification",
        purpose: "appointments.automation",
        needed:
          settings.requestResponse &&
          settings.noResponseAction === "notify_staff",
      },
      {
        key: "emailGrantId",
        channel: "email",
        purpose: "appointments.automation",
        needed: false,
      },
    ];
    const ids: Record<string, string | null> = {};
    for (const requirement of required) {
      const id = body[requirement.key];
      if (id === undefined || id === null || id === "") {
        if (requirement.needed)
          throw new BadRequestException(
            "Seleziona le autorizzazioni richieste per WhatsApp, azioni cliente e avvisi staff",
          );
        ids[requirement.key] = null;
        continue;
      }
      if (typeof id !== "string")
        throw new BadRequestException("Autorizzazione non valida");
      const grant = await this.prisma.notificationAutomationGrant.findFirst({
        where: { id, tenantId, channel: requirement.channel, status: "ready" },
      });
      if (
        !grant ||
        (grant.request as Record<string, unknown>)["purpose"] !==
          requirement.purpose ||
        !(await this.grants.verifyForWorker(id)).allowed
      )
        throw new ForbiddenException(
          "Una delle autorizzazioni non è valida per questa attività o finalità",
        );
      ids[requirement.key] = id;
    }
    const registration =
      await this.prisma.notificationAutomationWebhook.findUnique({
        where: { tenantId },
      });
    if (settings.requestResponse && registration?.status !== "ready")
      throw new ConflictException(
        "Configura la ricezione delle risposte prima di attivare",
      );
    const whatsapp =
      await this.prisma.notificationAutomationGrant.findUniqueOrThrow({
        where: { id: ids["whatsappGrantId"]! },
      });
    const number = await this.grants.withWhatsAppOperator(
      auth,
      async (client, token, actor) => {
        if (
          actor.tenantId !== tenantId ||
          (registration && registration.installationId !== actor.installationId)
        )
          throw new ForbiddenException(
            "Installazione della ricezione cambiata",
          );
        const session = (await client.whatsapp(token).sessions()).find(
          (s) =>
            s.id === whatsapp.sessionId &&
            s.state === "connected" &&
            s.runner_online &&
            !s.closed_at,
        );
        const phone = appointmentPhone(
          session?.number ? "+" + session.number.replace(/^\+/, "") : null,
        );
        if (
          !session ||
          !phone ||
          session.archive_id !==
            (whatsapp.request as Record<string, unknown>)["archiveId"]
        )
          throw new ConflictException(
            "Ricollega il numero corrispondente all’autorizzazione selezionata",
          );
        return phone;
      },
    );
    return this.prisma.$transaction(async (tx) => {
      await lockOperationalTenant(tx, tenantId);
      const updated = await tx.appointmentAutomationPolicy.updateMany({
        where: { tenantId, revision: policy.revision },
        data: {
          revision: { increment: 1 },
          updatedByUserId: actorId,
          enabled: true,
          enabledAt: this.clock.now(),
          whatsappGrantId: ids["whatsappGrantId"],
          actionGrantId: settings.requestResponse ? ids["actionGrantId"] : null,
          staffGrantId: settings.requestResponse ? ids["staffGrantId"] : null,
          emailGrantId: ids["emailGrantId"],
          businessNumber: number,
        },
      });
      if (!updated.count)
        throw new ConflictException(
          "La policy è cambiata: ricarica prima di attivare",
        );
      const old = await tx.appointmentAutomationRun.findMany({
        where: { tenantId, status: "waiting" },
        select: { id: true },
      });
      await stopAutomationRuns(
        tx,
        tenantId,
        old.map((r) => r.id),
        "superseded",
        "Nuova attivazione della policy",
      );
      await stopAutomationNotices(tx, tenantId, "Policy fermata o sostituita");
      return this.get(tenantId, tx);
    });
  }
  async deactivate(tenantId: string, actorId: string, input: unknown) {
    const body = object(input, ["expectedRevision"]);
    if (!Number.isInteger(body["expectedRevision"]))
      throw new BadRequestException("Revisione non valida");
    return this.prisma.$transaction(async (tx) => {
      await lockOperationalTenant(tx, tenantId);
      const result = await tx.appointmentAutomationPolicy.updateMany({
        where: { tenantId, revision: Number(body["expectedRevision"]) },
        data: {
          enabled: false,
          enabledAt: null,
          revision: { increment: 1 },
          updatedByUserId: actorId,
        },
      });
      if (!result.count)
        throw new ConflictException(
          "La policy è cambiata. Ricarica prima di fermarla.",
        );
      const runs = await tx.appointmentAutomationRun.findMany({
        where: { tenantId, status: "waiting" },
        select: { id: true },
      });
      await stopAutomationRuns(
        tx,
        tenantId,
        runs.map((r) => r.id),
        "superseded",
        "Automazioni fermate dall’operatore",
      );
      await stopAutomationNotices(tx, tenantId, "Policy fermata o sostituita");
      return this.get(tenantId, tx);
    });
  }
  async preview(tenantId: string, input: unknown) {
    const body = object(input, [
        "settings",
        "sectorId",
        "localStartsAt",
        "texts",
      ]),
      settings = validateAutomationSettings(body["settings"]);
    if (typeof body["sectorId"] !== "string" || body["sectorId"].length > 100)
      throw new BadRequestException("Scegli un settore per l’esempio");
    return this.prisma.$transaction(
      async (tx) => {
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: { timezone: true },
        });
        const sector = await tx.sector.findFirst({
          where: {
            id: String(body["sectorId"]),
            tenantId,
            isActive: true,
            location: { isActive: true },
          },
          include: { location: true },
        });
        if (!sector) throw new NotFoundException("Settore non disponibile");
        const startsAt = localPreviewTime(
            body["localStartsAt"],
            tenant.timezone,
          ),
          earliest = new Date(
            startsAt.getTime() - (settings.leadMinutes + 33 * 1440) * 60000,
          );
        const holidays = await tx.tenantHoliday.findMany({
          where: {
            tenantId,
            date: {
              gte: earliest,
              lte: new Date(startsAt.getTime() + 86400000),
            },
          },
          select: { date: true },
        });
        const texts = automationTexts(body["texts"]);
        const sample = {
          customer: { firstName: "Giulia", lastName: "Esempio" },
          service: { name: "Taglio e piega" },
          appointment: {
            startsAt,
            endsAt: new Date(startsAt.getTime() + 3600000),
            status: "confirmed",
          },
          collaborator: { firstName: "Andrea", lastName: "Esempio" },
          tenant: { name: "Salone di esempio" },
        };
        return {
          messagePreview: {
            confirmed: renderAutomationText(
              texts.confirmed,
              sample,
              tenant.timezone,
            ),
            cancelled: renderAutomationText(
              texts.cancelled,
              {
                ...sample,
                appointment: { ...sample.appointment, status: "cancelled" },
              },
              tenant.timezone,
            ),
            rescheduled: renderAutomationText(
              texts.rescheduled,
              {
                ...sample,
                appointment: { ...sample.appointment, status: "rescheduled" },
              },
              tenant.timezone,
            ),
            initial: renderAutomationText(
              texts.initial,
              sample,
              tenant.timezone,
            ),
            reminder: renderAutomationText(
              texts.reminder,
              sample,
              tenant.timezone,
            ),
          },
          ...planAppointmentReminders({
            settings,
            startsAt,
            now: this.clock.now(),
            timezone: tenant.timezone,
            calendars: [sector.location, sector],
            holidays: holidays.map((h) => h.date.toISOString().slice(0, 10)),
          }),
          sampleOnly: true,
          status: "draft",
          activationAvailable: true,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
