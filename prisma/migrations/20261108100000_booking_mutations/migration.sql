BEGIN;
-- Additive evolution. Existing appointments, prices and financial records are unchanged.
ALTER TABLE "OrderOperation" DROP CONSTRAINT "OrderOperation_kind_check";
ALTER TABLE "OrderOperation" ADD CONSTRAINT "OrderOperation_kind_check" CHECK (kind IN ('create_booking','create_sale','update_booking','cancel_booking'));
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_order_status_check";
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_order_status_check" CHECK ("orderStatus" IN ('open','confirmed','superseded','cancelled'));

-- Membership and tenant fences stay immediate. Resource conflicts move to a real,
-- initially-immediate constraint, explicitly deferred only for coordinated commands.
CREATE OR REPLACE FUNCTION alora_appointment_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid text; lid text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM "Customer" WHERE id=NEW."customerId" AND "tenantId"=NEW."tenantId") THEN RAISE EXCEPTION 'Cliente fuori azienda' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' OR NEW."serviceId" IS DISTINCT FROM OLD."serviceId" THEN
    SELECT "sectorId" INTO sid FROM "Service" WHERE id=NEW."serviceId" AND "tenantId"=NEW."tenantId";
    SELECT "locationId" INTO lid FROM "Sector" WHERE id=sid;
    IF sid IS NULL THEN RAISE EXCEPTION 'Servizio fuori azienda' USING ERRCODE='23514'; END IF;
    IF NEW."sectorId" IS NOT NULL AND NEW."sectorId"<>sid THEN RAISE EXCEPTION 'Servizio di un altro settore' USING ERRCODE='23514'; END IF;
    NEW."sectorId":=sid;
    IF NEW."locationId" IS NOT NULL AND NEW."locationId"<>lid THEN RAISE EXCEPTION 'Servizio di un altra sede' USING ERRCODE='23514'; END IF;
    NEW."locationId":=lid;
  END IF;
  IF TG_OP='UPDATE' AND NEW."locationId" IS DISTINCT FROM OLD."locationId" THEN
    IF EXISTS(SELECT 1 FROM "Sale" WHERE "appointmentId"=NEW.id) THEN RAISE EXCEPTION 'Conto collegato: sede e settore non modificabili' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='INSERT' OR (NEW.status NOT IN ('cancelled','no_show','completed') AND OLD.status IN ('cancelled','no_show','completed')) OR (NEW."startsAt",NEW."endsAt",NEW."collaboratorId",NEW."roomId",NEW."serviceId") IS DISTINCT FROM (OLD."startsAt",OLD."endsAt",OLD."collaboratorId",OLD."roomId",OLD."serviceId") THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."tenantId",7));
    IF NOT EXISTS(SELECT 1 FROM "Sector" s JOIN "Location" l ON l.id=s."locationId" WHERE s.id=NEW."sectorId" AND s."isActive" AND l."isActive") THEN RAISE EXCEPTION 'Sede o settore disattivati' USING ERRCODE='23514'; END IF;
    IF NEW."collaboratorId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "CollaboratorSector" WHERE "collaboratorId"=NEW."collaboratorId" AND "sectorId"=NEW."sectorId") THEN RAISE EXCEPTION 'Professionista non abilitato al settore' USING ERRCODE='23514'; END IF;
    IF NEW."roomId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Room" WHERE id=NEW."roomId" AND "sectorId"=NEW."sectorId" AND "tenantId"=NEW."tenantId" AND "isActive") THEN RAISE EXCEPTION 'Risorsa di un altro settore' USING ERRCODE='23514'; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM "SaleItem" i JOIN "Sale" s ON s.id=i."saleId" WHERE i.id=NEW."orderItemId" AND s."orderStatus"='cancelled') AND
    (TG_OP='INSERT' OR (to_jsonb(NEW)-'updatedAt'-'updatedById') IS DISTINCT FROM (to_jsonb(OLD)-'updatedAt'-'updatedById'))
  THEN RAISE EXCEPTION 'La prenotazione annullata conserva lo storico' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.status IN ('cancelled','no_show') AND NEW.status NOT IN ('cancelled','no_show') AND EXISTS(SELECT 1 FROM "AppointmentCancellation" WHERE "appointmentId"=NEW.id)
  THEN RAISE EXCEPTION 'La riattivazione richiede una nuova pianificazione esplicita' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION alora_appointment_resources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_row "Appointment"; before_buffer integer; after_buffer integer;
BEGIN
 IF TG_OP='UPDATE' AND
    (NEW."startsAt",NEW."endsAt",NEW."collaboratorId",NEW."roomId",NEW."serviceId") IS NOT DISTINCT FROM (OLD."startsAt",OLD."endsAt",OLD."collaboratorId",OLD."roomId",OLD."serviceId") AND
    NOT (NEW.status NOT IN ('cancelled','no_show','completed') AND OLD.status IN ('cancelled','no_show','completed'))
 THEN RETURN NULL; END IF;
 -- A deferred event may refer to an earlier version of the same row: validate final state.
 SELECT * INTO current_row FROM "Appointment" WHERE id=NEW.id;
 IF NOT FOUND OR current_row.status IN ('cancelled','no_show','completed') THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(current_row."tenantId",7));
 SELECT "bufferBeforeMinutes","bufferAfterMinutes" INTO before_buffer,after_buffer FROM "Service" WHERE id=current_row."serviceId";
 IF EXISTS(
   SELECT 1 FROM "Appointment" a JOIN "Service" s ON s.id=a."serviceId"
   WHERE a."tenantId"=current_row."tenantId" AND a.id<>current_row.id AND a.status NOT IN ('cancelled','no_show')
    AND current_row."collaboratorId" IS NOT NULL AND a."collaboratorId"=current_row."collaboratorId"
    AND a."startsAt"-s."bufferBeforeMinutes"*interval '1 minute'<current_row."endsAt"+after_buffer*interval '1 minute'
    AND a."endsAt"+s."bufferAfterMinutes"*interval '1 minute'>current_row."startsAt"-before_buffer*interval '1 minute'
 ) OR (current_row."roomId" IS NOT NULL AND NOT alora_room_has_capacity(current_row."roomId",current_row."startsAt"-before_buffer*interval '1 minute',current_row."endsAt"+after_buffer*interval '1 minute',current_row.id))
 THEN RAISE EXCEPTION 'Conflitto appuntamento' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER alora_appointment_resources AFTER INSERT OR UPDATE ON "Appointment" DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION alora_appointment_resources();

CREATE FUNCTION alora_cancelled_sale_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD."orderStatus"='cancelled' AND (
   NEW."orderStatus"<>'cancelled' OR
   (NEW."customerId",NEW."appointmentId",NEW."locationId",NEW.subtotal,NEW."discountTotal",NEW."taxTotal",NEW.total,NEW."orderDiscount") IS DISTINCT FROM
   (OLD."customerId",OLD."appointmentId",OLD."locationId",OLD.subtotal,OLD."discountTotal",OLD."taxTotal",OLD.total,OLD."orderDiscount")
 ) THEN RAISE EXCEPTION 'Il conto annullato conserva righe e valori; incassi e rimborsi restano espliciti' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_cancelled_sale_guard BEFORE UPDATE ON "Sale" FOR EACH ROW EXECUTE FUNCTION alora_cancelled_sale_guard();
CREATE FUNCTION alora_cancelled_order_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid text;
BEGIN
 IF TG_TABLE_NAME='Sale' THEN sid:=NEW.id;
 ELSE SELECT "saleId" INTO sid FROM "SaleItem" WHERE id=NEW."orderItemId"; END IF;
 IF EXISTS(SELECT 1 FROM "Sale" WHERE id=sid AND "orderStatus"='cancelled') AND EXISTS(
   SELECT 1 FROM "Appointment" a JOIN "SaleItem" i ON i.id=a."orderItemId" WHERE i."saleId"=sid AND a.status NOT IN ('cancelled','no_show','completed'))
 THEN RAISE EXCEPTION 'Il conto annullato non mantiene risorse attive' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER alora_cancelled_order_fence AFTER INSERT OR UPDATE ON "Sale" DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION alora_cancelled_order_fence();
CREATE CONSTRAINT TRIGGER alora_cancelled_booking_fence AFTER INSERT OR UPDATE ON "Appointment" DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION alora_cancelled_order_fence();
CREATE FUNCTION alora_cancelled_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid text;
BEGIN
 IF TG_OP='DELETE' THEN sid:=OLD."saleId"; ELSE sid:=NEW."saleId"; END IF;
 IF EXISTS(SELECT 1 FROM "Sale" WHERE id=sid AND "orderStatus"='cancelled') THEN RAISE EXCEPTION 'Righe del conto annullato conservate' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER alora_cancelled_item_guard BEFORE INSERT OR UPDATE OR DELETE ON "SaleItem" FOR EACH ROW EXECUTE FUNCTION alora_cancelled_item_guard();
CREATE FUNCTION alora_booked_appointment_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM "SaleItem" i JOIN "Sale" s ON s.id=i."saleId" WHERE i.id=OLD."orderItemId" AND
   (s."orderStatus"='cancelled' OR EXISTS(SELECT 1 FROM "OrderOperation" WHERE "saleId"=s.id) OR EXISTS(SELECT 1 FROM "PaymentOperation" WHERE "saleId"=s.id)))
 THEN RAISE EXCEPTION 'La prenotazione ha uno storico da conservare: annulla senza eliminare' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER alora_booked_appointment_delete_guard BEFORE DELETE ON "Appointment" FOR EACH ROW EXECUTE FUNCTION alora_booked_appointment_delete_guard();
CREATE TRIGGER alora_cancellation_immutable BEFORE UPDATE OR DELETE ON "AppointmentCancellation" FOR EACH ROW EXECUTE FUNCTION alora_immutable_record();
COMMIT;
