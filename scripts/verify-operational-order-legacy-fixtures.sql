-- Applied only to disposable pre-migration copies by the rehearsal script.
INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('__order_tenant','Order fixture','__order_fixture',now());
INSERT INTO "Customer" (id,"tenantId","firstName","lastName","updatedAt") VALUES ('__order_customer','__order_tenant','Synthetic','Customer',now());
INSERT INTO "Service" (id,"tenantId",name,"durationMinutes","basePrice","requiresCollaborator") VALUES ('__order_service','__order_tenant','Synthetic service',30,19.37,false);
INSERT INTO "Appointment" (id,"tenantId","customerId","serviceId","startsAt","endsAt",status,"estimatedPrice","finalPrice","updatedAt")
SELECT id,'__order_tenant','__order_customer','__order_service','2020-01-01T10:00:00Z','2020-01-01T10:30:00Z','completed',19.37,17.13,now()
FROM unnest(ARRAY['__order_unbilled','__order_linked','__order_duplicate','__order_no_match','__order_multi_line']) id;
-- Simulate legacy duplicates that predate the duplicate-write guard, only in disposable copies.
ALTER TABLE "Sale" DISABLE TRIGGER "Sale_one_order_per_appointment";
INSERT INTO "Sale" (id,"tenantId","customerId","appointmentId",subtotal,total,"paymentStatus") VALUES
('__order_autonomous','__order_tenant','__order_customer',NULL,10.01,10.01,'paid'),
('__order_linked_sale','__order_tenant','__order_customer','__order_linked',19.37,19.37,'partial'),
('__order_duplicate_sale_a','__order_tenant','__order_customer','__order_duplicate',19.37,19.37,'paid'),
('__order_duplicate_sale_b','__order_tenant','__order_customer','__order_duplicate',19.37,19.37,'paid'),
('__order_no_match_sale','__order_tenant','__order_customer','__order_no_match',0,0,'unpaid'),
('__order_multi_line_sale','__order_tenant','__order_customer','__order_multi_line',38.74,38.74,'paid');
INSERT INTO "SaleItem" (id,"saleId","serviceId",label,quantity,"unitPrice","lineTotal")
SELECT id||'_line',id,'__order_service','Historical service',1,19.37,19.37 FROM "Sale" WHERE id IN ('__order_linked_sale','__order_duplicate_sale_a','__order_duplicate_sale_b','__order_multi_line_sale');
INSERT INTO "SaleItem" (id,"saleId","serviceId",label,quantity,"unitPrice","lineTotal") VALUES ('__order_multi_line_second','__order_multi_line_sale','__order_service','Second historical service',1,19.37,19.37);

ALTER TABLE "Sale" ENABLE TRIGGER "Sale_one_order_per_appointment";
