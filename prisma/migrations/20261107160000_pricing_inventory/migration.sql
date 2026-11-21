BEGIN;
-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "priceMode" TEXT NOT NULL DEFAULT 'legacy';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "costMode" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "priceMode" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "purchaseVatRate" DECIMAL(5,2),
ADD COLUMN     "stockTracked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ServiceProduct" ADD COLUMN     "consumptionUnits" DECIMAL(14,3);

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "orderDiscount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "discountNet" DECIMAL(10,2),
ADD COLUMN     "inventoryRequirements" JSONB,
ADD COLUMN     "lineSubtotal" DECIMAL(10,2),
ADD COLUMN     "orderDiscountShare" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "priceMode" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "priceOverrideReason" TEXT,
ADD COLUMN     "stockState" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "vatRate" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "CatalogPriceHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT,
    "serviceId" TEXT,
    "snapshot" JSONB NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryOperation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "value" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "initialized" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sectorId" TEXT,
    "saleId" TEXT,
    "saleItemId" TEXT,
    "origin" JSONB,
    "kind" TEXT NOT NULL,
    "quantityDelta" DECIMAL(14,3) NOT NULL,
    "valueDelta" DECIMAL(18,6) NOT NULL,
    "quantityAfter" DECIMAL(14,3) NOT NULL,
    "valueAfter" DECIMAL(18,6) NOT NULL,
    "purchaseVatRate" DECIMAL(5,2),
    "purchaseTax" DECIMAL(10,2),
    "returnOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogPriceHistory_tenantId_productId_createdAt_idx" ON "CatalogPriceHistory"("tenantId", "productId", "createdAt");

-- CreateIndex
CREATE INDEX "CatalogPriceHistory_tenantId_serviceId_createdAt_idx" ON "CatalogPriceHistory"("tenantId", "serviceId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryOperation_tenantId_createdAt_idx" ON "InventoryOperation"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryOperation_tenantId_idempotencyKey_key" ON "InventoryOperation"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "StockBalance_tenantId_locationId_idx" ON "StockBalance"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_locationId_productId_key" ON "StockBalance"("locationId", "productId");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_locationId_createdAt_idx" ON "StockMovement"("tenantId", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_saleId_idx" ON "StockMovement"("tenantId", "saleId");

-- CreateIndex
CREATE INDEX "StockMovement_returnOfId_idx" ON "StockMovement"("returnOfId");

-- AddForeignKey
ALTER TABLE "CatalogPriceHistory" ADD CONSTRAINT "CatalogPriceHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogPriceHistory" ADD CONSTRAINT "CatalogPriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogPriceHistory" ADD CONSTRAINT "CatalogPriceHistory_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryOperation" ADD CONSTRAINT "InventoryOperation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "InventoryOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_returnOfId_fkey" FOREIGN KEY ("returnOfId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Observed state, not invented historical price changes or opening balances.
INSERT INTO "CatalogPriceHistory" (id,"tenantId","productId",snapshot,reason,source)
SELECT md5('alora:price:product:'||id)::uuid::text,"tenantId",id,jsonb_build_object('price',price,'vatRate',"vatRate",'priceMode',"priceMode",'cost',cost,'purchaseVatRate',"purchaseVatRate",'costMode',"costMode"),'Fotografia dei valori alla migrazione','migration_observation' FROM "Product";
INSERT INTO "CatalogPriceHistory" (id,"tenantId","serviceId",snapshot,reason,source)
SELECT md5('alora:price:service:'||id)::uuid::text,"tenantId",id,jsonb_build_object('price',"basePrice",'vatRate',"vatRate",'priceMode',"priceMode"),'Fotografia dei valori alla migrazione','migration_observation' FROM "Service";
ALTER TABLE "Product" ADD CONSTRAINT alora_product_price_modes CHECK ("priceMode" IN ('legacy','net','gross') AND "costMode" IN ('legacy','net','gross') AND ("priceMode"='legacy' OR ("vatRate" IS NOT NULL AND "vatRate" BETWEEN 0 AND 100)) AND ("costMode"='legacy' OR ("purchaseVatRate" IS NOT NULL AND "purchaseVatRate" BETWEEN 0 AND 100)));
ALTER TABLE "Service" ADD CONSTRAINT alora_service_price_mode CHECK ("priceMode" IN ('legacy','net','gross') AND ("priceMode"='legacy' OR ("vatRate" IS NOT NULL AND "vatRate" BETWEEN 0 AND 100)));
ALTER TABLE "SaleItem" ADD CONSTRAINT alora_sale_item_price_mode CHECK ("priceMode" IN ('legacy','net','gross') AND ("priceMode"='legacy' OR ("vatRate" IS NOT NULL AND "vatRate" BETWEEN 0 AND 100 AND "lineSubtotal" IS NOT NULL AND "discountNet" IS NOT NULL))), ADD CONSTRAINT alora_sale_item_stock_state CHECK ("stockState" IN ('legacy','pending','posted'));
ALTER TABLE "ServiceProduct" ADD CONSTRAINT alora_consumption_units CHECK ("consumptionUnits" IS NULL OR "consumptionUnits">0);
ALTER TABLE "StockBalance" ADD CONSTRAINT alora_stock_nonnegative CHECK (quantity>=0 AND value>=0 AND (quantity<>0 OR value=0));
ALTER TABLE "StockMovement" ADD CONSTRAINT alora_stock_delta_sign CHECK (("quantityDelta">0 AND "valueDelta">=0) OR ("quantityDelta"<0 AND "valueDelta"<=0) OR ("quantityDelta"=0 AND "valueDelta"=0 AND kind='opening'));

CREATE FUNCTION alora_price_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_json jsonb; after_json jsonb; actor text; reason text;
BEGIN
 IF TG_TABLE_NAME='Product' THEN
  after_json:=jsonb_build_object('price',NEW.price,'vatRate',NEW."vatRate",'priceMode',NEW."priceMode",'cost',NEW.cost,'purchaseVatRate',NEW."purchaseVatRate",'costMode',NEW."costMode");
  IF TG_OP='UPDATE' THEN before_json:=jsonb_build_object('price',OLD.price,'vatRate',OLD."vatRate",'priceMode',OLD."priceMode",'cost',OLD.cost,'purchaseVatRate',OLD."purchaseVatRate",'costMode',OLD."costMode"); END IF;
  IF TG_OP='UPDATE' AND OLD."stockTracked" AND NOT NEW."stockTracked" AND EXISTS(SELECT 1 FROM "StockBalance" WHERE "productId"=NEW.id AND initialized) THEN RAISE EXCEPTION 'Tracciamento gia avviato: disattiva il prodotto per conservare il registro' USING ERRCODE='23514'; END IF;
 ELSE
  after_json:=jsonb_build_object('price',NEW."basePrice",'vatRate',NEW."vatRate",'priceMode',NEW."priceMode");
  IF TG_OP='UPDATE' THEN before_json:=jsonb_build_object('price',OLD."basePrice",'vatRate',OLD."vatRate",'priceMode',OLD."priceMode"); END IF;
 END IF;
 IF TG_OP='INSERT' OR before_json IS DISTINCT FROM after_json THEN
  actor:=NULLIF(current_setting('alora.actor',true),''); reason:=COALESCE(NULLIF(current_setting('alora.price_reason',true),''),'Aggiornamento listino');
  IF actor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "User" WHERE id=actor AND "tenantId"=NEW."tenantId") THEN RAISE EXCEPTION 'Autore fuori azienda' USING ERRCODE='23514'; END IF;
  INSERT INTO "CatalogPriceHistory" (id,"tenantId","productId","serviceId",snapshot,"actorUserId",reason,source)
  VALUES(gen_random_uuid()::text,NEW."tenantId",CASE WHEN TG_TABLE_NAME='Product' THEN NEW.id END,CASE WHEN TG_TABLE_NAME='Service' THEN NEW.id END,after_json,actor,reason,CASE WHEN actor IS NULL THEN 'database_observation' ELSE 'application' END);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_product_price_change AFTER INSERT OR UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION alora_price_change();
CREATE TRIGGER alora_service_price_change AFTER INSERT OR UPDATE ON "Service" FOR EACH ROW EXECUTE FUNCTION alora_price_change();
CREATE FUNCTION alora_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Registro immutabile: usa un movimento di rettifica' USING ERRCODE='23514'; END $$;
CREATE TRIGGER alora_price_history_immutable BEFORE UPDATE OR DELETE ON "CatalogPriceHistory" FOR EACH ROW EXECUTE FUNCTION alora_immutable_record();
CREATE TRIGGER alora_stock_movement_immutable BEFORE UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION alora_immutable_record();

CREATE FUNCTION alora_stock_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid text; lid text; original "StockMovement"%ROWTYPE; returned_q numeric; returned_v numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW."tenantId",7));
 IF TG_TABLE_NAME='InventoryOperation' THEN
  IF NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."actorUserId" AND "tenantId"=NEW."tenantId") THEN RAISE EXCEPTION 'Autore del movimento fuori azienda' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (OLD.result IS NOT NULL OR (NEW."tenantId",NEW."idempotencyKey",NEW.fingerprint,NEW.kind,NEW."actorUserId",NEW.reason) IS DISTINCT FROM (OLD."tenantId",OLD."idempotencyKey",OLD.fingerprint,OLD.kind,OLD."actorUserId",OLD.reason)) THEN RAISE EXCEPTION 'Operazione inventario immutabile' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "Product" WHERE id=NEW."productId" AND "tenantId"=NEW."tenantId") OR NOT EXISTS(SELECT 1 FROM "Location" WHERE id=NEW."locationId" AND "tenantId"=NEW."tenantId") THEN RAISE EXCEPTION 'Prodotto o sede fuori azienda' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='StockBalance' AND TG_OP='UPDATE' AND (NEW."tenantId",NEW."locationId",NEW."productId") IS DISTINCT FROM (OLD."tenantId",OLD."locationId",OLD."productId") THEN RAISE EXCEPTION 'Giacenza non trasferibile: usa un trasferimento' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='StockMovement' THEN
  IF NOT EXISTS(SELECT 1 FROM "InventoryOperation" WHERE id=NEW."operationId" AND "tenantId"=NEW."tenantId" AND result IS NULL) THEN RAISE EXCEPTION 'Operazione inventario non valida' USING ERRCODE='23514'; END IF;
  IF NEW."sectorId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Sector" WHERE id=NEW."sectorId" AND "tenantId"=NEW."tenantId" AND "locationId"=NEW."locationId") THEN RAISE EXCEPTION 'Settore fuori sede' USING ERRCODE='23514'; END IF;
  IF NEW."returnOfId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "StockMovement" WHERE id=NEW."returnOfId" AND "tenantId"=NEW."tenantId" AND "productId"=NEW."productId" AND "locationId"=NEW."locationId" AND "quantityDelta"<0) THEN RAISE EXCEPTION 'Movimento di reso non valido' USING ERRCODE='23514'; END IF;
  IF NEW."returnOfId" IS NOT NULL THEN
   SELECT * INTO original FROM "StockMovement" WHERE id=NEW."returnOfId";
   SELECT COALESCE(sum("quantityDelta"),0),COALESCE(sum("valueDelta"),0) INTO returned_q,returned_v FROM "StockMovement" WHERE "returnOfId"=NEW."returnOfId";
   IF NEW."quantityDelta"<=0 OR returned_q+NEW."quantityDelta">-original."quantityDelta" OR returned_v+NEW."valueDelta">-original."valueDelta" THEN RAISE EXCEPTION 'Reso oltre la quantità o il costo originali' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_stock_balance_scope BEFORE INSERT OR UPDATE ON "StockBalance" FOR EACH ROW EXECUTE FUNCTION alora_stock_scope();
CREATE TRIGGER alora_stock_movement_scope BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION alora_stock_scope();
CREATE TRIGGER alora_inventory_operation_scope BEFORE INSERT OR UPDATE ON "InventoryOperation" FOR EACH ROW EXECUTE FUNCTION alora_stock_scope();
CREATE TRIGGER alora_inventory_operation_no_delete BEFORE DELETE ON "InventoryOperation" FOR EACH ROW EXECUTE FUNCTION alora_immutable_record();

CREATE FUNCTION alora_stock_reconcile() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q numeric; v numeric; opens bigint; balance "StockBalance"%ROWTYPE;
BEGIN
 SELECT * INTO balance FROM "StockBalance" WHERE "locationId"=NEW."locationId" AND "productId"=NEW."productId";
 SELECT COALESCE(sum("quantityDelta"),0),COALESCE(sum("valueDelta"),0),count(*) FILTER(WHERE kind='opening') INTO q,v,opens FROM "StockMovement" WHERE "locationId"=NEW."locationId" AND "productId"=NEW."productId";
 IF balance.id IS NULL OR balance.quantity<>q OR balance.value<>v OR (balance.initialized AND opens<>1) OR (NOT balance.initialized AND opens<>0) THEN RAISE EXCEPTION 'Registro e giacenza non riconciliati' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER alora_stock_balance_reconcile AFTER INSERT OR UPDATE ON "StockBalance" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alora_stock_reconcile();
CREATE CONSTRAINT TRIGGER alora_stock_movement_reconcile AFTER INSERT ON "StockMovement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alora_stock_reconcile();
CREATE TRIGGER alora_stock_balance_no_delete BEFORE DELETE ON "StockBalance" FOR EACH ROW EXECUTE FUNCTION alora_immutable_record();
ALTER TABLE "InventoryOperation" ADD CONSTRAINT alora_inventory_kind CHECK (kind IN ('opening','receipt','issue','adjust','transfer','return','order'));
ALTER TABLE "StockMovement" ADD CONSTRAINT alora_stock_movement_kind CHECK (kind IN ('opening','receipt','issue','adjust_in','adjust_out','transfer_in','transfer_out','return','sale','consumption','order_adjust_in','order_adjust_out'));
ALTER TABLE "CatalogPriceHistory" ADD CONSTRAINT alora_price_history_entity CHECK (("productId" IS NULL) <> ("serviceId" IS NULL));
CREATE TABLE "OrderPriceRevision" (
 id TEXT NOT NULL, "tenantId" TEXT NOT NULL,"saleId" TEXT NOT NULL,"saleItemId" TEXT NOT NULL,
 snapshot JSONB NOT NULL,"previousSnapshot" JSONB,"actorUserId" TEXT,reason TEXT NOT NULL,source TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "OrderPriceRevision_pkey" PRIMARY KEY (id), CONSTRAINT "OrderPriceRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OrderPriceRevision_tenantId_saleId_createdAt_idx" ON "OrderPriceRevision"("tenantId","saleId","createdAt");
INSERT INTO "OrderPriceRevision" (id,"tenantId","saleId","saleItemId",snapshot,reason,source)
SELECT md5('alora:order-price:'||i.id)::uuid::text,s."tenantId",s.id,i.id,to_jsonb(i)-'inventoryRequirements'-'stockState','Valori osservati alla migrazione','migration_observation' FROM "SaleItem" i JOIN "Sale" s ON s.id=i."saleId";
CREATE FUNCTION alora_order_price_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_json jsonb; previous_json jsonb; tid text; actor text; origin text;
BEGIN
 current_json:=to_jsonb(NEW)-'inventoryRequirements'-'stockState';
 IF TG_OP='UPDATE' THEN previous_json:=to_jsonb(OLD)-'inventoryRequirements'-'stockState'; END IF;
 IF TG_OP='INSERT' OR (current_json-'collaboratorId'-'label') IS DISTINCT FROM (previous_json-'collaboratorId'-'label') THEN
  SELECT "tenantId" INTO tid FROM "Sale" WHERE id=NEW."saleId";
  actor:=NULLIF(current_setting('alora.actor',true),''); origin:=NULLIF(current_setting('alora.price_source',true),'');
  IF actor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "User" WHERE id=actor AND "tenantId"=tid) THEN RAISE EXCEPTION 'Autore prezzo fuori azienda' USING ERRCODE='23514'; END IF;
  INSERT INTO "OrderPriceRevision" (id,"tenantId","saleId","saleItemId",snapshot,"previousSnapshot","actorUserId",reason,source)
  VALUES(gen_random_uuid()::text,tid,NEW."saleId",NEW.id,current_json,previous_json,actor,COALESCE(NULLIF(NEW."priceOverrideReason",''),'Aggiornamento conto'),CASE WHEN origin IN ('application','public_booking') THEN origin WHEN actor IS NOT NULL THEN 'application' ELSE 'database_observation' END);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_order_price_revision AFTER INSERT OR UPDATE ON "SaleItem" FOR EACH ROW EXECUTE FUNCTION alora_order_price_revision();
CREATE TRIGGER alora_order_price_history_immutable BEFORE UPDATE OR DELETE ON "OrderPriceRevision" FOR EACH ROW EXECUTE FUNCTION alora_immutable_record();
-- Only clearly future, still-open booked work is eligible for first-time posting.
-- Completed/past/ambiguous operations retain legacy stock provenance.
UPDATE "SaleItem" i SET "stockState"='pending' FROM "Sale" s, "Appointment" a
WHERE i."saleId"=s.id AND a."orderItemId"=i.id AND s."orderStatus"='open'
AND a."startsAt">=CURRENT_TIMESTAMP AND a.status IN ('draft','requested','confirmed','rescheduled');

COMMIT;
