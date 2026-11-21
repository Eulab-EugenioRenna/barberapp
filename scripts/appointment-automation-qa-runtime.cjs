/* TEST ONLY composition of compiled consumer services. No replacement domain or provider logic. */
module.exports = ({
  prisma,
  notifications,
  queue,
  providers = [{}, {}, {}],
  invalidation = { invalidateBookingReadModels: async () => {} },
  clock,
}) => {
  const database = new URL(
    process.env.DATABASE_URL || "postgres://invalid/invalid",
  ).pathname.slice(1);
  if (!/^(step11_qa_|step7_http_)\d+$/.test(database))
    throw Error("Disposable automation database required");
  const load = (file) => require("/app/dist/apps/api/" + file);
  const { AutomationClock } = load("common/automation-clock");
  clock ||= new AutomationClock();
  const { NotificationAutomationCommandStore } = load(
    "modules/notifications/notification-automation-command-store.service",
  );
  const { NotificationAutomationGrantsService } = load(
    "modules/notifications/notification-automation-grants.service",
  );
  const { AppointmentAutomationPlanner } = load(
    "modules/notifications/appointment-automation-planner.service",
  );
  const { AppointmentAutomationDispatch } = load(
    "modules/notifications/appointment-automation-dispatch.service",
  );
  const { AppointmentCustomerActions } = load(
    "modules/notifications/appointment-customer-actions.service",
  );
  const { AppointmentAutomationStaffNotices } = load(
    "modules/notifications/appointment-automation-staff.service",
  );
  const { AppointmentAutomationRecovery } = load(
    "modules/notifications/appointment-automation-recovery.service",
  );
  const { OrderCommandService } = load("modules/orders/order-command.service");
  const { NotificationsOutboxService } = load(
    "modules/notifications/notifications.outbox.service",
  );
  const { NotificationsDispatchService } = load(
    "modules/notifications/notifications.dispatch.service",
  );
  const store = new NotificationAutomationCommandStore(prisma),
    grants = new NotificationAutomationGrantsService(prisma, store);
  const planner = new AppointmentAutomationPlanner(store, clock, grants),
    dispatcher = new AppointmentAutomationDispatch(
      prisma,
      grants,
      store,
      clock,
    );
  const actions = new AppointmentCustomerActions(
      prisma,
      grants,
      new OrderCommandService(),
      invalidation,
      clock,
    ),
    staff = new AppointmentAutomationStaffNotices(prisma, grants);
  const recovery = new AppointmentAutomationRecovery(
    prisma,
    clock,
    actions,
    staff,
  );
  return {
    clock,
    store,
    grants,
    planner,
    dispatcher,
    actions,
    staff,
    recovery,
    outbox: new NotificationsOutboxService(
      prisma,
      notifications,
      queue,
      planner,
      recovery,
      clock,
    ),
    dispatch: new NotificationsDispatchService(
      notifications,
      ...providers,
      dispatcher,
    ),
  };
};
