-- Collaborators are selected freely on appointments, not configured per service.
DROP TABLE IF EXISTS "_CollaboratorServices";

-- Catalog products can require a price at checkout.
ALTER TABLE "Product" ALTER COLUMN "price" DROP NOT NULL;

-- A sale contains product and/or service lines.
ALTER TABLE "SaleItem" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "SaleItem" ADD COLUMN "serviceId" TEXT;
ALTER TABLE "SaleItem" ADD COLUMN "label" TEXT NOT NULL DEFAULT '';

UPDATE "SaleItem" AS item
SET "label" = product."name"
FROM "Product" AS product
WHERE item."productId" = product."id";

UPDATE "SaleItem" SET "label" = 'Articolo' WHERE "label" = '';
ALTER TABLE "SaleItem" ALTER COLUMN "label" DROP DEFAULT;

ALTER TABLE "SaleItem"
  ADD CONSTRAINT "SaleItem_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SaleItem" DROP CONSTRAINT IF EXISTS "SaleItem_productId_fkey";
ALTER TABLE "SaleItem"
  ADD CONSTRAINT "SaleItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");
CREATE INDEX "SaleItem_serviceId_idx" ON "SaleItem"("serviceId");

CREATE TABLE "SaleItemStation" (
  "saleItemId" TEXT NOT NULL,
  "stationId" TEXT NOT NULL,
  CONSTRAINT "SaleItemStation_pkey" PRIMARY KEY ("saleItemId", "stationId"),
  CONSTRAINT "SaleItemStation_saleItemId_fkey"
    FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SaleItemStation_stationId_fkey"
    FOREIGN KEY ("stationId") REFERENCES "Station"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "SaleItemStation_stationId_idx" ON "SaleItemStation"("stationId");
