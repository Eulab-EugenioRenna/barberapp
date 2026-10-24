CREATE TABLE "LocalSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "accessHash" TEXT NOT NULL,
  "refreshHash" TEXT NOT NULL,
  "accessExpiresAt" TIMESTAMP(3) NOT NULL,
  "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LocalSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LocalSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LocalSession_accessHash_key" ON "LocalSession"("accessHash");
CREATE UNIQUE INDEX "LocalSession_refreshHash_key" ON "LocalSession"("refreshHash");
CREATE INDEX "LocalSession_familyId_idx" ON "LocalSession"("familyId");
CREATE INDEX "LocalSession_userId_idx" ON "LocalSession"("userId");
