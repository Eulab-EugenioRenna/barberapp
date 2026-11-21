BEGIN;
-- Peak simultaneous occupancy, including buffers. Adjacent half-open intervals do
-- not overlap. This makes reservation validation agree with the whole-booking planner.
CREATE FUNCTION alora_room_has_capacity(room_id text, requested_start timestamp, requested_end timestamp, excluded_id text DEFAULT NULL)
RETURNS boolean LANGUAGE sql VOLATILE AS $$
 WITH intervals AS (
   SELECT a."startsAt"-s."bufferBeforeMinutes"*interval '1 minute' AS starts,
          a."endsAt"+s."bufferAfterMinutes"*interval '1 minute' AS ends
   FROM "Appointment" a JOIN "Service" s ON s.id=a."serviceId"
   WHERE a."roomId"=room_id AND a.status NOT IN ('cancelled','no_show')
     AND (excluded_id IS NULL OR a.id<>excluded_id)
 ), events AS (
   SELECT requested_start AS instant,1 AS delta UNION ALL SELECT requested_end,-1
   UNION ALL SELECT greatest(starts,requested_start),1 FROM intervals WHERE starts<requested_end AND ends>requested_start
   UNION ALL SELECT least(ends,requested_end),-1 FROM intervals WHERE starts<requested_end AND ends>requested_start
 ), changes AS (SELECT instant,sum(delta) AS delta FROM events GROUP BY instant),
 occupancy AS (SELECT sum(delta) OVER(ORDER BY instant) AS used FROM changes)
 SELECT requested_start<requested_end AND coalesce((SELECT max(used) FROM occupancy),0)<=(SELECT capacity FROM "Room" WHERE id=room_id)
$$;
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
  IF TG_OP='UPDATE' AND (NEW."sectorId",NEW."locationId") IS DISTINCT FROM (OLD."sectorId",OLD."locationId") THEN
    IF EXISTS(SELECT 1 FROM "Sale" WHERE "appointmentId"=NEW.id) THEN RAISE EXCEPTION 'Conto collegato: sede e settore non modificabili' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='INSERT' OR (NEW.status NOT IN ('cancelled','no_show','completed') AND OLD.status IN ('cancelled','no_show','completed')) OR (NEW."startsAt",NEW."endsAt",NEW."collaboratorId",NEW."roomId",NEW."serviceId") IS DISTINCT FROM (OLD."startsAt",OLD."endsAt",OLD."collaboratorId",OLD."roomId",OLD."serviceId") THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."tenantId",7));
    IF NOT EXISTS(SELECT 1 FROM "Sector" s JOIN "Location" l ON l.id=s."locationId" WHERE s.id=NEW."sectorId" AND s."isActive" AND l."isActive") THEN RAISE EXCEPTION 'Sede o settore disattivati' USING ERRCODE='23514'; END IF;
    IF NEW."collaboratorId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "CollaboratorSector" WHERE "collaboratorId"=NEW."collaboratorId" AND "sectorId"=NEW."sectorId") THEN RAISE EXCEPTION 'Professionista non abilitato al settore' USING ERRCODE='23514'; END IF;
    IF NEW."roomId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Room" WHERE id=NEW."roomId" AND "sectorId"=NEW."sectorId" AND "tenantId"=NEW."tenantId" AND "isActive") THEN RAISE EXCEPTION 'Risorsa di un altro settore' USING ERRCODE='23514'; END IF;
    -- Serialize booking writes per tenant, including professionals shared by locations.

    IF NEW.status NOT IN ('cancelled','no_show','completed') AND EXISTS(
      SELECT 1 FROM "Appointment" a JOIN "Service" s ON s.id=a."serviceId" JOIN "Service" ns ON ns.id=NEW."serviceId"
      WHERE a."tenantId"=NEW."tenantId" AND a.id<>NEW.id AND a.status NOT IN ('cancelled','no_show')
      AND ((NEW."collaboratorId" IS NOT NULL AND a."collaboratorId"=NEW."collaboratorId") OR (NEW."roomId" IS NOT NULL AND a."roomId"=NEW."roomId" AND
        NOT alora_room_has_capacity(NEW."roomId",
          NEW."startsAt"-ns."bufferBeforeMinutes"*interval '1 minute',
          NEW."endsAt"+ns."bufferAfterMinutes"*interval '1 minute',NEW.id)))
      AND a."startsAt" - s."bufferBeforeMinutes"*interval '1 minute' < NEW."endsAt" + ns."bufferAfterMinutes"*interval '1 minute'
      AND a."endsAt" + s."bufferAfterMinutes"*interval '1 minute' > NEW."startsAt" - ns."bufferBeforeMinutes"*interval '1 minute'
    ) THEN RAISE EXCEPTION 'Conflitto appuntamento' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;

-- A capacity change cannot invalidate already reserved future work.
CREATE FUNCTION alora_room_capacity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE peak numeric; now_utc timestamp:=CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
BEGIN
 IF NEW.capacity>=OLD.capacity THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW."tenantId",7));
 WITH intervals AS (
   SELECT greatest(a."startsAt"-s."bufferBeforeMinutes"*interval '1 minute',now_utc) AS starts,
          a."endsAt"+s."bufferAfterMinutes"*interval '1 minute' AS ends
   FROM "Appointment" a JOIN "Service" s ON s.id=a."serviceId"
   WHERE a."roomId"=NEW.id AND a.status NOT IN ('cancelled','no_show')
     AND a."endsAt"+s."bufferAfterMinutes"*interval '1 minute'>now_utc
 ), events AS (SELECT starts AS instant,1 AS delta FROM intervals UNION ALL SELECT ends,-1 FROM intervals),
 changes AS (SELECT instant,sum(delta) AS delta FROM events GROUP BY instant),
 occupancy AS (SELECT sum(delta) OVER(ORDER BY instant) AS used FROM changes)
 SELECT coalesce(max(used),0) INTO peak FROM occupancy;
 IF peak>NEW.capacity THEN RAISE EXCEPTION 'La capienza richiesta invalida prenotazioni future: riassegna prima le risorse' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_room_capacity_guard BEFORE UPDATE OF capacity ON "Room" FOR EACH ROW EXECUTE FUNCTION alora_room_capacity_guard();

COMMIT;
