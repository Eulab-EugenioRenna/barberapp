ALTER TABLE "Sale" ADD COLUMN "automationContact" JSONB;
ALTER TABLE "AppointmentAutomationPolicy"
 ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "enabledAt" TIMESTAMP(3),
 ADD COLUMN "whatsappGrantId" TEXT,
 ADD COLUMN "actionGrantId" TEXT,
 ADD COLUMN "staffGrantId" TEXT,
 ADD COLUMN "emailGrantId" TEXT,
 ADD COLUMN "businessNumber" TEXT,
 ADD COLUMN texts JSONB;
CREATE FUNCTION alora_automation_policy_grants() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.enabled THEN
  IF NEW."emailGrantId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "NotificationAutomationGrant" g WHERE g.id=NEW."emailGrantId" AND g."tenantId"=NEW."tenantId" AND g.channel='email' AND g.request->>'purpose'='appointments.automation') THEN RAISE EXCEPTION 'Email automation requires its independent email grant' USING ERRCODE='23514'; END IF;
  IF NEW."enabledAt" IS NULL OR NEW."businessNumber" IS NULL OR NOT EXISTS(SELECT 1 FROM "NotificationAutomationGrant" g WHERE g.id=NEW."whatsappGrantId" AND g."tenantId"=NEW."tenantId" AND g.channel='whatsapp' AND g.status='ready' AND g.request->>'purpose'='appointments.automation') THEN RAISE EXCEPTION 'Active automation requires its activity WhatsApp grant' USING ERRCODE='23514'; END IF;
  IF NEW.settings->>'requestResponse'='true' AND NOT EXISTS(SELECT 1 FROM "NotificationAutomationGrant" g WHERE g.id=NEW."actionGrantId" AND g."tenantId"=NEW."tenantId" AND g.channel='application_notification' AND g.status='ready' AND g.request->>'purpose'='appointments.customer_commands' AND g.request->'functions' ? 'appointments.update.all' AND g.request->'functions' ? 'notifications.manage') THEN RAISE EXCEPTION 'Customer commands require their independent agenda grant' USING ERRCODE='23514'; END IF;
  IF NEW.settings->>'requestResponse'='true' AND NEW.settings->>'noResponseAction'='notify_staff' AND NOT EXISTS(SELECT 1 FROM "NotificationAutomationGrant" g WHERE g.id=NEW."staffGrantId" AND g."tenantId"=NEW."tenantId" AND g.channel='application_notification' AND g.status='ready' AND g.request->>'purpose'='appointments.automation') THEN RAISE EXCEPTION 'Staff notifications require an independent grant' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_automation_policy_grants BEFORE INSERT OR UPDATE ON "AppointmentAutomationPolicy" FOR EACH ROW EXECUTE FUNCTION alora_automation_policy_grants();
ALTER TABLE "OrderOperation" DROP CONSTRAINT "OrderOperation_kind_check";
ALTER TABLE "OrderOperation" ADD CONSTRAINT "OrderOperation_kind_check" CHECK(kind IN ('create_booking','create_sale','update_booking','update_sale','cancel_booking','confirm_booking','request_booking_change','authorize_booking_contact'));
ALTER TABLE "OrderOperation" DROP CONSTRAINT "OrderOperation_source_check";
ALTER TABLE "OrderOperation" ADD CONSTRAINT "OrderOperation_source_check" CHECK(source IN ('internal','public','customer'));
ALTER TABLE "OrderOperation" DROP CONSTRAINT "OrderOperation_source_actor_check";
ALTER TABLE "OrderOperation" ADD CONSTRAINT "OrderOperation_source_actor_check" CHECK(
 (source='internal' AND "actorUserId" IS NOT NULL) OR
 (source='public' AND "actorUserId" IS NULL AND kind='create_booking') OR
 (source='customer' AND "actorUserId" IS NULL AND kind IN ('confirm_booking','request_booking_change','cancel_booking')));
CREATE TABLE "AppointmentAutomationRun" (
 id TEXT NOT NULL PRIMARY KEY,
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE CASCADE,
 "orderId" TEXT NOT NULL REFERENCES "Sale"(id) ON DELETE NO ACTION,
 "customerId" TEXT NOT NULL REFERENCES "Customer"(id) ON DELETE NO ACTION,
 "anchorAppointmentId" TEXT NOT NULL,
 "policyRevision" INTEGER NOT NULL,
 "planHash" TEXT NOT NULL,"contactHash" TEXT NOT NULL,
 "recipientCipher" TEXT NOT NULL,
 "whatsappGrantId" TEXT NOT NULL REFERENCES "NotificationAutomationGrant"(id) ON DELETE NO ACTION,
 "actionGrantId" TEXT REFERENCES "NotificationAutomationGrant"(id) ON DELETE NO ACTION,
 "staffGrantId" TEXT REFERENCES "NotificationAutomationGrant"(id) ON DELETE NO ACTION,
 "archiveId" TEXT NOT NULL,"businessNumber" TEXT NOT NULL,
 "startsAt" TIMESTAMP(3) NOT NULL,"expiresAt" TIMESTAMP(3) NOT NULL,
 snapshot JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','confirmed','change_requested','cancelled','expired','superseded')),
 "responseAction" TEXT CHECK("responseAction" IN ('confirm','change','cancel')),
 "responseEventId" TEXT,"respondedAt" TIMESTAMP(3),
 "reviewedAt" TIMESTAMP(3),"reviewedByUserId" TEXT,
 "staffNoticeAt" TIMESTAMP(3),"staffNoticeReason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 UNIQUE("tenantId","orderId","policyRevision","planHash","contactHash"),
 CHECK("expiresAt"<="startsAt"),CHECK(("responseAction" IS NULL)=("respondedAt" IS NULL))
);
CREATE INDEX "AppointmentAutomationRun_tenantId_status_expiresAt_idx" ON "AppointmentAutomationRun"("tenantId",status,"expiresAt");
CREATE TABLE "AppointmentAutomationAction" (
 "tokenHash" TEXT NOT NULL PRIMARY KEY,
 "runId" TEXT NOT NULL REFERENCES "AppointmentAutomationRun"(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('confirm','change','cancel')),
 UNIQUE("runId",kind)
);
CREATE TABLE "AppointmentAutomationDelivery" (
 "historyId" TEXT NOT NULL PRIMARY KEY REFERENCES "NotificationHistory"(id) ON DELETE NO ACTION,
 "runId" TEXT NOT NULL REFERENCES "AppointmentAutomationRun"(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 0 AND 5),
 "dueAt" TIMESTAMP(3) NOT NULL,"validUntil" TIMESTAMP(3) NOT NULL,"nextAttemptAt" TIMESTAMP(3) NOT NULL,
 UNIQUE("runId",sequence)
);
CREATE INDEX "AppointmentAutomationDelivery_nextAttemptAt_dueAt_idx" ON "AppointmentAutomationDelivery"("nextAttemptAt","dueAt");
CREATE FUNCTION alora_automation_workflow_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME='AppointmentAutomationRun' AND EXISTS(SELECT 1 FROM "Tenant" WHERE id=OLD."tenantId") THEN RAISE EXCEPTION 'Automation run must be retained' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME<>'AppointmentAutomationRun' AND EXISTS(SELECT 1 FROM "AppointmentAutomationRun" r JOIN "Tenant" t ON t.id=r."tenantId" WHERE r.id=OLD."runId") THEN RAISE EXCEPTION 'Automation intent and action must be retained' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_TABLE_NAME='AppointmentAutomationRun' THEN
  IF TG_OP='INSERT' THEN
   IF NOT EXISTS(SELECT 1 FROM "Sale" s WHERE s.id=NEW."orderId" AND s."tenantId"=NEW."tenantId" AND s."customerId"=NEW."customerId") OR NOT EXISTS(SELECT 1 FROM "NotificationAutomationGrant" g WHERE g.id=NEW."whatsappGrantId" AND g."tenantId"=NEW."tenantId" AND g.channel='whatsapp' AND g.request->>'archiveId'=NEW."archiveId") THEN RAISE EXCEPTION 'Automation run belongs to another account or grant' USING ERRCODE='23514'; END IF;
   IF NEW."actionGrantId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "NotificationAutomationGrant" g WHERE g.id=NEW."actionGrantId" AND g."tenantId"=NEW."tenantId" AND g.channel='application_notification' AND g.request->>'purpose'='appointments.customer_commands' AND g.request->'functions' ? 'appointments.update.all' AND g.request->'functions' ? 'notifications.manage') OR NEW."staffGrantId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "NotificationAutomationGrant" g WHERE g.id=NEW."staffGrantId" AND g."tenantId"=NEW."tenantId" AND g.channel='application_notification' AND g.request->>'purpose'='appointments.automation') THEN RAISE EXCEPTION 'Automation action/notice grant belongs to another scope' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='UPDATE' THEN
   IF (NEW.id,NEW."tenantId",NEW."orderId",NEW."customerId",NEW."anchorAppointmentId",NEW."policyRevision",NEW."planHash",NEW."contactHash",NEW."recipientCipher",NEW."whatsappGrantId",NEW."actionGrantId",NEW."staffGrantId",NEW."archiveId",NEW."businessNumber",NEW."startsAt",NEW."expiresAt",NEW.snapshot,NEW."createdAt") IS DISTINCT FROM
      (OLD.id,OLD."tenantId",OLD."orderId",OLD."customerId",OLD."anchorAppointmentId",OLD."policyRevision",OLD."planHash",OLD."contactHash",OLD."recipientCipher",OLD."whatsappGrantId",OLD."actionGrantId",OLD."staffGrantId",OLD."archiveId",OLD."businessNumber",OLD."startsAt",OLD."expiresAt",OLD.snapshot,OLD."createdAt") THEN RAISE EXCEPTION 'Automation plan is immutable' USING ERRCODE='23514'; END IF;
   IF OLD.status<>'waiting' AND NEW.status='waiting' THEN RAISE EXCEPTION 'Closed automation run cannot reopen' USING ERRCODE='23514'; END IF;
   IF OLD."respondedAt" IS NOT NULL AND (NEW."responseAction",NEW."responseEventId",NEW."respondedAt") IS DISTINCT FROM (OLD."responseAction",OLD."responseEventId",OLD."respondedAt") THEN RAISE EXCEPTION 'Customer response cannot be replaced' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='AppointmentAutomationAction' THEN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Action token is immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM "AppointmentAutomationRun" r JOIN "NotificationHistory" h ON h."tenantId"=r."tenantId" WHERE r.id=NEW."runId" AND h.id=NEW."historyId" AND h.channel='whatsapp' AND h."domainEventId" IS NOT NULL) THEN RAISE EXCEPTION 'Automation delivery belongs to another history or activity' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW."historyId",NEW."runId",NEW.sequence,NEW."dueAt",NEW."validUntil") IS DISTINCT FROM (OLD."historyId",OLD."runId",OLD.sequence,OLD."dueAt",OLD."validUntil") THEN RAISE EXCEPTION 'Automation delivery identity is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_automation_run_guard BEFORE INSERT OR UPDATE OR DELETE ON "AppointmentAutomationRun" FOR EACH ROW EXECUTE FUNCTION alora_automation_workflow_guard();
CREATE TRIGGER alora_automation_action_guard BEFORE INSERT OR UPDATE OR DELETE ON "AppointmentAutomationAction" FOR EACH ROW EXECUTE FUNCTION alora_automation_workflow_guard();
CREATE TRIGGER alora_automation_delivery_guard BEFORE INSERT OR UPDATE OR DELETE ON "AppointmentAutomationDelivery" FOR EACH ROW EXECUTE FUNCTION alora_automation_workflow_guard();
