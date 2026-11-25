-- Order of services and products in the till grid, chosen by dragging.
ALTER TABLE "Service" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
