-- CreateTable
CREATE TABLE "WhatsAppBroadcast" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectSessionId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "text" TEXT,
    "image" JSONB,
    "status" TEXT NOT NULL DEFAULT 'running',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppBroadcastRecipient" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "name" TEXT,
    "position" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "outboxId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppBroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsAppBroadcast_status_nextRunAt_idx" ON "WhatsAppBroadcast"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "WhatsAppBroadcast_tenantId_userId_createdAt_idx" ON "WhatsAppBroadcast"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppBroadcast_tenantId_userId_idempotencyKey_key" ON "WhatsAppBroadcast"("tenantId", "userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WhatsAppBroadcastRecipient_broadcastId_state_position_idx" ON "WhatsAppBroadcastRecipient"("broadcastId", "state", "position");

-- AddForeignKey
ALTER TABLE "WhatsAppBroadcast" ADD CONSTRAINT "WhatsAppBroadcast_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppBroadcastRecipient" ADD CONSTRAINT "WhatsAppBroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "WhatsAppBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

