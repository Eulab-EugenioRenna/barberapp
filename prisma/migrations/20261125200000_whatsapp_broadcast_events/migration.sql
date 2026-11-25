-- Steps of each «Messaggio a tutti», shown in its detail card.
ALTER TABLE "WhatsAppBroadcastRecipient" ADD COLUMN "sentAt" TIMESTAMP(3);
CREATE INDEX "WhatsAppBroadcastRecipient_outboxId_idx" ON "WhatsAppBroadcastRecipient"("outboxId");

CREATE TABLE "WhatsAppBroadcastEvent" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "pending" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppBroadcastEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WhatsAppBroadcastEvent_broadcastId_at_idx" ON "WhatsAppBroadcastEvent"("broadcastId", "at");
ALTER TABLE "WhatsAppBroadcastEvent" ADD CONSTRAINT "WhatsAppBroadcastEvent_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "WhatsAppBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;
