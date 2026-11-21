CREATE TABLE "NotificationAutomationWebhook" (
 "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "tenantId" TEXT NOT NULL UNIQUE REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "actorUserId" TEXT NOT NULL,"actorSubject" TEXT NOT NULL,"installationId" TEXT NOT NULL,"appId" TEXT NOT NULL,
 "requestKey" TEXT NOT NULL,"url" TEXT NOT NULL,
 "endpointId" TEXT,"secretCipher" TEXT,
 "status" TEXT NOT NULL DEFAULT 'preparing' CHECK ("status" IN ('preparing','ready','disabled')),
 "lastReceivedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK (("endpointId" IS NULL)=("secretCipher" IS NULL)),
 CHECK ("status"<>'ready' OR "secretCipher" IS NOT NULL)
);
CREATE TABLE "NotificationAutomationWebhookEvent" (
 "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "registrationId" TEXT NOT NULL REFERENCES "NotificationAutomationWebhook"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
 "installationId" TEXT NOT NULL,"eventId" TEXT NOT NULL,"kind" TEXT NOT NULL,"sessionId" TEXT NOT NULL,"bodyHash" TEXT NOT NULL,
 "occurredAt" TIMESTAMP(3) NOT NULL,"receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "status" TEXT NOT NULL CHECK ("status" IN ('received','ignored','processed','rejected')),
 "reason" TEXT,"payloadCipher" TEXT,"processedAt" TIMESTAMP(3),"nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (length("eventId")=36 AND length("bodyHash")=64 AND length("kind") BETWEEN 1 AND 120),
 UNIQUE("installationId","eventId")
);
CREATE INDEX "NotificationAutomationWebhookEvent_status_nextAttemptAt_receivedAt_idx" ON "NotificationAutomationWebhookEvent"("status","nextAttemptAt","receivedAt");
CREATE FUNCTION alora_automation_webhook_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW."actorUserId" AND "tenantId"=NEW."tenantId" AND "connectSubject"=NEW."actorSubject" AND "connectInstallationId"=NEW."installationId") THEN
  RAISE EXCEPTION 'Webhook author belongs to another activity' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.id,NEW."tenantId",NEW."actorUserId",NEW."actorSubject",NEW."installationId",NEW."appId",NEW."requestKey",NEW.url,NEW."createdAt") IS DISTINCT FROM
     (OLD.id,OLD."tenantId",OLD."actorUserId",OLD."actorSubject",OLD."installationId",OLD."appId",OLD."requestKey",OLD.url,OLD."createdAt") THEN
   RAISE EXCEPTION 'Webhook command identity is immutable' USING ERRCODE='23514'; END IF;
  IF OLD."secretCipher" IS NOT NULL AND (NEW."endpointId",NEW."secretCipher") IS DISTINCT FROM (OLD."endpointId",OLD."secretCipher") THEN
   RAISE EXCEPTION 'Webhook credential cannot rotate at replay' USING ERRCODE='23514'; END IF;
  IF OLD.status='disabled' AND NEW.status<>'disabled' THEN RAISE EXCEPTION 'Disabled webhook cannot reopen' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_automation_webhook_guard BEFORE INSERT OR UPDATE ON "NotificationAutomationWebhook" FOR EACH ROW EXECUTE FUNCTION alora_automation_webhook_guard();
CREATE FUNCTION alora_automation_webhook_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "NotificationAutomationWebhook" w WHERE w.id=NEW."registrationId" AND w."tenantId"=NEW."tenantId" AND w."installationId"=NEW."installationId") THEN
  RAISE EXCEPTION 'Webhook receipt belongs to another installation' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW."tenantId",NEW."registrationId",NEW."installationId",NEW."eventId",NEW.kind,NEW."sessionId",NEW."bodyHash",NEW."occurredAt",NEW."receivedAt",NEW."payloadCipher") IS DISTINCT FROM
                      (OLD.id,OLD."tenantId",OLD."registrationId",OLD."installationId",OLD."eventId",OLD.kind,OLD."sessionId",OLD."bodyHash",OLD."occurredAt",OLD."receivedAt",OLD."payloadCipher") THEN
  RAISE EXCEPTION 'Webhook receipt identity and content are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.status<>'received' AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Closed webhook receipt cannot reopen' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_automation_webhook_event_guard BEFORE INSERT OR UPDATE ON "NotificationAutomationWebhookEvent" FOR EACH ROW EXECUTE FUNCTION alora_automation_webhook_event_guard();
CREATE FUNCTION alora_keep_automation_webhook_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "Tenant" WHERE id=OLD."tenantId") THEN RAISE EXCEPTION 'Webhook receipt cannot be deleted while the activity exists' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER alora_keep_automation_webhook_receipt BEFORE DELETE ON "NotificationAutomationWebhookEvent" FOR EACH ROW EXECUTE FUNCTION alora_keep_automation_webhook_receipt();
