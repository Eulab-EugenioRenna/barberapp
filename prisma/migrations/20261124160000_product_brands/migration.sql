-- Brands group products in the catalogue and in Panoramica.
CREATE TABLE "ProductBrand" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductBrand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductBrand_tenantId_name_key" ON "ProductBrand"("tenantId", "name");
ALTER TABLE "ProductBrand" ADD CONSTRAINT "ProductBrand_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Product" ADD COLUMN "brandId" TEXT;
CREATE INDEX "Product_tenantId_brandId_idx" ON "Product"("tenantId", "brandId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "ProductBrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
