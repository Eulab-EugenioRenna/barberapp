-- Removing a whole tenant (platform «Elimina attività» and «Azzera dati»).
-- Ledgers, stock, price history and automation receipts are append-only and their
-- guards refuse DELETE. Only inside alora_purge_tenant, which sets a transaction-local
-- flag and touches nothing but the target tenant, the guards let rows go.

-- 1. Every row trigger function that guards UPDATE or DELETE steps aside while purging.
DO $migration$
DECLARE
  f record; def text; body int; pos int;
  bypass constant text := E'BEGIN\n  IF coalesce(current_setting(''alora.tenant_purge'', true), '''') <> '''' THEN\n    IF TG_OP = ''DELETE'' THEN RETURN OLD; END IF;\n    RETURN NEW;\n  END IF;\n';
BEGIN
  FOR f IN
    SELECT DISTINCT p.oid
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE NOT t.tgisinternal AND n.nspname = 'public' AND l.lanname = 'plpgsql'
      AND (t.tgtype & 1) = 1            -- row level
      AND (t.tgtype & (8 | 16)) <> 0    -- DELETE or UPDATE
  LOOP
    def := pg_get_functiondef(f.oid);
    CONTINUE WHEN position('alora.tenant_purge' IN def) > 0;
    body := position('$function$' IN def);
    CONTINUE WHEN body = 0;
    pos := regexp_instr(def, '\mBEGIN\M', body, 1, 0, 'i');
    CONTINUE WHEN pos = 0;
    EXECUTE overlay(def PLACING bypass FROM pos FOR 5);
  END LOOP;
END
$migration$;

-- 2. Deletes every row of the tenant, children before parents, in repeated passes:
-- the order follows the foreign keys of the current schema, so new tables need no change.
-- keep: tables left untouched (accounts and structure for «Azzera dati»).
CREATE OR REPLACE FUNCTION alora_purge_tenant(target text, keep text[] DEFAULT '{}')
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  t record; selfcol record; pass int := 0; total bigint := 0; n bigint;
  found boolean; progress boolean; blocked text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Tenant" WHERE id = target) THEN
    RAISE EXCEPTION 'Attività non trovata' USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('alora.tenant_purge', target, true);
  LOOP
    pass := pass + 1; progress := false; blocked := '{}';
    FOR t IN
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'tenantId' AND c.table_name <> ALL (keep)
      ORDER BY 1
    LOOP
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE "tenantId" = $1)', t.table_name) INTO found USING target;
      CONTINUE WHEN NOT found;
      BEGIN
        -- Rows pointing at rows of the same table (refunds, returns) go first.
        FOR selfcol IN
          SELECT a.attname FROM pg_constraint k
          JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
          WHERE k.contype = 'f' AND k.conrelid = format('%I', t.table_name)::regclass AND k.confrelid = k.conrelid
        LOOP
          EXECUTE format('DELETE FROM %I WHERE "tenantId" = $1 AND %I IS NOT NULL', t.table_name, selfcol.attname) USING target;
        END LOOP;
        EXECUTE format('DELETE FROM %I WHERE "tenantId" = $1', t.table_name) USING target;
        GET DIAGNOSTICS n = ROW_COUNT;
        total := total + n; progress := true;
      EXCEPTION WHEN foreign_key_violation OR restrict_violation THEN
        blocked := blocked || t.table_name::text;
      END;
    END LOOP;
    EXIT WHEN cardinality(blocked) = 0;
    IF NOT progress OR pass >= 60 THEN
      RAISE EXCEPTION 'Dati non cancellabili: %', array_to_string(blocked, ', ') USING ERRCODE = '23503';
    END IF;
  END LOOP;
  RETURN total;
END
$$;
