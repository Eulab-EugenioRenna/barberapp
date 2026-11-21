BEGIN;
INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('__mutation_sql','Mutation fixtures','__mutation_sql',now());
INSERT INTO "Customer" (id,"tenantId","firstName","lastName","updatedAt") VALUES ('__mutation_customer','__mutation_sql','Synthetic','Customer',now());
INSERT INTO "Room" (id,"tenantId",name,capacity) VALUES ('__mutation_room','__mutation_sql','Capacity one',1);
INSERT INTO "Service" (id,"tenantId",name,"durationMinutes","basePrice","requiresCollaborator","requiresRoom") VALUES ('__mutation_service','__mutation_sql','Booked',30,10,false,true);
INSERT INTO "Appointment" (id,"tenantId","customerId","serviceId","roomId","startsAt","endsAt",status,"updatedAt") VALUES
 ('__mutation_one','__mutation_sql','__mutation_customer','__mutation_service','__mutation_room','2038-01-04T10:00:00Z','2038-01-04T10:30:00Z','confirmed',now()),
 ('__mutation_two','__mutation_sql','__mutation_customer','__mutation_service','__mutation_room','2038-01-04T11:00:00Z','2038-01-04T11:30:00Z','confirmed',now());
DO $$ DECLARE failed boolean:=false; BEGIN
 BEGIN UPDATE "Appointment" SET "startsAt"='2038-01-04T11:00:00Z',"endsAt"='2038-01-04T11:30:00Z' WHERE id='__mutation_one'; EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Ordinary immediate resource conflict accepted'; END IF;
END $$;
SET CONSTRAINTS alora_appointment_resources DEFERRED;
UPDATE "Appointment" SET "startsAt"='2038-01-04T11:00:00Z',"endsAt"='2038-01-04T11:30:00Z' WHERE id='__mutation_one';
UPDATE "Appointment" SET "startsAt"='2038-01-04T10:00:00Z',"endsAt"='2038-01-04T10:30:00Z' WHERE id='__mutation_two';
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'PASS:ordinary-conflicts-stay-immediate-and-coordinated-resource-swap-preserves-row-ids';
DO $$ DECLARE failed boolean:=false; BEGIN
 BEGIN
  SET CONSTRAINTS alora_appointment_resources DEFERRED;
  UPDATE "Appointment" SET "startsAt"='2038-01-04T11:00:00Z',"endsAt"='2038-01-04T11:30:00Z' WHERE id='__mutation_two';
  SET CONSTRAINTS ALL IMMEDIATE;
 EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed OR (SELECT "startsAt" FROM "Appointment" WHERE id='__mutation_two')<>'2038-01-04T10:00:00Z' THEN RAISE EXCEPTION 'Deferred invalid final schedule not rolled back'; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT 'PASS:deferring-resource-constraint-never-bypasses-invalid-final-state';
INSERT INTO "Sale" (id,"tenantId","customerId","appointmentId",subtotal,total,"orderStatus") VALUES ('__mutation_sale','__mutation_sql','__mutation_customer','__mutation_one',20,20,'open');
INSERT INTO "SaleItem" (id,"saleId","serviceId",label,quantity,"unitPrice","lineTotal") VALUES ('__mutation_line_one','__mutation_sale','__mutation_service','Booked',1,10,10),('__mutation_line_two','__mutation_sale','__mutation_service','Booked',1,10,10);
UPDATE "Appointment" SET "orderItemId"=CASE id WHEN '__mutation_one' THEN '__mutation_line_one' ELSE '__mutation_line_two' END WHERE id IN ('__mutation_one','__mutation_two');
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ DECLARE failed boolean:=false; BEGIN
 BEGIN UPDATE "Sale" SET "orderStatus"='cancelled' WHERE id='__mutation_sale'; EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Cancelled account retains live resources'; END IF;
END $$;
UPDATE "Appointment" SET status='cancelled' WHERE id IN ('__mutation_one','__mutation_two');
INSERT INTO "AppointmentCancellation" (id,"appointmentId","cancelledByType",reason,"policyResult") VALUES ('__mutation_cancel','__mutation_one','staff','Synthetic cancellation','operator_recorded');
UPDATE "Sale" SET "orderStatus"='cancelled' WHERE id='__mutation_sale';
DO $$ DECLARE failed boolean; BEGIN
 failed:=false; BEGIN UPDATE "Sale" SET "orderStatus"='open' WHERE id='__mutation_sale'; EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Cancelled account reactivated'; END IF;
 failed:=false; BEGIN UPDATE "SaleItem" SET "lineTotal"=0 WHERE id='__mutation_line_one'; EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Cancelled value mutated'; END IF;
 failed:=false; BEGIN UPDATE "Appointment" SET status='confirmed' WHERE id='__mutation_one'; EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Cancelled booking reactivated'; END IF;
 failed:=false; BEGIN DELETE FROM "Appointment" WHERE id='__mutation_one'; EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Cancelled booking deleted'; END IF;
 failed:=false; BEGIN DELETE FROM "AppointmentCancellation" WHERE id='__mutation_cancel'; EXCEPTION WHEN check_violation THEN failed:=true; END; IF NOT failed THEN RAISE EXCEPTION 'Cancellation history deleted'; END IF;
END $$;
SELECT 'PASS:cancelled-bookings-lines-values-and-cancellation-records-cannot-be-reopened-or-deleted';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM "PaymentEntry" WHERE "saleId"='__mutation_sale') OR EXISTS(SELECT 1 FROM "StockMovement" WHERE "saleId"='__mutation_sale') OR (SELECT total FROM "Sale" WHERE id='__mutation_sale')<>20 THEN RAISE EXCEPTION 'Cancellation invented money or physical stock'; END IF;
END $$;
SELECT 'PASS:cancellation-keeps-original-account-value-without-inferring-refund-or-stock-return';
ROLLBACK;
