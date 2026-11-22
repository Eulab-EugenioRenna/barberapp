-- Additiva: distingue la disconnessione chiesta da ALORA (riconnettibile)
-- da quella fatta dal telefono o da Connect (il collegamento va rimosso).

ALTER TABLE "WhatsAppLink" ADD COLUMN "disconnectRequestedAt" TIMESTAMP(3);
