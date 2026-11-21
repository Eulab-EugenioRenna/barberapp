BEGIN;
INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('__fulfil_sql','Fulfilment fixtures','__fulfil_sql',now());
INSERT INTO "User" (id,"tenantId",email,"passwordHash","firstName","lastName",role,"updatedAt") VALUES ('__fulfil_actor','__fulfil_sql','fulfilment@example.invalid','unusable','Synthetic','Actor','owner',now());
INSERT INTO "Customer" (id,"tenantId","firstName","lastName","updatedAt") VALUES ('__fulfil_customer','__fulfil_sql','Synthetic','Customer',now());
INSERT INTO "Service" (id,"tenantId",name,"durationMinutes","basePrice","requiresCollaborator") VALUES ('__fulfil_service','__fulfil_sql','Service',30,10,false);
INSERT INTO "Appointment" (id,"tenantId","customerId","serviceId","startsAt","endsAt",status,"updatedAt") VALUES ('__fulfil_booking','__fulfil_sql','__fulfil_customer','__fulfil_service','2041-01-04T10:00:00Z','2041-01-04T10:30:00Z','cancelled',now());
INSERT INTO "Sale" (id,"tenantId","customerId","appointmentId",subtotal,total,"orderStatus") VALUES ('__fulfil_sale','__fulfil_sql','__fulfil_customer','__fulfil_booking',10,10,'open');
INSERT INTO "SaleItem" (id,"saleId","serviceId",label,quantity,"unitPrice","lineTotal","stockState") VALUES ('__fulfil_line','__fulfil_sale','__fulfil_service','Service',1,10,10,'pending');
UPDATE "Appointment" SET "orderItemId"='__fulfil_line' WHERE id='__fulfil_booking';
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ DECLARE failed boolean:=false; BEGIN
 BEGIN UPDATE "Sale" SET "orderStatus"='confirmed' WHERE id='__fulfil_sale'; EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Cancelled service charged without explicit declaration'; END IF;
 IF (SELECT "nonPerformanceChargeReason" FROM "SaleItem" WHERE id='__fulfil_line') IS NOT NULL THEN RAISE EXCEPTION 'Charge declaration inferred'; END IF;
END $$;
UPDATE "SaleItem" SET "unitPrice"=0,"lineTotal"=0 WHERE id='__fulfil_line';
UPDATE "Sale" SET subtotal=0,total=0,"orderStatus"='confirmed' WHERE id='__fulfil_sale';
UPDATE "Sale" SET "orderStatus"='open' WHERE id='__fulfil_sale';
UPDATE "SaleItem" SET "unitPrice"=10,"lineTotal"=10,"nonPerformanceChargeReason"='Quota concordata esplicitamente nella prova' WHERE id='__fulfil_line';
UPDATE "Sale" SET subtotal=10,total=10,"orderStatus"='confirmed' WHERE id='__fulfil_sale';
SELECT 'PASS:partial-cancellation-checkout-requires-explicit-charge-reason-or-zero-amount';
DO $$ DECLARE failed boolean:=false; BEGIN
 BEGIN UPDATE "SaleItem" SET "nonPerformanceChargeReason"='x' WHERE id='__fulfil_line'; EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Invalid reason accepted'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "OrderPriceRevision" WHERE "saleItemId"='__fulfil_line' AND snapshot->>'nonPerformanceChargeReason'='Quota concordata esplicitamente nella prova') THEN RAISE EXCEPTION 'Charge reason missing from immutable row history'; END IF;
END $$;
SELECT 'PASS:nonperformance-charge-reason-is-explicit-and-preserved-in-row-history';
INSERT INTO "Product" (id,"tenantId",name,"stockTracked") VALUES ('__fulfil_product','__fulfil_sql','Consumed product',true);
INSERT INTO "InventoryOperation" (id,"tenantId","actorUserId","idempotencyKey",fingerprint,kind,reason) VALUES ('__fulfil_stock_operation','__fulfil_sql','__fulfil_actor','fulfilment-sql-stock',repeat('a',64),'order','Synthetic stock fence check');
DO $$ DECLARE failed boolean; BEGIN
 failed:=false; BEGIN INSERT INTO "StockMovement" (id,"tenantId","operationId","locationId","productId","saleId","saleItemId",kind,"quantityDelta","valueDelta","quantityAfter","valueAfter") SELECT '__fulfil_issue','__fulfil_sql','__fulfil_stock_operation',"locationId",'__fulfil_product',id,'__fulfil_line','consumption',-1,-2,0,0 FROM "Sale" WHERE id='__fulfil_sale'; EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Cancelled service consumed stock'; END IF;
 failed:=false; BEGIN INSERT INTO "StockMovement" (id,"tenantId","operationId","locationId","productId","saleId","saleItemId",kind,"quantityDelta","valueDelta","quantityAfter","valueAfter") SELECT '__fulfil_return','__fulfil_sql','__fulfil_stock_operation',"locationId",'__fulfil_product',id,'__fulfil_line','order_adjust_in',1,2,1,2 FROM "Sale" WHERE id='__fulfil_sale'; EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Cancelled service silently returned stock'; END IF;
END $$;
SELECT 'PASS:nonperformed-services-reject-automatic-consumption-and-automatic-return-writes';
INSERT INTO "OrderOperation" (id,"tenantId","saleId","actorUserId","idempotencyKey",fingerprint,kind,source,result) VALUES ('__fulfil_command','__fulfil_sql','__fulfil_sale','__fulfil_actor','fulfilment-sql-command',repeat('b',64),'update_sale','internal','{}');
DO $$ DECLARE failed boolean:=false; BEGIN
 BEGIN UPDATE "OrderOperation" SET result='{"changed":true}' WHERE id='__fulfil_command'; EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Sale mutation acknowledgement changed'; END IF;
 IF EXISTS(SELECT 1 FROM "PaymentEntry" WHERE "saleId"='__fulfil_sale') OR EXISTS(SELECT 1 FROM "StockMovement" WHERE "saleId"='__fulfil_sale') THEN RAISE EXCEPTION 'Execution or money invented'; END IF;
END $$;
SELECT 'PASS:update-sale-command-uses-existing-immutable-actor-and-account-fences';
ROLLBACK;
