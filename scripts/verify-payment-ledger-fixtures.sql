BEGIN;
INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('__payment_a','Payment fixture A','__payment_a',now()),('__payment_b','Payment fixture B','__payment_b',now());
INSERT INTO "User" (id,"tenantId",email,"passwordHash","firstName","lastName",role,"updatedAt") VALUES ('__payment_actor','__payment_a','payment@example.invalid','unusable','Synthetic','Cashier','owner',now()),('__payment_foreign','__payment_b','payment-foreign@example.invalid','unusable','Synthetic','Foreign','owner',now());
INSERT INTO "Sale" (id,"tenantId",subtotal,total,"paymentStatus","paymentBasis") VALUES ('__payment_legacy_paid','__payment_a',100,100,'paid','legacy_unknown'),('__payment_legacy_partial','__payment_a',100,100,'partial','legacy_unknown');
DO $$ DECLARE failed boolean:=false; BEGIN
 IF (SELECT "paymentBasis" FROM "Sale" WHERE id='__payment_legacy_paid')<>'legacy_unknown' THEN RAISE EXCEPTION 'Inferred payment from status'; END IF;
 BEGIN
  INSERT INTO "PaymentOperation"(id,"tenantId","saleId","actorUserId","idempotencyKey",fingerprint,kind,"expectedRevision",result) VALUES ('bad','__payment_a','__payment_legacy_paid','__payment_actor','fixture-receipt',repeat('a',64),'receive',0,'{}');
 EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Unreconciled legacy accepted new payment'; END IF;
END $$;
SELECT 'PASS:legacy-paid-and-partial-do-not-infer-amounts';
INSERT INTO "PaymentOperation"(id,"tenantId","saleId","actorUserId","idempotencyKey",fingerprint,kind,"expectedRevision",reason,result) VALUES ('__payment_open_op','__payment_a','__payment_legacy_paid','__payment_actor','fixture-opening',repeat('a',64),'reconcile',0,'Actual historical opening','{}');
INSERT INTO "PaymentEntry"(id,"tenantId","saleId","operationId",kind,amount) VALUES ('__payment_open','__payment_a','__payment_legacy_paid','__payment_open_op','opening',20);
UPDATE "Sale" SET "paymentBasis"='ledger',revision=1,"paymentStatus"='partial' WHERE id='__payment_legacy_paid';
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ DECLARE failed boolean:=false; BEGIN
 BEGIN UPDATE "Sale" SET "paymentBasis"='ledger' WHERE id='__payment_legacy_partial'; EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Opening-free reconciliation accepted'; END IF;
END $$;
SELECT 'PASS:explicit-opening-keeps-unknown-date-and-no-receipt';
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO "PaymentOperation"(id,"tenantId","saleId","actorUserId","idempotencyKey",fingerprint,kind,"expectedRevision",result) VALUES ('__payment_receive_op','__payment_a','__payment_legacy_paid','__payment_actor','fixture-mixed-pay',repeat('b',64),'receive',1,'{}');
INSERT INTO "PaymentEntry"(id,"tenantId","saleId","operationId",kind,amount,method,"receivedAt") VALUES ('__payment_cash','__payment_a','__payment_legacy_paid','__payment_receive_op','receipt',30,'cash',now()),('__payment_card','__payment_a','__payment_legacy_paid','__payment_receive_op','receipt',50,'card',now());
UPDATE "Sale" SET revision=2,"paymentStatus"='paid',"paymentMethod"='mixed' WHERE id='__payment_legacy_paid';
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'PASS:opening-and-mixed-receipts-reconcile-exactly';
DO $$ DECLARE failed boolean; BEGIN
 failed:=false; BEGIN UPDATE "Sale" SET total=99 WHERE id='__payment_legacy_paid'; EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Underpaid total accepted'; END IF;
 failed:=false; BEGIN UPDATE "Sale" SET "paymentStatus"='unpaid' WHERE id='__payment_legacy_paid'; EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Status-only write accepted'; END IF;
 failed:=false; BEGIN UPDATE "Sale" SET "paymentBasis"='legacy_unknown' WHERE id='__payment_legacy_paid'; EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Ledger downgraded'; END IF;
END $$;
SELECT 'PASS:total-status-and-basis-cannot-diverge-from-ledger';
DO $$ DECLARE failed boolean; BEGIN
 failed:=false; BEGIN UPDATE "PaymentEntry" SET amount=1 WHERE id='__payment_cash'; EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Entry mutated'; END IF;
 failed:=false; BEGIN DELETE FROM "PaymentOperation" WHERE id='__payment_receive_op'; EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Operation deleted'; END IF;
 failed:=false; BEGIN DELETE FROM "Sale" WHERE id='__payment_legacy_paid'; EXCEPTION WHEN foreign_key_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Paid sale deleted'; END IF;
END $$;
SELECT 'PASS:operations-entries-and-financial-account-preserved';
DO $$ DECLARE failed boolean; BEGIN
 failed:=false; BEGIN INSERT INTO "PaymentOperation"(id,"tenantId","saleId","actorUserId","idempotencyKey",fingerprint,kind,"expectedRevision",result) VALUES ('foreign','__payment_b','__payment_legacy_paid','__payment_foreign','fixture-foreign',repeat('a',64),'receive',2,'{}'); EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Cross tenant operation accepted'; END IF;
 failed:=false; BEGIN INSERT INTO "PaymentOperation"(id,"tenantId","saleId","actorUserId","idempotencyKey",fingerprint,kind,"expectedRevision",result) VALUES ('foreign_actor','__payment_a','__payment_legacy_paid','__payment_foreign','fixture-actor',repeat('a',64),'receive',2,'{}'); EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Cross tenant actor accepted'; END IF;
END $$;
SELECT 'PASS:operation-and-actor-company-fences';
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO "PaymentOperation"(id,"tenantId","saleId","actorUserId","idempotencyKey",fingerprint,kind,"expectedRevision",reason,result) VALUES ('__payment_refund_op','__payment_a','__payment_legacy_paid','__payment_actor','fixture-refund',repeat('c',64),'refund',2,'Manual refund declared','{}');
INSERT INTO "PaymentEntry"(id,"tenantId","saleId","operationId",kind,amount,method,"receivedAt","refundOfId") VALUES ('__payment_refund','__payment_a','__payment_legacy_paid','__payment_refund_op','refund',10,'cash',now(),'__payment_cash');
UPDATE "Sale" SET revision=3,"paymentStatus"='partial' WHERE id='__payment_legacy_paid';
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ DECLARE failed boolean:=false; BEGIN
 BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  INSERT INTO "PaymentOperation"(id,"tenantId","saleId","actorUserId","idempotencyKey",fingerprint,kind,"expectedRevision",reason,result) VALUES ('over_refund_op','__payment_a','__payment_legacy_paid','__payment_actor','fixture-over-refund',repeat('d',64),'refund',3,'Invalid extra refund','{}');
  INSERT INTO "PaymentEntry"(id,"tenantId","saleId","operationId",kind,amount,method,"receivedAt","refundOfId") VALUES ('over_refund','__payment_a','__payment_legacy_paid','over_refund_op','refund',21,'cash',now(),'__payment_cash');
  UPDATE "Sale" SET revision=4 WHERE id='__payment_legacy_paid';
  SET CONSTRAINTS ALL IMMEDIATE;
 EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Original receipt over-refunded'; END IF;
END $$;
SELECT 'PASS:refund-cap-includes-all-prior-refunds';
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO "Sale" (id,"tenantId",subtotal,total,"orderStatus","orderOrigin","paymentStatus","paymentBasis") VALUES ('__payment_open_order','__payment_a',50,50,'open','booking','unpaid','ledger');
INSERT INTO "PaymentOperation"(id,"tenantId","saleId","actorUserId","idempotencyKey",fingerprint,kind,"expectedRevision",result) VALUES ('__payment_deposit_op','__payment_a','__payment_open_order','__payment_actor','fixture-deposit',repeat('e',64),'receive',0,'{}');
INSERT INTO "PaymentEntry"(id,"tenantId","saleId","operationId",kind,amount,method,"receivedAt") VALUES ('__payment_deposit','__payment_a','__payment_open_order','__payment_deposit_op','receipt',10,'cash',now());
UPDATE "Sale" SET revision=1,"paymentStatus"='partial',"paymentMethod"='cash' WHERE id='__payment_open_order';
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN IF (SELECT "orderStatus" FROM "Sale" WHERE id='__payment_open_order')<>'open' THEN RAISE EXCEPTION 'Deposit fulfilled order'; END IF; END $$;
SELECT 'PASS:deposit-on-open-account-does-not-confirm-fulfillment';
ROLLBACK;
