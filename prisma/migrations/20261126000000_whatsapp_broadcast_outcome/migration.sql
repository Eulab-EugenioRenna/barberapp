-- Each message waits for its real outcome on Connect; same content is recognised by hash.
ALTER TABLE "WhatsAppBroadcast" ADD COLUMN "uncertain" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WhatsAppBroadcast" ADD COLUMN "contentHash" TEXT;
CREATE INDEX "WhatsAppBroadcast_tenantId_contentHash_idx" ON "WhatsAppBroadcast"("tenantId", "contentHash");
