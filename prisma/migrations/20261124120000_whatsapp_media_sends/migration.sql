-- Additiva: allegati WhatsApp copiati in ALORA, registro degli invii fatti
-- da ALORA (destinatario e testo) e nome visualizzato delle chat.

CREATE TABLE "WhatsAppMedia" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "archiveId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "filename" TEXT,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppMedia_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppMedia_archiveId_messageId_key" ON "WhatsAppMedia"("archiveId", "messageId");
CREATE INDEX "WhatsAppMedia_tenantId_idx" ON "WhatsAppMedia"("tenantId");
ALTER TABLE "WhatsAppMedia" ADD CONSTRAINT "WhatsAppMedia_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WhatsAppSend" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "outboxId" TEXT NOT NULL,
    "customerId" TEXT,
    "recipient" TEXT NOT NULL,
    "recipientName" TEXT,
    "kind" TEXT NOT NULL,
    "preview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppSend_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppSend_outboxId_key" ON "WhatsAppSend"("outboxId");
CREATE INDEX "WhatsAppSend_tenantId_userId_idx" ON "WhatsAppSend"("tenantId", "userId");
ALTER TABLE "WhatsAppSend" ADD CONSTRAINT "WhatsAppSend_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WhatsAppChat" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "archiveId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "name" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppChat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppChat_archiveId_chatId_key" ON "WhatsAppChat"("archiveId", "chatId");
CREATE INDEX "WhatsAppChat_tenantId_idx" ON "WhatsAppChat"("tenantId");
ALTER TABLE "WhatsAppChat" ADD CONSTRAINT "WhatsAppChat_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
