/* eslint-disable no-console */
import { Prisma, PrismaClient, UserRole } from "@prisma/client";
import { hash } from "bcrypt";
import { randomBytes } from "node:crypto";

try {
  // Load .env when running outside the container (local / CI).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("dotenv").config();
} catch {
  // .env is optional: rely on process.env (e.g. inside the api container).
}

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const RESET = args.has("--reset") || process.env.DEMO_RESET === "1";
const RESET_CONFIRMED =
  args.has("--yes") || process.env.DEMO_RESET_CONFIRM === "yes";

const config = {
  tenantName: process.env.DEMO_TENANT_NAME?.trim() || "Demo Barber Studio",
  tenantSlug: process.env.DEMO_TENANT_SLUG?.trim() || "demo-barber-studio",
  publicDomain: process.env.DEMO_PUBLIC_DOMAIN?.trim() || undefined,
  ownerEmail: (
    process.env.DEMO_OWNER_EMAIL?.trim() || "demo@barber.test"
  ).toLowerCase(),
  ownerPassword: process.env.DEMO_OWNER_PASSWORD?.trim() || "DEMO123!",
  ownerFirstName: process.env.DEMO_OWNER_FIRST_NAME?.trim() || "Demo",
  ownerLastName: process.env.DEMO_OWNER_LAST_NAME?.trim() || "Owner",
  timezone: process.env.DEMO_TIMEZONE?.trim() || "Europe/Rome",
};

function generatedPassword(): string {
  return `Demo-${randomBytes(9).toString("base64url")}`;
}

function daysFromNow(days: number, hour: number, minute = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function plusMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function resolveLoyaltyTier(completedVisitsCount: number, totalSpent: number) {
  if (completedVisitsCount >= 8 || totalSpent >= 350) return "vip";
  if (completedVisitsCount >= 5 || totalSpent >= 200) return "regular";
  if (completedVisitsCount >= 2 || totalSpent >= 80) return "returning";
  return "new";
}

function buildAutoTags(input: {
  loyaltyTier: string;
  visitsCount: number;
  completedVisitsCount: number;
  totalSpent: number;
}): string[] {
  const tags = [input.loyaltyTier];
  if (input.visitsCount >= 1) tags.push(`sedute:${input.visitsCount}`);
  if (input.completedVisitsCount >= 1) {
    tags.push(`completate:${input.completedVisitsCount}`);
  }
  if (input.totalSpent > 0) {
    tags.push(`spesa:${Math.round(input.totalSpent)}`);
  }
  return tags;
}

async function removeTenantTree(tenantId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.collaboratorWeeklySchedule.deleteMany({
      where: { collaborator: { tenantId } },
    });
    await tx.saleItem.deleteMany({ where: { sale: { tenantId } } });
    await tx.sale.deleteMany({ where: { tenantId } });
    await tx.appointmentCancellation.deleteMany({
      where: { appointment: { tenantId } },
    });
    await tx.appointment.deleteMany({ where: { tenantId } });
    await tx.serviceProduct.deleteMany({ where: { service: { tenantId } } });
    await tx.notificationHistory.deleteMany({ where: { tenantId } });
    await tx.notificationInbox.deleteMany({ where: { tenantId } });
    await tx.notificationPreferenceUser.deleteMany({ where: { tenantId } });
    await tx.notificationPreferenceTenant.deleteMany({ where: { tenantId } });
    await tx.notificationTemplate.deleteMany({ where: { tenantId } });
    await tx.notificationProviderConfig.deleteMany({ where: { tenantId } });
    await tx.product.deleteMany({ where: { tenantId } });
    await tx.service.deleteMany({ where: { tenantId } });
    await tx.customer.deleteMany({ where: { tenantId } });
    await tx.collaborator.deleteMany({ where: { tenantId } });
    await tx.auditLog.deleteMany({ where: { tenantId } });
    await tx.tenantSubscription.deleteMany({ where: { tenantId } });
    await tx.user.deleteMany({ where: { tenantId } });
    await tx.tenant.delete({ where: { id: tenantId } });
  });
}

async function ensureDemoPlan() {
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

async function createDemoData(
  tx: Prisma.TransactionClient,
  tenantId: string,
  owner: { id: string; firstName: string; lastName: string; email: string },
): Promise<void> {
  const ownerCollaborator = await tx.collaborator.create({
    data: {
      tenantId,
      userId: owner.id,
      firstName: owner.firstName,
      lastName: owner.lastName,
      email: owner.email,
      calendarColor: "#1c7c64",
      isPublic: true,
      isActive: true,
    },
  });

  await tx.tenant.update({
    where: { id: tenantId },
    data: { defaultCollaboratorId: ownerCollaborator.id },
  });

  const [marco, nina, sara] = await Promise.all([
    tx.collaborator.create({
      data: {
        tenantId,
        firstName: "Marco",
        lastName: "Rossi",
        email: "marco.demo@barber.test",
        phone: "+39 333 111 0001",
        calendarColor: "#1c7c64",
        isPublic: true,
      },
    }),
    tx.collaborator.create({
      data: {
        tenantId,
        firstName: "Nina",
        lastName: "Bianchi",
        email: "nina.demo@barber.test",
        phone: "+39 333 111 0002",
        calendarColor: "#f97316",
        isPublic: true,
      },
    }),
    tx.collaborator.create({
      data: {
        tenantId,
        firstName: "Sara",
        lastName: "Leone",
        email: "sara.demo@barber.test",
        phone: "+39 333 111 0003",
        calendarColor: "#111827",
        isPublic: false,
      },
    }),
  ]);

  const allCollaborators = [ownerCollaborator, marco, nina, sara];
  // weekday index follows resolveWorkingWindow: 0 = Monday ... 6 = Sunday.
  // The demo works Monday to Saturday and is closed on Sunday.
  const workingDays = new Set([0, 1, 2, 3, 4, 5]);
  await Promise.all(
    allCollaborators.flatMap((collaborator) =>
      Array.from({ length: 7 }, (_, weekday) => weekday).map((weekday) =>
        tx.collaboratorWeeklySchedule.create({
          data: {
            collaboratorId: collaborator.id,
            weekday,
            isWorkingDay: workingDays.has(weekday),
            startTime: workingDays.has(weekday) ? "09:00" : null,
            endTime: workingDays.has(weekday) ? "19:00" : null,
          },
        }),
      ),
    ),
  );

  const [pomade, oil, shampoo, clay, tonic] = await Promise.all([
    tx.product.create({
      data: {
        tenantId,
        name: "Pomata opaca",
        description: "Tenuta naturale e finish opaco da riapplicare a casa.",
        category: "Styling",
        price: 18,
        sku: "POM-MAT",
      },
    }),
    tx.product.create({
      data: {
        tenantId,
        name: "Olio barba premium",
        description: "Blend nutriente con note legnose per il rituale barba.",
        category: "Barba",
        price: 24,
        sku: "OIL-BRD",
      },
    }),
    tx.product.create({
      data: {
        tenantId,
        name: "Shampoo detox",
        description: "Detersione profonda pre taglio o trattamento cute.",
        category: "Care",
        price: 16,
        sku: "SHP-DTX",
      },
    }),
    tx.product.create({
      data: {
        tenantId,
        name: "Clay texture",
        description: "Texture forte per raccolti e tagli medio-corti.",
        category: "Styling",
        price: 22,
        sku: "CLAY-TXT",
      },
    }),
    tx.product.create({
      data: {
        tenantId,
        name: "Scalp tonic",
        description: "Tonico cute energizzante consigliato nei percorsi premium.",
        category: "Care",
        price: 19,
        sku: "TON-SCLP",
      },
    }),
  ]);

  const [cut, beard, executive, colorRefresh] = await Promise.all([
    tx.service.create({
      data: {
        tenantId,
        name: "Taglio sartoriale",
        publicDescription: "Consulenza, lavaggio e taglio costruito sul viso.",
        durationMinutes: 30,
        basePrice: 38,
        color: "#1c7c64",
        isPublic: true,
        isBookableOnline: true,
      },
    }),
    tx.service.create({
      data: {
        tenantId,
        name: "Barba rituale",
        publicDescription: "Panno caldo, precisione e trattamento lenitivo.",
        durationMinutes: 30,
        basePrice: 26,
        color: "#f59e0b",
        isPublic: true,
        isBookableOnline: true,
      },
    }),
    tx.service.create({
      data: {
        tenantId,
        name: "Executive grooming",
        publicDescription: "Percorso completo con styling finale e rituale premium.",
        durationMinutes: 30,
        basePrice: 74,
        color: "#111827",
        isPublic: true,
        isBookableOnline: true,
      },
    }),
    tx.service.create({
      data: {
        tenantId,
        name: "Color refresh",
        publicDescription: "Servizio colore e rifinitura barba/capelli.",
        durationMinutes: 30,
        basePrice: 59,
        color: "#7c3aed",
        isPublic: false,
        isBookableOnline: false,
      },
    }),
  ]);

  await Promise.all([
    tx.serviceProduct.create({
      data: { serviceId: cut.id, productId: pomade.id, mode: "optional" },
    }),
    tx.serviceProduct.create({
      data: { serviceId: cut.id, productId: clay.id, mode: "optional" },
    }),
    tx.serviceProduct.create({
      data: { serviceId: beard.id, productId: oil.id, mode: "optional" },
    }),
    tx.serviceProduct.create({
      data: { serviceId: beard.id, productId: tonic.id, mode: "recommended" },
    }),
    tx.serviceProduct.create({
      data: {
        serviceId: executive.id,
        productId: shampoo.id,
        mode: "optional",
        priceLocked: true,
      },
    }),
    tx.serviceProduct.create({
      data: {
        serviceId: executive.id,
        productId: oil.id,
        mode: "included",
        priceLocked: true,
      },
    }),
  ]);

  const [luca, giulia, andrea, valentina] = await Promise.all([
    tx.customer.create({
      data: {
        tenantId,
        firstName: "Luca",
        lastName: "Ferri",
        email: "luca.ferri@example.test",
        phone: "+39 333 111 1111",
        tags: ["manuale:consenso-marketing"],
        privacyConsent: true,
      },
    }),
    tx.customer.create({
      data: {
        tenantId,
        firstName: "Giulia",
        lastName: "Riva",
        email: "giulia.riva@example.test",
        phone: "+39 333 222 2222",
        tags: ["manuale:nuovo-contatto"],
        privacyConsent: true,
      },
    }),
    tx.customer.create({
      data: {
        tenantId,
        firstName: "Andrea",
        lastName: "Sala",
        email: "andrea.sala@example.test",
        phone: "+39 333 333 3333",
        tags: ["manuale:richiamo"],
        privacyConsent: true,
      },
    }),
    tx.customer.create({
      data: {
        tenantId,
        firstName: "Valentina",
        lastName: "Neri",
        email: "valentina.neri@example.test",
        phone: "+39 333 444 4444",
        tags: ["manuale:premium-service"],
        privacyConsent: true,
      },
    }),
  ]);

  // Appuntamenti futuri.
  const upcomingOne = daysFromNow(1, 10);
  const upcomingTwo = daysFromNow(1, 15);
  const upcomingThree = daysFromNow(3, 11);
  await Promise.all([
    tx.appointment.create({
      data: {
        tenantId,
        customerId: giulia.id,
        serviceId: beard.id,
        collaboratorId: marco.id,
        startsAt: upcomingOne,
        endsAt: plusMinutes(upcomingOne, 30),
        status: "confirmed",
        source: "public",
        estimatedPrice: 26,
      },
    }),
    tx.appointment.create({
      data: {
        tenantId,
        customerId: andrea.id,
        serviceId: cut.id,
        collaboratorId: nina.id,
        startsAt: upcomingTwo,
        endsAt: plusMinutes(upcomingTwo, 30),
        status: "requested",
        source: "public",
        estimatedPrice: 38,
      },
    }),
    tx.appointment.create({
      data: {
        tenantId,
        customerId: valentina.id,
        serviceId: colorRefresh.id,
        collaboratorId: sara.id,
        startsAt: upcomingThree,
        endsAt: plusMinutes(upcomingThree, 30),
        status: "confirmed",
        source: "internal",
        estimatedPrice: 59,
        createdById: owner.id,
        updatedById: owner.id,
      },
    }),
  ]);

  // Appuntamenti passati SENZA ordine: alimentano la coda "Conferme".
  const pendingOne = daysFromNow(-1, 11);
  const pendingTwo = daysFromNow(-2, 17);
  await Promise.all([
    tx.appointment.create({
      data: {
        tenantId,
        customerId: andrea.id,
        serviceId: cut.id,
        collaboratorId: marco.id,
        startsAt: pendingOne,
        endsAt: plusMinutes(pendingOne, 30),
        status: "confirmed",
        source: "internal",
        estimatedPrice: 38,
        createdById: owner.id,
        updatedById: owner.id,
      },
    }),
    tx.appointment.create({
      data: {
        tenantId,
        customerId: giulia.id,
        serviceId: executive.id,
        collaboratorId: nina.id,
        startsAt: pendingTwo,
        endsAt: plusMinutes(pendingTwo, 30),
        status: "requested",
        source: "public",
        estimatedPrice: 74,
      },
    }),
  ]);

  // Appuntamenti completati collegati a un ordine.
  const completedOneStart = daysFromNow(-3, 12);
  const completedTwoStart = daysFromNow(-5, 16);
  const completedAppointmentOne = await tx.appointment.create({
    data: {
      tenantId,
      customerId: luca.id,
      serviceId: cut.id,
      collaboratorId: marco.id,
      startsAt: completedOneStart,
      endsAt: plusMinutes(completedOneStart, 30),
      status: "completed",
      source: "internal",
      estimatedPrice: 38,
      finalPrice: 42,
      createdById: owner.id,
      updatedById: owner.id,
    },
  });
  const completedAppointmentTwo = await tx.appointment.create({
    data: {
      tenantId,
      customerId: valentina.id,
      serviceId: executive.id,
      collaboratorId: nina.id,
      startsAt: completedTwoStart,
      endsAt: plusMinutes(completedTwoStart, 30),
      status: "completed",
      source: "internal",
      estimatedPrice: 74,
      finalPrice: 82,
      createdById: owner.id,
      updatedById: owner.id,
    },
  });

  // Appuntamenti completati storici senza ordine (ricavo da appuntamento).
  await Promise.all(
    [8, 15, 22, 30].map((daysAgo, index) => {
      const start = daysFromNow(-daysAgo, 9 + index * 2);
      const service = index % 2 === 0 ? cut : beard;
      const collaborator = index % 2 === 0 ? marco : nina;
      return tx.appointment.create({
        data: {
          tenantId,
          customerId: [luca, andrea, valentina, giulia][index].id,
          serviceId: service.id,
          collaboratorId: collaborator.id,
          startsAt: start,
          endsAt: plusMinutes(start, 30),
          status: "completed",
          source: "internal",
          estimatedPrice: Number(service.basePrice ?? 0),
          finalPrice: Number(service.basePrice ?? 0),
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
    }),
  );

  // Ordini: due collegati ad appuntamento, due vendite retail libere.
  await Promise.all([
    tx.sale.create({
      data: {
        tenantId,
        customerId: luca.id,
        collaboratorId: marco.id,
        appointmentId: completedAppointmentOne.id,
        subtotal: 60,
        total: 60,
        paymentStatus: "paid",
        paymentMethod: "card",
        createdById: owner.id,
        items: {
          create: [
            {
              productId: pomade.id,
              label: pomade.name,
              quantity: 1,
              unitPrice: 18,
              lineTotal: 18,
            },
            {
              serviceId: cut.id,
              collaboratorId: marco.id,
              label: cut.name,
              quantity: 1,
              unitPrice: 42,
              lineTotal: 42,
            },
          ],
        },
      },
    }),
    tx.sale.create({
      data: {
        tenantId,
        customerId: valentina.id,
        collaboratorId: nina.id,
        appointmentId: completedAppointmentTwo.id,
        subtotal: 98,
        total: 98,
        paymentStatus: "paid",
        paymentMethod: "cash",
        createdById: owner.id,
        items: {
          create: [
            {
              productId: oil.id,
              label: oil.name,
              quantity: 1,
              unitPrice: 24,
              lineTotal: 24,
            },
            {
              serviceId: executive.id,
              collaboratorId: nina.id,
              label: executive.name,
              quantity: 1,
              unitPrice: 74,
              lineTotal: 74,
            },
          ],
        },
      },
    }),
    tx.sale.create({
      data: {
        tenantId,
        customerId: luca.id,
        collaboratorId: nina.id,
        subtotal: 182,
        total: 182,
        paymentStatus: "paid",
        paymentMethod: "card",
        createdById: owner.id,
        items: {
          create: [
            {
              productId: pomade.id,
              label: pomade.name,
              quantity: 2,
              unitPrice: 18,
              lineTotal: 36,
            },
            {
              productId: oil.id,
              label: oil.name,
              quantity: 1,
              unitPrice: 24,
              lineTotal: 24,
            },
          ],
        },
      },
    }),
    tx.sale.create({
      data: {
        tenantId,
        customerId: andrea.id,
        collaboratorId: marco.id,
        subtotal: 84,
        total: 84,
        paymentStatus: "paid",
        paymentMethod: "cash",
        createdById: owner.id,
        items: {
          create: [
            {
              productId: shampoo.id,
              label: shampoo.name,
              quantity: 1,
              unitPrice: 16,
              lineTotal: 16,
            },
            {
              serviceId: beard.id,
              collaboratorId: marco.id,
              label: beard.name,
              quantity: 1,
              unitPrice: 68,
              lineTotal: 68,
            },
          ],
        },
      },
    }),
  ]);

  const customerSummaries = [
    { id: luca.id, visitsCount: 3, completedVisitsCount: 3, totalSpent: 242 },
    { id: giulia.id, visitsCount: 1, completedVisitsCount: 0, totalSpent: 0 },
    { id: andrea.id, visitsCount: 3, completedVisitsCount: 2, totalSpent: 84 },
    {
      id: valentina.id,
      visitsCount: 2,
      completedVisitsCount: 1,
      totalSpent: 98,
    },
  ];

  await Promise.all(
    customerSummaries.map((customer) => {
      const loyaltyTier = resolveLoyaltyTier(
        customer.completedVisitsCount,
        customer.totalSpent,
      );
      return tx.customer.update({
        where: { id: customer.id },
        data: {
          visitsCount: customer.visitsCount,
          completedVisitsCount: customer.completedVisitsCount,
          totalSpent: customer.totalSpent,
          loyaltyTier,
          autoTags: buildAutoTags({
            loyaltyTier,
            visitsCount: customer.visitsCount,
            completedVisitsCount: customer.completedVisitsCount,
            totalSpent: customer.totalSpent,
          }),
          lastAlignedAt: new Date(),
        },
      });
    }),
  );
}

async function clearPublicLookupCache(slug: string): Promise<void> {
  const host = process.env.REDIS_HOST;
  if (!host) return;
  let client: {
    del: (key: string) => Promise<unknown>;
    disconnect: () => void;
  } | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const imported = require("ioredis");
    const RedisCtor = imported?.default ?? imported;
    client = new RedisCtor({
      host,
      port: Number(process.env.REDIS_PORT || 6379),
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      connectTimeout: 2000,
    });
    await client.del(`app:public-tenant:slug:${slug}`);
  } catch {
    // Best-effort: the API repopulates this cache on the next request.
  } finally {
    client?.disconnect();
  }
}

async function main(): Promise<void> {
  if (args.has("--help") || args.has("-h")) {
    console.log(`
Crea un account demo completo e NON distruttivo.

Variabili d'ambiente:
  DEMO_TENANT_NAME      Nome tenant            (default: Demo Barber Studio)
  DEMO_TENANT_SLUG      Slug tenant            (default: demo-barber-studio)
  DEMO_PUBLIC_DOMAIN    Dominio pubblico       (opzionale)
  DEMO_OWNER_EMAIL      Email owner            (default: demo@barber.test)
  DEMO_OWNER_PASSWORD   Password owner         (default: generata e stampata)
  DEMO_OWNER_FIRST_NAME Nome owner             (default: Demo)
  DEMO_OWNER_LAST_NAME  Cognome owner          (default: Owner)
  DEMO_TIMEZONE         Timezone tenant        (default: Europe/Rome)

Opzioni:
  --reset   Ricrea il tenant demo (richiede DEMO_RESET_CONFIRM=yes o --yes)
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

  if (RESET) {
    if (!RESET_CONFIRMED) {
      throw new Error(
        "Reset bloccato: imposta DEMO_RESET_CONFIRM=yes (o passa --yes) per cancellare e ricreare il tenant demo.",
      );
    }
    if (existingTenant) {
      console.log(`Reset: rimuovo il tenant demo "${config.tenantSlug}"...`);
      await removeTenantTree(existingTenant.id);
    }
    await prisma.user.deleteMany({ where: { email: config.ownerEmail } });
  }

  const plan = await ensureDemoPlan();
  const password = config.ownerPassword || generatedPassword();
  const passwordHash = await hash(password, 10);

  const tenant = await prisma.$transaction(
    async (tx) => {
      const createdTenant = await tx.tenant.create({
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
          publicDescription:
            "Booking pubblico con servizi editoriali, palette colore dedicata e conferma immediata sul gestionale.",
          publicSteps: [
            "Servizio|Palette e catalogo reale dal tenant",
            "Collaboratore|Scelta team con disponibilita live",
            "Conferma|Prenotazione persistita e notificata",
          ],
          notes:
            "Tenant demo retail-first creato da scripts/create-demo-account.ts.",
        },
      });

      const owner = await tx.user.create({
        data: {
          tenantId: createdTenant.id,
          email: config.ownerEmail,
          passwordHash,
          firstName: config.ownerFirstName,
          lastName: config.ownerLastName,
          role: UserRole.owner,
          permissions: [
            "appointments.create",
            "appointments.update.all",
            "clients.read.full",
            "services.manage",
            "collaborators.manage",
            "products.manage",
            "dashboard.revenue.read",
            "settings.manage",
            "audit.read",
          ],
        },
      });

      await tx.tenantSubscription.create({
        data: {
          tenantId: createdTenant.id,
          planId: plan.id,
          status: "active",
          startsAt: new Date(),
        },
      });

      await createDemoData(tx, createdTenant.id, {
        id: owner.id,
        firstName: owner.firstName,
        lastName: owner.lastName,
        email: owner.email,
      });

      return createdTenant;
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

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
  console.log(`  Login owner:   ${config.ownerEmail}`);
  console.log(`  Password:      ${password}`);
  console.log(`  Public:        ${publicUrl}`);
  console.log("========================================");
  console.log("");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
