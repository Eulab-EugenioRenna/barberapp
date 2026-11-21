/* TEST ONLY. Synthetic sessions; outbound providers are disabled or synthetic under the Step 12 flag. */
const database = new URL(
  process.env.DATABASE_URL || "postgres://invalid/invalid",
).pathname.slice(1);
if (
  process.env.ALORA_STEP7_TEST_ONLY !== "1" ||
  !database.startsWith("step7_http_")
)
  throw new Error("Requires an isolated step7_http_ database");
const {
  Module,
  ValidationPipe,
  UnauthorizedException,
} = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const base = "/app/dist/apps/api/";
const load = (file) => require(base + file);
const { PrismaService } = load("prisma/prisma.service");
const { AppCacheService } = load("cache/cache.service");
const { CacheInvalidationService } = load("cache/cache-invalidation.service");
const { CustomersAlignmentService } = load(
  "modules/customers/customers-alignment.service",
);
const { NotificationsEventsService } = load(
  "modules/notifications/notifications.events.service",
);
const sessions = load("common/request-session");
const keys = load("common/function-catalog").ALORA_FUNCTIONS.map(
  (row) => row.key,
);
const subjects = Object.fromEntries(
  ["owner", "manager", "foreign", "cashier", "scheduler"].map((role) => [
    role,
    {
      tenantId: role === "foreign" ? "__http_b" : "__http_a",
      user: {
        id: "__http_" + role,
        tenantId: role === "foreign" ? "__http_b" : "__http_a",
        email: `step7-${role}@example.invalid`,
        firstName: "Collaudo",
        lastName: role,
        role: role === "manager" ? "manager" : "owner",
        permissionsConfigured: true,
        permissions:
          role === "scheduler"
            ? keys.filter(
                (key) =>
                  !key.startsWith("sales.") &&
                  !key.startsWith("inventory.") &&
                  !key.startsWith("dashboard."),
              )
            : role === "cashier"
              ? keys.filter((key) => !key.startsWith("inventory."))
              : keys,
        connectFunctions:
          role === "scheduler"
            ? keys.filter(
                (key) =>
                  !key.startsWith("sales.") &&
                  !key.startsWith("inventory.") &&
                  !key.startsWith("dashboard."),
              )
            : role === "cashier"
              ? keys.filter((key) => !key.startsWith("inventory."))
              : keys,
      },
    },
  ]),
);
// A synthetic owner with this function withheld proves grants are independent of role.
subjects.catalog_denied = structuredClone(subjects.owner);
subjects.catalog_denied.user.id = "__http_catalog_denied";
subjects.catalog_denied.user.email = "step13-catalog-denied@example.invalid";
subjects.catalog_denied.user.permissions = keys.filter(
  (key) => key !== "collaborators.read",
);
subjects.catalog_denied.user.connectFunctions = keys.filter(
  (key) => key !== "collaborators.read",
);
subjects.notifications_denied = structuredClone(subjects.owner);
subjects.notifications_denied.user.id = "__http_notifications_denied";
subjects.notifications_denied.user.email = "step12-notifications-denied@example.invalid";
subjects.notifications_denied.user.permissions = keys.filter(key => key !== "notifications.manage");
subjects.notifications_denied.user.connectFunctions = keys.filter(key => key !== "notifications.manage");
sessions.resolveRequestSession = async (_prisma, authorization) => {
  const subject = subjects[(authorization || "").replace(/^Bearer /, "")];
  if (!subject) throw new UnauthorizedException();
  return structuredClone(subject);
};
const { AvailabilityService } = load(
  "modules/availability/availability.service",
);
const { CollaboratorScheduleService } = load(
  "modules/availability/collaborator-schedule.service",
);
const controllers = [
  "payments/payment-ledger",
  "notifications/notifications",
  "notifications/appointment-automation-policy",
  "notifications/appointment-contact",
  "notifications/appointment-automation-monitor",
  "inventory/inventory",
  "locations/locations",
  "services/services",
  "collaborators/collaborators",
  "appointments/appointments",
  "availability/availability",
  "sales/sales",
  "public-booking/public-booking",
  "dashboard/dashboard",
  "dashboard/personal-dashboard",
  "tenant/tenant",
  "products/products",
  "customers/customers",
].map((file) => {
  const exported = load("modules/" + file + ".controller");
  return Object.values(exported).find((value) => typeof value === "function");
});
(async () => {
  const prisma = new PrismaService();
  await prisma.$connect();
  for (const [id, name] of [
    ["__http_a", "Collaudo Studio"],
    ["__http_b", "Altra attività"],
  ])
    await prisma.tenant.create({ data: { id, name, slug: id } });
  for (const [role, subject] of Object.entries(subjects))
    await prisma.user.create({
      data: {
        id: subject.user.id,
        tenantId: subject.tenantId,
        email: subject.user.email,
        passwordHash: "fixture-no-authentication",
        firstName: "Collaudo",
        lastName: role,
        role: subject.user.role,
      },
    });
  await prisma.customer.create({
    data: {
      id: "__http_customer",
      tenantId: "__http_a",
      firstName: "Cliente",
      lastName: "Prova",
    },
  });
  await prisma.customer.create({
    data: {
      id: "__http_private",
      tenantId: "__http_a",
      email: "fixture-private@example.invalid",
      firstName: "Stored",
      lastName: "Private",
      notes: "fixture-private-note",
      totalSpent: "999.99",
    },
  });
  const stored = new Map();
  const redis = {
    get: async (key) => stored.get(key) || null,
    set: async (key, value) => {
      stored.set(key, value);
    },
    del: async (...keys) => keys.forEach((key) => stored.delete(key)),
    scan: async (_cursor, _match, prefix) => [
      "0",
      [...stored.keys()].filter((key) => key.startsWith(prefix.slice(0, -1))),
    ],
    incr: async (key) => {
      const value = Number(stored.get(key) || 0) + 1;
      stored.set(key, String(value));
      return value;
    },
    expire: async () => 1,
  };
  const cache = new AppCacheService(redis);
  const notifications = { emit: async () => undefined };
  const alignment = {
    queueCustomerRefresh: async () => undefined,
    ensureDailyAlignmentQueued: async () => undefined,
    findOrCreateCustomer: async ({
      tenantId,
      firstName,
      lastName,
      phone,
      email,
    }) => {
      if (email) {
        const existing = await prisma.customer.findFirst({
          where: { tenantId, email },
        });
        if (existing) return existing;
      }
      return prisma.customer.create({
        data: { tenantId, firstName, lastName, phone, email },
      });
    },
  };
  class QaModule {}
  Module({
    controllers,
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: AppCacheService, useValue: cache },
      {
        provide: CacheInvalidationService,
        useValue: new CacheInvalidationService(cache),
      },
      { provide: CustomersAlignmentService, useValue: alignment },
      { provide: NotificationsEventsService, useValue: notifications },
      load("modules/notifications/notifications.service").NotificationsService,
      load("modules/notifications/appointment-automation-policy.service").AppointmentAutomationPolicyService,
      load("modules/notifications/appointment-contact.service").AppointmentContactService,
      load("common/automation-clock").AutomationClock,
      load("modules/notifications/notification-automation-command-store.service").NotificationAutomationCommandStore,
      load("modules/notifications/notification-automation-grants.service").NotificationAutomationGrantsService,
      load("modules/pricing/pricing.service").PricingService,
      load("modules/sales/sale-fulfilment.service").SaleFulfilmentService,
      load("modules/inventory/inventory.service").InventoryService,
      load("modules/payments/payments.service").PaymentsService,
      load("modules/orders/operational-order.service").OperationalOrderService,
      load("modules/orders/order-command.service").OrderCommandService,
      load("modules/orders/booking-resources.service").BookingResourcesService,
      load("modules/orders/booking-command.service").BookingCommandService,
      load("modules/orders/booking-mutation.service").BookingMutationService,
      load("modules/orders/booking-availability.service")
        .BookingAvailabilityService,
      load("modules/dashboard/financial-report.service").FinancialReportService,
      AvailabilityService,
      CollaboratorScheduleService,
    ],
  })(QaModule);
  const app = await NestFactory.create(QaModule, { logger: ["error", "warn"] });
  const express = app.getHttpAdapter().getInstance();
  if (process.env.ALORA_STEP12_TEST_ONLY === "1") {
    const { NotificationsOutboxService } = load(
      "modules/notifications/notifications.outbox.service",
    );
    const { NotificationsDispatchService } = load(
      "modules/notifications/notifications.dispatch.service",
    );
    const realNotifications = app.get(
      load("modules/notifications/notifications.service").NotificationsService,
    );
    notifications.emit = new NotificationsEventsService(
      realNotifications,
      prisma,
    ).emit.bind(new NotificationsEventsService(realNotifications, prisma));
    const queued = [],
      providerCalls = [];
    let queueUnavailable = false,
      mode = "success",
      pauseSend = false,
      releaseSend = null,
      failHistory = false;
    const queue = {
      add: async (_name, data, options) => {
        if (queueUnavailable) throw new Error("synthetic-redis-unavailable");
        queued.push({ ...data, jobId: options.jobId });
        return { id: options.jobId };
      },
    };
    const provider = (channel, providerKey) => ({
      channel,
      providerKey,
      send: async (input) => {
        providerCalls.push({
          id: input.historyId,
          channel,
          target: input.target,
          payload: input.payload,
        });
        if (pauseSend) {
          pauseSend = false;
          await new Promise((resolve) => {
            releaseSend = resolve;
          });
          releaseSend = null;
        }
        if (mode === "throw")
          throw new Error("synthetic-provider-lost-response");
        if (mode === "not_started")
          return { ok: false, outcome: "not_started", retrySafe: true };
        if (mode === "uncertain") return { ok: false, outcome: "uncertain" };
        return { ok: true, providerMessageId: "synthetic:" + input.historyId };
      },
    });
    const {outbox,dispatch}=require('/qa/appointment-automation-qa-runtime.cjs')({prisma,notifications:realNotifications,queue,providers:[provider("in_app","in_app.native"),provider("email","email.smtp"),provider("webhook","webhook.http")]});
    const createHistory =
      realNotifications.createHistoryEntry.bind(realNotifications);
    realNotifications.createHistoryEntry = async (...args) => {
      const result = await createHistory(...args);
      if (failHistory) {
        failHistory = false;
        throw new Error("synthetic-after-history-insert-failure");
      }
      return result;
    };
    express.post("/__qa/notifications/:action", async (req, res) => {
      if (req.headers.authorization !== "Bearer owner")
        return res.sendStatus(401);
      try {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const body = raw ? JSON.parse(raw) : {};
        if (typeof body.queueUnavailable === "boolean")
          queueUnavailable = body.queueUnavailable;
        if (
          ["success", "throw", "uncertain", "not_started"].includes(body.mode)
        )
          mode = body.mode;
        if (body.pauseSend) pauseSend = true;
        if (body.releaseSend && releaseSend) releaseSend();
        if (body.failHistory) failHistory = true;
        if (req.params.action === "recover")
          return res.json(await outbox.recover());
        if (req.params.action === "prepare")
          return res.json(await outbox.materializeOne());
        if (req.params.action === "dispatch") {
          await dispatch.dispatchHistory(body.id);
          return res.json({ processed: true });
        }
        return res.json({ queued, providerCalls, paused: !!releaseSend });
      } catch {
        return res
          .status(500)
          .json({ message: "Synthetic notification control failed" });
      }
    });
  }
  let pausePlan = false;
  let planPaused = false;
  let releasePlan;
  const resourcePlanner = app.get(
    load("modules/orders/booking-resources.service").BookingResourcesService,
  );
  const planResources = resourcePlanner.plan.bind(resourcePlanner);
  resourcePlanner.plan = async (...args) => {
    const result = await planResources(...args);
    if (pausePlan) {
      pausePlan = false;
      planPaused = true;
      await new Promise((resolve) => {
        releasePlan = resolve;
      });
      planPaused = false;
    }
    return result;
  };
  express.post("/__qa/pause-next-plan", (req, res) => {
    if (req.headers.authorization !== "Bearer owner")
      return res.sendStatus(401);
    pausePlan = true;
    res.json({ armed: true });
  });
  express.get("/__qa/paused-plan", (req, res) => {
    if (req.headers.authorization !== "Bearer owner")
      return res.sendStatus(401);
    res.json({ paused: planPaused });
  });
  express.post("/__qa/release-plan", (req, res) => {
    if (req.headers.authorization !== "Bearer owner")
      return res.sendStatus(401);
    if (releasePlan) releasePlan();
    releasePlan = null;
    pausePlan = false;
    res.json({ released: true });
  });
  let failNextOrder = false;
  let failNextRecalculation = false;
  let failNextSaleAck = false;
  let failNextBookingAck = false;
  const commandService = app.get(
    load("modules/orders/order-command.service").OrderCommandService,
  );
  const saveCommand = commandService.save.bind(commandService);
  commandService.save = async (...args) => {
    const result = await saveCommand(...args);
    if (failNextSaleAck && args[1].kind === "update_sale") {
      failNextSaleAck = false;
      throw new Error("synthetic-sale-ack-failure");
    }
    if (failNextBookingAck && args[1].kind === "update_booking") {
      failNextBookingAck = false;
      throw new Error("synthetic-booking-ack-failure");
    }
    return result;
  };
  express.post("/__qa/fail-next-booking-ack", (req, res) => {
    if (req.headers.authorization !== "Bearer owner")
      return res.sendStatus(401);
    failNextBookingAck = true;
    res.json({ armed: true });
  });
  express.post("/__qa/fail-next-sale-ack", (req, res) => {
    if (req.headers.authorization !== "Bearer owner")
      return res.sendStatus(401);
    failNextSaleAck = true;
    res.json({ armed: true });
  });
  const orderService = app.get(
    load("modules/orders/operational-order.service").OperationalOrderService,
  );
  const attach = orderService.attachOpenOrder.bind(orderService);
  const recalculate = orderService.recalculate.bind(orderService);
  orderService.recalculate = async (...args) => {
    if (failNextRecalculation) {
      failNextRecalculation = false;
      throw new Error("synthetic-booking-recalculation-failure");
    }
    return recalculate(...args);
  };
  express.post("/__qa/fail-next-booking-recalculation", (req, res) => {
    if (req.headers.authorization !== "Bearer owner")
      return res.sendStatus(401);
    failNextRecalculation = true;
    res.json({ armed: true });
  });
  orderService.attachOpenOrder = async (...args) => {
    if (failNextOrder) {
      failNextOrder = false;
      throw new Error("synthetic-order-attachment-failure");
    }
    return attach(...args);
  };
  express.post("/__qa/fail-next-order", (req, res) => {
    if (req.headers.authorization !== "Bearer owner")
      return res.sendStatus(401);
    failNextOrder = true;
    res.json({ armed: true });
  });
  express.get("/health", (_req, res) => res.json({ testOnly: true, database }));
  express.get("/auth/me", (req, res) => {
    const subject =
      subjects[(req.headers.authorization || "").replace(/^Bearer /, "")];
    return subject
      ? res.json(subject.user)
      : res.status(401).json({ message: "Synthetic QA session required" });
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(
    new (load("common/prisma-error.filter").PrismaErrorFilter)(),
  );
  app.useGlobalGuards(
    new (load("common/local-policy.guard").LocalPolicyGuard)(prisma),
  );
  app.useGlobalInterceptors(
    new (load("common/security-audit.interceptor").SecurityAuditInterceptor)(
      prisma,
    ),
    new (load("common/request-session.interceptor").RequestSessionInterceptor)(
      prisma,
    ),
  );
  await app.listen(3000, "0.0.0.0");
  console.log(JSON.stringify({ testOnly: true, ready: true }));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
