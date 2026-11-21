/** Default is read-only. --apply accepts explicit reviewed appointment/line mappings. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const databaseIndex = process.argv.indexOf("--database");
const database = databaseIndex < 0 ? "barber" : process.argv[databaseIndex + 1];
if (!database || !/^[a-zA-Z0-9_]+$/.test(database))
  throw Error("Invalid database");
const sql = (query) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "barber-postgres-1",
      "psql",
      "-X",
      "-U",
      "barber",
      "-d",
      database,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, stdio: "pipe" },
  )
    .toString()
    .trim();
const applyIndex = process.argv.indexOf("--apply");
if (applyIndex < 0) {
  console.log(
    sql(`SELECT COALESCE(json_agg(t),'[]') FROM (
    SELECT a.id AS "appointmentId",a."orderIssue",COALESCE(json_agg(json_build_object('saleId',s.id,'saleItemId',i.id,'serviceMatches',i."serviceId"=a."serviceId",'quantity',i.quantity)) FILTER (WHERE i.id IS NOT NULL),'[]') AS candidates
    FROM "Appointment" a LEFT JOIN "Sale" s ON s."appointmentId"=a.id LEFT JOIN "SaleItem" i ON i."saleId"=s.id WHERE a."orderIssue" IS NOT NULL GROUP BY a.id ORDER BY a.id
  ) t`),
  );
} else {
  if (!process.argv[applyIndex + 1]) throw Error("Missing mapping file");
  const mappings = JSON.parse(
    readFileSync(process.argv[applyIndex + 1], "utf8"),
  );
  if (
    !Array.isArray(mappings) ||
    !mappings.length ||
    mappings.some(
      (m) =>
        typeof m.appointmentId !== "string" ||
        typeof m.saleItemId !== "string" ||
        !m.appointmentId ||
        !m.saleItemId,
    )
  )
    throw Error("Expected explicit appointmentId/saleItemId mappings");
  // Encode the document as hex: no data is interpolated as executable SQL.
  const encoded = Buffer.from(JSON.stringify(mappings)).toString("hex");
  const result = sql(`BEGIN;
    DO $$ DECLARE m record; a "Appointment"%ROWTYPE; i "SaleItem"%ROWTYPE; s "Sale"%ROWTYPE; tid text;
    BEGIN
      -- Acquire tenant locks before row locks, in the same order as application commands.
      FOR tid IN SELECT DISTINCT ap."tenantId" FROM "Appointment" ap JOIN jsonb_array_elements(convert_from(decode('${encoded}','hex'),'UTF8')::jsonb) v ON ap.id=v->>'appointmentId' ORDER BY ap."tenantId" LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended(tid,7));
      END LOOP;
      FOR m IN SELECT value->>'appointmentId' AS aid,value->>'saleItemId' AS iid FROM jsonb_array_elements(convert_from(decode('${encoded}','hex'),'UTF8')::jsonb) ORDER BY value->>'appointmentId' LOOP
        SELECT * INTO STRICT a FROM "Appointment" WHERE id=m.aid FOR UPDATE;
        SELECT * INTO STRICT i FROM "SaleItem" WHERE id=m.iid;
        SELECT * INTO STRICT s FROM "Sale" WHERE id=i."saleId";
        IF a."orderIssue" IS NULL AND a."orderItemId"=i.id THEN CONTINUE; END IF;
        IF a."orderIssue" IS NULL OR s."appointmentId" IS DISTINCT FROM a.id OR s."tenantId"<>a."tenantId" OR s."locationId"<>a."locationId" OR s."customerId" IS DISTINCT FROM a."customerId" OR i."serviceId" IS DISTINCT FROM a."serviceId" OR i."sectorId"<>a."sectorId" OR i.quantity<>1 THEN
          RAISE EXCEPTION 'Mapping incompatible; no amounts or original references were changed';
        END IF;
        UPDATE "Appointment" SET "orderItemId"=i.id,"orderIssue"=NULL WHERE id=a.id;
      END LOOP;
    END $$;
    COMMIT;`);
  console.log(
    JSON.stringify({
      applied: true,
      mappings: mappings.length,
      originalFinancialFieldsChanged: false,
      result,
    }),
  );
}
