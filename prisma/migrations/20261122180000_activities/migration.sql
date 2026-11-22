-- Activities: what the business does (Barberia, Estetica, Rivendita…), shared by
-- every location. A Sector becomes "an activity at a location"; services and
-- products belong to an activity. Nothing historical moves: appointments and
-- account lines keep their sector.

CREATE TABLE "Activity" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "preset" TEXT,
  "name" TEXT NOT NULL,
  "color" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Activity_id_tenantId_key" ON "Activity"("id", "tenantId");
CREATE UNIQUE INDEX "Activity_tenantId_name_key" ON "Activity"("tenantId", "name");
CREATE INDEX "Activity_tenantId_isActive_idx" ON "Activity"("tenantId", "isActive");
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Built-in catalogue: the key is stable, the name can be changed by the business.
CREATE FUNCTION alora_activity_preset(aname text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(trim(aname))
    WHEN 'barberia' THEN 'barberia'
    WHEN 'parrucchiere' THEN 'parrucchiere'
    WHEN 'estetica' THEN 'estetica'
    WHEN 'unghie' THEN 'unghie'
    WHEN 'benessere e spa' THEN 'benessere'
    WHEN 'rivendita' THEN 'rivendita'
    ELSE NULL END
$$;

-- Same name (case-insensitive) = same activity of the account.
CREATE FUNCTION alora_activity_for(tid text, aname text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE aid text;
BEGIN
  SELECT id INTO aid FROM "Activity" WHERE "tenantId"=tid AND lower(name)=lower(trim(aname)) LIMIT 1;
  IF aid IS NULL THEN
    aid := md5('alora:activity:' || tid || ':' || lower(trim(aname)))::uuid::text;
    INSERT INTO "Activity" (id,"tenantId",preset,name,"updatedAt")
      VALUES (aid, tid, alora_activity_preset(aname),
        -- Catalogue activities keep their canonical spelling (Barberia, not "barberia").
        CASE WHEN alora_activity_preset(aname) IS NOT NULL
          THEN upper(left(trim(aname), 1)) || lower(substr(trim(aname), 2))
          ELSE trim(aname) END,
        CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;
    SELECT id INTO aid FROM "Activity" WHERE "tenantId"=tid AND lower(name)=lower(trim(aname)) LIMIT 1;
  END IF;
  RETURN aid;
END $$;

ALTER TABLE "Sector" ADD COLUMN "activityId" TEXT;
ALTER TABLE "Service" ADD COLUMN "activityId" TEXT;
ALTER TABLE "Product" ADD COLUMN "activityId" TEXT;

-- Two sectors with the same name in one location cannot become the same activity there.
UPDATE "Sector" s SET name = s.name || ' ' || d.rn
  FROM (
    SELECT id, row_number() OVER (PARTITION BY "locationId", lower(name) ORDER BY "createdAt", id) AS rn
    FROM "Sector"
  ) d
  WHERE d.id = s.id AND d.rn > 1;

UPDATE "Sector" SET "activityId" = alora_activity_for("tenantId", name);
UPDATE "Service" x SET "activityId" = s."activityId" FROM "Sector" s WHERE s.id = x."sectorId";
UPDATE "Product" SET "activityId" = alora_activity_for("tenantId", 'Rivendita');
-- Every account starts with the resale activity used by products.
SELECT alora_activity_for(id, 'Rivendita') FROM "Tenant";

ALTER TABLE "Sector" ALTER COLUMN "activityId" SET NOT NULL;
ALTER TABLE "Service" ALTER COLUMN "activityId" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "activityId" SET NOT NULL;

ALTER TABLE "Sector" ADD CONSTRAINT "Sector_activityId_tenantId_fkey" FOREIGN KEY ("activityId", "tenantId") REFERENCES "Activity"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Service" ADD CONSTRAINT "Service_activityId_tenantId_fkey" FOREIGN KEY ("activityId", "tenantId") REFERENCES "Activity"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_activityId_tenantId_fkey" FOREIGN KEY ("activityId", "tenantId") REFERENCES "Activity"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Sector_location_activity_key" ON "Sector"("locationId", "activityId");
CREATE INDEX "Sector_tenantId_activityId_idx" ON "Sector"("tenantId", "activityId");
CREATE INDEX "Service_tenantId_activityId_idx" ON "Service"("tenantId", "activityId");
CREATE INDEX "Product_tenantId_activityId_idx" ON "Product"("tenantId", "activityId");

-- Sector: activity from the name when omitted; the name always mirrors the activity.
CREATE FUNCTION alora_sector_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."activityId" IS NULL THEN
    NEW."activityId" := alora_activity_for(NEW."tenantId", NEW.name);
  END IF;
  SELECT name INTO NEW.name FROM "Activity" WHERE id = NEW."activityId" AND "tenantId" = NEW."tenantId";
  IF NEW.name IS NULL THEN RAISE EXCEPTION 'Attività non valida' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER alora_sector_activity BEFORE INSERT OR UPDATE OF "activityId", name ON "Sector"
  FOR EACH ROW EXECUTE FUNCTION alora_sector_activity();

-- Renaming an activity renames it in every location.
CREATE FUNCTION alora_activity_rename() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Sector" SET name = NEW.name, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "activityId" = NEW.id AND name IS DISTINCT FROM NEW.name;
  RETURN NEW;
END $$;
CREATE TRIGGER alora_activity_rename AFTER UPDATE OF name ON "Activity"
  FOR EACH ROW EXECUTE FUNCTION alora_activity_rename();

-- Service: home sector from the activity (runs before alora_service_scope, which
-- only handles single-sector accounts), activity from the home sector otherwise.
CREATE FUNCTION alora_service_activity_sector() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sectorId" IS NULL AND NEW."activityId" IS NOT NULL THEN
    SELECT id INTO NEW."sectorId" FROM "Sector"
      WHERE "tenantId" = NEW."tenantId" AND "activityId" = NEW."activityId"
      ORDER BY "isActive" DESC, "createdAt", id LIMIT 1;
    IF NEW."sectorId" IS NULL THEN
      RAISE EXCEPTION 'Attiva l''attività in almeno una sede prima di aggiungere servizi' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER alora_service_activity_sector BEFORE INSERT ON "Service"
  FOR EACH ROW EXECUTE FUNCTION alora_service_activity_sector();

CREATE FUNCTION alora_service_zactivity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."activityId" IS NULL THEN
    SELECT "activityId" INTO NEW."activityId" FROM "Sector" WHERE id = NEW."sectorId";
  END IF;
  RETURN NEW;
END $$;
-- Name sorts after alora_service_scope so the default sector is already set.
CREATE TRIGGER alora_service_zactivity BEFORE INSERT ON "Service"
  FOR EACH ROW EXECUTE FUNCTION alora_service_zactivity();

-- Product: «Rivendita» unless another activity is chosen.
CREATE FUNCTION alora_product_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."activityId" IS NULL THEN
    NEW."activityId" := alora_activity_for(NEW."tenantId", 'Rivendita');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER alora_product_activity BEFORE INSERT ON "Product"
  FOR EACH ROW EXECUTE FUNCTION alora_product_activity();

-- New accounts get the resale activity next to the initial location.
CREATE FUNCTION alora_tenant_activities() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM alora_activity_for(NEW.id, 'Rivendita');
  RETURN NEW;
END $$;
CREATE TRIGGER alora_tenant_zactivities AFTER INSERT ON "Tenant"
  FOR EACH ROW EXECUTE FUNCTION alora_tenant_activities();
