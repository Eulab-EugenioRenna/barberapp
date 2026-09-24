-- Keep legacy duplicate sales intact, but serialize and reject every new
-- duplicate appointment link. Standalone quick orders keep a NULL link.
CREATE INDEX IF NOT EXISTS "Sale_appointmentId_idx"
ON "Sale"("appointmentId");

CREATE OR REPLACE FUNCTION "prevent_duplicate_appointment_sale"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."appointmentId" IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."appointmentId", 0));

  IF EXISTS (
    SELECT 1
    FROM "Sale"
    WHERE "appointmentId" = NEW."appointmentId"
      AND "id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'An order already exists for appointment %', NEW."appointmentId"
      USING ERRCODE = '23505',
            CONSTRAINT = 'Sale_appointmentId_order_once';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Sale_one_order_per_appointment" ON "Sale";
CREATE TRIGGER "Sale_one_order_per_appointment"
BEFORE INSERT OR UPDATE OF "appointmentId" ON "Sale"
FOR EACH ROW
EXECUTE FUNCTION "prevent_duplicate_appointment_sale"();
