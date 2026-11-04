-- Additive: EULab Admin access-as grants are isolated from ordinary Connect SSO sessions.
CREATE TABLE "ConnectTechnicalAccess" (
    "id" TEXT NOT NULL,
    "handoffHash" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "targetSubject" TEXT NOT NULL,
    "operatorSubject" TEXT NOT NULL,
    "operatorTokenCipher" TEXT NOT NULL,
    "handoffExpiresAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "exchangedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConnectTechnicalAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConnectTechnicalAccess_handoffHash_key" ON "ConnectTechnicalAccess"("handoffHash");
CREATE INDEX "ConnectTechnicalAccess_targetUserId_idx" ON "ConnectTechnicalAccess"("targetUserId");
CREATE INDEX "ConnectTechnicalAccess_expiresAt_idx" ON "ConnectTechnicalAccess"("expiresAt");

ALTER TABLE "LocalSession" ADD COLUMN "technicalAccessId" TEXT;
CREATE UNIQUE INDEX "LocalSession_technicalAccessId_key" ON "LocalSession"("technicalAccessId");

ALTER TABLE "ConnectTechnicalAccess" ADD CONSTRAINT "ConnectTechnicalAccess_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LocalSession" ADD CONSTRAINT "LocalSession_technicalAccessId_fkey" FOREIGN KEY ("technicalAccessId") REFERENCES "ConnectTechnicalAccess"("id") ON DELETE CASCADE ON UPDATE CASCADE;
