BEGIN;
ALTER TABLE "Sale" ADD COLUMN "orderStatus" TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN "orderOrigin" TEXT NOT NULL DEFAULT 'legacy_sale',
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_order_status_check" CHECK ("orderStatus" IN ('open','confirmed','superseded')),
  ADD CONSTRAINT "Sale_revision_check" CHECK (revision >= 0),
  ADD CONSTRAINT "Sale_open_payment_check" CHECK ("orderStatus" <> 'open' OR ("paymentStatus"='unpaid' AND "paymentMethod" IS NULL));
ALTER TABLE "Appointment" ADD COLUMN "orderItemId" TEXT, ADD COLUMN "orderIssue" TEXT;
CREATE UNIQUE INDEX "Appointment_orderItemId_key" ON "Appointment"("orderItemId");
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "SaleItem"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing financial rows and all original appointment fields are immutable during backfill.
WITH candidates AS (
 SELECT a.id, count(DISTINCT s.id) AS sales,
   count(i.id) FILTER (WHERE i."serviceId"=a."serviceId" AND i."sectorId"=a."sectorId" AND i.quantity=1 AND s."tenantId"=a."tenantId" AND s."locationId"=a."locationId" AND s."customerId"=a."customerId") AS matches,
   min(i.id) FILTER (WHERE i."serviceId"=a."serviceId" AND i."sectorId"=a."sectorId" AND i.quantity=1 AND s."tenantId"=a."tenantId" AND s."locationId"=a."locationId" AND s."customerId"=a."customerId") AS item
 FROM "Appointment" a JOIN "Sale" s ON s."appointmentId"=a.id LEFT JOIN "SaleItem" i ON i."saleId"=s.id GROUP BY a.id
)
UPDATE "Appointment" a SET "orderItemId"=CASE WHEN c.sales=1 AND c.matches=1 THEN c.item ELSE NULL END,
 "orderIssue"=CASE WHEN c.sales>1 THEN 'multiple-sales' WHEN c.matches<>1 THEN 'ambiguous-or-missing-service-line' ELSE NULL END
FROM candidates c WHERE c.id=a.id;

INSERT INTO "Sale" (id,"tenantId","locationId","customerId","appointmentId",subtotal,"discountTotal","taxTotal",total,"paymentStatus","soldAt","createdById","orderStatus","orderOrigin")
SELECT md5('alora:order:appointment:'||a.id)::uuid::text,a."tenantId",a."locationId",a."customerId",a.id,
 COALESCE(a."finalPrice",a."estimatedPrice",0),0,0,COALESCE(a."finalPrice",a."estimatedPrice",0),'unpaid',a."startsAt",a."createdById",'open','legacy_appointment'
FROM "Appointment" a WHERE NOT EXISTS(SELECT 1 FROM "Sale" s WHERE s."appointmentId"=a.id);

INSERT INTO "SaleItem" (id,"saleId","sectorId","serviceId",label,quantity,"unitPrice",discount,"taxTotal","lineTotal")
SELECT md5('alora:order:line:'||a.id)::uuid::text,s.id,a."sectorId",a."serviceId",v.name,1,s.total,0,0,s.total
FROM "Appointment" a JOIN "Sale" s ON s."appointmentId"=a.id AND s."orderOrigin"='legacy_appointment' JOIN "Service" v ON v.id=a."serviceId";
UPDATE "Appointment" a SET "orderItemId"=i.id FROM "SaleItem" i JOIN "Sale" s ON s.id=i."saleId" AND s."orderOrigin"='legacy_appointment' WHERE s."appointmentId"=a.id;

-- Deferred so the application can update both representations atomically.
CREATE FUNCTION alora_order_booking_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE aid text;
BEGIN
 IF TG_TABLE_NAME='Appointment' THEN aid:=NEW.id;
 ELSE SELECT id INTO aid FROM "Appointment" WHERE "orderItemId"=NEW.id; END IF;
 IF aid IS NOT NULL AND EXISTS(
   SELECT 1 FROM "Appointment" a JOIN "SaleItem" i ON i.id=a."orderItemId" JOIN "Sale" s ON s.id=i."saleId"
   WHERE a.id=aid AND (s."tenantId"<>a."tenantId" OR s."locationId"<>a."locationId" OR s."customerId" IS DISTINCT FROM a."customerId" OR i."serviceId" IS DISTINCT FROM a."serviceId" OR i."sectorId"<>a."sectorId" OR i.quantity<>1)
 ) THEN RAISE EXCEPTION 'Riga del conto incompatibile con la prenotazione' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER alora_order_appointment_fence AFTER INSERT OR UPDATE ON "Appointment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alora_order_booking_fence();
CREATE CONSTRAINT TRIGGER alora_order_item_fence AFTER INSERT OR UPDATE ON "SaleItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alora_order_booking_fence();
CREATE FUNCTION alora_order_sale_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "Appointment" a JOIN "SaleItem" i ON i.id=a."orderItemId" WHERE i."saleId"=NEW.id AND (a."tenantId"<>NEW."tenantId" OR a."locationId"<>NEW."locationId" OR a."customerId" IS DISTINCT FROM NEW."customerId"))
 THEN RAISE EXCEPTION 'Conto incompatibile con la prenotazione' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER alora_order_sale_fence AFTER INSERT OR UPDATE ON "Sale" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alora_order_sale_fence();
COMMIT;
