-- Draft configuration only. No historical appointments, scheduled events or grants are inferred.
CREATE TABLE "AppointmentAutomationPolicy" (
  "tenantId" TEXT NOT NULL PRIMARY KEY REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "settings" JSONB NOT NULL CHECK (jsonb_typeof("settings")='object'),
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE FUNCTION alora_automation_policy_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW."updatedByUserId" AND "tenantId"=NEW."tenantId") THEN
   RAISE EXCEPTION 'Policy author belongs to another activity' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."revision"<>OLD."revision"+1) THEN
   RAISE EXCEPTION 'Policy update requires the next revision of the same activity' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_automation_policy_version BEFORE INSERT OR UPDATE ON "AppointmentAutomationPolicy"
 FOR EACH ROW EXECUTE FUNCTION alora_automation_policy_version();
