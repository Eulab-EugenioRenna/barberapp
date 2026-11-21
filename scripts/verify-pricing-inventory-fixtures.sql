BEGIN;
DO $$ DECLARE lid text; op text; failed boolean; BEGIN
 SELECT id INTO lid FROM "Location" WHERE "tenantId"='__inventory_fixture_a' AND "legacyKey"='initial';
 UPDATE "Product" SET "stockTracked"=true WHERE id='__inventory_fixture_product';
 INSERT INTO "InventoryOperation" (id,"tenantId","idempotencyKey",fingerprint,kind,"actorUserId",reason) VALUES ('__inventory_op','__inventory_fixture_a','fixture-opening-key','fixture','opening','__inventory_fixture_user','Synthetic opening');
 INSERT INTO "StockBalance" (id,"tenantId","locationId","productId") VALUES ('__inventory_balance','__inventory_fixture_a',lid,'__inventory_fixture_product');
 INSERT INTO "StockMovement" (id,"tenantId","operationId","locationId","productId",kind,"quantityDelta","valueDelta","quantityAfter","valueAfter") VALUES ('__inventory_movement','__inventory_fixture_a','__inventory_op',lid,'__inventory_fixture_product','opening',1,5,1,5);
 UPDATE "StockBalance" SET quantity=1,value=5,initialized=true WHERE id='__inventory_balance';
 SET CONSTRAINTS ALL IMMEDIATE;
 BEGIN
  UPDATE "StockBalance" SET quantity=2 WHERE id='__inventory_balance';
  RAISE EXCEPTION 'Unbalanced quantity accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE "StockMovement" SET "valueDelta"=6 WHERE id='__inventory_movement';
  RAISE EXCEPTION 'Movement history mutated';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO "StockBalance" (id,"tenantId","locationId","productId") VALUES ('__inventory_bad','__inventory_fixture_a',lid,'__inventory_fixture_foreign');
  RAISE EXCEPTION 'Cross tenant product accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE "CatalogPriceHistory" SET reason='Changed' WHERE "productId"='__inventory_fixture_product';
  RAISE EXCEPTION 'Price observation mutated';
 EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE "InventoryOperation" SET result='{"done":true}'::jsonb WHERE id='__inventory_op';
 BEGIN
  UPDATE "InventoryOperation" SET reason='Changed' WHERE id='__inventory_op';
  RAISE EXCEPTION 'Finalized operation mutated';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT 'PASS:ledger-and-balance-reconcile-in-one-transaction';
SELECT 'PASS:cross-tenant-stock-and-unbalanced-direct-writes-rejected';
SELECT 'PASS:movement-price-and-finalized-operation-history-immutable';
ROLLBACK;
