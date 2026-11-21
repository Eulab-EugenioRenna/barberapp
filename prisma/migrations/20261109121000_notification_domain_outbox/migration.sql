-- Additive: no historical event, recipient, delivery, or retry is inferred.
CREATE TABLE "NotificationDomainEvent" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tenantId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "actorUserId" TEXT,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  CONSTRAINT "NotificationDomainEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationDomainEvent_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationDomainEvent_valid" CHECK (
    length("eventKey") BETWEEN 8 AND 200 AND length("eventType") BETWEEN 1 AND 120
    AND "attemptCount" >= 0 AND jsonb_typeof("payload") = 'object'
    AND "payload"->>'tenantId' IS NOT DISTINCT FROM "tenantId"
    AND "payload"->>'eventType' IS NOT DISTINCT FROM "eventType"
    AND "payload"->>'entityType' IS NOT DISTINCT FROM "entityType"
    AND "payload"->>'entityId' IS NOT DISTINCT FROM "entityId"
  )
);
CREATE UNIQUE INDEX "NotificationDomainEvent_tenantId_eventKey_key" ON "NotificationDomainEvent"("tenantId","eventKey");
CREATE INDEX "NotificationDomainEvent_processedAt_nextAttemptAt_createdAt_idx" ON "NotificationDomainEvent"("processedAt","nextAttemptAt","createdAt");
ALTER TABLE "NotificationHistory"
  ADD COLUMN "domainEventId" TEXT,
  ADD COLUMN "dispatchKey" TEXT,
  ADD COLUMN "dispatchToken" TEXT,
  ADD COLUMN "dispatchLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "retrySafe" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NotificationHistory" ADD CONSTRAINT "NotificationHistory_domainEventId_fkey"
  FOREIGN KEY ("domainEventId") REFERENCES "NotificationDomainEvent"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE UNIQUE INDEX "NotificationHistory_domainEventId_dispatchKey_key" ON "NotificationHistory"("domainEventId","dispatchKey");
CREATE INDEX "NotificationHistory_status_nextRetryAt_idx" ON "NotificationHistory"("status","nextRetryAt");

CREATE FUNCTION alora_notification_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW."id",NEW."tenantId",NEW."eventKey",NEW."eventType",NEW."entityType",NEW."entityId",NEW."actorUserId",NEW."payload",NEW."createdAt")
     IS DISTINCT FROM
    (OLD."id",OLD."tenantId",OLD."eventKey",OLD."eventType",OLD."entityType",OLD."entityId",OLD."actorUserId",OLD."payload",OLD."createdAt") THEN
   RAISE EXCEPTION 'Notification domain event content is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD."processedAt" IS NOT NULL AND NEW."processedAt" IS DISTINCT FROM OLD."processedAt" THEN
   RAISE EXCEPTION 'Processed notification event cannot be reopened' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_notification_event_immutable BEFORE UPDATE ON "NotificationDomainEvent"
 FOR EACH ROW EXECUTE FUNCTION alora_notification_event_immutable();

CREATE FUNCTION alora_notification_history_domain_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW."domainEventId" IS NULL) <> (NEW."dispatchKey" IS NULL) THEN
   RAISE EXCEPTION 'Notification delivery identity is incomplete' USING ERRCODE='23514';
 END IF;
 IF NEW."domainEventId" IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM "NotificationDomainEvent" e WHERE e.id=NEW."domainEventId" AND e."tenantId"=NEW."tenantId"
     AND e."eventType"=NEW."eventType"
 ) THEN RAISE EXCEPTION 'Notification delivery belongs to another event or tenant' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD."domainEventId" IS NOT NULL AND
    (NEW."domainEventId",NEW."dispatchKey",NEW."tenantId",NEW."eventType",NEW."channel",NEW."recipientUserId",NEW."customerId",NEW."recipientEmail",NEW."recipientWebhookUrl",NEW."payload",NEW."notificationInboxId")
    IS DISTINCT FROM
    (OLD."domainEventId",OLD."dispatchKey",OLD."tenantId",OLD."eventType",OLD."channel",OLD."recipientUserId",OLD."customerId",OLD."recipientEmail",OLD."recipientWebhookUrl",OLD."payload",OLD."notificationInboxId")
 THEN RAISE EXCEPTION 'Notification delivery content is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW."domainEventId" IS NOT NULL AND EXISTS (
   SELECT 1 FROM "NotificationDomainEvent" WHERE id=NEW."domainEventId" AND "processedAt" IS NOT NULL
 ) THEN RAISE EXCEPTION 'Processed event delivery set is closed' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
   IF OLD.status::text IN ('sent','skipped') AND NEW.status IS DISTINCT FROM OLD.status THEN
     RAISE EXCEPTION 'Terminal notification delivery cannot be replayed' USING ERRCODE='23514';
   END IF;
   IF NEW.status::text='dispatching' AND (OLD.status::text='uncertain' OR (OLD.status::text='failed' AND NOT OLD."retrySafe")) THEN
     RAISE EXCEPTION 'Uncertain or unsafe failed delivery cannot be retried' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_notification_history_domain_scope BEFORE INSERT OR UPDATE ON "NotificationHistory"
 FOR EACH ROW EXECUTE FUNCTION alora_notification_history_domain_scope();

ALTER TABLE "NotificationHistory" ADD CONSTRAINT "NotificationHistory_dispatch_lease"
 CHECK (status::text <> 'dispatching' OR ("dispatchToken" IS NOT NULL AND "dispatchLeaseUntil" IS NOT NULL));
ALTER TABLE "NotificationHistory" ADD CONSTRAINT "NotificationHistory_safe_retry"
 CHECK (NOT "retrySafe" OR (status::text='failed' AND "nextRetryAt" IS NOT NULL));
CREATE FUNCTION alora_notification_event_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."payload" #>> '{actor,id}' IS DISTINCT FROM NEW."actorUserId" THEN
   RAISE EXCEPTION 'Notification event actor mismatch' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NEW."actorUserId" IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM "User" u WHERE u.id=NEW."actorUserId" AND u."tenantId"=NEW."tenantId"
 ) THEN RAISE EXCEPTION 'Notification event actor belongs to another tenant' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_notification_event_scope BEFORE INSERT OR UPDATE ON "NotificationDomainEvent"
 FOR EACH ROW EXECUTE FUNCTION alora_notification_event_scope();
CREATE FUNCTION alora_notification_keep_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE protected boolean;
BEGIN
 IF TG_TABLE_NAME='NotificationDomainEvent' THEN protected:=true;
 ELSE protected:=OLD."domainEventId" IS NOT NULL; END IF;
 IF protected AND EXISTS (SELECT 1 FROM "Tenant" WHERE id=OLD."tenantId") THEN
   RAISE EXCEPTION 'Notification intent and delivery history must be preserved' USING ERRCODE='23514';
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER alora_notification_keep_event BEFORE DELETE ON "NotificationDomainEvent"
 FOR EACH ROW EXECUTE FUNCTION alora_notification_keep_history();
CREATE TRIGGER alora_notification_keep_delivery BEFORE DELETE ON "NotificationHistory"
 FOR EACH ROW EXECUTE FUNCTION alora_notification_keep_history();
