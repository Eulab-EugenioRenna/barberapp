BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM "Appointment" a JOIN "SaleItem" i ON i.id=a."orderItemId" JOIN "Sale" s ON s.id=i."saleId" WHERE a.id='__order_unbilled' AND s."orderStatus"='open' AND s."paymentStatus"='unpaid' AND i."lineTotal"=17.13 AND i."collaboratorId" IS NULL)
 THEN RAISE EXCEPTION 'Unbilled history not preserved'; END IF;
 IF (SELECT "orderItemId" FROM "Appointment" WHERE id='__order_linked')<>'__order_linked_sale_line' THEN RAISE EXCEPTION 'Unique link not acquired'; END IF;
 IF (SELECT "orderIssue" FROM "Appointment" WHERE id='__order_duplicate')<>'multiple-sales' THEN RAISE EXCEPTION 'Duplicates not flagged'; END IF;
 IF (SELECT count(*) FROM "Sale" WHERE "appointmentId"='__order_duplicate')<>2 THEN RAISE EXCEPTION 'Duplicate history mutated'; END IF;
 IF (SELECT count(*) FROM "Appointment" WHERE id IN ('__order_multi_line','__order_no_match') AND "orderIssue"='ambiguous-or-missing-service-line' AND "orderItemId" IS NULL)<>2 THEN RAISE EXCEPTION 'Ambiguous lines automatically selected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "Sale" WHERE id='__order_autonomous' AND "appointmentId" IS NULL AND total=10.01) THEN RAISE EXCEPTION 'Standalone sale altered'; END IF;
END $$;
SELECT 'PASS:unbilled-unpaid-deterministic-order-and-unique-existing-link';
SELECT 'PASS:duplicate-and-ambiguous-history-preserved-with-explicit-issues';
SELECT 'PASS:standalone-sales-and-historical-totals-preserved';
DO $$ BEGIN
 BEGIN
  UPDATE "Sale" SET "customerId"=NULL WHERE id='__order_linked_sale';
  SET CONSTRAINTS alora_order_sale_fence IMMEDIATE;
  RAISE EXCEPTION 'Expected customer/booking fence rejection';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
  UPDATE "SaleItem" SET "serviceId"=NULL WHERE id='__order_linked_sale_line';
  SET CONSTRAINTS alora_order_item_fence IMMEDIATE;
  RAISE EXCEPTION 'Expected service/booking fence rejection';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
SELECT 'PASS:deferred-customer-and-booked-line-fences-reject-incompatible-writes';
ROLLBACK;
