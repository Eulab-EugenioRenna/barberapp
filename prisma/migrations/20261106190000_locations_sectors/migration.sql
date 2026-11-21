BEGIN;
-- Existing references must be coherent before assigning new operational scopes.
-- Preserve and reject inconsistent history; never silently reassign it.
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM "Appointment" a JOIN "Service" s ON s.id=a."serviceId" JOIN "Customer" c ON c.id=a."customerId" LEFT JOIN "Collaborator" p ON p.id=a."collaboratorId" LEFT JOIN "Room" r ON r.id=a."roomId" WHERE s."tenantId"<>a."tenantId" OR c."tenantId"<>a."tenantId" OR p."tenantId"<>a."tenantId" OR r."tenantId"<>a."tenantId")
    OR EXISTS (SELECT 1 FROM "Sale" s LEFT JOIN "Customer" c ON c.id=s."customerId" LEFT JOIN "Collaborator" p ON p.id=s."collaboratorId" LEFT JOIN "Appointment" a ON a.id=s."appointmentId" WHERE c."tenantId"<>s."tenantId" OR p."tenantId"<>s."tenantId" OR a."tenantId"<>s."tenantId")
    OR EXISTS (SELECT 1 FROM "SaleItem" i JOIN "Sale" s ON s.id=i."saleId" LEFT JOIN "Service" v ON v.id=i."serviceId" LEFT JOIN "Product" p ON p.id=i."productId" LEFT JOIN "Collaborator" c ON c.id=i."collaboratorId" WHERE v."tenantId"<>s."tenantId" OR p."tenantId"<>s."tenantId" OR c."tenantId"<>s."tenantId")
    OR EXISTS (SELECT 1 FROM "ServiceProduct" sp JOIN "Service" s ON s.id=sp."serviceId" JOIN "Product" p ON p.id=sp."productId" WHERE s."tenantId"<>p."tenantId")
  THEN RAISE EXCEPTION 'Riferimenti operativi tra aziende incoerenti: migrazione interrotta senza riassegnazioni' USING ERRCODE='23514'; END IF;
END $preflight$;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "sectorId" TEXT;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "sectorId" TEXT;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "sectorId" TEXT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "locationId" TEXT;

-- AlterTable
ALTER TABLE "SaleItem" ADD COLUMN     "sectorId" TEXT;

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "legacyKey" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "weeklyHours" JSONB,
    "closures" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sector" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "legacyKey" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "weeklyHours" JSONB,
    "closures" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollaboratorSector" (
    "collaboratorId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,

    CONSTRAINT "CollaboratorSector_pkey" PRIMARY KEY ("collaboratorId","sectorId")
);

-- CreateTable
CREATE TABLE "UserSectorAccess" (
    "userId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,

    CONSTRAINT "UserSectorAccess_pkey" PRIMARY KEY ("userId","sectorId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_tenantId_legacyKey_key" ON "Location"("tenantId", "legacyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Location_id_tenantId_key" ON "Location"("id", "tenantId");

-- CreateIndex
CREATE INDEX "Sector_tenantId_locationId_idx" ON "Sector"("tenantId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Sector_tenantId_legacyKey_key" ON "Sector"("tenantId", "legacyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Sector_id_tenantId_key" ON "Sector"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Sector_id_locationId_key" ON "Sector"("id", "locationId");

CREATE UNIQUE INDEX "Sector_id_tenantId_locationId_key" ON "Sector"("id","tenantId","locationId");

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_sectorId_tenantId_fkey" FOREIGN KEY ("sectorId","tenantId") REFERENCES "Sector"("id","tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_sectorId_tenantId_fkey" FOREIGN KEY ("sectorId","tenantId") REFERENCES "Sector"("id","tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_locationId_tenantId_fkey" FOREIGN KEY ("locationId","tenantId") REFERENCES "Location"("id","tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_sectorId_tenantId_locationId_fkey" FOREIGN KEY ("sectorId","tenantId","locationId") REFERENCES "Sector"("id","tenantId","locationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_locationId_tenantId_fkey" FOREIGN KEY ("locationId","tenantId") REFERENCES "Location"("id","tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sector" ADD CONSTRAINT "Sector_locationId_tenantId_fkey" FOREIGN KEY ("locationId","tenantId") REFERENCES "Location"("id","tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaboratorSector" ADD CONSTRAINT "CollaboratorSector_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollaboratorSector" ADD CONSTRAINT "CollaboratorSector_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSectorAccess" ADD CONSTRAINT "UserSectorAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSectorAccess" ADD CONSTRAINT "UserSectorAccess_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Sector"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A repeatable mapping, not a claim about the historical business sector.
CREATE OR REPLACE FUNCTION alora_step7_backfill() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "Location" (id,"tenantId","legacyKey",name,"updatedAt")
    SELECT md5('alora:location:initial:' || id)::uuid::text,id,'initial',name,CURRENT_TIMESTAMP FROM "Tenant"
    ON CONFLICT ("tenantId","legacyKey") DO NOTHING;
  INSERT INTO "Sector" (id,"tenantId","locationId","legacyKey",name,"updatedAt")
    SELECT md5('alora:sector:initial:' || t.id)::uuid::text,t.id,l.id,'initial','Generale',CURRENT_TIMESTAMP
    FROM "Tenant" t JOIN "Location" l ON l."tenantId"=t.id AND l."legacyKey"='initial'
    ON CONFLICT ("tenantId","legacyKey") DO NOTHING;
  UPDATE "Service" x SET "sectorId"=s.id FROM "Sector" s WHERE x."tenantId"=s."tenantId" AND s."legacyKey"='initial' AND x."sectorId" IS NULL;
  UPDATE "Room" x SET "sectorId"=s.id FROM "Sector" s WHERE x."tenantId"=s."tenantId" AND s."legacyKey"='initial' AND x."sectorId" IS NULL;
  UPDATE "Appointment" x SET "sectorId"=s.id,"locationId"=s."locationId" FROM "Sector" s WHERE x."tenantId"=s."tenantId" AND s."legacyKey"='initial' AND x."sectorId" IS NULL;
  UPDATE "Sale" x SET "locationId"=l.id FROM "Location" l WHERE x."tenantId"=l."tenantId" AND l."legacyKey"='initial' AND x."locationId" IS NULL;
  UPDATE "SaleItem" x SET "sectorId"=s.id FROM "Sale" a JOIN "Sector" s ON s."tenantId"=a."tenantId" AND s."legacyKey"='initial' WHERE x."saleId"=a.id AND x."sectorId" IS NULL;
  INSERT INTO "CollaboratorSector" ("collaboratorId","sectorId") SELECT c.id,s.id FROM "Collaborator" c JOIN "Sector" s ON s."tenantId"=c."tenantId" AND s."legacyKey"='initial' ON CONFLICT DO NOTHING;
  INSERT INTO "UserSectorAccess" ("userId","sectorId") SELECT u.id,s.id FROM "User" u JOIN "Sector" s ON s."tenantId"=u."tenantId" AND s."legacyKey"='initial' WHERE u.role IN ('owner','manager','reception','collaborator') ON CONFLICT DO NOTHING;
END $$;
SELECT alora_step7_backfill();
-- Backfill is a one-time initialization. Later repair must never regrant removed access.
DROP FUNCTION alora_step7_backfill();

ALTER TABLE "Service" ALTER COLUMN "sectorId" SET NOT NULL;
ALTER TABLE "Room" ALTER COLUMN "sectorId" SET NOT NULL;
ALTER TABLE "Appointment" ALTER COLUMN "sectorId" SET NOT NULL, ALTER COLUMN "locationId" SET NOT NULL;
ALTER TABLE "Sale" ALTER COLUMN "locationId" SET NOT NULL;
ALTER TABLE "SaleItem" ALTER COLUMN "sectorId" SET NOT NULL;
CREATE INDEX "Service_tenant_sector_idx" ON "Service"("tenantId","sectorId");
CREATE INDEX "Room_tenant_sector_idx" ON "Room"("tenantId","sectorId");
CREATE INDEX "Appointment_tenant_scope_time_idx" ON "Appointment"("tenantId","locationId","sectorId","startsAt");
CREATE INDEX "Sale_tenant_location_time_idx" ON "Sale"("tenantId","locationId","soldAt");
CREATE INDEX "SaleItem_sector_idx" ON "SaleItem"("sectorId");

-- Tenant fences independent of the HTTP/API layer.

-- Sectors never move their historical rows by changing the parent identity.
CREATE FUNCTION alora_scope_parent_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" THEN RAISE EXCEPTION 'Azienda della sede o settore non modificabile' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='Sector' THEN
    IF NEW."locationId" IS DISTINCT FROM OLD."locationId" THEN RAISE EXCEPTION 'Sede del settore non modificabile' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER alora_location_owner BEFORE UPDATE OF "tenantId" ON "Location" FOR EACH ROW EXECUTE FUNCTION alora_scope_parent_immutable();
CREATE TRIGGER alora_sector_parent BEFORE UPDATE OF "tenantId","locationId" ON "Sector" FOR EACH ROW EXECUTE FUNCTION alora_scope_parent_immutable();

CREATE FUNCTION alora_initial_scope_for_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lid text; sid text;
BEGIN
  lid := md5('alora:location:initial:' || NEW.id)::uuid::text;
  sid := md5('alora:sector:initial:' || NEW.id)::uuid::text;
  INSERT INTO "Location" (id,"tenantId","legacyKey",name,"updatedAt") VALUES(lid,NEW.id,'initial',NEW.name,CURRENT_TIMESTAMP);
  INSERT INTO "Sector" (id,"tenantId","locationId","legacyKey",name,"updatedAt") VALUES(sid,NEW.id,lid,'initial','Generale',CURRENT_TIMESTAMP);
  RETURN NEW;
END $$;
CREATE TRIGGER alora_tenant_initial_scope AFTER INSERT ON "Tenant" FOR EACH ROW EXECUTE FUNCTION alora_initial_scope_for_tenant();

CREATE FUNCTION alora_default_sector() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sectorId" IS NULL THEN
    IF (SELECT count(*) FROM "Sector" WHERE "tenantId"=NEW."tenantId") <> 1 THEN
      RAISE EXCEPTION 'Selezionare il settore' USING ERRCODE='23514';
    END IF;
    SELECT id INTO NEW."sectorId" FROM "Sector" WHERE "tenantId"=NEW."tenantId";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER alora_service_scope BEFORE INSERT ON "Service" FOR EACH ROW EXECUTE FUNCTION alora_default_sector();
CREATE TRIGGER alora_room_scope BEFORE INSERT ON "Room" FOR EACH ROW EXECUTE FUNCTION alora_default_sector();

CREATE FUNCTION alora_membership_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid text; actual text;
BEGIN
  SELECT "tenantId" INTO tid FROM "Sector" WHERE id=NEW."sectorId";
  IF TG_TABLE_NAME='CollaboratorSector' THEN
    SELECT "tenantId" INTO actual FROM "Collaborator" WHERE id=NEW."collaboratorId";
  ELSE
    SELECT "tenantId" INTO actual FROM "User" WHERE id=NEW."userId";
  END IF;
  IF tid IS NULL OR actual IS DISTINCT FROM tid THEN RAISE EXCEPTION 'Appartenenza fuori azienda' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER alora_collaborator_membership BEFORE INSERT OR UPDATE ON "CollaboratorSector" FOR EACH ROW EXECUTE FUNCTION alora_membership_fence();
CREATE TRIGGER alora_user_membership BEFORE INSERT OR UPDATE ON "UserSectorAccess" FOR EACH ROW EXECUTE FUNCTION alora_membership_fence();

-- Only new local records receive the single initial scope. No identity/role is updated.
CREATE FUNCTION alora_initial_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid text;
BEGIN
  SELECT id INTO sid FROM "Sector" WHERE "tenantId"=NEW."tenantId" AND "legacyKey"='initial';
  IF sid IS NOT NULL THEN
    IF TG_TABLE_NAME='Collaborator' THEN
      INSERT INTO "CollaboratorSector" VALUES(NEW.id,sid) ON CONFLICT DO NOTHING;
    ELSIF NEW.role IN ('owner','manager','reception','collaborator') THEN
      INSERT INTO "UserSectorAccess" VALUES(NEW.id,sid) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER alora_new_collaborator_membership AFTER INSERT ON "Collaborator" FOR EACH ROW EXECUTE FUNCTION alora_initial_membership();
CREATE TRIGGER alora_new_user_membership AFTER INSERT ON "User" FOR EACH ROW EXECUTE FUNCTION alora_initial_membership();

CREATE FUNCTION alora_appointment_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid text; lid text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM "Customer" WHERE id=NEW."customerId" AND "tenantId"=NEW."tenantId") THEN RAISE EXCEPTION 'Cliente fuori azienda' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' OR NEW."serviceId" IS DISTINCT FROM OLD."serviceId" THEN
    SELECT "sectorId" INTO sid FROM "Service" WHERE id=NEW."serviceId" AND "tenantId"=NEW."tenantId";
    SELECT "locationId" INTO lid FROM "Sector" WHERE id=sid;
    IF sid IS NULL THEN RAISE EXCEPTION 'Servizio fuori azienda' USING ERRCODE='23514'; END IF;
    IF NEW."sectorId" IS NOT NULL AND NEW."sectorId"<>sid THEN RAISE EXCEPTION 'Servizio di un altro settore' USING ERRCODE='23514'; END IF;
    NEW."sectorId":=sid;
    IF NEW."locationId" IS NOT NULL AND NEW."locationId"<>lid THEN RAISE EXCEPTION 'Servizio di un altra sede' USING ERRCODE='23514'; END IF;
    NEW."locationId":=lid;
  END IF;
  IF TG_OP='UPDATE' AND (NEW."sectorId",NEW."locationId") IS DISTINCT FROM (OLD."sectorId",OLD."locationId") THEN
    IF EXISTS(SELECT 1 FROM "Sale" WHERE "appointmentId"=NEW.id) THEN RAISE EXCEPTION 'Conto collegato: sede e settore non modificabili' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='INSERT' OR (NEW.status NOT IN ('cancelled','no_show','completed') AND OLD.status IN ('cancelled','no_show','completed')) OR (NEW."startsAt",NEW."endsAt",NEW."collaboratorId",NEW."roomId",NEW."serviceId") IS DISTINCT FROM (OLD."startsAt",OLD."endsAt",OLD."collaboratorId",OLD."roomId",OLD."serviceId") THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."tenantId",7));
    IF NOT EXISTS(SELECT 1 FROM "Sector" s JOIN "Location" l ON l.id=s."locationId" WHERE s.id=NEW."sectorId" AND s."isActive" AND l."isActive") THEN RAISE EXCEPTION 'Sede o settore disattivati' USING ERRCODE='23514'; END IF;
    IF NEW."collaboratorId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "CollaboratorSector" WHERE "collaboratorId"=NEW."collaboratorId" AND "sectorId"=NEW."sectorId") THEN RAISE EXCEPTION 'Professionista non abilitato al settore' USING ERRCODE='23514'; END IF;
    IF NEW."roomId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Room" WHERE id=NEW."roomId" AND "sectorId"=NEW."sectorId" AND "tenantId"=NEW."tenantId" AND "isActive") THEN RAISE EXCEPTION 'Risorsa di un altro settore' USING ERRCODE='23514'; END IF;
    -- Serialize booking writes per tenant, including professionals shared by locations.

    IF NEW.status NOT IN ('cancelled','no_show','completed') AND EXISTS(
      SELECT 1 FROM "Appointment" a JOIN "Service" s ON s.id=a."serviceId" JOIN "Service" ns ON ns.id=NEW."serviceId"
      WHERE a."tenantId"=NEW."tenantId" AND a.id<>NEW.id AND a.status NOT IN ('cancelled','no_show')
      AND ((NEW."collaboratorId" IS NOT NULL AND a."collaboratorId"=NEW."collaboratorId") OR (NEW."roomId" IS NOT NULL AND a."roomId"=NEW."roomId" AND
        (SELECT count(*) FROM "Appointment" ra JOIN "Service" rs ON rs.id=ra."serviceId" WHERE ra."tenantId"=NEW."tenantId" AND ra.id<>NEW.id AND ra."roomId"=NEW."roomId" AND ra.status NOT IN ('cancelled','no_show')
         AND ra."startsAt"-rs."bufferBeforeMinutes"*interval '1 minute' < NEW."endsAt"+ns."bufferAfterMinutes"*interval '1 minute'
         AND ra."endsAt"+rs."bufferAfterMinutes"*interval '1 minute' > NEW."startsAt"-ns."bufferBeforeMinutes"*interval '1 minute') >= (SELECT capacity FROM "Room" WHERE id=NEW."roomId")))
      AND a."startsAt" - s."bufferBeforeMinutes"*interval '1 minute' < NEW."endsAt" + ns."bufferAfterMinutes"*interval '1 minute'
      AND a."endsAt" + s."bufferAfterMinutes"*interval '1 minute' > NEW."startsAt" - ns."bufferBeforeMinutes"*interval '1 minute'
    ) THEN RAISE EXCEPTION 'Conflitto appuntamento' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER alora_appointment_scope BEFORE INSERT OR UPDATE ON "Appointment" FOR EACH ROW EXECUTE FUNCTION alora_appointment_scope();

CREATE FUNCTION alora_sale_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lid text;
BEGIN
  IF NEW."customerId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Customer" WHERE id=NEW."customerId" AND "tenantId"=NEW."tenantId") THEN RAISE EXCEPTION 'Cliente fuori azienda' USING ERRCODE='23514'; END IF;
  IF NEW."collaboratorId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Collaborator" WHERE id=NEW."collaboratorId" AND "tenantId"=NEW."tenantId") THEN RAISE EXCEPTION 'Professionista fuori azienda' USING ERRCODE='23514'; END IF;
  IF NEW."appointmentId" IS NOT NULL THEN
    SELECT "locationId" INTO lid FROM "Appointment" WHERE id=NEW."appointmentId" AND "tenantId"=NEW."tenantId";
    IF lid IS NULL THEN RAISE EXCEPTION 'Appuntamento fuori azienda' USING ERRCODE='23514'; END IF;
    IF NEW."locationId" IS NOT NULL AND NEW."locationId"<>lid THEN RAISE EXCEPTION 'Conto e appuntamento di sedi diverse' USING ERRCODE='23514'; END IF;
    NEW."locationId":=lid;
  ELSIF NEW."locationId" IS NULL THEN
    IF (SELECT count(*) FROM "Location" WHERE "tenantId"=NEW."tenantId")<>1 THEN RAISE EXCEPTION 'Selezionare la sede' USING ERRCODE='23514'; END IF;
    SELECT id INTO NEW."locationId" FROM "Location" WHERE "tenantId"=NEW."tenantId";
  END IF;
  IF TG_OP='UPDATE' AND NEW."locationId" IS DISTINCT FROM OLD."locationId" THEN RAISE EXCEPTION 'La sede del conto e storica' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER alora_sale_scope BEFORE INSERT OR UPDATE ON "Sale" FOR EACH ROW EXECUTE FUNCTION alora_sale_scope();

CREATE FUNCTION alora_sale_item_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid text; lid text; sid text;
BEGIN
  SELECT "tenantId","locationId" INTO tid,lid FROM "Sale" WHERE id=NEW."saleId";
  IF NEW."sectorId" IS NULL THEN
    SELECT a."sectorId" INTO NEW."sectorId" FROM "Sale" s JOIN "Appointment" a ON a.id=s."appointmentId" WHERE s.id=NEW."saleId" AND a."serviceId"=NEW."serviceId" AND a."tenantId"=tid;
  END IF;
  IF NEW."sectorId" IS NULL THEN
    IF NEW."serviceId" IS NOT NULL THEN SELECT "sectorId" INTO NEW."sectorId" FROM "Service" WHERE id=NEW."serviceId" AND "tenantId"=tid;
    ELSE
      IF (SELECT count(*) FROM "Sector" WHERE "locationId"=lid)<>1 THEN RAISE EXCEPTION 'Selezionare il settore della riga' USING ERRCODE='23514'; END IF;
      SELECT id INTO NEW."sectorId" FROM "Sector" WHERE "locationId"=lid;
    END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "Sector" WHERE id=NEW."sectorId" AND "tenantId"=tid AND "locationId"=lid) THEN RAISE EXCEPTION 'Riga di un altra sede o azienda' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' OR NEW."serviceId" IS DISTINCT FROM OLD."serviceId" THEN
    IF NEW."serviceId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Service" WHERE id=NEW."serviceId" AND "tenantId"=tid AND "sectorId"=NEW."sectorId") AND NOT EXISTS(SELECT 1 FROM "Sale" s JOIN "Appointment" a ON a.id=s."appointmentId" WHERE s.id=NEW."saleId" AND a."tenantId"=tid AND a."serviceId"=NEW."serviceId" AND a."sectorId"=NEW."sectorId") THEN RAISE EXCEPTION 'Settore del servizio non valido' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='UPDATE' AND (NEW."serviceId",NEW."productId") IS NOT DISTINCT FROM (OLD."serviceId",OLD."productId") AND NEW."sectorId"<>OLD."sectorId" THEN RAISE EXCEPTION 'Settore storico della riga non modificabile' USING ERRCODE='23514'; END IF;
  IF NEW."productId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Product" WHERE id=NEW."productId" AND "tenantId"=tid) THEN RAISE EXCEPTION 'Prodotto fuori azienda' USING ERRCODE='23514'; END IF;
  IF NEW."serviceId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Service" WHERE id=NEW."serviceId" AND "tenantId"=tid) THEN RAISE EXCEPTION 'Servizio fuori azienda' USING ERRCODE='23514'; END IF;
  IF NEW."collaboratorId" IS NOT NULL AND (TG_OP='INSERT' OR (NEW."collaboratorId",NEW."sectorId") IS DISTINCT FROM (OLD."collaboratorId",OLD."sectorId"))
    AND NOT EXISTS(SELECT 1 FROM "CollaboratorSector" WHERE "collaboratorId"=NEW."collaboratorId" AND "sectorId"=NEW."sectorId")
    AND NOT EXISTS(SELECT 1 FROM "Sale" s JOIN "Appointment" a ON a.id=s."appointmentId" WHERE s.id=NEW."saleId" AND a."tenantId"=tid AND a."serviceId"=NEW."serviceId" AND a."sectorId"=NEW."sectorId" AND a."collaboratorId"=NEW."collaboratorId")
  THEN RAISE EXCEPTION 'Professionista non abilitato al settore' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER alora_sale_item_scope BEFORE INSERT OR UPDATE ON "SaleItem" FOR EACH ROW EXECUTE FUNCTION alora_sale_item_scope();
COMMIT;
