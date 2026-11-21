-- Migration additiva e reversibile: campo barcode su Product, unico per tenant.
-- Applicare solo dopo aver verificato su una copia del database (non sul DB vivo).

BEGIN;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "barcode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_barcode_key" ON "Product"("tenantId", "barcode");

COMMIT;
