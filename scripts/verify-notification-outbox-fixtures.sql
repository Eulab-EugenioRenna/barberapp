BEGIN;
INSERT INTO "Tenant"(id,name,slug,"updatedAt") VALUES('__step12_a','Synthetic outbox A','synthetic-step12-a',now()),('__step12_b','Synthetic outbox B','synthetic-step12-b',now());
INSERT INTO "NotificationDomainEvent"(id,"tenantId","eventKey","eventType","entityType","entityId",payload)
VALUES('__step12_event','__step12_a','synthetic-event-12','appointment.confirmed','appointment','synthetic-appointment','{"tenantId":"__step12_a","eventType":"appointment.confirmed","entityType":"appointment","entityId":"synthetic-appointment"}');
DO $$ BEGIN
 BEGIN UPDATE "NotificationDomainEvent" SET payload=payload||'{"changed":true}' WHERE id='__step12_event'; RAISE EXCEPTION 'Expected immutable event'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM "NotificationDomainEvent" WHERE id='__step12_event'; RAISE EXCEPTION 'Expected retained event'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN INSERT INTO "NotificationDomainEvent"(id,"tenantId","eventKey","eventType","entityType",payload) VALUES('__step12_bad','__step12_a','bad-tenant-event','test','notification','{"tenantId":"__step12_b","eventType":"test","entityType":"notification"}'); RAISE EXCEPTION 'Expected payload tenant validation'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT 'PASS:immutable-and-tenant-consistent-domain-events';
INSERT INTO "NotificationHistory"(id,"tenantId",channel,"eventType","domainEventId","dispatchKey",payload)
VALUES('__step12_history','__step12_a','email','appointment.confirmed','__step12_event','synthetic-target','{"renderedMessage":"Synthetic content"}');
DO $$ BEGIN
 BEGIN INSERT INTO "NotificationHistory"(id,"tenantId",channel,"eventType","domainEventId","dispatchKey") VALUES('__step12_other','__step12_b','email','appointment.confirmed','__step12_event','other-target'); RAISE EXCEPTION 'Expected delivery tenant validation'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN INSERT INTO "NotificationHistory"(id,"tenantId",channel,"eventType","domainEventId","dispatchKey") VALUES('__step12_duplicate','__step12_a','email','appointment.confirmed','__step12_event','synthetic-target'); RAISE EXCEPTION 'Expected target uniqueness'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN UPDATE "NotificationHistory" SET payload='{"different":true}' WHERE id='__step12_history'; RAISE EXCEPTION 'Expected immutable delivery'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM "NotificationHistory" WHERE id='__step12_history'; RAISE EXCEPTION 'Expected retained delivery'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT 'PASS:stable-delivery-identity-immutable-payload-and-cross-tenant-rejection';
DO $$ BEGIN
 BEGIN UPDATE "NotificationHistory" SET status='dispatching' WHERE id='__step12_history'; RAISE EXCEPTION 'Expected claim token and lease'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE "NotificationHistory" SET "retrySafe"=true WHERE id='__step12_history'; RAISE EXCEPTION 'Expected definitive failed-state retry metadata'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE "NotificationHistory" SET status='dispatching',"dispatchToken"='synthetic-claim',"dispatchLeaseUntil"=now()+interval '1 minute' WHERE id='__step12_history';
UPDATE "NotificationHistory" SET status='uncertain',"dispatchLeaseUntil"=null WHERE id='__step12_history';
UPDATE "NotificationDomainEvent" SET "processedAt"=now() WHERE id='__step12_event';
DO $$ BEGIN
 BEGIN UPDATE "NotificationHistory" SET status='dispatching',"dispatchLeaseUntil"=now()+interval '1 minute' WHERE id='__step12_history'; RAISE EXCEPTION 'Expected uncertain delivery fence'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN INSERT INTO "NotificationHistory"(id,"tenantId",channel,"eventType","domainEventId","dispatchKey") VALUES('__step12_late','__step12_a','email','appointment.confirmed','__step12_event','late-target'); RAISE EXCEPTION 'Expected closed delivery set'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

DO $$ BEGIN
 BEGIN UPDATE "NotificationDomainEvent" SET "processedAt"=null WHERE id='__step12_event'; RAISE EXCEPTION 'Expected closed event'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT 'PASS:claimed-dispatch-requires-token-and-lease-no-unsafe-retry-and-closed-event-cannot-reopen';
-- Both tenant-owned rows are removed together by the normal tenant cascade; no orphan is permitted.
DELETE FROM "Tenant" WHERE id='__step12_a';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM "NotificationHistory" WHERE id='__step12_history') OR EXISTS(SELECT 1 FROM "NotificationDomainEvent" WHERE id='__step12_event') THEN RAISE EXCEPTION 'Expected complete tenant cascade'; END IF; END $$;
SELECT 'PASS:tenant-cascade-is-coherent-with-preserved-event-history';
INSERT INTO "User"(id,"tenantId",email,"passwordHash","firstName","lastName",role,"connectSubject","connectInstallationId","updatedAt") VALUES('__step12_hook_author','__step12_b','hook-author@synthetic.invalid','disabled','Synthetic','Author','owner','synthetic-subject','synthetic-installation',now());
INSERT INTO "NotificationAutomationWebhook"(id,"tenantId","actorUserId","actorSubject","installationId","appId","requestKey",url,"updatedAt") VALUES('__step12_hook','__step12_b','__step12_hook_author','synthetic-subject','synthetic-installation','synthetic-app','synthetic-hook-command','https://synthetic.invalid/callback',now());
INSERT INTO "NotificationAutomationWebhookEvent"(id,"tenantId","registrationId","installationId","eventId",kind,"sessionId","bodyHash","occurredAt",status,"payloadCipher") VALUES('__step12_hook_event','__step12_b','__step12_hook','synthetic-installation','00000000-0000-4000-8000-000000000001','message.interactive_response','synthetic-session',repeat('1',64),now(),'received','synthetic-cipher');
DO $$ BEGIN
 BEGIN UPDATE "NotificationAutomationWebhookEvent" SET "tenantId"='__step12_a' WHERE id='__step12_hook_event'; RAISE EXCEPTION 'Expected receipt tenant boundary'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE "NotificationAutomationWebhookEvent" SET "payloadCipher"='different' WHERE id='__step12_hook_event'; RAISE EXCEPTION 'Expected immutable receipt'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM "NotificationAutomationWebhookEvent" WHERE id='__step12_hook_event'; RAISE EXCEPTION 'Expected retained receipt'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE "NotificationAutomationWebhookEvent" SET status='ignored',"processedAt"=now() WHERE id='__step12_hook_event';
DO $$ BEGIN
 BEGIN UPDATE "NotificationAutomationWebhookEvent" SET status='received',"processedAt"=null WHERE id='__step12_hook_event'; RAISE EXCEPTION 'Expected closed receipt'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
INSERT INTO "NotificationAutomationGrant"(id,"tenantId","actorUserId","actorSubject","appId","installationId",channel,"requestKey","requestHash",request,"sessionId","updatedAt") VALUES('__step12_command_grant','__step12_b','__step12_hook_author','synthetic-subject','synthetic-app','synthetic-installation','whatsapp','synthetic-grant-command',repeat('1',64),'{}','synthetic-session',now());
INSERT INTO "NotificationAutomationCommand"("tenantId","commandId","grantId","inputHash","payloadCipher","updatedAt") VALUES('__step12_b','00000000-0000-4000-8000-000000000002','__step12_command_grant',repeat('1',64),'synthetic-cipher',now());
DO $$ BEGIN
 BEGIN INSERT INTO "NotificationAutomationCommand"("tenantId","commandId","grantId","inputHash","payloadCipher","updatedAt") VALUES('__step12_a','00000000-0000-4000-8000-000000000003','__step12_command_grant',repeat('1',64),'synthetic-cipher',now()); RAISE EXCEPTION 'Expected command tenant scope'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE "NotificationAutomationCommand" SET "payloadCipher"='different' WHERE "tenantId"='__step12_b'; RAISE EXCEPTION 'Expected frozen command'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN DELETE FROM "NotificationAutomationCommand" WHERE "tenantId"='__step12_b'; RAISE EXCEPTION 'Expected retained command'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT 'PASS:original-automation-command-is-frozen-retained-and-bound-to-grant-tenant';
DELETE FROM "Tenant" WHERE id='__step12_b';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM "NotificationAutomationWebhook" WHERE id='__step12_hook') OR EXISTS(SELECT 1 FROM "NotificationAutomationWebhookEvent" WHERE id='__step12_hook_event') THEN RAISE EXCEPTION 'Expected complete webhook tenant cascade'; END IF; END $$;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM "NotificationAutomationCommand" WHERE "tenantId"='__step12_b') THEN RAISE EXCEPTION 'Expected complete command tenant cascade'; END IF; END $$;
SELECT 'PASS:webhook-receipt-tenant-boundary-immutability-retention-closed-state-and-complete-tenant-cascade';
ROLLBACK;
