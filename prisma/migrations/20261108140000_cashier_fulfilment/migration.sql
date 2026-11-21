BEGIN;
-- No charge or execution is inferred for existing records.
ALTER TABLE "SaleItem" ADD COLUMN "nonPerformanceChargeReason" TEXT;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_non_performance_reason_check" CHECK ("nonPerformanceChargeReason" IS NULL OR ("serviceId" IS NOT NULL AND length(btrim("nonPerformanceChargeReason")) BETWEEN 3 AND 500));
ALTER TABLE "OrderOperation" DROP CONSTRAINT "OrderOperation_kind_check";
ALTER TABLE "OrderOperation" ADD CONSTRAINT "OrderOperation_kind_check" CHECK (kind IN ('create_booking','create_sale','update_booking','update_sale','cancel_booking'));
CREATE FUNCTION alora_checkout_charge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid text; line_id text;
BEGIN
 IF TG_TABLE_NAME='Sale' THEN
  IF TG_OP='UPDATE' AND NEW."orderStatus" IS NOT DISTINCT FROM OLD."orderStatus" THEN RETURN NULL; END IF;
  sid:=NEW.id;
 ELSE
  IF TG_OP='UPDATE' AND (NEW."lineTotal",NEW."taxTotal",NEW."serviceId",NEW."nonPerformanceChargeReason") IS NOT DISTINCT FROM (OLD."lineTotal",OLD."taxTotal",OLD."serviceId",OLD."nonPerformanceChargeReason") THEN RETURN NULL; END IF;
  sid:=NEW."saleId";
  line_id:=NEW.id;
 END IF;
 IF EXISTS(SELECT 1 FROM "Sale" s JOIN "SaleItem" i ON i."saleId"=s.id JOIN "Appointment" a ON a."orderItemId"=i.id
   WHERE s.id=sid AND (line_id IS NULL OR i.id=line_id) AND s."orderStatus"='confirmed' AND a.status IN ('cancelled','no_show') AND i."lineTotal"+i."taxTotal">0 AND nullif(btrim(i."nonPerformanceChargeReason"),'') IS NULL)
 THEN RAISE EXCEPTION 'Quota per servizio non eseguito da dichiarare esplicitamente' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER alora_checkout_charge_guard AFTER INSERT OR UPDATE ON "Sale" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alora_checkout_charge_guard();
CREATE CONSTRAINT TRIGGER alora_checkout_item_charge_guard AFTER INSERT OR UPDATE ON "SaleItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alora_checkout_charge_guard();
CREATE FUNCTION alora_nonperformed_stock_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."saleItemId" IS NOT NULL AND NEW.kind IN ('consumption','sale','order_adjust_out','order_adjust_in') AND EXISTS(
  SELECT 1 FROM "Appointment" WHERE "orderItemId"=NEW."saleItemId" AND status IN ('cancelled','no_show'))
 THEN RAISE EXCEPTION 'Un servizio non eseguito non genera consumi o resi automatici' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_nonperformed_stock_guard BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION alora_nonperformed_stock_guard();
COMMIT;
