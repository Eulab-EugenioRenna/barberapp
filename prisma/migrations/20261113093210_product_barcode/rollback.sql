-- Manual reverse di 20261113093210_product_barcode; never run by migrate deploy.
-- Per rollback controllato solo se necessario.

BEGIN;

-- DropIndex
DROP INDEX IF EXISTS "Product_tenantId_barcode_key";

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "barcode";

COMMIT;
