BEGIN;
INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('__command_a','Command A','__command_a',now()),('__command_b','Command B','__command_b',now());
INSERT INTO "User" (id,"tenantId",email,"passwordHash","firstName","lastName",role,"updatedAt") VALUES ('__command_actor','__command_a','command@example.invalid','unusable','Synthetic','Actor','owner',now()),('__command_foreign','__command_b','command-foreign@example.invalid','unusable','Synthetic','Foreign','owner',now());
INSERT INTO "Sale" (id,"tenantId",subtotal,total,"paymentStatus") VALUES ('__command_sale','__command_a',10,10,'unpaid');
INSERT INTO "OrderOperation" (id,"tenantId","saleId","actorUserId","idempotencyKey",fingerprint,kind,source,result) VALUES ('__command_operation','__command_a','__command_sale','__command_actor','fixture-command',repeat('a',64),'create_booking','internal','{}');
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ DECLARE failed boolean; BEGIN
 failed:=false; BEGIN UPDATE "OrderOperation" SET result='{"changed":true}' WHERE id='__command_operation'; EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Acknowledgement mutated'; END IF;
 failed:=false; BEGIN DELETE FROM "OrderOperation" WHERE id='__command_operation'; EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Command deleted'; END IF;
 failed:=false; BEGIN DELETE FROM "Sale" WHERE id='__command_sale'; EXCEPTION WHEN foreign_key_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Acknowledged account deleted'; END IF;
END $$;
SELECT 'PASS:command-acknowledgement-and-account-preserved';
DO $$ DECLARE failed boolean; BEGIN
 failed:=false; BEGIN INSERT INTO "OrderOperation" (id,"tenantId","saleId","actorUserId","idempotencyKey",fingerprint,kind,source,result) VALUES ('foreign_sale','__command_b','__command_sale','__command_foreign','fixture-foreign-sale',repeat('a',64),'create_booking','internal','{}'); EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Foreign account accepted'; END IF;
 failed:=false; BEGIN INSERT INTO "OrderOperation" (id,"tenantId","saleId","actorUserId","idempotencyKey",fingerprint,kind,source,result) VALUES ('foreign_actor','__command_a','__command_sale','__command_foreign','fixture-foreign-actor',repeat('a',64),'create_booking','internal','{}'); EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Foreign actor accepted'; END IF;
 failed:=false; BEGIN INSERT INTO "OrderOperation" (id,"tenantId","saleId","actorUserId","idempotencyKey",fingerprint,kind,source,result) VALUES ('bad_source','__command_a','__command_sale','__command_actor','fixture-bad-source',repeat('a',64),'create_booking','public','{}'); EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Public actor spoof accepted'; END IF;
END $$;
SELECT 'PASS:command-company-actor-and-source-fences';
DO $$ DECLARE failed boolean:=false; BEGIN
 BEGIN INSERT INTO "OrderOperation" (id,"tenantId","saleId","actorUserId","idempotencyKey",fingerprint,kind,source,result) VALUES ('duplicate','__command_a','__command_sale','__command_actor','fixture-command',repeat('b',64),'create_booking','internal','{}'); EXCEPTION WHEN unique_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Command key reused'; END IF;
END $$;
SELECT 'PASS:command-idempotency-key-unique-within-company';
ROLLBACK;
