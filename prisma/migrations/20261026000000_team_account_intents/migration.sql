CREATE TABLE "TeamAccountIntent" (
  "userId" TEXT NOT NULL PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sourceId" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "roleIds" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "ssoSetupRequired" BOOLEAN
);
CREATE INDEX "TeamAccountIntent_tenantId_completedAt_idx" ON "TeamAccountIntent"("tenantId", "completedAt");
