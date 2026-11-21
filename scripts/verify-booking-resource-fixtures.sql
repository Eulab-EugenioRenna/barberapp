BEGIN;
INSERT INTO "Tenant" (id,name,slug,"updatedAt") VALUES ('__resources_a','Resource fixtures','__resources_a',now());
INSERT INTO "Customer" (id,"tenantId","firstName","lastName","updatedAt") VALUES ('__resources_customer','__resources_a','Synthetic','Customer',now());
INSERT INTO "Room" (id,"tenantId",name,capacity) VALUES ('__resources_room','__resources_a','Capacity two',2);
INSERT INTO "Service" (id,"tenantId",name,"durationMinutes","basePrice","requiresCollaborator","requiresRoom") VALUES ('__resources_short','__resources_a','Short',30,10,false,true),('__resources_long','__resources_a','Long',60,20,false,true);
INSERT INTO "Appointment" (id,"tenantId","customerId","serviceId","roomId","startsAt","endsAt",status,"updatedAt") VALUES
 ('__resources_first','__resources_a','__resources_customer','__resources_short','__resources_room','2035-01-08T10:00:00Z','2035-01-08T10:30:00Z','confirmed',now()),
 ('__resources_second','__resources_a','__resources_customer','__resources_short','__resources_room','2035-01-08T10:30:00Z','2035-01-08T11:00:00Z','confirmed',now());
INSERT INTO "Appointment" (id,"tenantId","customerId","serviceId","roomId","startsAt","endsAt",status,"updatedAt") VALUES ('__resources_longer','__resources_a','__resources_customer','__resources_long','__resources_room','2035-01-08T10:00:00Z','2035-01-08T11:00:00Z','confirmed',now());
DO $$ DECLARE failed boolean:=false; BEGIN
 BEGIN
 INSERT INTO "Appointment" (id,"tenantId","customerId","serviceId","roomId","startsAt","endsAt",status,"updatedAt") VALUES ('__resources_overflow','__resources_a','__resources_customer','__resources_short','__resources_room','2035-01-08T10:15:00Z','2035-01-08T10:45:00Z','confirmed',now());
 EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Peak capacity exceeded'; END IF;
END $$;
SELECT 'PASS:peak-capacity-allows-long-plus-successive-bookings-and-rejects-third-simultaneous';
DO $$ DECLARE failed boolean:=false; BEGIN
 BEGIN UPDATE "Room" SET capacity=1 WHERE id='__resources_room'; EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Future reservations invalidated by capacity reduction'; END IF;
END $$;
UPDATE "Appointment" SET status='cancelled' WHERE id='__resources_longer';
UPDATE "Room" SET capacity=1 WHERE id='__resources_room';
SELECT 'PASS:capacity-reduction-requires-releasing-future-reservations';
DO $$ DECLARE failed boolean:=false; BEGIN
 BEGIN
 INSERT INTO "Appointment" (id,"tenantId","customerId","serviceId","roomId","startsAt","endsAt",status,"updatedAt") VALUES
 ('__resources_batch_first','__resources_a','__resources_customer','__resources_short','__resources_room','2035-01-09T10:00:00Z','2035-01-09T10:30:00Z','confirmed',now()),
 ('__resources_batch_second','__resources_a','__resources_customer','__resources_short','__resources_room','2035-01-09T10:00:00Z','2035-01-09T10:30:00Z','confirmed',now());
 EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Same-statement capacity overflow accepted'; END IF;
END $$;
SELECT 'PASS:multi-row-insert-cannot-hide-earlier-reservations-in-same-statement';
INSERT INTO "Service" (id,"tenantId",name,"durationMinutes","basePrice","requiresCollaborator","requiresRoom","bufferAfterMinutes") VALUES ('__resources_buffered','__resources_a','Buffered',30,10,false,true,30);
INSERT INTO "Appointment" (id,"tenantId","customerId","serviceId","roomId","startsAt","endsAt",status,"updatedAt") VALUES ('__resources_buffer_original','__resources_a','__resources_customer','__resources_buffered','__resources_room','2035-01-10T10:00:00Z','2035-01-10T10:30:00Z','confirmed',now());
DO $$ DECLARE failed boolean:=false; BEGIN
 BEGIN
 INSERT INTO "Appointment" (id,"tenantId","customerId","serviceId","roomId","startsAt","endsAt",status,"updatedAt") VALUES ('__resources_buffer','__resources_a','__resources_customer','__resources_short','__resources_room','2035-01-10T10:30:00Z','2035-01-10T11:00:00Z','confirmed',now());
 EXCEPTION WHEN check_violation THEN failed:=true; END;
 IF NOT failed THEN RAISE EXCEPTION 'Reservation buffer ignored'; END IF;
END $$;
SELECT 'PASS:room-capacity-includes-service-buffers';
ROLLBACK;
