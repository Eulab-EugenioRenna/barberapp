import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
import { PrismaClient, UserRole } from "@prisma/client";
import { hash } from "bcrypt";
import { ensureDemoAccount } from "../scripts/create-demo-account";

const prisma = new PrismaClient();

const PLATFORM_ADMIN_EMAIL =
  process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase() ||
  "admin@platform.test";
const PLATFORM_ADMIN_PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD || "";
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
      update: {},
      create: plan,
    });
  }
}

async function ensurePlatformAdmin() {
  const existing = await prisma.user.findUnique({
    where: { email: PLATFORM_ADMIN_EMAIL },
  });
  if (existing || !PLATFORM_ADMIN_PASSWORD) return;
  await prisma.user.create({
    data: {
      email: PLATFORM_ADMIN_EMAIL,
      passwordHash: await hash(PLATFORM_ADMIN_PASSWORD, 10),
      firstName: "Platform",
      lastName: "Admin",
      role: UserRole.platform_admin,
      permissions: ["platform.admin"],
    },
  });
}

async function main() {
  await upsertPlans();
  await ensurePlatformAdmin();
  if (process.env.SEED_DEMO === "1") await ensureDemoAccount(prisma);
  console.log(
    "Catalogo iniziale verificato. Account e tenant esistenti conservati; nessuna password viene stampata.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
