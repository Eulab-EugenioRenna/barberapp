BEGIN;
-- The agenda corrects its own mistakes: a cancelled, no-show or completed booking can
-- return active (the resource conflict check still runs), and a cancelled account can
-- reopen when one of its bookings is reactivated. Amounts, customer, location and the
-- cancellation records stay exactly as they were: they are history, not state.
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
  -- A booking of a cancelled account is frozen until the account itself is reopened.
  IF EXISTS(SELECT 1 FROM "SaleItem" i JOIN "Sale" s ON s.id=i."saleId" WHERE i.id=NEW."orderItemId" AND s."orderStatus"='cancelled') AND
    (TG_OP='INSERT' OR (to_jsonb(NEW)-'updatedAt'-'updatedById') IS DISTINCT FROM (to_jsonb(OLD)-'updatedAt'-'updatedById'))
  THEN RAISE EXCEPTION 'La prenotazione annullata conserva lo storico' USING ERRCODE='23514'; END IF;
  -- Reactivation is a plain correction now: the cancellation row stays as history.
  RETURN NEW;
END $$;

-- A cancelled account keeps every value; only its status may go back (reopen).
CREATE OR REPLACE FUNCTION alora_cancelled_sale_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD."orderStatus"='cancelled' AND (
   NEW."orderStatus" NOT IN ('cancelled','open','confirmed') OR
   (NEW."customerId",NEW."appointmentId",NEW."locationId",NEW.subtotal,NEW."discountTotal",NEW."taxTotal",NEW.total,NEW."orderDiscount") IS DISTINCT FROM
   (OLD."customerId",OLD."appointmentId",OLD."locationId",OLD.subtotal,OLD."discountTotal",OLD."taxTotal",OLD.total,OLD."orderDiscount")
 ) THEN RAISE EXCEPTION 'Il conto annullato conserva righe e valori; incassi e rimborsi restano espliciti' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
COMMIT;
