-- Explicit consumer commands only. No historical messages, recipients or account changes are inferred.
CREATE TABLE "NotificationAutomationCommand" (
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "commandId" TEXT NOT NULL,
 "grantId" TEXT NOT NULL REFERENCES "NotificationAutomationGrant"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
 "inputHash" TEXT NOT NULL CHECK (length("inputHash")=64),
 "payloadCipher" TEXT NOT NULL,
 "sendStartedAt" TIMESTAMP(3),
 "withdrawRequestedAt" TIMESTAMP(3),"withdrawResolvedAt" TIMESTAMP(3),
 "withdrawOutcome" TEXT CHECK ("withdrawOutcome" IN ('withdrawn','already_terminal','effect_started')),
 "receiptId" TEXT,"lastReceipt" JSONB,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY("tenantId","commandId"),
 CHECK (("withdrawResolvedAt" IS NULL)=("withdrawOutcome" IS NULL)),
 CHECK ("withdrawResolvedAt" IS NULL OR "withdrawRequestedAt" IS NOT NULL),
 CHECK (("receiptId" IS NULL)=("lastReceipt" IS NULL)),
 CHECK ("lastReceipt" IS NULL OR coalesce((jsonb_typeof("lastReceipt")='object' AND "lastReceipt"->>'id'="receiptId" AND "lastReceipt"->>'state' IN ('queued','sending','sent','failed','uncertain','cancelled')),false))
);
CREATE INDEX "NotificationAutomationCommand_withdrawResolvedAt_nextAttemptAt_idx" ON "NotificationAutomationCommand"("withdrawResolvedAt","nextAttemptAt");
CREATE FUNCTION alora_automation_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM "Tenant" WHERE id=OLD."tenantId") THEN RAISE EXCEPTION 'Automation command receipt must be preserved' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "NotificationAutomationGrant" g WHERE g.id=NEW."grantId" AND g."tenantId"=NEW."tenantId" AND g.channel='whatsapp') THEN
  RAISE EXCEPTION 'Automation command belongs to another grant or activity' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW."tenantId",NEW."commandId",NEW."grantId",NEW."inputHash",NEW."payloadCipher",NEW."createdAt") IS DISTINCT FROM (OLD."tenantId",OLD."commandId",OLD."grantId",OLD."inputHash",OLD."payloadCipher",OLD."createdAt") THEN
   RAISE EXCEPTION 'Original automation command is immutable' USING ERRCODE='23514'; END IF;
  IF OLD."sendStartedAt" IS NOT NULL AND NEW."sendStartedAt" IS DISTINCT FROM OLD."sendStartedAt" OR OLD."withdrawRequestedAt" IS NOT NULL AND NEW."withdrawRequestedAt" IS DISTINCT FROM OLD."withdrawRequestedAt" OR OLD."withdrawResolvedAt" IS NOT NULL AND (NEW."withdrawResolvedAt",NEW."withdrawOutcome") IS DISTINCT FROM (OLD."withdrawResolvedAt",OLD."withdrawOutcome") THEN
   RAISE EXCEPTION 'Automation attempt and withdrawal cannot restart' USING ERRCODE='23514'; END IF;
  IF OLD."receiptId" IS NOT NULL AND NEW."receiptId" IS DISTINCT FROM OLD."receiptId" THEN RAISE EXCEPTION 'Automation receipt identity is immutable' USING ERRCODE='23514'; END IF;
  IF OLD."lastReceipt"->>'state' IN ('sent','failed','cancelled') AND NEW."lastReceipt" IS DISTINCT FROM OLD."lastReceipt" THEN RAISE EXCEPTION 'Terminal automation receipt cannot regress' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_automation_command_guard BEFORE INSERT OR UPDATE OR DELETE ON "NotificationAutomationCommand" FOR EACH ROW EXECUTE FUNCTION alora_automation_command_guard();
