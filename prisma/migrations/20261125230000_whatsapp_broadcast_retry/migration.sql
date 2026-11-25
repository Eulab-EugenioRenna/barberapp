-- «Completa e riprova i rimanenti»: each retry round sends with a new key.
ALTER TABLE "WhatsAppBroadcastRecipient" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 0;
