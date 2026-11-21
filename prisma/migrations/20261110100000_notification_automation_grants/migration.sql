-- Only new explicit authorization commands. No grant, account or delivery is inferred.
CREATE TABLE "NotificationAutomationGrant" (
 "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "actorUserId" TEXT NOT NULL,
 "actorSubject" TEXT NOT NULL,
 "appId" TEXT NOT NULL,
 "installationId" TEXT NOT NULL,
 "channel" TEXT NOT NULL CHECK ("channel" IN ('whatsapp','application_notification','email')),
 "requestKey" TEXT NOT NULL,
 "requestHash" TEXT NOT NULL,
 "request" JSONB NOT NULL CHECK (jsonb_typeof("request")='object'),
 "sessionId" TEXT,
 "grantId" TEXT,
 "credentialCipher" TEXT,
 "status" TEXT NOT NULL DEFAULT 'preparing' CHECK ("status" IN ('preparing','ready','revocation_pending','revoked')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK (("grantId" IS NULL)=("credentialCipher" IS NULL)),
 CHECK ("status"<>'ready' OR "credentialCipher" IS NOT NULL),
 CHECK (("channel"='whatsapp')=("sessionId" IS NOT NULL)),
 UNIQUE("tenantId","requestKey")
);
CREATE INDEX "NotificationAutomationGrant_tenantId_status_idx" ON "NotificationAutomationGrant"("tenantId","status");
CREATE FUNCTION alora_automation_grant_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW."actorUserId" AND "tenantId"=NEW."tenantId" AND "connectSubject"=NEW."actorSubject" AND "connectInstallationId"=NEW."installationId") THEN
  RAISE EXCEPTION 'Grant author belongs to another activity' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW."tenantId",NEW."actorUserId",NEW."actorSubject",NEW."appId",NEW."installationId",NEW.channel,NEW."requestKey",NEW."requestHash",NEW.request,NEW."sessionId",NEW."createdAt") IS DISTINCT FROM
     (OLD.id,OLD."tenantId",OLD."actorUserId",OLD."actorSubject",OLD."appId",OLD."installationId",OLD.channel,OLD."requestKey",OLD."requestHash",OLD.request,OLD."sessionId",OLD."createdAt") THEN
   RAISE EXCEPTION 'Grant command identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD."credentialCipher" IS NOT NULL AND (NEW."grantId",NEW."credentialCipher") IS DISTINCT FROM (OLD."grantId",OLD."credentialCipher") THEN
   RAISE EXCEPTION 'Grant credential cannot be replaced' USING ERRCODE='23514';
  END IF;
  IF OLD.status='revoked' AND NEW.status<>'revoked' OR OLD.status='revocation_pending' AND NEW.status NOT IN ('revocation_pending','revoked') THEN
   RAISE EXCEPTION 'Revoked authorization cannot reopen' USING ERRCODE='23514';
  END IF;
  IF OLD.status='ready' AND NEW.status='preparing' THEN RAISE EXCEPTION 'Ready grant cannot restart provisioning' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_automation_grant_guard BEFORE INSERT OR UPDATE ON "NotificationAutomationGrant"
 FOR EACH ROW EXECUTE FUNCTION alora_automation_grant_guard();
