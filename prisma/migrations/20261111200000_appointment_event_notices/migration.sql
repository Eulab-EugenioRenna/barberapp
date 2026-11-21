ALTER TABLE "AppointmentAutomationDelivery" ALTER COLUMN "runId" DROP NOT NULL;
ALTER TABLE "AppointmentAutomationDelivery" ADD COLUMN "noticeContext" JSONB;
ALTER TABLE "AppointmentAutomationDelivery" ADD CONSTRAINT "AppointmentAutomationDelivery_kind_check" CHECK (("runId" IS NOT NULL AND "noticeContext" IS NULL) OR ("runId" IS NULL AND "noticeContext" IS NOT NULL AND sequence=0));
CREATE INDEX "AppointmentAutomationDelivery_notice_order_idx" ON "AppointmentAutomationDelivery" (("noticeContext"->>'orderId')) WHERE "runId" IS NULL;
-- The existing guard remains authoritative for reminder runs. This companion freezes standalone notices.
CREATE FUNCTION alora_automation_event_notice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD."runId" IS NULL AND EXISTS(SELECT 1 FROM "NotificationHistory" h JOIN "Tenant" t ON t.id=h."tenantId" WHERE h.id=OLD."historyId") THEN RAISE EXCEPTION 'Event notice must be retained' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (NEW."historyId",NEW."runId",NEW.sequence,NEW."dueAt",NEW."validUntil",NEW."noticeContext") IS DISTINCT FROM (OLD."historyId",OLD."runId",OLD.sequence,OLD."dueAt",OLD."validUntil",OLD."noticeContext") THEN RAISE EXCEPTION 'Event notice context is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW."runId" IS NULL AND NOT EXISTS(
  SELECT 1 FROM "NotificationHistory" h JOIN "Sale" s ON s.id=NEW."noticeContext"->>'orderId' AND s."tenantId"=h."tenantId" AND s."customerId"=h."customerId" AND h."customerId"=NEW."noticeContext"->>'customerId'
  JOIN "NotificationAutomationGrant" g ON g.id=NEW."noticeContext"->>'grantId' AND g."tenantId"=h."tenantId" AND g.channel='whatsapp' AND g.request->>'purpose'='appointments.automation'
  JOIN "NotificationDomainEvent" e ON e.id=h."domainEventId" AND e."tenantId"=h."tenantId" AND e."eventType"=h."eventType"
  WHERE h.id=NEW."historyId" AND h.channel='whatsapp' AND h."eventType" IN ('appointment.confirmed','appointment.cancelled') AND h."eventType"=NEW."noticeContext"->>'eventType'
 ) THEN RAISE EXCEPTION 'Event notice belongs to another activity or event' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- The old run guard requires a run on INSERT, so it now applies only to reminder deliveries.
DROP TRIGGER alora_automation_delivery_guard ON "AppointmentAutomationDelivery";
CREATE TRIGGER alora_automation_delivery_guard BEFORE INSERT OR UPDATE ON "AppointmentAutomationDelivery" FOR EACH ROW WHEN (NEW."runId" IS NOT NULL) EXECUTE FUNCTION alora_automation_workflow_guard();
CREATE TRIGGER alora_automation_delivery_delete_guard BEFORE DELETE ON "AppointmentAutomationDelivery" FOR EACH ROW WHEN (OLD."runId" IS NOT NULL) EXECUTE FUNCTION alora_automation_workflow_guard();
CREATE TRIGGER alora_automation_event_notice_guard BEFORE INSERT OR UPDATE OR DELETE ON "AppointmentAutomationDelivery" FOR EACH ROW EXECUTE FUNCTION alora_automation_event_notice_guard();

ALTER TABLE "AppointmentAutomationDelivery" DROP CONSTRAINT "AppointmentAutomationDelivery_historyId_fkey";
ALTER TABLE "AppointmentAutomationDelivery" ADD CONSTRAINT "AppointmentAutomationDelivery_historyId_fkey" FOREIGN KEY ("historyId") REFERENCES "NotificationHistory"(id) ON DELETE CASCADE;
