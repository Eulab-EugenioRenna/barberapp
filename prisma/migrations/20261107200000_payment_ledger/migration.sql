BEGIN;
-- Preserve every historical state/method; no amount or payment is inferred.
-- Existing rows keep their historical status and unknown amount.
ALTER TABLE "Sale" ADD COLUMN "paymentBasis" TEXT NOT NULL DEFAULT 'legacy_unknown';
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_payment_basis_check" CHECK ("paymentBasis" IN ('legacy_unknown','ledger'));
-- Deposits belong to the same open account, before fulfillment/stock posting.
ALTER TABLE "Sale" DROP CONSTRAINT "Sale_open_payment_check";
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_open_payment_check" CHECK (
 "orderStatus"<>'open' OR "paymentBasis"='ledger' OR ("paymentStatus"='unpaid' AND "paymentMethod" IS NULL));
CREATE TABLE "PaymentOperation" (
 id TEXT PRIMARY KEY,
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "saleId" TEXT NOT NULL REFERENCES "Sale"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "actorUserId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "idempotencyKey" TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('receive','refund','reconcile')),
 "expectedRevision" INTEGER NOT NULL CHECK ("expectedRevision">=0),
 reason TEXT,
 result JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PaymentOperation_key_check" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9._:-]{8,128}$' AND fingerprint ~ '^[a-f0-9]{64}$'),
 CONSTRAINT "PaymentOperation_reason_check" CHECK ((reason IS NULL OR length(btrim(reason)) BETWEEN 3 AND 500) AND (kind='receive' OR reason IS NOT NULL))
);
CREATE UNIQUE INDEX "PaymentOperation_tenantId_idempotencyKey_key" ON "PaymentOperation"("tenantId","idempotencyKey");
CREATE UNIQUE INDEX "PaymentOperation_saleId_expectedRevision_key" ON "PaymentOperation"("saleId","expectedRevision");
CREATE INDEX "PaymentOperation_tenantId_saleId_createdAt_idx" ON "PaymentOperation"("tenantId","saleId","createdAt");
CREATE TABLE "PaymentEntry" (
 id TEXT PRIMARY KEY,
 "tenantId" TEXT NOT NULL REFERENCES "Tenant"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "saleId" TEXT NOT NULL REFERENCES "Sale"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "operationId" TEXT NOT NULL REFERENCES "PaymentOperation"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 kind TEXT NOT NULL CHECK (kind IN ('receipt','refund','opening')),
 amount DECIMAL(10,2) NOT NULL,
 method TEXT,
 "receivedAt" TIMESTAMP(3),
 "refundOfId" TEXT REFERENCES "PaymentEntry"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PaymentEntry_amount_check" CHECK (amount>=0 AND (kind='opening' OR amount>0)),
 CONSTRAINT "PaymentEntry_shape_check" CHECK (
   (kind='opening' AND method IS NULL AND "receivedAt" IS NULL AND "refundOfId" IS NULL)
   OR (kind IN ('receipt','refund') AND method IN ('cash','card','bank','other') AND method IS NOT NULL
       AND "receivedAt" IS NOT NULL AND ((kind='refund')=("refundOfId" IS NOT NULL))))
);
CREATE INDEX "PaymentEntry_tenantId_saleId_createdAt_idx" ON "PaymentEntry"("tenantId","saleId","createdAt");
CREATE INDEX "PaymentEntry_refundOfId_idx" ON "PaymentEntry"("refundOfId");
CREATE UNIQUE INDEX "PaymentEntry_one_opening" ON "PaymentEntry"("saleId") WHERE kind='opening';
CREATE TRIGGER alora_payment_operation_immutable BEFORE UPDATE OR DELETE ON "PaymentOperation" FOR EACH ROW EXECUTE FUNCTION alora_immutable_record();
CREATE TRIGGER alora_payment_entry_immutable BEFORE UPDATE OR DELETE ON "PaymentEntry" FOR EACH ROW EXECUTE FUNCTION alora_immutable_record();

CREATE FUNCTION alora_payment_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "Sale"; op "PaymentOperation"; original "PaymentEntry";
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW."tenantId",7));
 SELECT * INTO s FROM "Sale" WHERE id=NEW."saleId" FOR UPDATE;
 IF s.id IS NULL OR s."tenantId"<>NEW."tenantId" THEN RAISE EXCEPTION 'Conto fuori azienda' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='PaymentOperation' THEN
   IF NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW."actorUserId" AND "tenantId"=NEW."tenantId") THEN
     RAISE EXCEPTION 'Autore fuori azienda' USING ERRCODE='23514'; END IF;
   IF s.revision<>NEW."expectedRevision" THEN RAISE EXCEPTION 'Revisione conto superata' USING ERRCODE='23514'; END IF;
   IF NEW.kind='reconcile' AND (s."paymentBasis"<>'legacy_unknown' OR EXISTS(SELECT 1 FROM "PaymentEntry" WHERE "saleId"=s.id)) THEN
     RAISE EXCEPTION 'Riconciliazione iniziale gia registrata' USING ERRCODE='23514'; END IF;
   IF NEW.kind<>'reconcile' AND s."paymentBasis"<>'ledger' THEN RAISE EXCEPTION 'Riconcilia prima lo storico' USING ERRCODE='23514'; END IF;
 ELSE
   SELECT * INTO op FROM "PaymentOperation" WHERE id=NEW."operationId";
   IF op.id IS NULL OR op."tenantId"<>NEW."tenantId" OR op."saleId"<>NEW."saleId"
     OR (op.kind='receive' AND NEW.kind<>'receipt') OR (op.kind='refund' AND NEW.kind<>'refund') OR (op.kind='reconcile' AND NEW.kind<>'opening') THEN
     RAISE EXCEPTION 'Movimento non coerente con operazione' USING ERRCODE='23514'; END IF;
   IF NEW.kind='refund' THEN
     SELECT * INTO original FROM "PaymentEntry" WHERE id=NEW."refundOfId";
     IF original.id IS NULL OR original."saleId"<>NEW."saleId" OR original."tenantId"<>NEW."tenantId" OR original.kind NOT IN ('receipt','opening') THEN
       RAISE EXCEPTION 'Incasso originale non valido' USING ERRCODE='23514'; END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_payment_operation_scope BEFORE INSERT ON "PaymentOperation" FOR EACH ROW EXECUTE FUNCTION alora_payment_scope();
CREATE TRIGGER alora_payment_entry_scope BEFORE INSERT ON "PaymentEntry" FOR EACH ROW EXECUTE FUNCTION alora_payment_scope();

CREATE FUNCTION alora_payment_reconcile() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid text; s "Sale"; net numeric; refunds numeric; projected text; op "PaymentOperation"; n integer;
BEGIN
 IF TG_TABLE_NAME='Sale' THEN sid:=NEW.id; ELSE sid:=NEW."saleId"; END IF;
 SELECT * INTO s FROM "Sale" WHERE id=sid;
 IF s.id IS NULL THEN RETURN NULL; END IF;
 IF s."paymentBasis"='legacy_unknown' THEN
   IF EXISTS(SELECT 1 FROM "PaymentEntry" WHERE "saleId"=sid) OR EXISTS(SELECT 1 FROM "PaymentOperation" WHERE "saleId"=sid) THEN RAISE EXCEPTION 'Registro presente su storico non riconciliato' USING ERRCODE='23514'; END IF;
   RETURN NULL;
 END IF;
 SELECT coalesce(sum(CASE WHEN kind='refund' THEN -amount ELSE amount END),0),coalesce(sum(amount) FILTER(WHERE kind='refund'),0)
 INTO net,refunds FROM "PaymentEntry" WHERE "saleId"=sid;
 IF net<0 OR net>s.total THEN RAISE EXCEPTION 'Incasso netto fuori totale conto' USING ERRCODE='23514'; END IF;
 projected:=CASE WHEN net=0 THEN CASE WHEN refunds>0 THEN 'refunded' ELSE 'unpaid' END WHEN net=s.total THEN 'paid' ELSE 'partial' END;
 IF s."paymentStatus"::text<>projected THEN RAISE EXCEPTION 'Stato pagamento non riconciliato' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "PaymentEntry" e WHERE e."saleId"=sid AND e.kind IN ('receipt','opening') AND
     e.amount<(SELECT coalesce(sum(r.amount),0) FROM "PaymentEntry" r WHERE r."refundOfId"=e.id)) THEN
   RAISE EXCEPTION 'Rimborso oltre incasso originale' USING ERRCODE='23514'; END IF;
 FOR op IN SELECT * FROM "PaymentOperation" WHERE "saleId"=sid LOOP
   SELECT count(*) INTO n FROM "PaymentEntry" WHERE "operationId"=op.id;
   IF n<1 OR n>10 OR (op.kind='reconcile' AND n<>1) OR s.revision<=op."expectedRevision" THEN
     RAISE EXCEPTION 'Operazione pagamento incompleta' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER alora_payment_sale_reconcile AFTER INSERT OR UPDATE ON "Sale" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alora_payment_reconcile();
CREATE CONSTRAINT TRIGGER alora_payment_entry_reconcile AFTER INSERT ON "PaymentEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alora_payment_reconcile();
CREATE CONSTRAINT TRIGGER alora_payment_operation_reconcile AFTER INSERT ON "PaymentOperation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION alora_payment_reconcile();
-- A ledger cannot be silently reverted to the legacy status-only path.
CREATE FUNCTION alora_payment_basis_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD."paymentBasis"='ledger' AND NEW."paymentBasis"<>'ledger' THEN RAISE EXCEPTION 'Registro incassi non reversibile' USING ERRCODE='23514'; END IF;
 IF OLD."paymentBasis"='legacy_unknown' AND NEW."paymentBasis"='ledger' AND NOT EXISTS(SELECT 1 FROM "PaymentEntry" WHERE "saleId"=NEW.id AND kind='opening') THEN
   RAISE EXCEPTION 'Serve riconciliazione iniziale esplicita' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER alora_payment_basis_guard BEFORE UPDATE ON "Sale" FOR EACH ROW EXECUTE FUNCTION alora_payment_basis_guard();
-- New writers start with known zero receipts; existing rows stay unknown.
ALTER TABLE "Sale" ALTER COLUMN "paymentBasis" SET DEFAULT 'ledger';
COMMIT;
