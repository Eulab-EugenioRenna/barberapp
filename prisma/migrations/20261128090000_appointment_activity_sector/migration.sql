-- A service of an activity run at several locations is bookable at each of them:
-- the booking sector must be a sector of the service's activity (not only its home sector).
CREATE OR REPLACE FUNCTION alora_appointment_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid text; lid text; aid text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM "Customer" WHERE id=NEW."customerId" AND "tenantId"=NEW."tenantId") THEN RAISE EXCEPTION 'Cliente fuori azienda' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' OR NEW."serviceId" IS DISTINCT FROM OLD."serviceId" THEN
    SELECT "sectorId","activityId" INTO sid, aid FROM "Service" WHERE id=NEW."serviceId" AND "tenantId"=NEW."tenantId";
    IF sid IS NULL THEN RAISE EXCEPTION 'Servizio fuori azienda' USING ERRCODE='23514'; END IF;
    -- The same activity run at another location books there (as localizeServices does):
    -- the given sector must belong to the service's activity; only a location picks
    -- that activity's sector at the location.
    IF NEW."sectorId" IS NOT NULL AND NEW."sectorId"<>sid THEN
      IF NOT EXISTS(SELECT 1 FROM "Sector" WHERE id=NEW."sectorId" AND "tenantId"=NEW."tenantId" AND "activityId"=aid) THEN RAISE EXCEPTION 'Servizio di un altro settore' USING ERRCODE='23514'; END IF;
      sid:=NEW."sectorId";
    ELSIF NEW."sectorId" IS NULL AND NEW."locationId" IS NOT NULL THEN
      SELECT id INTO sid FROM "Sector" WHERE "tenantId"=NEW."tenantId" AND "locationId"=NEW."locationId" AND "activityId"=aid ORDER BY "isActive" DESC, id LIMIT 1;
      IF sid IS NULL THEN RAISE EXCEPTION 'Servizio di un altra sede' USING ERRCODE='23514'; END IF;
    END IF;
    SELECT "locationId" INTO lid FROM "Sector" WHERE id=sid;
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
