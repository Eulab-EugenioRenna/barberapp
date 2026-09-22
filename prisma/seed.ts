import { PrismaClient, UserRole } from "@prisma/client";
import { hash } from "bcrypt";

const prisma = new PrismaClient();

const PLATFORM_ADMIN_EMAIL = "admin@platform.test";
const PLATFORM_ADMIN_PASSWORD = "Platform123!";
const DEMO_OWNER_EMAIL = "demo@barber.test";
const DEMO_OWNER_PASSWORD = "Demo123!";

function resolveLoyaltyTier(input: {
  completedVisitsCount: number;
  totalSpent: number;
}): string {
  if (input.completedVisitsCount >= 8 || input.totalSpent >= 350) {
    return "vip";
  }

  if (input.completedVisitsCount >= 5 || input.totalSpent >= 200) {
    return "regular";
  }

  if (input.completedVisitsCount >= 2 || input.totalSpent >= 80) {
    return "returning";
  }

  return "new";
}

function buildAutoTags(input: {
  loyaltyTier: string;
  visitsCount: number;
  completedVisitsCount: number;
  totalSpent: number;
}): string[] {
  const tags = [input.loyaltyTier];

  if (input.visitsCount >= 1) {
    tags.push(`sedute:${input.visitsCount}`);
  }

  if (input.completedVisitsCount >= 1) {
    tags.push(`completate:${input.completedVisitsCount}`);
  }

  if (input.totalSpent > 0) {
    tags.push(`spesa:${Math.round(input.totalSpent)}`);
  }

  return tags;
}

async function upsertPlans() {
  const plans = [
    {
      code: "starter",
      name: "Starter",
      description: "Piano base per nuove attivita",
      price: 29,
      billingInterval: "monthly" as const,
      maxUsers: 3,
      maxCollaborators: 3,
      maxAppointmentsPerMonth: 300,
      isPublic: true,
      features: { publicBooking: true, products: true, notifications: true },
    },
    {
      code: "growth",
      name: "Growth",
      description: "Piano per attivita in crescita",
      price: 79,
      billingInterval: "monthly" as const,
      maxUsers: 10,
      maxCollaborators: 10,
      maxAppointmentsPerMonth: 1500,
      isPublic: true,
      features: {
        publicBooking: true,
        products: true,
        notifications: true,
        exports: true,
      },
    },
  ];

  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { code: plan.code },
      update: plan,
      create: plan,
    });
  }
}

async function upsertPlatformAdmin() {
  const passwordHash = await hash(PLATFORM_ADMIN_PASSWORD, 10);

  await prisma.user.upsert({
    where: { email: PLATFORM_ADMIN_EMAIL },
    update: {
      passwordHash,
      firstName: "Platform",
      lastName: "Admin",
      role: UserRole.platform_admin,
      tenantId: null,
      isActive: true,
      permissions: ["platform.admin"],
    },
    create: {
      email: PLATFORM_ADMIN_EMAIL,
      passwordHash,
      firstName: "Platform",
      lastName: "Admin",
      role: UserRole.platform_admin,
      permissions: ["platform.admin"],
    },
  });
}

async function removeTenantTree(tenantId: string) {
  await prisma.$transaction(async (tx) => {
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

async function recreateDemoTenant() {
  await prisma.user.deleteMany({ where: { email: DEMO_OWNER_EMAIL } });
  const existingTenant = await prisma.tenant.findFirst({
    where: { slug: "demo-barber-studio" },
    select: { id: true },
  });

  if (existingTenant) {
    await removeTenantTree(existingTenant.id);
  }

  const starterPlan = await prisma.subscriptionPlan.findUniqueOrThrow({
    where: { code: "growth" },
  });
  const ownerPasswordHash = await hash(DEMO_OWNER_PASSWORD, 10);

  const tenant = await prisma.tenant.create({
    data: {
      name: "Demo Barber Studio",
      slug: "demo-barber-studio",
      publicDomain: "demo-barber-studio.local",
      bookingMode: "hybrid",
      primaryColor: "#1c7c64",
      accentColor: "#f97316",
      publicEnabled: true,
      publicTitle: "Demo Barber Studio",
      publicDescription:
        "Booking pubblico con servizi editoriali, palette colore dedicata e conferma immediata sul gestionale.",
      publicSteps: [
        "Servizio|Palette e catalogo reale dal tenant",
        "Collaboratore|Scelta team con disponibilita live",
        "Conferma|Prenotazione persistita e notificata",
      ],
      notes:
        "Tenant demo retail-first con booking pubblico e catalogo prodotti associato ai servizi.",
    },
  });

  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: DEMO_OWNER_EMAIL,
      passwordHash: ownerPasswordHash,
      firstName: "Demo",
      lastName: "Owner",
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

  const ownerCollaborator = await prisma.collaborator.create({
    data: {
      tenantId: tenant.id,
      userId: owner.id,
      firstName: owner.firstName,
      lastName: owner.lastName,
      email: owner.email,
      calendarColor: "#1c7c64",
      isPublic: true,
      isActive: true,
    },
  });

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { defaultCollaboratorId: ownerCollaborator.id },
  });

  await prisma.tenantSubscription.create({
    data: {
      tenantId: tenant.id,
      planId: starterPlan.id,
      status: "active",
      startsAt: new Date(),
    },
  });

  const [marco, nina, sara] = await Promise.all([
    prisma.collaborator.create({
      data: {
        tenantId: tenant.id,
        firstName: "Marco",
        lastName: "Rossi",
        email: "marco.demo@barber.test",
        phone: "+39 333 111 0001",
        calendarColor: "#1c7c64",
        isPublic: true,
      },
    }),
    prisma.collaborator.create({
      data: {
        tenantId: tenant.id,
        firstName: "Nina",
        lastName: "Bianchi",
        email: "nina.demo@barber.test",
        phone: "+39 333 111 0002",
        calendarColor: "#f97316",
        isPublic: true,
      },
    }),
    prisma.collaborator.create({
      data: {
        tenantId: tenant.id,
        firstName: "Sara",
        lastName: "Leone",
        email: "sara.demo@barber.test",
        phone: "+39 333 111 0003",
        calendarColor: "#111827",
        isPublic: false,
      },
    }),
  ]);

  const [pomade, oil, shampoo, clay, tonic] = await Promise.all([
    prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: "Pomata opaca",
        description: "Tenuta naturale e finish opaco da riapplicare a casa.",
        category: "Styling",
        price: 18,
        sku: "POM-MAT",
      },
    }),
    prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: "Olio barba premium",
        description: "Blend nutriente con note legnose per il rituale barba.",
        category: "Barba",
        price: 24,
        sku: "OIL-BRD",
      },
    }),
    prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: "Shampoo detox",
        description: "Detersione profonda pre taglio o trattamento cute.",
        category: "Care",
        price: 16,
        sku: "SHP-DTX",
      },
    }),
    prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: "Clay texture",
        description: "Texture forte per raccolti e tagli medio-corti.",
        category: "Styling",
        price: 22,
        sku: "CLAY-TXT",
      },
    }),
    prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: "Scalp tonic",
        description:
          "Tonico cute energizzante consigliato nei percorsi premium.",
        category: "Care",
        price: 19,
        sku: "TON-SCLP",
      },
    }),
  ]);

  const [cut, beard, executive, colorRefresh] = await Promise.all([
    prisma.service.create({
      data: {
        tenantId: tenant.id,
        name: "Taglio sartoriale",
        publicDescription: "Consulenza, lavaggio e taglio costruito sul viso.",
        durationMinutes: 30,
        basePrice: 38,
        color: "#1c7c64",
        isPublic: true,
        isBookableOnline: true,
        collaborators: {
          connect: [
            { id: ownerCollaborator.id },
            { id: marco.id },
            { id: nina.id },
          ],
        },
      },
    }),
    prisma.service.create({
      data: {
        tenantId: tenant.id,
        name: "Barba rituale",
        publicDescription: "Panno caldo, precisione e trattamento lenitivo.",
        durationMinutes: 30,
        basePrice: 26,
        color: "#f59e0b",
        isPublic: true,
        isBookableOnline: true,
        collaborators: {
          connect: [
            { id: ownerCollaborator.id },
            { id: marco.id },
            { id: sara.id },
          ],
        },
      },
    }),
    prisma.service.create({
      data: {
        tenantId: tenant.id,
        name: "Executive grooming",
        publicDescription:
          "Percorso completo con styling finale e rituale premium.",
        durationMinutes: 30,
        basePrice: 74,
        color: "#111827",
        isPublic: true,
        isBookableOnline: true,
        collaborators: {
          connect: [{ id: ownerCollaborator.id }, { id: nina.id }],
        },
      },
    }),
    prisma.service.create({
      data: {
        tenantId: tenant.id,
        name: "Color refresh",
        publicDescription: "Servizio colore e rifinitura barba/capelli.",
        durationMinutes: 30,
        basePrice: 59,
        color: "#7c3aed",
        isPublic: false,
        isBookableOnline: false,
        collaborators: { connect: [{ id: sara.id }] },
      },
    }),
  ]);

  await Promise.all([
    prisma.serviceProduct.create({
      data: {
        serviceId: cut.id,
        productId: pomade.id,
        mode: "optional",
        quantity: 1,
      },
    }),
    prisma.serviceProduct.create({
      data: {
        serviceId: cut.id,
        productId: clay.id,
        mode: "optional",
        quantity: 1,
      },
    }),
    prisma.serviceProduct.create({
      data: {
        serviceId: beard.id,
        productId: oil.id,
        mode: "optional",
        quantity: 1,
      },
    }),
    prisma.serviceProduct.create({
      data: {
        serviceId: beard.id,
        productId: tonic.id,
        mode: "recommended",
        quantity: 1,
      },
    }),
    prisma.serviceProduct.create({
      data: {
        serviceId: executive.id,
        productId: shampoo.id,
        mode: "optional",
        quantity: 1,
        priceLocked: true,
      },
    }),
    prisma.serviceProduct.create({
      data: {
        serviceId: executive.id,
        productId: oil.id,
        mode: "included",
        quantity: 1,
        priceLocked: true,
      },
    }),
  ]);

  const [luca, giulia, andrea, valentina] = await Promise.all([
    prisma.customer.create({
      data: {
        tenantId: tenant.id,
        firstName: "Luca",
        lastName: "Ferri",
        email: "luca.ferri@example.test",
        phone: "+39 333 111 1111",
        tags: ["manuale:consenso-marketing"],
        privacyConsent: true,
      },
    }),
    prisma.customer.create({
      data: {
        tenantId: tenant.id,
        firstName: "Giulia",
        lastName: "Riva",
        email: "giulia.riva@example.test",
        phone: "+39 333 222 2222",
        tags: ["manuale:nuovo-contatto"],
        privacyConsent: true,
      },
    }),
    prisma.customer.create({
      data: {
        tenantId: tenant.id,
        firstName: "Andrea",
        lastName: "Sala",
        email: "andrea.sala@example.test",
        phone: "+39 333 333 3333",
        tags: ["manuale:richiamo"],
        privacyConsent: true,
      },
    }),
    prisma.customer.create({
      data: {
        tenantId: tenant.id,
        firstName: "Valentina",
        lastName: "Neri",
        email: "valentina.neri@example.test",
        phone: "+39 333 444 4444",
        tags: ["manuale:premium-service"],
        privacyConsent: true,
      },
    }),
  ]);

  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    9,
    0,
    0,
    0,
  );
  const upcomingOne = new Date(start.getTime() + 60 * 60000);
  const upcomingTwo = new Date(start.getTime() + 4 * 60 * 60000);
  const upcomingThree = new Date(start.getTime() + 7 * 60 * 60000);
  const completedOne = new Date(start.getTime() - 2 * 24 * 60 * 60000);
  const completedTwo = new Date(
    start.getTime() - 24 * 60 * 60000 + 3 * 60 * 60000,
  );

  const completedAppointmentOne = await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      customerId: luca.id,
      serviceId: cut.id,
      collaboratorId: marco.id,
      startsAt: completedOne,
      endsAt: new Date(completedOne.getTime() + 30 * 60000),
      status: "completed",
      source: "internal",
      estimatedPrice: 38,
      finalPrice: 42,
      createdById: owner.id,
      updatedById: owner.id,
    },
  });

  const completedAppointmentTwo = await prisma.appointment.create({
    data: {
      tenantId: tenant.id,
      customerId: valentina.id,
      serviceId: executive.id,
      collaboratorId: nina.id,
      startsAt: completedTwo,
      endsAt: new Date(completedTwo.getTime() + 30 * 60000),
      status: "completed",
      source: "internal",
      estimatedPrice: 74,
      finalPrice: 82,
      createdById: owner.id,
      updatedById: owner.id,
    },
  });

  await Promise.all([
    prisma.appointment.create({
      data: {
        tenantId: tenant.id,
        customerId: giulia.id,
        serviceId: beard.id,
        collaboratorId: marco.id,
        startsAt: upcomingOne,
        endsAt: new Date(upcomingOne.getTime() + 30 * 60000),
        status: "confirmed",
        source: "public",
        estimatedPrice: 26,
      },
    }),
    prisma.appointment.create({
      data: {
        tenantId: tenant.id,
        customerId: andrea.id,
        serviceId: cut.id,
        collaboratorId: nina.id,
        startsAt: upcomingTwo,
        endsAt: new Date(upcomingTwo.getTime() + 30 * 60000),
        status: "requested",
        source: "public",
        estimatedPrice: 38,
      },
    }),
    prisma.appointment.create({
      data: {
        tenantId: tenant.id,
        customerId: valentina.id,
        serviceId: colorRefresh.id,
        collaboratorId: sara.id,
        startsAt: upcomingThree,
        endsAt: new Date(upcomingThree.getTime() + 30 * 60000),
        status: "confirmed",
        source: "internal",
        estimatedPrice: 59,
        createdById: owner.id,
        updatedById: owner.id,
      },
    }),
    prisma.appointment.create({
      data: {
        tenantId: tenant.id,
        customerId: luca.id,
        serviceId: executive.id,
        collaboratorId: nina.id,
        startsAt: new Date(completedOne.getTime() - 5 * 24 * 60 * 60000),
        endsAt: new Date(
          completedOne.getTime() - 5 * 24 * 60 * 60000 + 30 * 60000,
        ),
        status: "completed",
        source: "internal",
        estimatedPrice: 74,
        finalPrice: 74,
        createdById: owner.id,
        updatedById: owner.id,
      },
    }),
    prisma.appointment.create({
      data: {
        tenantId: tenant.id,
        customerId: luca.id,
        serviceId: cut.id,
        collaboratorId: marco.id,
        startsAt: new Date(completedOne.getTime() - 9 * 24 * 60 * 60000),
        endsAt: new Date(
          completedOne.getTime() - 9 * 24 * 60 * 60000 + 30 * 60000,
        ),
        status: "completed",
        source: "internal",
        estimatedPrice: 38,
        finalPrice: 38,
        createdById: owner.id,
        updatedById: owner.id,
      },
    }),
    prisma.appointment.create({
      data: {
        tenantId: tenant.id,
        customerId: andrea.id,
        serviceId: beard.id,
        collaboratorId: marco.id,
        startsAt: new Date(completedTwo.getTime() - 4 * 24 * 60 * 60000),
        endsAt: new Date(
          completedTwo.getTime() - 4 * 24 * 60 * 60000 + 30 * 60000,
        ),
        status: "completed",
        source: "public",
        estimatedPrice: 26,
        finalPrice: 26,
      },
    }),
    prisma.appointment.create({
      data: {
        tenantId: tenant.id,
        customerId: andrea.id,
        serviceId: cut.id,
        collaboratorId: nina.id,
        startsAt: new Date(completedTwo.getTime() - 8 * 24 * 60 * 60000),
        endsAt: new Date(
          completedTwo.getTime() - 8 * 24 * 60 * 60000 + 30 * 60000,
        ),
        status: "completed",
        source: "internal",
        estimatedPrice: 38,
        finalPrice: 38,
        createdById: owner.id,
        updatedById: owner.id,
      },
    }),
  ]);

  await Promise.all([
    prisma.sale.create({
      data: {
        tenantId: tenant.id,
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
            { productId: pomade.id, quantity: 1, unitPrice: 18, lineTotal: 18 },
          ],
        },
      },
    }),
    prisma.sale.create({
      data: {
        tenantId: tenant.id,
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
            { productId: oil.id, quantity: 1, unitPrice: 24, lineTotal: 24 },
          ],
        },
      },
    }),
    prisma.sale.create({
      data: {
        tenantId: tenant.id,
        customerId: luca.id,
        collaboratorId: nina.id,
        subtotal: 182,
        total: 182,
        paymentStatus: "paid",
        paymentMethod: "card",
        createdById: owner.id,
        items: {
          create: [
            { productId: pomade.id, quantity: 2, unitPrice: 18, lineTotal: 36 },
            { productId: oil.id, quantity: 1, unitPrice: 24, lineTotal: 24 },
          ],
        },
      },
    }),
    prisma.sale.create({
      data: {
        tenantId: tenant.id,
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
              quantity: 1,
              unitPrice: 16,
              lineTotal: 16,
            },
          ],
        },
      },
    }),
  ]);

  const customerSummaries = [
    {
      id: luca.id,
      visitsCount: 3,
      completedVisitsCount: 3,
      totalSpent: 242,
    },
    {
      id: giulia.id,
      visitsCount: 1,
      completedVisitsCount: 0,
      totalSpent: 0,
    },
    {
      id: andrea.id,
      visitsCount: 3,
      completedVisitsCount: 2,
      totalSpent: 84,
    },
    {
      id: valentina.id,
      visitsCount: 2,
      completedVisitsCount: 1,
      totalSpent: 98,
    },
  ];

  await Promise.all(
    customerSummaries.map((customer) => {
      const loyaltyTier = resolveLoyaltyTier({
        completedVisitsCount: customer.completedVisitsCount,
        totalSpent: customer.totalSpent,
      });

      return prisma.customer.update({
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

async function main() {
  await upsertPlans();
  await upsertPlatformAdmin();
  await recreateDemoTenant();

  console.log("Platform admin:", PLATFORM_ADMIN_EMAIL, PLATFORM_ADMIN_PASSWORD);
  console.log("Demo tenant owner:", DEMO_OWNER_EMAIL, DEMO_OWNER_PASSWORD);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
