-- Additive metadata and an optional unbound flow for authorized Connect-only identities.
ALTER TABLE "ConnectAuthFlow" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "ConnectAuthFlow" ADD COLUMN "contextCipher" TEXT;
CREATE TABLE "ConnectTenantBinding" (
  "tenantId" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "secretCipher" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectTenantBinding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConnectTenantBinding_installationId_key" ON "ConnectTenantBinding"("installationId");
CREATE TABLE "ConnectMigrationChallenge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectMigrationChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConnectMigrationChallenge_tokenHash_key" ON "ConnectMigrationChallenge"("tokenHash");
CREATE INDEX "ConnectMigrationChallenge_userId_expiresAt_idx" ON "ConnectMigrationChallenge"("userId", "expiresAt");
