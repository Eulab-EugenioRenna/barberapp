const { execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const BASELINE_MIGRATIONS = [
  "20260512130000_notifications_system",
  "20260922000000_initial_schema",
];

function prisma(args) {
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", ...args], {
    stdio: "inherit",
  });
}

async function main() {
  const client = new PrismaClient();

  try {
    const [state] = await client.$queryRaw`
      SELECT
        to_regclass('public."Tenant"') IS NOT NULL AS "hasTenant",
        to_regclass('public."SaleItem"') IS NOT NULL AS "hasSaleItem",
        to_regclass('public."_prisma_migrations"') IS NOT NULL AS "hasMigrationHistory",
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'SaleItem'
            AND column_name = 'label'
        ) AS "hasSaleItemLabel"
    `;

    if (!state.hasTenant) {
      if (state.hasMigrationHistory) {
        throw new Error(
          "Il database non contiene lo schema applicativo, ma ha una cronologia Prisma. Interrompo per non applicare una baseline incoerente.",
        );
      }

      console.log("Database vuoto: applico la baseline e tutte le migrazioni.");
    } else if (!state.hasMigrationHistory) {
      if (!state.hasSaleItem || state.hasSaleItemLabel) {
        throw new Error(
          "Database esistente non riconosciuto come schema legacy. Interrompo senza modificare dati: verifica la cronologia Prisma prima di riprovare.",
        );
      }

      console.log("Database legacy rilevato: registro la baseline senza alterare dati.");
      for (const migration of BASELINE_MIGRATIONS) {
        prisma(["migrate", "resolve", "--applied", migration]);
      }
    }

    prisma(["migrate", "deploy"]);
  } finally {
    await client.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
