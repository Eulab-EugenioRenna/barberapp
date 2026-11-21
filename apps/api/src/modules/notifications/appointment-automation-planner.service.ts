import { AutomationClock } from "../../common/automation-clock";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  WhatsAppPayload,
  AutomationDelegationInput,
} from "@eulab/connect/server";
import { randomBytes, randomUUID } from "node:crypto";
import { lockOperationalTenant } from "../../common/operational-lock";
import { sealConnect } from "../../common/connect-runtime";
import { NotificationAutomationCommandStore } from "./notification-automation-command-store.service";
import {
  currentAutomationPlan,
  automationAppointmentHash,
  AutomationCalendarRow,
  AutomationNoticeContext,
  automationHash,
  invalidateAutomationAccounts,
} from "./appointment-automation-state";
import { validateAutomationSettings } from "./appointment-automation-policy.service";
import { planAppointmentReminders } from "./appointment-reminder-plan";
import {
  automationNextOpening,
  automationTexts,
  automationWindowEnd,
  renderAutomationMessage,
} from "./appointment-automation-messages";
import type { NotificationEventPayload } from "./notifications.types";
import type { NotificationDispatchTarget } from "./notifications.types";
import { NotificationAutomationGrantsService } from "./notification-automation-grants.service";

@Injectable()
export class AppointmentAutomationPlanner {
  constructor(
    private readonly commands: NotificationAutomationCommandStore,
    private readonly clock: AutomationClock,
    private readonly grants: NotificationAutomationGrantsService,
  ) {}
  async authorizeTargets(
    tx: Prisma.TransactionClient,
    payload: NotificationEventPayload,
    targets: NotificationDispatchTarget[],
  ) {
    if (!payload.flags?.["customerOrigin"]) return targets;
    const runId = payload.eventData?.["automationRunId"];
    if (typeof runId !== "string") return [];
    const run = await tx.appointmentAutomationRun.findFirst({
        where: { id: runId, tenantId: payload.tenantId },
      }),
      policy = await tx.appointmentAutomationPolicy.findUnique({
        where: { tenantId: payload.tenantId },
      });
    if (!run || !policy?.enabled || policy.revision !== run.policyRevision)
      return [];
    const authorities = [
      {
        channel: "in_app",
        grant: policy.staffGrantId,
        scope: "application_notification",
      },
      { channel: "email", grant: policy.emailGrantId, scope: "email" },
    ];
    const allowed = await Promise.all(
      authorities.map(async (authority) => {
        if (!authority.grant) return null;
        const row = await tx.notificationAutomationGrant.findFirst({
          where: {
            id: authority.grant,
            tenantId: payload.tenantId,
            channel: authority.scope,
          },
        });
        if (
          !row ||
          (row.request as Record<string, unknown>)["purpose"] !==
            "appointments.automation" ||
          !(await this.grants.verifyForWorker(row.id)).allowed
        )
          return null;
        return authority;
      }),
    );
    await lockOperationalTenant(tx, payload.tenantId);
    const current = await tx.appointmentAutomationPolicy.findUnique({
      where: { tenantId: payload.tenantId },
    });
    if (!current?.enabled || current.revision !== policy.revision) return [];
    return targets.flatMap((target) => {
      const authority = allowed.find((a) => a?.channel === target.channel);
      return authority
        ? [
            {
              ...target,
              metadata: {
                ...target.metadata,
                automationAuthorityGrantId: authority.grant,
                automationRunId: run.id,
                automationPolicyRevision: policy.revision,
              },
            },
          ]
        : [];
    });
  }
  async materialize(
    tx: Prisma.TransactionClient,
    event: {
      id: string;
      tenantId: string;
      eventType: string;
      createdAt: Date;
      payload: Prisma.JsonValue;
    },
  ) {
    if (
      ![
        "appointment.created.internal",
        "appointment.created.public",
        "appointment.rescheduled",
        "appointment.confirmed",
        "appointment.requested",
        "appointment.assigned",
        "appointment.reassigned",
        "appointment.contact_authorized",
        "appointment.completed",
        "appointment.checked_in",
        "appointment.no_show",
        "appointment.cancelled",
      ].includes(event.eventType)
    )
      return [];
    const source = event.payload as unknown as NotificationEventPayload,
      orderId = source.eventData?.["orderId"];
    const notices = await this.materializeNotice(tx, event);
    if (typeof orderId !== "string" || source.flags?.["customerOrigin"])
      return notices;
    await lockOperationalTenant(tx, event.tenantId);
    await invalidateAutomationAccounts(tx, event.tenantId, [orderId]);
    const policy = await tx.appointmentAutomationPolicy.findUnique({
      where: { tenantId: event.tenantId },
    });
    if (
      !policy?.enabled ||
      !policy.enabledAt ||
      event.createdAt < policy.enabledAt ||
      !policy.whatsappGrantId ||
      !policy.businessNumber
    )
      return notices;
    const now = this.clock.now(),
      plan = await currentAutomationPlan(tx, event.tenantId, orderId, now);
    if (
      !plan ||
      source.eventData?.["contactAuthorizationId"] !== plan.authorizationId ||
      plan.appointments.some((a) => a.status === "draft") ||
      plan.appointments[0].startsAt <= now
    )
      return notices;
    const sourceRows = (
      (source.eventData?.["affectedAppointments"] || []) as Array<
        AutomationCalendarRow & { status: string }
      >
    ).filter((row) =>
      ["requested", "confirmed", "rescheduled"].includes(row.status),
    );
    const currentRows = plan.appointments.filter((row) =>
      sourceRows.some((source) => source.id === row.id),
    );
    if (
      sourceRows.length &&
      (currentRows.length !== sourceRows.length ||
        automationAppointmentHash(sourceRows) !==
          automationAppointmentHash(currentRows))
    )
      return notices;
    const existing = await tx.appointmentAutomationRun.findFirst({
      where: {
        tenantId: event.tenantId,
        orderId,
        policyRevision: policy.revision,
        planHash: plan.planHash,
        contactHash: plan.contactHash,
      },
    });
    if (existing) return notices;
    const grant = await tx.notificationAutomationGrant.findFirst({
      where: {
        id: policy.whatsappGrantId,
        tenantId: event.tenantId,
        channel: "whatsapp",
        status: "ready",
      },
    });
    if (!grant) return notices;
    const request = grant.request as unknown as AutomationDelegationInput,
      settings = validateAutomationSettings(policy.settings),
      texts = automationTexts(policy.texts);
    const startsAt = plan.appointments[0].startsAt,
      expiresAt = new Date(
        startsAt.getTime() -
          (settings.requestResponse ? settings.responseDeadlineMinutes : 0) *
            60000,
      );
    if (expiresAt <= now || !request.archiveId) return notices;
    const holidays = (
      await tx.tenantHoliday.findMany({
        where: {
          tenantId: event.tenantId,
          date: {
            gte: new Date(now.getTime() - 86400000),
            lte: new Date(startsAt.getTime() + 86400000),
          },
        },
        select: { date: true },
      })
    ).map((h) => h.date.toISOString().slice(0, 10));
    const schedule = planAppointmentReminders({
      settings,
      startsAt,
      now,
      timezone: plan.order.tenant.timezone,
      calendars: plan.appointments.flatMap((a) => [a.location, a.sector]),
      holidays,
    });
    const intents = schedule.reminders.map((r) => ({
      sequence: r.sequence,
      dueAt: new Date(r.dueAt),
      text: texts.reminder,
    }));
    const rescheduled = [
      "appointment.rescheduled",
      "appointment.reassigned",
    ].includes(event.eventType);
    const initialEnabled = rescheduled
      ? settings.eventNotices?.rescheduling !== false
      : settings.initialConfirmation &&
        [
          "appointment.created.internal",
          "appointment.created.public",
          "appointment.contact_authorized",
        ].includes(event.eventType);
    const initial = initialEnabled
      ? automationNextOpening(plan, settings, now, expiresAt, holidays)
      : null;
    if (
      initial &&
      (!intents.length ||
        intents[0].dueAt.getTime() - initial.getTime() >=
          settings.repeatIntervalMinutes * 60000)
    )
      intents.unshift({
        sequence: 0,
        dueAt: initial,
        text: rescheduled ? texts.rescheduled : texts.initial,
      });
    if (!intents.length) return notices;
    const snapshot = {
      orderId,
      customer: {
        firstName: plan.order.customer!.firstName,
        lastName: plan.order.customer!.lastName,
      },
      appointments: plan.appointments.map((a) => ({
        id: a.id,
        service: a.service.name,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        sectorId: a.sectorId,
        locationId: a.locationId,
      })),
      requestResponse: settings.requestResponse,
      noResponseAction: settings.noResponseAction,
      repeatIntervalMinutes: settings.repeatIntervalMinutes,
    };
    const run = await tx.appointmentAutomationRun.create({
      data: {
        id: randomUUID(),
        tenantId: event.tenantId,
        orderId,
        customerId: plan.order.customerId!,
        anchorAppointmentId: plan.appointments[0].id,
        policyRevision: policy.revision,
        planHash: plan.planHash,
        contactHash: plan.contactHash,
        recipientCipher: sealConnect(plan.phone),
        whatsappGrantId: grant.id,
        actionGrantId: policy.actionGrantId,
        staffGrantId: policy.staffGrantId,
        archiveId: request.archiveId,
        businessNumber: policy.businessNumber,
        startsAt,
        expiresAt,
        snapshot,
      },
    });
    const actions: Array<{ type: "reply"; id: string; label: string }> = [];
    if (settings.requestResponse)
      for (const [kind, label] of [
        ["confirm", "Confermo"],
        ["change", "Richiedi modifica"],
        ["cancel", "Annulla o richiedi"],
      ] as const) {
        const token = "alora_" + randomBytes(32).toString("base64url");
        await tx.appointmentAutomationAction.create({
          data: { runId: run.id, tokenHash: automationHash(token), kind },
        });
        actions.push({ type: "reply", id: token, label });
      }
    const ids: string[] = [...notices];
    for (const intent of intents) {
      const text = renderAutomationMessage(plan, intent.text);
      const payload: WhatsAppPayload = settings.requestResponse
        ? {
            kind: "interactive",
            to: plan.phone,
            content: {
              type: "buttons",
              body:
                text +
                "\nAnnullamento automatico fino a 24 ore prima; dopo, la richiesta viene sottoposta allo staff.",
              footer:
                "Rispondi entro " +
                new Intl.DateTimeFormat("it-IT", {
                  timeZone: plan.order.tenant.timezone,
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(expiresAt),
              actions,
            },
          }
        : { kind: "text", to: plan.phone, text };
      const tooLong =
        payload.kind === "interactive"
          ? payload.content.body.length > 4000
          : payload.kind === "text" && payload.text.length > 16000;
      const id = randomUUID(),
        validUntil = automationWindowEnd(
          plan,
          settings,
          intent.dueAt,
          expiresAt,
          holidays,
        );
      await tx.notificationHistory.create({
        data: {
          id,
          tenantId: event.tenantId,
          domainEventId: event.id,
          dispatchKey: "automation:" + run.id + ":" + intent.sequence,
          eventType: event.eventType,
          channel: "whatsapp",
          providerKey: "whatsapp.connect.automation",
          recipientType: "customer",
          customerId: run.customerId,
          status: tooLong ? "skipped" : "pending",
          error: tooLong
            ? "Testo oltre il limite del canale dopo la sostituzione dei segnaposto: rivedi il template"
            : null,
          payload: {
            tenantId: event.tenantId,
            eventType: event.eventType,
            entityType: "appointment",
            entityId: run.anchorAppointmentId,
            eventData: {
              orderId,
              automationRunId: run.id,
              sequence: intent.sequence,
            },
          },
          metadata: {
            automationRunId: run.id,
            sequence: intent.sequence,
            dueAt: intent.dueAt.toISOString(),
          },
        },
      });
      await tx.appointmentAutomationDelivery.create({
        data: {
          historyId: id,
          runId: run.id,
          sequence: intent.sequence,
          dueAt: intent.dueAt,
          validUntil,
          nextAttemptAt: intent.dueAt,
        },
      });
      if (!tooLong)
        await this.commands.reserve(grant, id, request.purpose, payload, tx);
      ids.push(id);
    }
    return ids;
  }
  private async materializeNotice(
    tx: Prisma.TransactionClient,
    event: {
      id: string;
      tenantId: string;
      eventType: string;
      createdAt: Date;
      payload: Prisma.JsonValue;
    },
  ) {
    if (
      !["appointment.confirmed", "appointment.cancelled"].includes(
        event.eventType,
      )
    )
      return [];
    const source = event.payload as unknown as NotificationEventPayload,
      orderId = source.eventData?.["orderId"];
    const targets = (source.eventData?.["affectedAppointments"] ||
      []) as AutomationCalendarRow[];
    const previous = (source.eventData?.["previousAppointments"] ||
      []) as Array<{ id: string }>;
    if (
      typeof orderId !== "string" ||
      !targets.length ||
      !targets.every((a) => previous.some((p) => p.id === a.id))
    )
      return [];
    await lockOperationalTenant(tx, event.tenantId);
    const policy = await tx.appointmentAutomationPolicy.findUnique({
      where: { tenantId: event.tenantId },
    });
    if (
      !policy?.enabled ||
      !policy.enabledAt ||
      event.createdAt < policy.enabledAt ||
      !policy.whatsappGrantId
    )
      return [];
    const settings = validateAutomationSettings(policy.settings),
      enabled =
        event.eventType === "appointment.confirmed"
          ? settings.eventNotices?.confirmation
          : settings.eventNotices?.cancellation;
    if (!enabled) return [];
    const key = "whatsapp-event-notice:" + event.id;
    if (
      await tx.notificationHistory.findUnique({
        where: {
          domainEventId_dispatchKey: {
            domainEventId: event.id,
            dispatchKey: key,
          },
        },
      })
    )
      return [];
    const now = this.clock.now(),
      plan = await currentAutomationPlan(
        tx,
        event.tenantId,
        orderId,
        now,
        targets.map((a) => a.id),
      );
    const expected =
      event.eventType === "appointment.cancelled" ? "cancelled" : "confirmed";
    if (
      !plan ||
      source.eventData?.["contactAuthorizationId"] !== plan.authorizationId ||
      plan.planHash !== automationAppointmentHash(targets) ||
      !plan.appointments.every((a) => a.status === expected)
    )
      return [];
    const grant = await tx.notificationAutomationGrant.findFirst({
      where: {
        id: policy.whatsappGrantId,
        tenantId: event.tenantId,
        channel: "whatsapp",
        status: "ready",
      },
    });
    if (!grant) return [];
    const expiresAt = new Date(
      Math.min(
        plan.appointments[0].startsAt.getTime(),
        event.createdAt.getTime() + 86400000,
      ),
    );
    if (expiresAt <= now) return [];
    const holidays = (
      await tx.tenantHoliday.findMany({
        where: {
          tenantId: event.tenantId,
          date: {
            gte: new Date(now.getTime() - 86400000),
            lte: new Date(expiresAt.getTime() + 86400000),
          },
        },
        select: { date: true },
      })
    ).map((h) => h.date.toISOString().slice(0, 10));
    const opening = automationNextOpening(
        plan,
        settings,
        now,
        expiresAt,
        holidays,
      ),
      dueAt = opening || now;
    const texts = automationTexts(policy.texts),
      text = renderAutomationMessage(
        plan,
        event.eventType === "appointment.cancelled"
          ? texts.cancelled
          : texts.confirmed,
      );
    const skipped = !opening || text.length > 16000;
    const id = randomUUID(),
      context: AutomationNoticeContext = {
        orderId,
        customerId: plan.order.customerId!,
        policyRevision: policy.revision,
        grantId: grant.id,
        eventType: event.eventType as AutomationNoticeContext["eventType"],
        targets: plan.appointments.map((a) => a.id),
        planHash: plan.planHash,
        contactHash: plan.contactHash,
        expiresAt: expiresAt.toISOString(),
        snapshot: {
          customer: {
            firstName: plan.order.customer!.firstName,
            lastName: plan.order.customer!.lastName,
          },
          appointments: plan.appointments.map((a) => ({
            id: a.id,
            service: a.service.name,
            startsAt: a.startsAt.toISOString(),
            endsAt: a.endsAt.toISOString(),
          })),
        },
      };
    await tx.notificationHistory.create({
      data: {
        id,
        tenantId: event.tenantId,
        domainEventId: event.id,
        dispatchKey: key,
        eventType: event.eventType,
        channel: "whatsapp",
        providerKey: "whatsapp.connect.automation",
        recipientType: "customer",
        customerId: plan.order.customerId,
        status: skipped ? "skipped" : "pending",
        error: skipped
          ? opening
            ? "Testo oltre il limite del canale"
            : "Nessuna apertura utile prima della scadenza dell’avviso"
          : null,
        payload: {
          tenantId: event.tenantId,
          eventType: event.eventType,
          entityType: "appointment",
          entityId: plan.appointments[0].id,
          eventData: { orderId, automationEventNotice: true },
        },
        metadata: {
          automationEventNotice: true,
          eventType: event.eventType,
          dueAt: dueAt.toISOString(),
        },
      },
    });
    await tx.appointmentAutomationDelivery.create({
      data: {
        historyId: id,
        runId: null,
        noticeContext: context as unknown as Prisma.InputJsonValue,
        sequence: 0,
        dueAt,
        validUntil: opening
          ? automationWindowEnd(plan, settings, dueAt, expiresAt, holidays)
          : now,
        nextAttemptAt: dueAt,
      },
    });
    if (!skipped)
      await this.commands.reserve(
        grant,
        id,
        (grant.request as unknown as AutomationDelegationInput).purpose,
        { kind: "text", to: plan.phone, text },
        tx,
      );
    return [id];
  }
}
