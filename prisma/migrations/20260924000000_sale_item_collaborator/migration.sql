-- A single sale/appointment can contain services performed by different people.
-- Attribution therefore belongs to each sale line, not just to the sale header.
ALTER TABLE "SaleItem" ADD COLUMN "collaboratorId" TEXT;

ALTER TABLE "SaleItem"
  ADD CONSTRAINT "SaleItem_collaboratorId_fkey"
  FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SaleItem_collaboratorId_idx" ON "SaleItem"("collaboratorId");
