BEGIN;
-- Availability reads become authoritative only under this shared tenant lock.
-- Fence calendar configuration writes too, including nested schedule replacements.
-- No configuration, booking, identity or historical value is rewritten.
CREATE FUNCTION alora_calendar_configuration_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document jsonb; tid text;
BEGIN
 IF TG_OP='DELETE' THEN document:=to_jsonb(OLD); ELSE document:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='Tenant' THEN tid:=document->>'id';
 ELSIF TG_TABLE_NAME IN ('CollaboratorWeeklySchedule','CollaboratorDayOverride','CollaboratorSector') THEN
  SELECT "tenantId" INTO tid FROM "Collaborator" WHERE id=document->>'collaboratorId';
 ELSE tid:=document->>'tenantId'; END IF;
 IF tid IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(tid,7)); END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['Tenant','Location','Sector','Service','Room','Collaborator','CollaboratorWeeklySchedule','CollaboratorDayOverride','CollaboratorSector','TenantHoliday'] LOOP
  EXECUTE format('CREATE TRIGGER alora_calendar_configuration_lock BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION alora_calendar_configuration_lock()',table_name);
 END LOOP;
END $$;
COMMIT;
