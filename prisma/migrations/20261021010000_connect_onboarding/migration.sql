ALTER TABLE "User" ADD COLUMN "connectSubject" TEXT,
 ADD COLUMN "connectInstallationId" TEXT,
 ADD COLUMN "connectAcceptedAt" TIMESTAMP(3),
 ADD COLUMN "connectActivatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_connectInstallationId_connectSubject_key" ON "User"("connectInstallationId", "connectSubject");
CREATE TABLE "ConnectSession" (
 "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "installationId" TEXT NOT NULL,
 "accessCipher" TEXT NOT NULL, "refreshCipher" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL,
 "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ConnectSession_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ConnectSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConnectSession_userId_idx" ON "ConnectSession"("userId");
ALTER TABLE "LocalSession" ADD COLUMN "connectSessionId" TEXT;
ALTER TABLE "LocalSession" ADD CONSTRAINT "LocalSession_connectSessionId_fkey" FOREIGN KEY ("connectSessionId") REFERENCES "ConnectSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "ConnectAuthFlow" (
 "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "installationId" TEXT NOT NULL,
 "stateHash" TEXT NOT NULL, "browserHash" TEXT NOT NULL, "verifierCipher" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3), "handoffHash" TEXT,
 "exchangedAt" TIMESTAMP(3), "connectSessionId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ConnectAuthFlow_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ConnectAuthFlow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ConnectAuthFlow_connectSessionId_fkey" FOREIGN KEY ("connectSessionId") REFERENCES "ConnectSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConnectAuthFlow_stateHash_key" ON "ConnectAuthFlow"("stateHash");
CREATE UNIQUE INDEX "ConnectAuthFlow_handoffHash_key" ON "ConnectAuthFlow"("handoffHash");
CREATE INDEX "ConnectAuthFlow_userId_expiresAt_idx" ON "ConnectAuthFlow"("userId", "expiresAt");
