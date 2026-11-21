BEGIN;
CREATE TABLE "OrderOperation" (
 id TEXT PRIMARY KEY,
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "saleId" TEXT NOT NULL REFERENCES "Sale"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "actorUserId" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "idempotencyKey" TEXT NOT NULL CHECK ("idempotencyKey" ~ '^[A-Za-z0-9._:-]{8,128}$'),
 fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 kind TEXT NOT NULL CHECK (kind IN ('create_booking','create_sale','cancel_booking')),
 source TEXT NOT NULL CHECK (source IN ('internal','public')),
 result JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "OrderOperation_source_actor_check" CHECK (
  (source='internal' AND "actorUserId" IS NOT NULL) OR
  (source='public' AND "actorUserId" IS NULL AND kind='create_booking'))
);
CREATE UNIQUE INDEX "OrderOperation_tenantId_idempotencyKey_key" ON "OrderOperation"("tenantId","idempotencyKey");
CREATE INDEX "OrderOperation_tenantId_saleId_createdAt_idx" ON "OrderOperation"("tenantId","saleId","createdAt");
CREATE FUNCTION alora_order_operation_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW."tenantId",7));
 IF NOT EXISTS(SELECT 1 FROM "Sale" WHERE id=NEW."saleId" AND "tenantId"=NEW."tenantId") THEN
  RAISE EXCEPTION 'Comando su conto fuori azienda' USING ERRCODE='23514'; END IF;
 IF NEW."actorUserId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."actorUserId" AND "tenantId"=NEW."tenantId") THEN
  RAISE EXCEPTION 'Autore comando fuori azienda' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_order_operation_scope BEFORE INSERT ON "OrderOperation" FOR EACH ROW EXECUTE FUNCTION alora_order_operation_scope();
CREATE TRIGGER alora_order_operation_immutable BEFORE UPDATE OR DELETE ON "OrderOperation" FOR EACH ROW EXECUTE FUNCTION alora_immutable_record();
COMMIT;
