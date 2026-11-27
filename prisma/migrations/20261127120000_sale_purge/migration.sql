-- «Elimina vendita» for a sale registered by mistake (no stock movements, no
-- message already sent). Payment entries, order commands and price history are
-- append-only; only inside alora_purge_sale, which sets a transaction-local flag
-- and touches nothing but the target sale, the guards let its rows go.
-- «Annulla vendita» is recorded as a new order command kind.

-- 1. Every row trigger function that guards UPDATE or DELETE steps aside while purging a sale.
DO $migration$
DECLARE
  f record; def text; body int; pos int;
  bypass constant text := E'BEGIN\n  IF coalesce(current_setting(''alora.sale_purge'', true), '''') <> '''' THEN\n    IF TG_OP = ''DELETE'' THEN RETURN OLD; END IF;\n    RETURN NEW;\n  END IF;\n';
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
    CONTINUE WHEN position('alora.sale_purge' IN def) > 0;
    body := position('$function$' IN def);
    CONTINUE WHEN body = 0;
    pos := regexp_instr(def, '\mBEGIN\M', body, 1, 0, 'i');
    CONTINUE WHEN pos = 0;
    EXECUTE overlay(def PLACING bypass FROM pos FOR 5);
  END LOOP;
END
$migration$;

-- 2. Removes one sale and everything that exists only because of it.
-- Kept: notification history already produced (and its domain events), stock.
CREATE OR REPLACE FUNCTION alora_purge_sale(tenant text, target text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE appts text[]; n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Sale" WHERE id = target AND "tenantId" = tenant) THEN
    RAISE EXCEPTION 'Vendita non trovata' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM "StockMovement" WHERE "tenantId" = tenant AND "saleId" = target) THEN
    RAISE EXCEPTION 'La vendita ha movimenti di magazzino: annullala invece di eliminarla' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(array_agg(a.id), '{}') INTO appts
  FROM "Appointment" a JOIN "SaleItem" i ON i.id = a."orderItemId"
  WHERE i."saleId" = target;
  PERFORM set_config('alora.sale_purge', target, true);
  DELETE FROM "PaymentEntry" WHERE "saleId" = target AND "refundOfId" IS NOT NULL;
  DELETE FROM "PaymentEntry" WHERE "saleId" = target;
  DELETE FROM "PaymentOperation" WHERE "saleId" = target;
  -- Messages still waiting for this sale are never sent.
  UPDATE "NotificationHistory" h SET status = 'skipped', error = 'Vendita eliminata'
  WHERE h."tenantId" = tenant AND h.status IN ('queued', 'pending', 'failed') AND h.id IN (
    SELECT d."historyId" FROM "AppointmentAutomationDelivery" d
    LEFT JOIN "AppointmentAutomationRun" r ON r.id = d."runId"
    WHERE r."orderId" = target OR (d."runId" IS NULL AND d."noticeContext"->>'orderId' = target));
  -- Actions and deliveries follow the run; the notification history stays.
  DELETE FROM "AppointmentAutomationRun" WHERE "orderId" = target;
  DELETE FROM "NotificationDomainEvent" e
  WHERE e."tenantId" = tenant AND e."entityType" = 'appointment' AND e."entityId" = ANY (appts)
    AND NOT EXISTS (SELECT 1 FROM "NotificationHistory" h WHERE h."domainEventId" = e.id);
  DELETE FROM "Appointment" WHERE id = ANY (appts);
  DELETE FROM "OrderOperation" WHERE "saleId" = target;
  DELETE FROM "OrderPriceRevision" WHERE "saleId" = target;
  DELETE FROM "Sale" WHERE id = target;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('alora.sale_purge', '', true);
  RETURN n;
END
$$;

-- 3. «Annulla vendita» command.
ALTER TABLE "OrderOperation" DROP CONSTRAINT "OrderOperation_kind_check";
ALTER TABLE "OrderOperation" ADD CONSTRAINT "OrderOperation_kind_check" CHECK(kind IN ('create_booking','create_sale','update_booking','update_sale','cancel_booking','cancel_sale','confirm_booking','request_booking_change','authorize_booking_contact'));
