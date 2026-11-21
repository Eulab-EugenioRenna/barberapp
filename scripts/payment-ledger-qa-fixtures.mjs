/** Synthetic historical receipt fixtures only. Never runs against the main database. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
export function cloneLegacySale(health, sourceId) {
  assert(health.testOnly && /^step7_http_\d+$/.test(health.database));
  assert(/^[a-f0-9-]{36}$/.test(sourceId));
  const id = randomUUID();
  const statement = `BEGIN;
 INSERT INTO "Sale" (id,"tenantId","locationId","customerId",subtotal,"discountTotal","taxTotal",total,"paymentStatus","paymentBasis","soldAt")
 SELECT '${id}',"tenantId","locationId","customerId",subtotal,"discountTotal","taxTotal",total,'unpaid','legacy_unknown',"soldAt" FROM "Sale" WHERE id='${sourceId}' AND "tenantId"='__http_a';
 INSERT INTO "SaleItem" (id,"saleId","sectorId","productId",label,quantity,"unitPrice","lineTotal","taxTotal","priceMode","vatRate","lineSubtotal","discountNet")
 SELECT gen_random_uuid()::text,'${id}',"sectorId","productId",label,quantity,"unitPrice","lineTotal","taxTotal","priceMode","vatRate","lineSubtotal","discountNet" FROM "SaleItem" WHERE "saleId"='${sourceId}';
 SELECT count(*) FROM "Sale" WHERE id='${id}'; COMMIT;`;
  const result = execFileSync(
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
      health.database,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: statement, stdio: "pipe" },
  ).toString();
  assert(result.includes("\n1\n"));
  return id;
}
