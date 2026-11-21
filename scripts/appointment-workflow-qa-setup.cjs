/* Test composition only: actual compiled controllers/domain services on a disposable SDK harness. */
module.exports = async ({ prisma, actors }) => {
  const database = new URL(
    process.env.DATABASE_URL || "postgres://invalid/invalid",
  ).pathname.slice(1);
  if (
    process.env.ALORA_APPOINTMENT_WORKFLOW_TEST_ONLY !== "1" ||
    !/^step11_qa_\d+$/.test(database)
  )
    throw Error("Disposable workflow harness required");
  const load = (file) => require("/app/dist/apps/api/" + file),
    entries = [],
    counters = new Map(),
    cacheInvalidations = [],
    providerCalls = [],
    queued = [];
  let offset = 0,
    queueUnavailable = false,
    failCustomerOperation = false;
  prisma.$use(async (params, next) => {
    const result = await next(params);
    if (
      failCustomerOperation &&
      params.model === "OrderOperation" &&
      params.action === "create" &&
      params.args?.data?.source === "customer"
    ) {
      failCustomerOperation = false;
      throw Error("Synthetic failure after customer operation insert");
    }
    return result;
  });
  const { AppCacheService } = load("cache/cache.service"),
    { CacheInvalidationService } = load("cache/cache-invalidation.service"),
    { AutomationClock } = load("common/automation-clock");
  const cache = {
    get: async (key) => counters.get(key),
    set: async (key, value) => {
      counters.set(key, value);
    },
    del: async (key) => {
      counters.delete(key);
    },
    delByPrefix: async (prefix) => {
      cacheInvalidations.push(prefix);
      for (const key of counters.keys())
        if (key.startsWith(prefix)) counters.delete(key);
    },
    increment: async (key) => {
      const value = (counters.get(key) || 0) + 1;
      counters.set(key, value);
      return value;
    },
    getOrSet: async (key, _ttl, read) => {
      if (counters.has(key)) return counters.get(key);
      const value = await read();
      counters.set(key, value);
      return value;
    },
  };
  const clock = { now: () => new Date(Date.now() + offset) },
    invalidation = new CacheInvalidationService(cache);
  const { NotificationsService } = load(
      "modules/notifications/notifications.service",
    ),
    notifications = new NotificationsService(prisma, cache);
  const queue = {
    add: async (_name, data, options) => {
      if (queueUnavailable) throw Error("Synthetic Redis unavailable");
      queued.push({ ...data, jobId: options.jobId });
      return { id: options.jobId };
    },
  };
  const provider = (channel, providerKey) => ({
    channel,
    providerKey,
    send: async (input) => {
      providerCalls.push({ historyId: input.historyId, channel });
      return { ok: true, providerMessageId: "synthetic:" + input.historyId };
    },
  });
  const runtime = require("/qa/appointment-automation-qa-runtime.cjs")({
    prisma,
    notifications,
    queue,
    providers: [
      provider("in_app", "in_app.native"),
      provider("email", "email.smtp"),
      provider("webhook", "webhook.http"),
    ],
    clock,
    invalidation,
  });
  runtime.outbox.onModuleInit = () => {}; // Manual deterministic polls; no concurrent timer consumes the failpoint.
  const { NotificationsOutboxService } = load(
      "modules/notifications/notifications.outbox.service",
    ),
    { NotificationsDispatchService } = load(
      "modules/notifications/notifications.dispatch.service",
    );
  const alignment = {
    ensureDailyAlignmentQueued: async () => {},
    alignCustomer: async () => {},
    queueCustomerRefresh: async () => {},
  };
  const { CustomersAlignmentService } = load(
    "modules/customers/customers-alignment.service",
  );
  const providers = [
    { provide: AppCacheService, useValue: cache },
    { provide: CacheInvalidationService, useValue: invalidation },
    { provide: AutomationClock, useValue: clock },
    { provide: NotificationsService, useValue: notifications },
    { provide: NotificationsOutboxService, useValue: runtime.outbox },
    { provide: NotificationsDispatchService, useValue: runtime.dispatch },
    { provide: CustomersAlignmentService, useValue: alignment },
  ];
  for (const path of [
    "orders/order-command",
    "orders/operational-order",
    "orders/booking-resources",
    "orders/booking-command",
    "orders/booking-mutation",
    "orders/booking-availability",
    "availability/availability",
    "availability/collaborator-schedule",
    "notifications/appointment-contact",
    "notifications/appointment-automation-policy",
    "notifications/notifications.events",
    "payments/payments",
    "dashboard/financial-report",
  ]) {
    const values = Object.values(load("modules/" + path + ".service"));
    providers.push(
      values.find(
        (value) =>
          typeof value === "function" && value.name.endsWith("Service"),
      ),
    );
  }
  const controllers = [
    "appointments/appointments",
    "public-booking/public-booking",
    "customers/customers",
    "locations/locations",
    "notifications/notifications",
    "notifications/appointment-contact",
    "notifications/appointment-automation-policy",
    "notifications/appointment-automation-monitor",
    "payments/payment-ledger",
  ].map((path) =>
    Object.values(load("modules/" + path + ".controller")).find(
      (value) => typeof value === "function",
    ),
  );
  const hours = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    isWorkingDay: true,
    startTime: "00:00",
    endTime: "23:59",
  }));
  for (const actor of [actors.owner, actors.foreign]) {
    const location = await prisma.location.findFirstOrThrow({
      where: { tenantId: actor.tenantId },
    });
    await prisma.location.updateMany({
      where: { tenantId: actor.tenantId },
      data: { weeklyHours: hours },
    });
    const sectors = await prisma.sector.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: { name: "asc" },
      }),
      services = [];
    for (const sector of sectors) {
      await prisma.sector.update({
        where: { id: sector.id },
        data: { weeklyHours: hours },
      });
      services.push(
        await prisma.service.create({
          data: {
            tenantId: actor.tenantId,
            sectorId: sector.id,
            name: "Synthetic service " + sector.name,
            durationMinutes: 30,
            requiresCollaborator: false,
            requiresRoom: false,
            isPublic: true,
            isBookableOnline: true,
            basePrice: 50,
            priceMode: "legacy",
          },
        }),
      );
    }
    entries.push({
      tenantId: actor.tenantId,
      locationId: location.id,
      sectors: sectors.map((s) => s.id),
      services: services.map((s) => s.id),
    });
  }
  return {
    providers,
    controllers,
    async control(body) {
      if (body.clockOffsetMs !== undefined) offset = Number(body.clockOffsetMs);
      if (body.queueUnavailable !== undefined)
        queueUnavailable = !!body.queueUnavailable;
      if (body.failCustomerOperation !== undefined)
        failCustomerOperation = !!body.failCustomerOperation;
      if (body.action === "processEvent")
        await runtime.actions.processOne(body.eventId);
      if (body.clearCache) counters.clear();
      if (body.action === "recover") await runtime.outbox.recover();
      if (body.action === "withdrawals")
        await new (load(
          "modules/notifications/notification-automation-withdrawal-recovery.service",
        ).NotificationAutomationWithdrawalRecovery)(
          runtime.store,
          runtime.grants,
        ).recover();
      if (body.action === "dispatch")
        await runtime.dispatch.dispatchHistory(body.historyId);
      if (body.action === "drain") {
        const jobs = queued.splice(0);
        for (const job of jobs)
          await runtime.dispatch.dispatchHistory(job.notificationHistoryId);
      }
      return {
        fixtures: entries,
        now: clock.now().toISOString(),
        queued,
        providerCalls,
        cacheInvalidations,
      };
    },
  };
};
