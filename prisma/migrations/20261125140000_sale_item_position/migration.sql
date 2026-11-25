-- Order of the lines in an account, as arranged at the till.
ALTER TABLE "SaleItem" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Existing lines keep the order they were shown in until now (physical order).
UPDATE "SaleItem" AS item
SET "position" = ordered.rn
FROM (
  SELECT id, (row_number() OVER (PARTITION BY "saleId" ORDER BY ctid)) - 1 AS rn
  FROM "SaleItem"
) AS ordered
WHERE item.id = ordered.id;
