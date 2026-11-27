-- Session snapshot: what a request needs to authorize is read together with the
-- token row, in one query.
--  * "connectSnapshot": Connect functions taken at login (and only at login).
--    A change on Connect takes effect at the next login; ALORA logout/revocation
--    stays immediate because "revokedAt" is checked on every request.
--  * "localSnapshot": ALORA profile, company state and sector memberships. It is
--    rebuilt lazily and the triggers below clear it whenever its source rows change,
--    so local changes (role, deactivation, sector access) keep taking effect at once.
--  * "snapshotVersion" guards the lazy rebuild against a concurrent clear.
ALTER TABLE "LocalSession"
  ADD COLUMN "connectSnapshot" JSONB,
  ADD COLUMN "localSnapshot" JSONB,
  ADD COLUMN "snapshotVersion" INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION alora_session_snapshot_stale_users(user_ids text[])
RETURNS void LANGUAGE sql AS $$
  UPDATE "LocalSession"
     SET "localSnapshot" = NULL, "snapshotVersion" = "snapshotVersion" + 1
   WHERE "userId" = ANY(user_ids) AND "revokedAt" IS NULL AND "usedAt" IS NULL;
$$;

CREATE OR REPLACE FUNCTION alora_session_snapshot_stale_tenant(tenant text)
RETURNS void LANGUAGE sql AS $$
  UPDATE "LocalSession" s
     SET "localSnapshot" = NULL, "snapshotVersion" = s."snapshotVersion" + 1
    FROM "User" u
   WHERE u.id = s."userId" AND u."tenantId" = tenant
     AND s."revokedAt" IS NULL AND s."usedAt" IS NULL;
$$;

CREATE OR REPLACE FUNCTION alora_session_snapshot_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.permissions IS DISTINCT FROM OLD.permissions
     OR NEW."permissionsConfigured" IS DISTINCT FROM OLD."permissionsConfigured"
     OR NEW."isActive" IS DISTINCT FROM OLD."isActive"
     OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW."firstName" IS DISTINCT FROM OLD."firstName"
     OR NEW."lastName" IS DISTINCT FROM OLD."lastName"
     OR NEW."connectSubject" IS DISTINCT FROM OLD."connectSubject" THEN
    PERFORM alora_session_snapshot_stale_users(ARRAY[NEW.id]);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER alora_session_snapshot_user AFTER UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION alora_session_snapshot_user();

CREATE OR REPLACE FUNCTION alora_session_snapshot_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."isActive" IS DISTINCT FROM OLD."isActive"
     OR NEW."isSuspended" IS DISTINCT FROM OLD."isSuspended" THEN
    PERFORM alora_session_snapshot_stale_tenant(NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER alora_session_snapshot_tenant AFTER UPDATE ON "Tenant"
  FOR EACH ROW EXECUTE FUNCTION alora_session_snapshot_tenant();

-- Owners and collaborators see sectors by tenant or by membership: any sector
-- added, moved or removed changes their operational scope.
CREATE OR REPLACE FUNCTION alora_session_snapshot_sector() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."locationId" IS NOT DISTINCT FROM OLD."locationId"
     AND NEW."tenantId" IS NOT DISTINCT FROM OLD."tenantId" THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    PERFORM alora_session_snapshot_stale_tenant(OLD."tenantId");
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW."tenantId" IS DISTINCT FROM OLD."tenantId") THEN
    PERFORM alora_session_snapshot_stale_tenant(NEW."tenantId");
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER alora_session_snapshot_sector AFTER INSERT OR UPDATE OR DELETE ON "Sector"
  FOR EACH ROW EXECUTE FUNCTION alora_session_snapshot_sector();

CREATE OR REPLACE FUNCTION alora_session_snapshot_sector_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM alora_session_snapshot_stale_users(ARRAY[OLD."userId"]);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM alora_session_snapshot_stale_users(ARRAY[NEW."userId"]);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER alora_session_snapshot_sector_access AFTER INSERT OR UPDATE OR DELETE ON "UserSectorAccess"
  FOR EACH ROW EXECUTE FUNCTION alora_session_snapshot_sector_access();

CREATE OR REPLACE FUNCTION alora_session_snapshot_collaborator_sector() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ids text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP <> 'INSERT' THEN ids := ids || OLD."collaboratorId"; END IF;
  IF TG_OP <> 'DELETE' THEN ids := ids || NEW."collaboratorId"; END IF;
  PERFORM alora_session_snapshot_stale_users(ARRAY(
    SELECT c."userId" FROM "Collaborator" c
     WHERE c."userId" IS NOT NULL AND c.id = ANY(ids)));
  RETURN NULL;
END $$;
CREATE TRIGGER alora_session_snapshot_collaborator_sector AFTER INSERT OR UPDATE OR DELETE ON "CollaboratorSector"
  FOR EACH ROW EXECUTE FUNCTION alora_session_snapshot_collaborator_sector();

-- The profile link (collaboratorId) depends on the collaborator's user, tenant and state.
CREATE OR REPLACE FUNCTION alora_session_snapshot_collaborator() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."userId" IS NOT DISTINCT FROM OLD."userId"
     AND NEW."tenantId" IS NOT DISTINCT FROM OLD."tenantId"
     AND NEW."isActive" IS NOT DISTINCT FROM OLD."isActive" THEN
    RETURN NULL;
  END IF;
  IF TG_OP <> 'INSERT' AND OLD."userId" IS NOT NULL THEN
    PERFORM alora_session_snapshot_stale_users(ARRAY[OLD."userId"]);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."userId" IS NOT NULL THEN
    PERFORM alora_session_snapshot_stale_users(ARRAY[NEW."userId"]);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER alora_session_snapshot_collaborator AFTER INSERT OR UPDATE OR DELETE ON "Collaborator"
  FOR EACH ROW EXECUTE FUNCTION alora_session_snapshot_collaborator();
