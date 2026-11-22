-- Additiva: registra i collegamenti WhatsApp creati da ALORA e il loro proprietario.
-- Nessun dato esistente viene modificato; i collegamenti precedenti non vengono attribuiti.

BEGIN;

CREATE TABLE "WhatsAppLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    CONSTRAINT "WhatsAppLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppLink_sessionId_key" ON "WhatsAppLink"("sessionId");
CREATE INDEX "WhatsAppLink_tenantId_userId_idx" ON "WhatsAppLink"("tenantId", "userId");

ALTER TABLE "WhatsAppLink" ADD CONSTRAINT "WhatsAppLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppLink" ADD CONSTRAINT "WhatsAppLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
