/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires */
/**
 * Demo account (npm run demo:create, or `node dist/scripts/create-demo-account.js`
 * in the api runtime image).
 *
 * Only the account bootstrap is written directly: subscription plan, tenant,
 * owner user (LOCAL, password, not linked to Connect: the owner migrates it via
 * the built-in assisted migration) and the few fields no endpoint writes (listed
 * in DIRECT_WRITES). Every business record is created by the API's own
 * controllers/services, called in this process exactly as an HTTP request would
 * call them (same DTO validation, same policy check, same session scope), so
 * triggers, ledger, stock, order↔booking links and price rules are the ones the
 * app produces today.
 *
 * Seeding session: an in-memory RequestSession placed in the request-session
 * AsyncLocalStorage scope of this process (common/request-session-scope.ts). No
 * token, no LocalSession row, no HTTP server, no production code path changed:
 * nothing created here can be presented to the running API.
 */
import { Prisma, PrismaClient, UserRole } from "@prisma/client";
import { hash } from "bcrypt";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

try {
  // Load .env when running outside the container (local / CI).
  require("dotenv").config();
} catch {
  // .env is optional: rely on process.env (e.g. inside the api container).
}

const args = new Set(process.argv.slice(2));
const RESET = args.has("--reset") || process.env.DEMO_RESET === "1";
const RESET_CONFIRMED =
  args.has("--yes") || process.env.DEMO_RESET_CONFIRM === "yes";

const config = {
  tenantName: process.env.DEMO_TENANT_NAME?.trim() || "ALORA Demo Studio",
  tenantSlug: process.env.DEMO_TENANT_SLUG?.trim() || "demo-barber-studio",
  publicDomain: process.env.DEMO_PUBLIC_DOMAIN?.trim() || undefined,
  ownerEmail: (
    process.env.DEMO_OWNER_EMAIL?.trim() || "demo@barber.test"
  ).toLowerCase(),
  ownerPassword: process.env.DEMO_OWNER_PASSWORD || "",
  ownerFirstName: process.env.DEMO_OWNER_FIRST_NAME?.trim() || "Demo",
  ownerLastName: process.env.DEMO_OWNER_LAST_NAME?.trim() || "Owner",
  timezone: process.env.DEMO_TIMEZONE?.trim() || "Europe/Rome",
};

/** Fields with no endpoint today: written directly, after the API created the record. */
const DIRECT_WRITES = [
  "Service.bufferBeforeMinutes / bufferAfterMinutes / category (no endpoint writes them)",
  "Customer.birthDate (not in the customer DTO)",
  "Collaborator.userId of the owner (linking needs the Connect team flow)",
  "Users manager / reception / collaborator, their UserSectorAccess (team accounts need Connect)",
];

// ---------------------------------------------------------------------------
// API loading: TypeScript sources under ts-node, compiled build in the image.
// ---------------------------------------------------------------------------

function apiRoot(): string {
  const source = resolve(__dirname, "../apps/api/src");
  if (existsSync(join(source, "app.module.ts"))) return source;
  const compiled = resolve(__dirname, "../apps/api");
  if (existsSync(join(compiled, "app.module.js"))) return compiled;
  throw new Error(
    "API non trovata: esegui da repository (ts-node) o dall'immagine api (dist/scripts).",
  );
}
const API_ROOT = apiRoot();
const api = (relative: string): any => require(join(API_ROOT, relative));

// ---------------------------------------------------------------------------
// Dates: everything relative to "now", in the tenant timezone.
// ---------------------------------------------------------------------------

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
const TODAY = todayKey();
function dayKey(offset: number): string {
  const date = new Date(`${TODAY}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
/** 0 = Monday ... 6 = Sunday (collaborator schedules). */
function mondayWeekday(key: string): number {
  return (new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7;
}
/** Offsets (from -14 to +7) of the open days Tuesday..Saturday. */
function openDayOffsets(from: number, to: number): number[] {
  const result: number[] = [];
  for (let offset = from; offset <= to; offset += 1)
    if (mondayWeekday(dayKey(offset)) >= 1 && mondayWeekday(dayKey(offset)) <= 5)
      result.push(offset);
  return result;
}
/** Next offset >= start on the given weekday (0 = Monday). */
function nextWeekday(start: number, weekday: number): number {
  let offset = start;
  while (mondayWeekday(dayKey(offset)) !== weekday) offset += 1;
  return offset;
}
const at = (offset: number, time: string) => `${dayKey(offset)}T${time}`;

function ean13(base12: string): string {
  const digits = base12.split("").map(Number);
  const sum = digits.reduce((total, digit, index) => total + (index % 2 ? digit * 3 : digit), 0);
  return base12 + ((10 - (sum % 10)) % 10);
}

// ---------------------------------------------------------------------------
// Archive (reset): never delete, as before.
// ---------------------------------------------------------------------------

/** Old demo out of sight: inactive, not public, slug, domain and logins freed for the new one. */
async function archiveTenant(prisma: PrismaClient, tenantId: string, stamp: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true, notes: true } });
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        slug: `${tenant.slug}-archivio-${stamp}-${tenantId.slice(0, 6)}`.slice(0, 120), publicDomain: null,
        isActive: false, publicEnabled: false,
        notes: `${tenant.notes ?? ""}\nArchiviato dal reset demo del ${stamp}.`.trim(),
      },
    });
    for (const user of await tx.user.findMany({ where: { tenantId }, select: { id: true } }))
      await archiveUser(tx, user.id, stamp);
  });
}
async function archiveUser(db: Prisma.TransactionClient | PrismaClient, userId: string, stamp: string): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  const [local, domain] = user.email.split("@");
  await db.user.update({
    where: { id: userId },
    data: { email: `${local}+archivio-${stamp}-${userId.slice(0, 6)}@${domain ?? "archivio.invalid"}`, isActive: false },
  });
}

async function ensureDemoPlan(prisma: PrismaClient) {
  return prisma.subscriptionPlan.upsert({
    where: { code: "demo" },
    update: {},
    create: {
      code: "demo",
      name: "Demo",
      description: "Piano demo completo per showcase e formazione.",
      price: 0,
      billingInterval: "monthly",
      maxUsers: 25,
      maxCollaborators: 25,
      maxAppointmentsPerMonth: 100_000,
      isPublic: false,
      features: {
        publicBooking: true,
        products: true,
        notifications: true,
        exports: true,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// In-process API: Nest application context + controller invoker.
// ---------------------------------------------------------------------------

type CallInput = {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
};
type Actor = {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  permissions: string[];
  permissionsConfigured: boolean;
  collaboratorId: string | null;
};

/** Nest loads reflect-metadata before any call reaches this. */
const getMetadata = (key: unknown, target: object, property?: string): any =>
  (Reflect as any).getMetadata(key, target, property);

class DemoApi {
  private readonly authorization = `Bearer seed-${randomBytes(24).toString("base64url")}`;
  private readonly validation: any;
  private readonly prisma: any;
  private readonly scopeModule = api("common/request-session-scope");
  private readonly operational = api("modules/locations/operational-scope");
  private readonly policy = api("common/local-policy.guard");
  private readonly functions: string[] = api("common/function-catalog").ALORA_FUNCTIONS.map(
    (item: { key: string }) => item.key,
  );
  calls = 0;

  constructor(private readonly app: any, public actor: Actor) {
    const { ValidationPipe } = require("@nestjs/common");
    const { validationExceptionFactory } = api("common/validation-messages");
    this.validation = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationExceptionFactory,
    });
    this.prisma = app.get(api("prisma/prisma.service").PrismaService);
  }

  /** What a Connect login would hold for this profile (owner: every ALORA function). */
  private session(): any {
    const actor = this.actor;
    return {
      connectSessionId: null,
      user: {
        id: actor.id,
        tenantId: actor.tenantId,
        email: actor.email,
        firstName: actor.firstName,
        lastName: actor.lastName,
        role: actor.role,
        permissions: actor.permissions,
        permissionsConfigured: actor.permissionsConfigured,
        ...(actor.role === "owner" ? { connectFunctions: this.functions } : {}),
        collaboratorId: actor.collaboratorId,
      },
      tenantId: actor.tenantId,
    };
  }

  /**
   * Calls `Controller.method` as the HTTP pipeline would: LocalPolicyGuard's
   * function check, operational scope, global ValidationPipe on @Body/@Query/@Param
   * (plus param pipes), the request-session scope, and the security audit row.
   */
  async call<T = any>(controllerPath: string, controllerName: string, method: string, input: CallInput = {}): Promise<T> {
    const { ROUTE_ARGS_METADATA, METHOD_METADATA } = require("@nestjs/common/constants");
    const { RequestMethod } = require("@nestjs/common");
    const Controller = api(controllerPath)[controllerName];
    if (!Controller) throw new Error(`Controller ${controllerName} non trovato`);
    const instance = this.app.get(Controller, { strict: false });
    const handler = Controller.prototype[method];
    if (typeof handler !== "function") throw new Error(`${controllerName}.${method} non esiste`);
    const httpMethod = RequestMethod[getMetadata(METHOD_METADATA, handler) ?? 0] ?? "GET";
    const session = this.session();
    const operation = api("common/operation-catalog").operationDefinition(controllerName, method);
    const isPublic = operation?.kind === "public";
    if (!isPublic) this.policy.authorizeLocalOperation(session, controllerName, method);
    const headers: Record<string, string> = { ...(isPublic ? {} : { authorization: this.authorization }), ...(input.headers ?? {}) };
    const request: any = {
      method: httpMethod,
      headers,
      params: input.params ?? {},
      query: input.query ?? {},
      body: input.body ?? {},
      ip: headers["x-forwarded-for"] ?? "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    };
    const metadata = getMetadata(ROUTE_ARGS_METADATA, Controller, method) ?? {};
    const types = getMetadata("design:paramtypes", Controller.prototype, method) ?? [];
    const values: unknown[] = [];
    for (const [key, meta] of Object.entries<any>(metadata)) {
      const type = Number(key.split(":")[0]);
      const source: Record<number, [string, unknown]> = {
        0: ["custom", request],
        3: ["body", request.body],
        4: ["query", request.query],
        5: ["param", request.params],
        6: ["custom", request.headers],
      };
      if (!source[type]) throw new Error(`${controllerName}.${method}: parametro ${key} non supportato`);
      const [kind, whole] = source[type];
      let value: any = meta.data && whole && typeof whole === "object" ? (whole as any)[meta.data] : whole;
      if (kind !== "custom") {
        const argument = { type: kind, metatype: types[meta.index], data: meta.data };
        value = await this.validation.transform(value, argument);
        for (const pipe of meta.pipes ?? [])
          value = await (typeof pipe === "function" ? new pipe() : pipe).transform(value, argument);
      }
      values[meta.index] = value;
    }
    const run = async () => {
      if (!isPublic && ["AppointmentsController", "AvailabilityController", "ServicesController",
        "CollaboratorsController", "SalesController", "DashboardController", "LocationsController"].includes(controllerName))
        await this.operational.resolveOperationalScope(this.prisma, session, headers);
      const result = await this.operational.runOperationalCacheScope(
        session.operationalScope?.cacheKey,
        () => handler.apply(instance, values),
      );
      // SecurityAuditInterceptor: identifiers and operation only.
      if (!isPublic && !["GET", "HEAD", "OPTIONS"].includes(httpMethod) &&
        getMetadata("alora.readOnly", handler) !== true)
        await this.prisma.auditLog.create({
          data: {
            tenantId: session.tenantId,
            actorUserId: session.user.id,
            actorRole: session.user.role,
            action: `${controllerName}.${method}`,
            entityType: controllerName,
            entityId: request.params.id,
          },
        });
      return result;
    };
    this.calls += 1;
    try {
      return await (isPublic
        ? run()
        : this.scopeModule.runRequestSessionScope(run, {
            prisma: this.prisma,
            authorization: headers.authorization,
            session,
          }));
    } catch (error: any) {
      const detail = error?.getResponse?.() ?? error?.message ?? error;
      throw new Error(`${controllerName}.${method} rifiutata: ${JSON.stringify(detail)}\n  richiesta: ${JSON.stringify({ params: input.params, body: input.body }).slice(0, 600)}`);
    }
  }
}

/**
 * The feature modules the seed needs, without HTTP, auth (Connect) or WhatsApp.
 * Queue workers and outbox timers are not started in THIS process: events and
 * jobs written by the services are dispatched by the running API, as for any
 * request.
 */
async function createApiContext(): Promise<any> {
  const { Module } = require("@nestjs/common");
  const { NestFactory } = require("@nestjs/core");
  const { ConfigModule } = require("@nestjs/config");
  require("@nestjs/bullmq").BullRegistrar.prototype.onModuleInit = function () {};
  api("modules/notifications/notifications.outbox.service").NotificationsOutboxService.prototype.onModuleInit =
    function () {};
  api("modules/notifications/notification-automation-withdrawal-recovery.service")
    .NotificationAutomationWithdrawalRecovery.prototype.onModuleInit = function () {};
  class DemoSeedModule {}
  Module({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      api("cache/cache.module").AppCacheModule,
      api("prisma/prisma.module").PrismaModule,
      api("modules/tenant/tenant.module").TenantModule,
      api("modules/locations/locations.module").LocationsModule,
      api("modules/inventory/inventory.module").InventoryModule,
      api("modules/collaborators/collaborators.module").CollaboratorsModule,
      api("modules/services/services.module").ServicesModule,
      api("modules/products/products.module").ProductsModule,
      api("modules/customers/customers.module").CustomersModule,
      api("modules/appointments/appointments.module").AppointmentsModule,
      api("modules/sales/sales.module").SalesModule,
      api("modules/payments/payments.module").PaymentsModule,
      api("modules/notifications/notifications.module").NotificationsModule,
      api("modules/public-booking/public-booking.module").PublicBookingModule,
    ],
  })(DemoSeedModule);
  const app = await NestFactory.createApplicationContext(DemoSeedModule, {
    logger: ["error", "warn"],
    abortOnError: false,
  });
  return app;
}

// ---------------------------------------------------------------------------
// Demo data, through the API.
// ---------------------------------------------------------------------------

const C = {
  tenant: ["modules/tenant/tenant.controller", "TenantController"],
  activities: ["modules/locations/activities.controller", "ActivitiesController"],
  locations: ["modules/locations/locations.controller", "LocationsController"],
  collaborators: ["modules/collaborators/collaborators.controller", "CollaboratorsController"],
  services: ["modules/services/services.controller", "ServicesController"],
  products: ["modules/products/products.controller", "ProductsController"],
  brands: ["modules/products/product-brands.controller", "ProductBrandsController"],
  inventory: ["modules/inventory/inventory.controller", "InventoryController"],
  customers: ["modules/customers/customers.controller", "CustomersController"],
  appointments: ["modules/appointments/appointments.controller", "AppointmentsController"],
  publicBooking: ["modules/public-booking/public-booking.controller", "PublicBookingController"],
  sales: ["modules/sales/sales.controller", "SalesController"],
  payments: ["modules/payments/payments.controller", "PaymentsController"],
  ledger: ["modules/payments/payment-ledger.controller", "PaymentLedgerController"],
  notifications: ["modules/notifications/notifications.controller", "NotificationsController"],
  policy: ["modules/notifications/appointment-automation-policy.controller", "AppointmentAutomationPolicyController"],
} as const;

type Ref = readonly [string, string];
let keySequence = 0;
const key = (label: string) => `demo.${label}.${Date.now().toString(36)}.${(keySequence += 1)}`;

/** Weekly hours on Location/Sector: 0 = Sunday (operational-hours.ts). */
function locationHours(open: Record<number, [string, string]>) {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    isWorkingDay: !!open[weekday],
    ...(open[weekday] ? { startTime: open[weekday][0], endTime: open[weekday][1] } : {}),
  }));
}
/** Collaborator schedules: 0 = Monday (collaborator-schedule.service.ts). */
function staffHours(open: Record<number, [string, string]>) {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    isWorkingDay: !!open[weekday],
    ...(open[weekday] ? { startTime: open[weekday][0], endTime: open[weekday][1] } : {}),
  }));
}

async function seedDemo(apiClient: DemoApi, prisma: PrismaClient, tenantId: string, owner: Actor, log: string[]) {
  const call = <T = any>(ref: Ref, method: string, input?: CallInput) =>
    apiClient.call<T>(ref[0], ref[1], method, input);
  const note = (line: string) => {
    log.push(line);
    console.log(`  · ${line}`);
  };

  // --- Activities, locations, sectors ------------------------------------
  // A new account starts with one location (named after the company) and a
  // «Generale» sector/activity (database trigger). Rename that activity to
  // Barberia, add Estetica, then the second location.
  const { activities } = await call<{ activities: any[] }>(C.activities, "list");
  const initial = activities.find((item) => item.name === "Generale") ?? activities.find((item) => item.name !== "Rivendita");
  const barberia = await call(C.activities, "update", { params: { id: initial.id }, body: { name: "Barberia", color: "#1e3425" } });
  const estetica = await call(C.activities, "create", { body: { preset: "estetica" } });
  // Navigli runs two other activities. Today a booking must be in the home sector of
  // its service (trigger alora_appointment_scope), so an activity shared by both
  // locations would be bookable only in the first one.
  const parrucchiere = await call(C.activities, "create", { body: { preset: "parrucchiere" } });
  const benessere = await call(C.activities, "create", { body: { preset: "benessere" } });
  const centro = await prisma.location.findFirstOrThrow({ where: { tenantId }, include: { sectors: true } });
  // Location hours, 0 = Sunday: Sunday and Monday closed.
  const centroHours = locationHours({ 2: ["09:00", "19:00"], 3: ["09:00", "19:00"], 4: ["09:00", "20:00"], 5: ["09:00", "20:00"], 6: ["09:00", "18:00"] });
  const locationClosure = dayKey(nextWeekday(15, 2)); // a Wednesday, ~3 weeks ahead
  await call(C.locations, "update", {
    params: { id: centro.id },
    body: { name: "ALORA Centro", address: "Via Roma 12, 20121 Milano", weeklyHours: centroHours, closures: [locationClosure] },
  });
  const centroBarberia = centro.sectors[0];
  await call(C.locations, "updateSector", {
    params: { id: centroBarberia.id },
    body: { weeklyHours: locationHours({ 2: ["09:00", "19:00"], 3: ["09:00", "19:00"], 4: ["09:00", "20:00"], 5: ["09:00", "20:00"], 6: ["09:00", "17:00"] }) },
  });
  const sectorClosure = dayKey(nextWeekday(4, 3)); // Estetica Centro closed one Thursday
  const centroEstetica = await call(C.locations, "createSector", {
    params: { id: centro.id },
    // The activityId form of this endpoint currently fails ("name" key present as
    // undefined in settings()); the name form links the existing activity (database).
    body: { name: estetica.name, weeklyHours: locationHours({ 2: ["10:00", "19:00"], 3: ["10:00", "19:00"], 4: ["10:00", "19:00"], 5: ["10:00", "19:00"], 6: ["09:30", "16:00"] }), closures: [sectorClosure] },
  });
  const navigli = await call(C.locations, "create", {
    body: {
      name: "ALORA Navigli",
      address: "Ripa di Porta Ticinese 55, 20143 Milano",
      activityIds: [parrucchiere.id, benessere.id],
      weeklyHours: locationHours({ 2: ["10:00", "20:00"], 3: ["10:00", "20:00"], 4: ["10:00", "20:00"], 5: ["10:00", "21:00"], 6: ["10:00", "19:00"] }),
      closures: [dayKey(nextWeekday(2, 1))],
    },
  });
  const navigliHair = navigli.sectors.find((s: any) => s.activityId === parrucchiere.id);
  const navigliSpa = navigli.sectors.find((s: any) => s.activityId === benessere.id);
  await call(C.locations, "updateSector", {
    params: { id: navigliSpa.id },
    body: { weeklyHours: locationHours({ 3: ["11:00", "20:00"], 4: ["11:00", "20:00"], 5: ["11:00", "21:00"], 6: ["10:00", "19:00"] }), closures: [dayKey(nextWeekday(1, 5))] },
  });
  if (centroEstetica.activityId !== estetica.id) throw new Error("Settore Estetica non collegato all'attività");
  note(`sedi: ALORA Centro (Barberia + Estetica) + ALORA Navigli (Parrucchiere + Benessere), 4 settori, chiusure sede ${locationClosure}, settore ${sectorClosure}`);

  // Rooms (Estetica cabins).
  const cabinaCentro = await call(C.locations, "createRoom", { body: { sectorId: centroEstetica.id, name: "Cabina viso", capacity: 1 } });
  await call(C.locations, "createRoom", { body: { sectorId: navigliSpa.id, name: "Cabina relax", capacity: 1, isPublic: true } });

  // --- Tenant settings & holidays ----------------------------------------
  const holiday = dayKey(nextWeekday(3, 4)); // a Friday within the next week and a half
  const year = Number(TODAY.slice(0, 4));
  const christmas = `${TODAY.slice(5) > "12-25" ? year + 1 : year}-12-25`;
  const newYear = `${TODAY.slice(5) > "01-01" ? year + 1 : year}-01-01`;
  const holidays = [
    { date: holiday, name: "Festa del patrono" },
    ...(christmas !== holiday ? [{ date: christmas, name: "Natale" }] : []),
    ...(newYear !== holiday ? [{ date: newYear, name: "Capodanno" }] : []),
  ];

  // --- Collaborators -------------------------------------------------------
  const collaborator = async (body: Record<string, unknown>, sectorIds: string[]) => {
    const created = await call(C.collaborators, "create", { body: { ...body, sectorId: sectorIds[0] } });
    if (sectorIds.length > 1)
      await call(C.locations, "professionalSectors", { params: { id: created.id }, body: { sectorIds } });
    return created;
  };
  const ownerCollaborator = await collaborator({
    firstName: owner.firstName, lastName: owner.lastName, email: owner.email, phone: "+39 333 100 0000",
    calendarColor: "#1c7c64", isPublic: true,
    weeklySchedules: staffHours({ 1: ["09:00", "19:00"], 2: ["09:00", "19:00"], 3: ["09:00", "19:00"], 4: ["09:00", "19:00"], 5: ["09:00", "17:00"] }),
  }, [centroBarberia.id]);
  const marco = await collaborator({
    firstName: "Marco", lastName: "Rossi", email: "marco.demo@barber.test", phone: "+39 333 111 0001",
    calendarColor: "#2563eb", isPublic: true,
    // Saturday reduced, works in both locations.
    weeklySchedules: staffHours({ 1: ["09:00", "18:00"], 2: ["09:00", "18:00"], 3: ["12:00", "20:00"], 4: ["10:00", "20:00"], 5: ["10:00", "14:00"] }),
    dayOverrides: [{ date: dayKey(nextWeekday(1, 3)), isWorkingDay: true, startTime: "14:00", endTime: "21:00", note: "Turno serale evento" }],
  }, [centroBarberia.id, navigliHair.id]);
  const lucaOff = dayKey(nextWeekday(2, 2));
  const luca = await collaborator({
    firstName: "Luca", lastName: "Bianchi", email: "luca.demo@barber.test", phone: "+39 333 111 0002",
    calendarColor: "#f97316", isPublic: false, // not bookable online
    // Day off on Saturday, exception (holiday) on a future Wednesday.
    weeklySchedules: staffHours({ 1: ["10:00", "19:00"], 2: ["10:00", "19:00"], 3: ["10:00", "19:00"], 4: ["10:00", "19:00"] }),
    dayOverrides: [{ date: lucaOff, isWorkingDay: false, isHoliday: true, note: "Ferie" }],
  }, [centroBarberia.id]);
  const sara = await collaborator({
    firstName: "Sara", lastName: "Leone", email: "sara.demo@barber.test", phone: "+39 333 111 0003",
    calendarColor: "#db2777", isPublic: true,
    // Wednesday afternoon only.
    weeklySchedules: staffHours({ 1: ["10:00", "19:00"], 2: ["14:00", "19:00"], 3: ["10:00", "19:00"], 4: ["10:00", "19:00"], 5: ["09:30", "16:00"] }),
  }, [centroEstetica.id]);
  const giulia = await collaborator({
    firstName: "Giulia", lastName: "Conti", email: "giulia.demo@barber.test", phone: "+39 333 111 0004",
    calendarColor: "#7c3aed", isPublic: true,
    weeklySchedules: staffHours({ 2: ["11:00", "20:00"], 3: ["11:00", "20:00"], 4: ["11:00", "21:00"], 5: ["10:00", "19:00"] }),
  }, [navigliSpa.id, centroEstetica.id]);
  const paolo = await collaborator({
    firstName: "Paolo", lastName: "Greco", email: "paolo.demo@barber.test", calendarColor: "#111827", isPublic: true,
    weeklySchedules: staffHours({ 1: ["10:00", "20:00"], 2: ["10:00", "20:00"], 3: ["10:00", "20:00"], 4: ["10:00", "21:00"], 5: ["10:00", "19:00"] }),
  }, [navigliHair.id]);
  note("collaboratori: 6 (titolare incluso), orari diversi, sabato ridotto, giorno libero, eccezioni giornaliere");

  await call(C.tenant, "updateSettings", {
    body: {
      bookingMode: "hybrid",
      defaultCollaboratorId: ownerCollaborator.id,
      publicEnabled: true,
      publicTitle: config.tenantName,
      publicDescription: "Barberia ed estetica in due sedi a Milano: prenota online il tuo servizio.",
      publicSteps: [
        "Servizio|Scegli fra barberia ed estetica",
        "Professionista|Disponibilità reale della squadra",
        "Conferma|La prenotazione arriva subito in agenda",
      ],
      primaryColor: "#1c7c64",
      accentColor: "#f97316",
      holidays,
    },
  });
  note(`festività azienda: ${holidays.map((item) => item.date).join(", ")}`);

  // --- Services --------------------------------------------------------------
  const service = (body: Record<string, unknown>) => call(C.services, "create", { body: { isActive: true, ...body } });
  const s = {
    taglio: await service({ activityId: barberia.id, name: "Taglio sartoriale", publicDescription: "Consulenza, lavaggio e taglio costruito sul viso.", durationMinutes: 45, basePrice: "38", priceMode: "gross", vatRate: "22", color: "#1c7c64", isPublic: true, isBookableOnline: true }),
    barba: await service({ activityId: barberia.id, name: "Barba rituale", publicDescription: "Panno caldo, precisione e trattamento lenitivo.", durationMinutes: 30, basePrice: "26", priceMode: "gross", vatRate: "22", color: "#f59e0b", isPublic: true, isBookableOnline: true }),
    rifinitura: await service({ activityId: barberia.id, name: "Rifinitura collo", durationMinutes: 15, basePrice: "10", priceMode: "gross", vatRate: "22", color: "#0ea5e9", isPublic: true, isBookableOnline: true }),
    executive: await service({ activityId: barberia.id, name: "Executive grooming", publicDescription: "Taglio, barba, maschera e styling finale.", durationMinutes: 90, basePrice: "74", priceMode: "gross", vatRate: "22", color: "#111827", isPublic: true, isBookableOnline: true }),
    bimbo: await service({ activityId: barberia.id, name: "Taglio junior", durationMinutes: 30, basePrice: "16.39", priceMode: "net", vatRate: "22", color: "#22c55e", isPublic: true, isBookableOnline: true }),
    colore: await service({ activityId: barberia.id, name: "Color refresh", internalDescription: "Solo su consulenza in negozio.", durationMinutes: 60, basePrice: "59", priceMode: "gross", vatRate: "22", color: "#a855f7", isPublic: false, isBookableOnline: false }),
    viso: await service({ activityId: estetica.id, name: "Pulizia viso", publicDescription: "Trattamento in cabina con vapore e maschera.", durationMinutes: 60, basePrice: "65", priceMode: "gross", vatRate: "22", color: "#db2777", isPublic: true, isBookableOnline: true, requiresRoom: true }),
    manicure: await service({ activityId: estetica.id, name: "Manicure", durationMinutes: 45, basePrice: "30", priceMode: "gross", vatRate: "22", color: "#f472b6", isPublic: true, isBookableOnline: true }),
    sopracciglia: await service({ activityId: estetica.id, name: "Sopracciglia", durationMinutes: 20, basePrice: "15", priceMode: "gross", vatRate: "22", color: "#fb7185", isPublic: true, isBookableOnline: true }),
    donna: await service({ activityId: parrucchiere.id, name: "Taglio donna", publicDescription: "Shampoo, taglio e piega.", durationMinutes: 60, basePrice: "48", priceMode: "gross", vatRate: "22", color: "#7c3aed", isPublic: true, isBookableOnline: true }),
    piega: await service({ activityId: parrucchiere.id, name: "Piega", durationMinutes: 30, basePrice: "25", priceMode: "gross", vatRate: "22", color: "#a78bfa", isPublic: true, isBookableOnline: true }),
    colorazione: await service({ activityId: parrucchiere.id, name: "Colore e piega", durationMinutes: 90, basePrice: "75", priceMode: "gross", vatRate: "22", color: "#6d28d9", isPublic: true, isBookableOnline: true }),
    massaggio: await service({ activityId: benessere.id, name: "Massaggio decontratturante", publicDescription: "In cabina, olii caldi.", durationMinutes: 50, basePrice: "55", priceMode: "gross", vatRate: "22", color: "#0891b2", isPublic: true, isBookableOnline: true, requiresRoom: true }),
    spa: await service({ activityId: benessere.id, name: "Rituale spa", durationMinutes: 75, basePrice: "70", priceMode: "net", vatRate: "22", color: "#06b6d4", isPublic: true, isBookableOnline: true }),
  };
  // Price history through the app: a list price change with its reason.
  await call(C.services, "update", { params: { id: s.taglio.id }, body: { basePrice: "40", priceChangeReason: "Listino autunno" } });
  await call(C.services, "update", { params: { id: s.manicure.id }, body: { basePrice: "32", priceChangeReason: "Nuovo smalto semipermanente incluso" } });
  // No endpoint writes buffers or categories today (DIRECT_WRITES).
  const extras: Array<[any, Prisma.ServiceUpdateInput]> = [
    [s.taglio, { category: "Capelli", bufferAfterMinutes: 5 }],
    [s.barba, { category: "Barba" }],
    [s.rifinitura, { category: "Capelli" }],
    [s.executive, { category: "Percorsi", bufferBeforeMinutes: 10, bufferAfterMinutes: 10 }],
    [s.bimbo, { category: "Capelli" }],
    [s.colore, { category: "Colore", bufferAfterMinutes: 15 }],
    [s.viso, { category: "Viso", bufferBeforeMinutes: 5, bufferAfterMinutes: 10 }],
    [s.manicure, { category: "Mani" }],
    [s.massaggio, { category: "Corpo", bufferAfterMinutes: 10 }],
    [s.spa, { category: "Corpo", bufferBeforeMinutes: 10 }],
    [s.donna, { category: "Capelli" }],
    [s.piega, { category: "Capelli" }],
    [s.colorazione, { category: "Colore", bufferAfterMinutes: 10 }],
    [s.sopracciglia, { category: "Viso" }],
  ];
  for (const [item, data] of extras) await prisma.service.update({ where: { id: item.id }, data });
  note("servizi: 14 (15–90 min, IVA, prezzi lordi/netti, uno con cabina, uno non pubblico, storico prezzi)");

  // --- Products, brands, stock -----------------------------------------------
  const brand = async (name: string) => call(C.brands, "create", { body: { name } });
  const [officina, botanica, nord] = [await brand("Officina Barbieri"), await brand("Botanica Lab"), await brand("Nord Grooming")];
  const product = (body: Record<string, unknown>) =>
    call(C.products, "create", { body: { isActive: true, priceMode: "gross", vatRate: "22", costMode: "net", purchaseVatRate: "22", ...body } });
  const p = {
    pomata: await product({ name: "Pomata opaca", description: "Tenuta naturale e finish opaco.", category: "Styling", sku: "POM-MAT", barcode: ean13("200000000001"), brandId: officina.id, price: "18", cost: "7.40", stockTracked: true }),
    olio: await product({ name: "Olio barba premium", description: "Blend nutriente con note legnose.", category: "Barba", sku: "OIL-BRD", barcode: ean13("200000000002"), brandId: officina.id, price: "24", cost: "9.80", stockTracked: true }),
    shampoo: await product({ name: "Shampoo detox", description: "Detersione profonda pre taglio.", category: "Care", sku: "SHP-DTX", barcode: ean13("200000000003"), brandId: nord.id, price: "16", cost: "5.90", stockTracked: true }),
    clay: await product({ name: "Clay texture", category: "Styling", sku: "CLAY-TXT", barcode: ean13("200000000004"), brandId: nord.id, price: "22", cost: "8.20", stockTracked: true }),
    crema: await product({ activityId: estetica.id, name: "Crema viso idratante", category: "Viso", sku: "CRM-VIS", barcode: ean13("200000000005"), brandId: botanica.id, price: "29", cost: "11.50", stockTracked: true }),
    tonico: await product({ name: "Scalp tonic", description: "Tonico cute (non a magazzino).", category: "Care", sku: "TON-SCLP", price: "19", priceMode: "net", vatRate: "22", costMode: "legacy", purchaseVatRate: undefined }),
  };
  await call(C.products, "update", { params: { id: p.olio.id }, body: { price: "26", priceChangeReason: "Aumento listino fornitore" } });
  const stock = async (kind: string, locationId: string, productId: string, quantity: string, extra: Record<string, unknown> = {}) =>
    call(C.inventory, "execute", { body: { kind, idempotencyKey: key(`stock-${kind}`), locationId, productId, quantity, ...extra } });
  for (const [item, centroQty, navigliQty] of [[p.pomata, "14", "8"], [p.olio, "3", "6"], [p.shampoo, "20", "10"], [p.clay, "9", "2"], [p.crema, "12", "6"]] as const) {
    await stock("opening", centro.id, item.id, centroQty);
    await stock("opening", navigli.id, item.id, navigliQty);
  }
  await stock("receipt", centro.id, p.pomata.id, "12", { unitCost: "7.40", costMode: "net", purchaseVatRate: "22", reason: "Riordino fornitore Officina Barbieri" });
  await stock("transfer", centro.id, p.shampoo.id, "4", { toLocationId: navigli.id, reason: "Riequilibrio fra sedi" });
  await stock("issue", navigli.id, p.clay.id, "1", { reason: "Tester rotto" });
  await stock("adjust", navigli.id, p.pomata.id, "7", { reason: "Inventario di fine mese" });
  // Service ↔ product links (consumption drives stock when the service is sold).
  const link = (serviceId: string, body: Record<string, unknown>) =>
    call(C.services, "attachProduct", { params: { id: serviceId }, body });
  await link(s.taglio.id, { productId: p.pomata.id, mode: "optional" });
  await link(s.taglio.id, { productId: p.clay.id, mode: "recommended" });
  await link(s.barba.id, { productId: p.olio.id, mode: "recommended" });
  await link(s.executive.id, { productId: p.shampoo.id, mode: "included", priceLocked: true, consumptionUnits: "0.100" });
  await link(s.executive.id, { productId: p.olio.id, mode: "required", priceLocked: true });
  await link(s.viso.id, { productId: p.crema.id, mode: "recommended" });
  note("prodotti: 6 (barcode EAN-13, brand, costo, IVA), giacenze iniziali, carico, trasferimento, scarico, rettifica inventario, collegamenti servizio↔prodotto");

  // --- Customers ---------------------------------------------------------------
  const customerRows: Array<Record<string, unknown> & { birth?: string }> = [
    { firstName: "Luca", lastName: "Ferri", email: "luca.ferri@example.test", phone: "+39 333 111 1111", marketingConsent: true, tags: ["abituale"], birth: "1986-03-14" },
    { firstName: "Giulia", lastName: "Riva", email: "giulia.riva@example.test", phone: "+39 333 222 2222", marketingConsent: true, notes: "Preferisce il sabato mattina.", birth: "1992-11-02" },
    { firstName: "Andrea", lastName: "Sala", email: "andrea.sala@example.test", phone: "+39 333 333 3333", marketingConsent: false, tags: ["richiamo"] },
    { firstName: "Valentina", lastName: "Neri", email: "valentina.neri@example.test", phone: "+39 347 444 4444", marketingConsent: true, tags: ["premium"], birth: dayKey(3).replace(/^\d{4}/, "1990") },
    { firstName: "Matteo", lastName: "Galli", phone: "+39 02 8456 1290", marketingConsent: false, notes: "Numero fisso dello studio: chiamare dopo le 15." },
    { firstName: "Oliver", lastName: "Smith", email: "oliver.smith@example.test", phone: "+44 20 7946 0958", marketingConsent: false, notes: "Cliente inglese, parla poco italiano." },
    { firstName: "Chiara", lastName: "Fontana", email: "chiara.fontana@example.test", phone: "tel. da richiedere", marketingConsent: false, notes: "Numero illeggibile sulla scheda cartacea." },
    { firstName: "Federico", lastName: "Moretti", email: "federico.moretti@example.test", marketingConsent: true, notes: "Nessun telefono: solo email." },
    { firstName: "Elena", lastName: "Barbieri", email: "elena.barbieri@example.test", phone: "+39 340 555 0101", marketingConsent: true, birth: "1979-07-21" },
    { firstName: "Davide", lastName: "Lombardi", phone: "+39 339 555 0102", marketingConsent: false },
    { firstName: "Sofia", lastName: "Marchetti", email: "sofia.marchetti@example.test", phone: "+39 348 555 0103", marketingConsent: true, notes: "Allergia al nichel." },
    { firstName: "Alessandro", lastName: "Costa", email: "alessandro.costa@example.test", phone: "+39 320 555 0104", marketingConsent: false, birth: "2001-01-30" },
    { firstName: "Martina", lastName: "Giordano", phone: "+39 351 555 0105", marketingConsent: true },
    { firstName: "Simone", lastName: "Rinaldi", email: "simone.rinaldi@example.test", phone: "+39 366 555 0106", marketingConsent: false, tags: ["vip"] },
    { firstName: "Francesca", lastName: "Ferrara", email: "francesca.ferrara@example.test", phone: "+39 329 555 0107", marketingConsent: true, birth: "1995-05-09" },
    { firstName: "Lorenzo", lastName: "Caruso", phone: "+39 0331 245 678", marketingConsent: false, notes: "Fisso di casa." },
    { firstName: "Beatrice", lastName: "Mancini", email: "beatrice.mancini@example.test", phone: "+41 79 555 01 08", marketingConsent: true, notes: "Numero svizzero." },
    { firstName: "Tommaso", lastName: "Villa", email: "tommaso.villa@example.test", phone: "+39 335 555 0109", marketingConsent: false },
    { firstName: "Aurora", lastName: "Testa", phone: "+39 338 555 0110", marketingConsent: true, birth: "1988-12-24" },
    { firstName: "Gabriele", lastName: "De Luca", email: "gabriele.deluca@example.test", phone: "+39 331 555 0111", marketingConsent: false },
  ];
  const customers: any[] = [];
  for (const { birth, ...body } of customerRows) {
    const created = await call(C.customers, "create", { body: { privacyConsent: true, ...body } });
    if (birth) await prisma.customer.update({ where: { id: created.id }, data: { birthDate: new Date(`${birth}T00:00:00Z`) } });
    customers.push(created);
  }
  note(`clienti: ${customers.length} (fisso, estero, illeggibile, senza telefono, consensi sì/no, compleanni)`);

  return { centro, navigli, sectors: { centroBarberia, centroEstetica, navigliHair, navigliSpa }, rooms: { cabinaCentro }, staff: { ownerCollaborator, marco, luca, sara, giulia, paolo }, s, p, customers, lucaOff, holiday, call, note };
}

// ---------------------------------------------------------------------------
// Agenda, cassa and payments, through the API.
// ---------------------------------------------------------------------------

type Base = Awaited<ReturnType<typeof seedDemo>>;

/** Deterministic pseudo-random sequence: same demo shape at every reset. */
function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
function nowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  return minutes(parts);
}
/** Absolute ISO instant of a local tenant date/time (for receivedAt / soldAt). */
function instant(offset: number, time: string): string {
  const local = new Date(`${dayKey(offset)}T${time}:00Z`);
  const zoned = new Date(local.toLocaleString("en-US", { timeZone: config.timezone }));
  const utc = new Date(local.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(local.getTime() - (zoned.getTime() - utc.getTime())).toISOString();
}
const money = (value: unknown) => Number(value ?? 0).toFixed(2);

async function seedOperations(apiClient: DemoApi, prisma: PrismaClient, tenantId: string, owner: Actor, base: Base) {
  const { call, note, staff, s, p, customers, sectors, centro, navigli } = base;
  const rand = random(20261128);
  const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
  const tenantSlug = config.tenantSlug;
  const now = nowMinutes();
  const FIRST = -14;
  const LAST = 8;

  // Who works where (collaborator schedules are not per location).
  type Plan = { collaborator: any; services: any[]; servicesAt?: (weekday: number) => any[]; place: (weekday: number) => { location: any; sector: any } | null; hours: Record<number, [string, string]> };
  const barber = [s.taglio, s.barba, s.rifinitura, s.executive, s.bimbo, s.taglio, s.barba];
  const beauty = [s.manicure, s.sopracciglia, s.viso, s.manicure];
  const hair = [s.donna, s.piega, s.colorazione, s.piega];
  const spa = [s.massaggio, s.spa];
  const scheduleOf = async (id: string) => {
    const rows = await prisma.collaboratorWeeklySchedule.findMany({ where: { collaboratorId: id } });
    return Object.fromEntries(rows.filter((r) => r.isWorkingDay && r.startTime && r.endTime).map((r) => [r.weekday, [r.startTime!, r.endTime!]])) as Record<number, [string, string]>;
  };
  const atCentro = (sector: any) => () => ({ location: centro, sector });
  const atNavigli = (sector: any) => () => ({ location: navigli, sector });
  const plans: Plan[] = [
    { collaborator: staff.ownerCollaborator, services: [...barber, s.colore], place: atCentro(sectors.centroBarberia), hours: await scheduleOf(staff.ownerCollaborator.id) },
    { collaborator: staff.marco, services: barber, place: (weekday) => (weekday <= 2 ? { location: centro, sector: sectors.centroBarberia } : { location: navigli, sector: sectors.navigliHair }), servicesAt: (weekday: number) => (weekday <= 2 ? barber : hair), hours: await scheduleOf(staff.marco.id) },
    { collaborator: staff.luca, services: barber, place: atCentro(sectors.centroBarberia), hours: await scheduleOf(staff.luca.id) },
    { collaborator: staff.sara, services: beauty, place: atCentro(sectors.centroEstetica), hours: await scheduleOf(staff.sara.id) },
    { collaborator: staff.giulia, services: spa, place: atNavigli(sectors.navigliSpa), hours: await scheduleOf(staff.giulia.id) },
    { collaborator: staff.paolo, services: hair, place: atNavigli(sectors.navigliHair), hours: await scheduleOf(staff.paolo.id) },
  ];
  const serviceRow = new Map((await prisma.service.findMany({ where: { tenantId } })).map((row) => [row.id, row]));
  const closures = new Map<string, Set<string>>(); // locationId|sectorId -> dates
  for (const row of [...(await prisma.location.findMany({ where: { tenantId } })), ...(await prisma.sector.findMany({ where: { tenantId } }))])
    closures.set(row.id, new Set(Array.isArray(row.closures) ? (row.closures as string[]) : []));
  const holidays = new Set((await prisma.tenantHoliday.findMany({ where: { tenantId } })).map((h) => h.date.toISOString().slice(0, 10)));
  const overrides = await prisma.collaboratorDayOverride.findMany({ where: { collaborator: { tenantId } } });

  // Fixed scenarios first; the generator leaves their time free.
  const saturday = nextWeekday(1, 5);
  const monday = nextWeekday(1, 0);
  const pastWednesday = nextWeekday(-6, 2);
  const futureThursday = nextWeekday(2, 3);
  const blocked: Array<{ collaboratorId: string; offset: number; from: number; to: number }> = [
    { collaboratorId: staff.ownerCollaborator.id, offset: pastWednesday, from: minutes("15:00"), to: minutes("16:30") },
    { collaboratorId: staff.luca.id, offset: futureThursday, from: minutes("16:00"), to: minutes("17:30") },
  ];

  const [ownerPlan, marcoPlan, lucaPlan, saraPlan, giuliaPlan, paoloPlan] = plans;
  // Public bookings (source public) need opening hours, public service/professional
  // and a future time: their slots are reserved before the regular agenda.
  const publicSlots = [
    { plan: ownerPlan, offset: nextWeekday(2, 1), start: "12:00", service: s.rifinitura },
    { plan: paoloPlan, offset: nextWeekday(2, 2), start: "13:00", service: s.piega },
    { plan: giuliaPlan, offset: nextWeekday(1, 3), start: "15:00", service: s.spa },
    { plan: saraPlan, offset: nextWeekday(1, 1), start: "11:00", service: s.manicure },
    { plan: marcoPlan, offset: nextWeekday(3, 1), start: "16:00", service: s.taglio },
  ];
  for (const slot of publicSlots)
    blocked.push({ collaboratorId: slot.plan.collaborator.id, offset: slot.offset, from: minutes(slot.start) - 15, to: minutes(slot.start) + slot.service.durationMinutes + 15 });
  // --- Public bookings (source public): future, inside opening hours ----------------
  let publicCount = 0;
  const publicPeople = [
    { customerName: "Nicolò Ferraro", email: "nicolo.ferraro@example.test", phone: "+39 345 777 0001", appointmentWhatsAppConsent: true },
    { customerName: `${customers[2].firstName} ${customers[2].lastName}`, email: customers[2].email },
    { customerName: "Irene Gatti", email: "irene.gatti@example.test", customerNotes: "Prenotato dal sito." },
    { customerName: "Marta Colombo", email: "marta.colombo@example.test", phone: "+39 347 777 0004", appointmentWhatsAppConsent: false },
    { customerName: `${customers[7].firstName} ${customers[7].lastName}`, email: customers[7].email, customerNotes: "Barba lunga, solo spuntatina." },
  ];
  const publicIds: string[] = [];
  for (const [index, slot] of publicSlots.entries()) {
    const startTime = slot.start;
    try {
      const result = await call(C.publicBooking, "createBooking", {
        params: { tenantSlug },
        headers: { "x-forwarded-for": `198.51.100.${10 + index}`, host: "demo.invalid" },
        body: { idempotencyKey: key("public"), serviceId: slot.service.id, collaboratorId: slot.plan.collaborator.id, startsAt: at(slot.offset, startTime), ...publicPeople[index] },
      });
      publicCount += 1;
      if (result?.id) publicIds.push(result.id);
    } catch (error) {
      note(`prenotazione pubblica saltata: ${(error as Error).message.split("\n")[0]}`);
    }
  }
  const publicRows = await prisma.appointment.findMany({ where: { tenantId, source: "public" }, orderBy: { startsAt: "asc" } });
  if (publicRows[0]) await call(C.appointments, "updateStatus", { params: { id: publicRows[0].id }, body: { status: "confirmed" } });
  note(`prenotazioni pubbliche: ${publicCount}`);

  const booked: Array<{ id: string; orderId: string; offset: number; start: number; end: number; plan: Plan; service: any; customer: any; location: any; sector: any; lastOfDay?: boolean }> = [];
  const book = async (input: {
    plan: Plan; offset: number; start: number; service: any; customer: any; location: any; sector: any;
    status?: string; customerNotes?: string; internalNotes?: string; finalPrice?: string; priceOverrideReason?: string;
  }) => {
    const result = await call(C.appointments, "create", {
      body: {
        idempotencyKey: key("booking"),
        customerId: input.customer.id,
        serviceId: input.service.id,
        collaboratorId: input.plan.collaborator.id,
        startsAt: at(input.offset, clock(input.start)),
        locationId: input.location.id,
        sectorId: input.sector.id,
        ...(input.status ? { status: input.status } : {}),
        ...(input.customerNotes ? { customerNotes: input.customerNotes } : {}),
        ...(input.internalNotes ? { internalNotes: input.internalNotes } : {}),
        ...(input.finalPrice ? { finalPrice: input.finalPrice, priceOverrideReason: input.priceOverrideReason } : {}),
      },
    });
    const entry = { id: result.id, orderId: result.orderId, offset: input.offset, start: input.start, end: input.start + input.service.durationMinutes, plan: input.plan, service: input.service, customer: input.customer, location: input.location, sector: input.sector };
    booked.push(entry);
    return entry;
  };
  const customerNotes = ["Vorrei mantenere la lunghezza sopra.", "Arrivo 5 minuti prima.", "Prima volta: consiglio sul prodotto.", "Pelle sensibile."];
  const internalNotes = ["Cliente puntuale, preferisce caffè.", "Proporre olio barba.", "Ha chiesto fattura.", "Ricordare la tessera fedeltà."];

  // --- Regular agenda: several bookings per day per professional ---------------
  for (const plan of plans) {
    for (let offset = FIRST; offset <= LAST; offset += 1) {
      const day = dayKey(offset);
      const weekday = mondayWeekday(day);
      const shift = plan.hours[weekday];
      const place = plan.place(weekday);
      if (!shift || !place || holidays.has(day)) continue;
      if (closures.get(place.location.id)?.has(day) || closures.get(place.sector.id)?.has(day)) continue;
      const override = overrides.find((o) => o.collaboratorId === plan.collaborator.id && o.date.toISOString().slice(0, 10) === day);
      if (override && !override.isWorkingDay) continue;
      const [from, to] = override?.isWorkingDay && override.startTime && override.endTime ? [override.startTime, override.endTime] : shift;
      let t = minutes(from) + pick([0, 0, 15, 30]);
      let count = 0;
      const limit = 3 + Math.floor(rand() * 3);
      while (count < limit) {
        const service = pick(plan.servicesAt?.(weekday) ?? plan.services);
        const row = serviceRow.get(service.id)!;
        const start = t + row.bufferBeforeMinutes;
        const end = start + row.durationMinutes;
        if (end > minutes(to)) break;
        const clash = blocked.find((b) => b.collaboratorId === plan.collaborator.id && b.offset === offset && start - row.bufferBeforeMinutes < b.to && end + row.bufferAfterMinutes > b.from);
        if (clash) { t = clash.to + 15; continue; }
        const customer = pick(customers);
        const future = offset > 0 || (offset === 0 && start > now);
        await book({
          plan, offset, start, service, customer, location: place.location, sector: place.sector,
          status: future ? (rand() < 0.12 ? "requested" : "confirmed") : "confirmed",
          customerNotes: rand() < 0.12 ? pick(customerNotes) : undefined,
          internalNotes: rand() < 0.15 ? pick(internalNotes) : undefined,
        });
        count += 1;
        t = end + row.bufferAfterMinutes + pick([0, 0, 15, 30, 45, 60]);
      }
      const last = booked.filter((b) => b.plan === plan && b.offset === offset).pop();
      if (last) last.lastOfDay = true;
    }
  }
  note(`agenda: ${booked.length} prenotazioni regolari dal ${dayKey(FIRST)} al ${dayKey(LAST)}`);

  // --- Special bookings -----------------------------------------------------------
  // Multi-service sequence in the past (checked out together at the cassa).
  const sequencePast = await call(C.appointments, "create", {
    body: {
      idempotencyKey: key("sequence"), customerId: customers[0].id, startsAt: at(pastWednesday, "15:00"),
      locationId: centro.id, sectorId: sectors.centroBarberia.id,
      lines: [{ serviceId: s.barba.id, collaboratorId: staff.ownerCollaborator.id }, { serviceId: s.taglio.id, collaboratorId: staff.ownerCollaborator.id }],
      customerNotes: "Taglio e barba nello stesso appuntamento.",
    },
  });
  // Multi-service sequence in the future, with an internal note.
  const sequenceFuture = await call(C.appointments, "create", {
    body: {
      idempotencyKey: key("sequence"), customerId: customers[3].id, startsAt: at(futureThursday, "16:00"),
      locationId: centro.id, sectorId: sectors.centroBarberia.id,
      lines: [{ serviceId: s.rifinitura.id, collaboratorId: staff.luca.id }, { serviceId: s.barba.id, collaboratorId: staff.luca.id }, { serviceId: s.taglio.id, collaboratorId: staff.luca.id }],
      internalNotes: "Percorso completo prima del matrimonio.",
    },
  });
  // Closed day (Monday) and company holiday: internal bookings are allowed, the agenda flags them.
  const closedDay = await book({ plan: ownerPlan, offset: monday, start: minutes("10:00"), service: s.executive, customer: customers[13], location: centro, sector: sectors.centroBarberia, internalNotes: "Apertura straordinaria su richiesta del cliente (lunedì chiuso)." });
  const holidayKey = [...holidays].sort().find((day) => day > TODAY);
  const holidayOffset = holidayKey ? Math.round((Date.parse(`${holidayKey}T12:00:00Z`) - Date.parse(`${TODAY}T12:00:00Z`)) / 86_400_000) : null;
  const onHoliday = holidayOffset !== null
    ? await book({ plan: ownerPlan, offset: holidayOffset, start: minutes("11:00"), service: s.taglio, customer: customers[8], location: centro, sector: sectors.centroBarberia, internalNotes: "Su appuntamento nel giorno di festa." })
    : null;
  // Ends after closing time (Centro Barberia closes at 17:00 on Saturday).
  const afterClosing = await book({ plan: ownerPlan, offset: saturday, start: minutes("17:30"), service: s.executive, customer: customers[1], location: centro, sector: sectors.centroBarberia, customerNotes: "Posso venire solo dopo il lavoro." });
  // Price agreed at booking time (override with reason).
  const agreedPrice = await book({ plan: paoloPlan, offset: nextWeekday(1, 3), start: minutes("20:00"), service: s.colorazione, customer: customers[16], location: navigli, sector: sectors.navigliHair, finalPrice: "49", priceOverrideReason: "Prezzo concordato: prima prova colore" });
  // Draft (being prepared by reception).
  const draft = await book({ plan: giuliaPlan, offset: nextWeekday(2, 4), start: minutes("20:00"), service: s.massaggio, customer: customers[10], location: navigli, sector: sectors.navigliSpa, status: "draft", internalNotes: "Bozza: attendere conferma orario dalla cliente." });
  // Room-bound service in the evening, after the regular agenda.
  const evening = await book({ plan: saraPlan, offset: nextWeekday(1, 1), start: minutes("19:00"), service: s.viso, customer: customers[14], location: centro, sector: sectors.centroEstetica, status: "checked_in" });
  void [marcoPlan, lucaPlan, closedDay, onHoliday, afterClosing, agreedPrice, draft, evening];

  // --- Outcomes: what the agenda and the cassa do with each booking ---------------
  const ledger = (saleId: string) => call(C.ledger, "read", { params: { id: saleId } });
  const receive = async (saleId: string, entries: Array<{ amount: string; method: string; receivedAt?: string }>) => {
    const state = await ledger(saleId);
    return call(C.ledger, "record", { params: { id: saleId }, body: { kind: "receive", idempotencyKey: key("receive"), revision: state.revision, entries } });
  };
  const refund = async (saleId: string, amount: string, method: string, reason: string) => {
    const state = await ledger(saleId);
    const receipt = state.items.find((item: any) => item.kind === "receipt" && Number(item.refundableAmount ?? item.amount) > 0);
    return call(C.ledger, "record", { params: { id: saleId }, body: { kind: "refund", idempotencyKey: key("refund"), revision: state.revision, reason, entries: [{ amount, method, refundOfId: receipt.id }] } });
  };
  const productLine = (product: any, sector: any, quantity = 1, extra: Record<string, unknown> = {}) => ({ kind: "product", productId: product.id, sectorId: sector.id, quantity, ...extra });
  const beautySector = (sector: any) => sector.id === sectors.centroEstetica.id || sector.id === sectors.navigliSpa.id;
  const retailSector = (location: any) => (location.id === centro.id ? sectors.centroBarberia : sectors.navigliHair);
  /** Cassa checkout of a booking, as the quick-order modal does: open from booking, confirm. */
  const checkout = async (appointmentId: string, options: {
    products?: any[]; lineDiscount?: string; orderDiscount?: string; unitPrice?: string; overrideReason?: string;
    nonPerformance?: string; pay?: Array<{ method: string; share?: number }>; paidAt?: string; partial?: string;
  } = {}) => {
    const sale = await call(C.sales, "forAppointment", { params: { appointmentId } });
    // The professional who performed each booked row (the modal pre-fills it from the agenda).
    const performer = new Map((await prisma.appointment.findMany({ where: { orderItemId: { in: sale.items.map((item: any) => item.id) } }, select: { orderItemId: true, collaboratorId: true } })).map((row) => [row.orderItemId, row.collaboratorId]));
    const items = sale.items.map((item: any, index: number) => ({
      id: item.id, kind: item.serviceId ? "service" : "product", serviceId: item.serviceId ?? undefined, productId: item.productId ?? undefined,
      sectorId: item.sectorId, quantity: item.quantity,
      collaboratorId: item.serviceId ? item.collaboratorId ?? performer.get(item.id) ?? null : undefined,
      ...(index === 0 && options.unitPrice ? { unitPrice: options.unitPrice, priceOverrideReason: options.overrideReason } : {}),
      ...(index === 0 && options.lineDiscount ? { discount: options.lineDiscount } : {}),
      ...(index === 0 && options.nonPerformance ? { nonPerformanceChargeReason: options.nonPerformance } : {}),
    }));
    const confirmed = await call(C.sales, "update", {
      params: { id: sale.id },
      headers: { "x-alora-location": sale.locationId },
      body: {
        idempotencyKey: key("checkout"), revision: sale.revision, customerId: sale.customerId, orderStatus: "confirmed",
        items: [...items, ...(options.products ?? [])],
        ...(options.orderDiscount ? { orderDiscount: options.orderDiscount } : {}),
      },
    });
    const total = Number(confirmed.total);
    if (options.partial) await receive(sale.id, [{ amount: options.partial, method: "cash", ...(options.paidAt ? { receivedAt: options.paidAt } : {}) }]);
    else if (options.pay && total > 0) {
      let left = total;
      const entries = options.pay.map((part, index) => {
        const amount = index === options.pay!.length - 1 ? left : Math.round(total * (part.share ?? 1) * 100) / 100;
        left = Math.round((left - amount) * 100) / 100;
        return { amount: money(amount), method: part.method, ...(options.paidAt ? { receivedAt: options.paidAt } : {}) };
      });
      await receive(sale.id, entries);
    }
    return confirmed;
  };

  const past = booked.filter((b) => b.offset < 0 || (b.offset === 0 && b.end <= now));
  const running = booked.filter((b) => b.offset === 0 && b.start <= now && b.end > now);
  const future = booked.filter((b) => b.offset > 0 || (b.offset === 0 && b.start > now));
  const tally: Record<string, number> = {};
  const count = (label: string) => (tally[label] = (tally[label] ?? 0) + 1);
  const cancelReasons = ["Cliente malato", "Imprevisto di lavoro", "Ha spostato a un'altra settimana", "Doppia prenotazione"];
  for (const [index, entry] of past.entries()) {
    const roll = rand();
    const paidAt = entry.offset < 0 ? instant(entry.offset, clock(Math.min(entry.end + 5, 23 * 60))) : undefined;
    const retail = retailSector(entry.location);
    if (roll < 0.06) {
      await call(C.appointments, "cancel", { params: { id: entry.id }, body: { reason: pick(cancelReasons) } });
      count("annullate (passato)");
    } else if (roll < 0.1) {
      await call(C.appointments, "updateStatus", { params: { id: entry.id }, body: { status: "no_show" } });
      count("no-show");
    } else if (roll < 0.15 && entry.offset >= -4) {
      // Done but not yet through the cassa: the «Conferme» queue.
      await call(C.appointments, "updateStatus", { params: { id: entry.id }, body: { status: "completed" } });
      count("completate con conto aperto (Conferme)");
    } else if (roll < 0.18 && entry.offset >= -4) {
      count("passate ancora confermate (Conferme)");
    } else {
      const variant = index % 9;
      const method = pick(["card", "card", "cash"]);
      const options =
        variant === 0 ? { products: [beautySector(entry.sector) ? productLine(p.crema, entry.sector) : productLine(p.pomata, retail)], pay: [{ method }] }
          : variant === 1 ? { lineDiscount: "5", pay: [{ method }] }
            : variant === 2 ? { orderDiscount: "3", products: [productLine(p.shampoo, retail)], pay: [{ method: "card", share: 0.5 }, { method: "cash" }] }
              : variant === 3 ? { unitPrice: money(Number(serviceRow.get(entry.service.id)!.basePrice) - 4), overrideReason: "Cliente fidelizzato: prezzo amico", pay: [{ method }] }
                : variant === 4 && entry.offset < -2 && index % 2 === 0 ? { partial: money(Math.max(5, Math.floor(Number(serviceRow.get(entry.service.id)!.basePrice) / 2))) }
                  : { pay: [{ method }] };
      await checkout(entry.id, { ...options, paidAt });
      count(variant === 4 && entry.offset < -2 && index % 2 === 0 ? "pagate in parte" : "chiuse in cassa e pagate");
    }
  }
  for (const entry of running) {
    await call(C.appointments, "updateStatus", { params: { id: entry.id }, body: { status: "checked_in" } });
    count("in corso (checked_in)");
  }
  // A no-show charged at the cassa (non-performance fee).
  const noShow = await prisma.appointment.findFirst({ where: { tenantId, status: "no_show", orderItem: { sale: { orderStatus: "open" } } }, include: { service: true } });
  if (noShow) {
    await checkout(noShow.id, { unitPrice: "10", overrideReason: "Penale mancata disdetta", nonPerformance: "Mancata disdetta entro 24 ore", pay: [{ method: "card" }] });
    count("no-show con penale");
  }
  // Past sequence: checked out together, with a retail product.
  await checkout(sequencePast.id, { products: [productLine(p.olio, sectors.centroBarberia)], pay: [{ method: "card" }], paidAt: instant(pastWednesday, "16:20") });

  // Future: cancellations with reasons, a reschedule, a deposit, waiting requests.
  const futureCandidates = future.filter((b) => b.offset > 0);
  for (const entry of futureCandidates.filter((_, index) => index % 11 === 3)) {
    await call(C.appointments, "cancel", { params: { id: entry.id }, body: { reason: pick(cancelReasons) } });
    count("annullate (futuro)");
  }
  const toMove = futureCandidates.find((b) => b.lastOfDay && b.offset > 1);
  if (toMove) {
    await call(C.appointments, "update", {
      params: { id: toMove.id },
      body: { idempotencyKey: key("reschedule"), startsAt: at(toMove.offset, clock(toMove.end + 30)), status: "rescheduled", internalNotes: "Spostato su richiesta del cliente." },
    });
    count("spostate (rescheduled)");
  }
  // Deposit on a future booking: the open order is partially paid.
  const depositEntry = futureCandidates.find((b) => [s.executive.id, s.viso.id, s.colorazione.id].includes(b.service.id));
  if (depositEntry) {
    await receive(depositEntry.orderId, [{ amount: "20.00", method: "card" }]);
    count("acconto su prenotazione futura");
  }
  await receive(sequenceFuture.orderId, [{ amount: "15.00", method: "cash" }]);

  // --- Cassa sales without a booking ---------------------------------------------------
  const sale = (body: Record<string, unknown>, location: any) =>
    call(C.sales, "create", { headers: { "x-alora-location": location.id }, body: { idempotencyKey: key("sale"), locationId: location.id, ...body } });
  const retailCentro = sectors.centroBarberia;
  const retailNavigli = sectors.navigliHair;
  // Product-only, paid by card earlier this week.
  const cardSale = await sale({ customerId: customers[4].id, soldAt: instant(-2, "12:10"), paymentStatus: "unpaid", items: [productLine(p.pomata, retailCentro, 2), productLine(p.clay, retailCentro)] }, centro);
  await receive(cardSale.id, [{ amount: money(cardSale.total), method: "card", receivedAt: instant(-2, "12:11") }]);
  // Product-only, cash, today, paid at once.
  await sale({ items: [productLine(p.shampoo, retailNavigli), productLine(p.olio, retailNavigli)], paymentStatus: "paid", paymentMethod: "cash" }, navigli);
  // Product-only, left unpaid (to collect).
  await sale({ customerId: customers[9].id, soldAt: instant(-1, "18:40"), items: [productLine(p.crema, sectors.centroEstetica)], paymentStatus: "unpaid" }, centro);
  // Walk-in service sold directly at the cassa: fulfilment creates the completed booking.
  const walkIn = await sale({
    customerId: customers[11].id, soldAt: instant(-3, "13:30"), servicesStartAt: instant(-3, "12:50"), paymentStatus: "unpaid",
    items: [{ kind: "service", serviceId: s.rifinitura.id, collaboratorId: staff.luca.id }, productLine(p.pomata, retailCentro, 1, { discount: "2" })],
  }, centro);
  await receive(walkIn.id, [{ amount: money(walkIn.total), method: "cash", receivedAt: instant(-3, "13:31") }]);
  // Mixed sale with an order discount and a price override, paid in two methods.
  const mixed = await sale({
    customerId: customers[5].id, soldAt: instant(-5, "17:30"), servicesStartAt: instant(-5, "18:20"), orderDiscount: "4",
    paymentStatus: "unpaid",
    items: [{ kind: "service", serviceId: s.piega.id, collaboratorId: staff.paolo.id, unitPrice: "22", priceOverrideReason: "Promo prima visita" }, productLine(p.shampoo, sectors.navigliHair)],
  }, navigli);
  await receive(mixed.id, [{ amount: "20.00", method: "cash", receivedAt: instant(-5, "18:00") }, { amount: money(Number(mixed.total) - 20), method: "card", receivedAt: instant(-5, "18:00") }]);
  // Refunded: product returned by the customer.
  const refunded = await sale({ customerId: customers[6].id, soldAt: instant(-8, "11:00"), items: [productLine(p.olio, retailCentro)], paymentStatus: "unpaid" }, centro);
  await receive(refunded.id, [{ amount: money(refunded.total), method: "card", receivedAt: instant(-8, "11:01") }]);
  await refund(refunded.id, money(refunded.total), "card", "Prodotto reso integro dalla cliente");
  // Cancelled: wrong sale, cancelled from the cassa (refund + stock back).
  const wrong = await sale({ items: [productLine(p.clay, retailNavigli, 2)], paymentStatus: "paid", paymentMethod: "cash" }, navigli);
  await call(C.sales, "cancel", { params: { id: wrong.id }, headers: { "x-alora-location": navigli.id }, body: { reason: "Conto battuto per errore" } });
  // Partial: deposit on a product order, balance later.
  const deposit = await sale({ customerId: customers[17].id, soldAt: instant(-1, "10:15"), items: [productLine(p.shampoo, retailCentro, 3)], paymentStatus: "partial", amountPaid: "20", paymentMethod: "cash" }, centro);
  void deposit;
  note(`cassa: ${Object.entries(tally).map(([label, value]) => `${label} ${value}`).join(", ")}`);
  note("vendite al banco: carta, contanti, da incassare, servizio senza prenotazione, misto con sconti, reso rimborsato, conto annullato, acconto");
}

// ---------------------------------------------------------------------------
// Team, notifications and automation policy.
// ---------------------------------------------------------------------------

async function seedTeamAndNotifications(apiClient: DemoApi, prisma: PrismaClient, tenantId: string, owner: Actor, base: Base) {
  const { call, note, staff, sectors } = base;
  // The owner is the default professional (Collaborator.userId): no local endpoint links it.
  await prisma.collaborator.update({ where: { id: staff.ownerCollaborator.id }, data: { userId: owner.id } });

  // Team members: LOCAL users only. Creating and licensing them is a Connect flow
  // (TeamController); here they are local legacy accounts, like the owner, that can
  // use the same assisted migration. Password from DEMO_TEAM_PASSWORD, otherwise an
  // unusable random hash (no known credential).
  const [local, domain] = config.ownerEmail.split("@");
  const teamPassword = process.env.DEMO_TEAM_PASSWORD;
  const teamHash = await hash(teamPassword || randomBytes(32).toString("base64url"), 10);
  const members = [
    { role: UserRole.manager, firstName: "Chiara", lastName: "Manager", permissions: ["appointments.read.all", "appointments.create", "appointments.update.all", "clients.read.full", "sales.read", "sales.manage", "services.read", "collaborators.read", "inventory.read", "dashboard.revenue.read"], sectors: Object.values(sectors) },
    { role: UserRole.reception, firstName: "Alice", lastName: "Reception", permissions: ["appointments.read.all", "appointments.create", "appointments.update.all", "clients.read.full", "sales.manage"], sectors: [sectors.centroBarberia, sectors.centroEstetica] },
    { role: UserRole.collaborator, firstName: "Paolo", lastName: "Greco", permissions: ["appointments.read.own", "appointments.update.own", "dashboard.personal.values.read"], sectors: [], collaboratorId: staff.paolo.id },
  ];
  const known = new Set(api("common/function-catalog").ALORA_FUNCTIONS.map((item: { key: string }) => item.key));
  for (const member of members) {
    const user = await prisma.user.create({
      data: {
        tenantId,
        email: `${local}+${member.role}@${domain}`,
        passwordHash: teamHash,
        firstName: member.firstName,
        lastName: member.lastName,
        role: member.role,
        permissions: member.permissions.filter((item) => known.has(item)),
        permissionsConfigured: true,
        isActive: true,
      },
    });
    await prisma.userSectorAccess.createMany({ data: member.sectors.map((sector: any) => ({ userId: user.id, sectorId: sector.id })), skipDuplicates: true });
    if (member.collaboratorId) await prisma.collaborator.update({ where: { id: member.collaboratorId }, data: { userId: user.id } });
  }
  note(`squadra locale: manager, reception, collaboratore (${teamPassword ? "password DEMO_TEAM_PASSWORD" : "senza password utilizzabile"})`);

  // Notification templates and preferences: local services, no Connect.
  const templates = await call<any[]>(C.notifications, "templates");
  const list = Array.isArray(templates) ? templates : (templates as any)?.items ?? [];
  const reminder = list.find((item: any) => item.channel === "email" && /confirm/.test(item.eventType)) ?? list.find((item: any) => item.channel === "email");
  if (reminder)
    await call(C.notifications, "updateTemplate", {
      params: { eventType: reminder.eventType, channel: reminder.channel },
      body: { subject: reminder.subject ?? "", title: reminder.title ?? "", body: `${reminder.body}\n\nTi aspettiamo in ALORA Demo Studio.`, expectedUpdatedAt: new Date(reminder.updatedAt).toISOString() },
    });
  const preferences = await call(C.notifications, "preferences");
  const tenantPreference = preferences.tenant.find((item: any) => item.channel === "in_app" && item.enabled);
  if (tenantPreference)
    await call(C.notifications, "updateTenantPreferences", { body: { eventType: tenantPreference.eventType, channel: tenantPreference.channel, sendToReception: false } });
  const userPreference = preferences.tenant.find((item: any) => item.channel === "in_app" && item !== tenantPreference);
  if (userPreference)
    await call(C.notifications, "updateMyPreferences", { body: { eventType: userPreference.eventType, channel: userPreference.channel, enabled: false } });
  // Appointment automation policy: saved as a draft. Activation needs Connect grants.
  const policy = await call(C.policy, "get");
  await call(C.policy, "save", { body: { settings: policy.settings, expectedRevision: policy.revision } });
  note("notifiche: template email personalizzato, preferenze azienda e utente, policy automazioni in bozza (non attivata)");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function clearPublicLookupCache(slug: string): Promise<void> {
  const host = process.env.REDIS_HOST;
  if (!host) return;
  let client: {
    del: (key: string) => Promise<unknown>;
    disconnect: () => void;
  } | null = null;
  try {
    const imported = require("ioredis");
    const RedisCtor = imported?.default ?? imported;
    client = new RedisCtor({
      host,
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      connectTimeout: 2000,
    });
    await client!.del(`app:public-tenant:slug:${slug}`);
  } catch {
    // Best-effort: the API repopulates this cache on the next request.
  } finally {
    client?.disconnect();
  }
}

export async function ensureDemoAccount(prisma: PrismaClient): Promise<void> {
  if (args.has("--help") || args.has("-h")) {
    console.log(`
Crea un account demo completo e NON distruttivo (il reset archivia la demo precedente, non cancella nulla).
I dati (sedi, squadra, catalogo, magazzino, clienti, agenda, cassa, pagamenti) sono creati
dai servizi dell'API in questo processo; serve lo stesso database e Redis dell'API.

Variabili d'ambiente:
  DEMO_TENANT_NAME      Nome tenant            (default: ALORA Demo Studio)
  DEMO_TENANT_SLUG      Slug tenant            (default: demo-barber-studio)
  DEMO_PUBLIC_DOMAIN    Dominio pubblico       (opzionale)
  DEMO_OWNER_EMAIL      Email owner            (default: demo@barber.test)
  DEMO_OWNER_PASSWORD   Password owner         (obbligatoria in .env, mai stampata)
  DEMO_OWNER_FIRST_NAME Nome owner             (default: Demo)
  DEMO_OWNER_LAST_NAME  Cognome owner          (default: Owner)
  DEMO_TIMEZONE         Timezone tenant        (default: Europe/Rome)

Opzioni:
  --reset   Archivia la demo esistente e ne crea una nuova (richiede DEMO_RESET_CONFIRM=yes o --yes)
  --help    Mostra questo messaggio
`);
    return;
  }

  const existingTenant = await prisma.tenant.findUnique({
    where: { slug: config.tenantSlug },
    select: { id: true },
  });
  const existingUser = await prisma.user.findUnique({
    where: { email: config.ownerEmail },
    select: { id: true, tenantId: true },
  });

  if (existingTenant && !RESET) {
    console.log(
      `Tenant "${config.tenantSlug}" gia esistente (id ${existingTenant.id}). Nessuna modifica effettuata.`,
    );
    console.log(
      "Per ricrearlo: DEMO_RESET_CONFIRM=yes npm run demo:create -- --reset",
    );
    return;
  }

  if (existingUser && existingUser.tenantId !== existingTenant?.id) {
    throw new Error(
      `L'email ${config.ownerEmail} e gia usata da un altro account. Imposta DEMO_OWNER_EMAIL con un indirizzo libero.`,
    );
  }

  if (!config.ownerPassword)
    throw new Error(
      "Imposta DEMO_OWNER_PASSWORD in .env prima della creazione o del reset",
    );

  if (RESET) {
    if (!RESET_CONFIRMED) {
      throw new Error(
        "Reset bloccato: imposta DEMO_RESET_CONFIRM=yes (o passa --yes) per archiviare e ricreare il tenant demo.",
      );
    }
    // The old demo is archived, not deleted: payments and stock are append-only
    // records, and nothing of a real tenant can be touched by a name mismatch.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    if (existingTenant) {
      console.log(`Reset: archivio il tenant demo "${config.tenantSlug}"...`);
      await archiveTenant(prisma, existingTenant.id, stamp);
    }
    const leftover = await prisma.user.findUnique({ where: { email: config.ownerEmail }, select: { id: true, tenantId: true } });
    if (leftover) await archiveUser(prisma, leftover.id, stamp);
  }

  const plan = await ensureDemoPlan(prisma);
  const passwordHash = await hash(config.ownerPassword, 10);

  // Account bootstrap (no endpoint creates a company or a local owner: Connect does).
  // The owner is a LEGACY local account: password, active, owner role, tenant,
  // never linked to Connect (connectSubject/connectActivatedAt null), as the
  // assisted migration (common/connect-accounts.ts verifyLegacy) requires.
  const { tenant, owner } = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: config.tenantName,
        slug: config.tenantSlug,
        publicDomain: config.publicDomain,
        bookingMode: "hybrid",
        timezone: config.timezone,
        primaryColor: "#1c7c64",
        accentColor: "#f97316",
        publicEnabled: true,
        publicTitle: config.tenantName,
        notes: "Tenant demo creato da scripts/create-demo-account.ts tramite i servizi dell'API.",
      },
    });
    const owner = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: config.ownerEmail,
        passwordHash,
        firstName: config.ownerFirstName,
        lastName: config.ownerLastName,
        role: UserRole.owner,
        isActive: true,
      },
    });
    await tx.tenantSubscription.create({
      data: { tenantId: tenant.id, planId: plan.id, status: "active", startsAt: new Date() },
    });
    return { tenant, owner };
  });

  const ownerActor: Actor = {
    id: owner.id,
    tenantId: tenant.id,
    email: owner.email,
    firstName: owner.firstName,
    lastName: owner.lastName,
    role: owner.role,
    permissions: owner.permissions,
    permissionsConfigured: owner.permissionsConfigured,
    collaboratorId: null,
  };

  console.log(`Creo i dati demo tramite l'API (${API_ROOT})...`);
  const app = await createApiContext();
  const log: string[] = [];
  let apiClient: DemoApi | undefined;
  try {
    apiClient = new DemoApi(app, ownerActor);
    const base = await seedDemo(apiClient, prisma, tenant.id, ownerActor, log);
    await seedOperations(apiClient, prisma, tenant.id, ownerActor, base);
    await seedTeamAndNotifications(apiClient, prisma, tenant.id, ownerActor, base);
  } catch (error) {
    console.error("");
    console.error(
      `Creazione interrotta. Il tenant ${tenant.id} resta parziale: rilancia con --reset --yes per archiviarlo e ricrearlo.`,
    );
    throw error;
  } finally {
    await app.close();
  }

  const publicUrl = config.publicDomain
    ? `http://${config.publicDomain}`
    : `/${config.tenantSlug}`;

  await clearPublicLookupCache(config.tenantSlug);

  console.log("");
  console.log("========================================");
  console.log("  ACCOUNT DEMO CREATO");
  console.log("========================================");
  console.log(`  Tenant:        ${tenant.name}`);
  console.log(`  Slug:          ${tenant.slug}`);
  console.log(`  Tenant id:     ${tenant.id}`);
  console.log(`  Login owner:   ${config.ownerEmail} (account locale da migrare a Connect)`);
  console.log("  Password:      configurata in .env, non visualizzata");
  console.log(`  Public:        ${publicUrl}`);
  console.log(`  Chiamate API:  ${apiClient?.calls ?? 0}`);
  console.log("  Scritture dirette (nessun endpoint oggi):");
  for (const line of DIRECT_WRITES) console.log(`    - ${line}`);
  console.log("========================================");
  console.log("");
}

if (require.main === module) {
  const prisma = new PrismaClient();
  ensureDemoAccount(prisma)
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
      // Nest/ioredis handles may linger after close: the seed is done.
      setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
    });
}
