import { Prisma } from "@prisma/client";
import type { OperationalScope } from "../locations/operational-scope";

export interface SalesTaxReport {
  knownNet: string;
  knownTax: string;
  knownGross: string;
  unknownLinesGross: string;
  unknownLineCount: number;
  rates: Array<{ rate: string; net: string; tax: string; gross: string }>;
}
export interface MaterialCostReport {
  knownCost: string;
  unknownLineCount: number;
  unattributedMovementGroups: number;
  margin: string | null;
}
export interface InventoryValueReport {
  receiptsNet: string;
  receiptsTax: string;
  receiptsGross: string | null;
  receiptsUnknownTaxCount: number;
  openingValue: string;
  issuedCost: string;
  returnedCost: string;
  transferDelta: string;
  adjustmentDelta: string;
  movementDelta: string;
  currentValue: string;
  currentLedgerValue: string;
  currentDifference: string;
  unknownProductLocations: number;
}

/** Extends the report's sold/sold_lines CTEs. No catalog cost or tax inference.
 * Costs describe the current recorded materials of the sold account cohort;
 * warehouse movements describe createdAt in the requested period separately.
 */
export function financialValuationSql(input: {
  scope: OperationalScope;
  canReadInventory: boolean;
  warehouseView: boolean;
  inPeriod: (field: Prisma.Sql) => Prisma.Sql;
}) {
  const { scope, canReadInventory, warehouseView, inPeriod } = input;
  const set = (field: Prisma.Sql, ids: string[]) =>
    ids.length
      ? Prisma.sql`${field} IN (${Prisma.join(ids)})`
      : Prisma.sql`FALSE`;
  return {
    ctes: Prisma.sql`, valuation_lines AS MATERIALIZED (
      SELECT i.*, i."priceMode" IN ('net','gross') AND i."vatRate" IS NOT NULL AS tax_known,
        ${canReadInventory} AND i."stockState"='posted'
        AND jsonb_typeof(i."inventoryRequirements"->'requirements')='array'
        AND (i."inventoryRequirements"->>'serviceId') IS NOT DISTINCT FROM i."serviceId"
        AND (i."inventoryRequirements"->>'productId') IS NOT DISTINCT FROM i."productId"
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE
          WHEN jsonb_typeof(i."inventoryRequirements"->'requirements')='array' THEN i."inventoryRequirements"->'requirements' ELSE '[]'::jsonb END) r
          WHERE r->>'productId' IS NULL OR COALESCE(r->>'units','') !~ '^[0-9]+([.][0-9]+)?$'
          OR (CASE WHEN COALESCE(r->>'units','') ~ '^[0-9]+([.][0-9]+)?$' THEN (r->>'units')::numeric ELSE 0 END > 0
            AND NOT EXISTS (SELECT 1 FROM "StockMovement" original WHERE original."tenantId"=${scope.tenantId}
              AND original."saleId"=i."saleId" AND original."saleItemId"=i.id AND original."productId"=r->>'productId' AND original."quantityDelta"<0)))
        AND NOT EXISTS (SELECT 1 FROM "StockMovement" m WHERE m."tenantId"=${scope.tenantId}
          AND m."saleId"=i."saleId" AND m."saleItemId"=i.id
          AND (m."sectorId" IS NULL OR NOT (${set(Prisma.sql`m."sectorId"`, scope.allowedSectorIds)}))) AS cost_known,
        COALESCE((SELECT -SUM(m."valueDelta") FROM "StockMovement" m
          WHERE ${canReadInventory} AND m."tenantId"=${scope.tenantId} AND m."saleId"=i."saleId" AND m."saleItemId"=i.id
          AND ${set(Prisma.sql`m."sectorId"`, scope.allowedSectorIds)}),0) AS cost
      FROM sold_lines i
    ), orphan_costs AS (
      SELECT m."saleId",m."saleItemId" FROM "StockMovement" m JOIN sold s ON s.id=m."saleId"
      WHERE ${canReadInventory} AND m."tenantId"=${scope.tenantId}
      AND NOT EXISTS(SELECT 1 FROM "SaleItem" i WHERE i.id=m."saleItemId" AND i."saleId"=m."saleId")
      GROUP BY m."saleId",m."saleItemId" HAVING SUM(m."valueDelta")<>0
    ), warehouse_permission AS (
      SELECT ${canReadInventory && warehouseView} AND NOT EXISTS (
        SELECT 1 FROM "Sector" b WHERE b."tenantId"=${scope.tenantId}
        AND ${set(Prisma.sql`b."locationId"`, scope.locationIds)}
        AND NOT (${set(Prisma.sql`b.id`, scope.allowedSectorIds)})) AS allowed
    ), warehouse_period AS MATERIALIZED (
      SELECT m.* FROM "StockMovement" m WHERE (SELECT allowed FROM warehouse_permission)
      AND m."tenantId"=${scope.tenantId} AND ${set(Prisma.sql`m."locationId"`, scope.locationIds)}
      AND ${inPeriod(Prisma.sql`m."createdAt"`)}
    ), warehouse_current AS (
      SELECT COALESCE(SUM(b.value) FILTER(WHERE b.initialized),0) AS value
      FROM "StockBalance" b WHERE (SELECT allowed FROM warehouse_permission)
      AND b."tenantId"=${scope.tenantId} AND ${set(Prisma.sql`b."locationId"`, scope.locationIds)}
    ), warehouse_ledger AS (
      SELECT COALESCE(SUM(m."valueDelta"),0) AS value FROM "StockMovement" m
      WHERE (SELECT allowed FROM warehouse_permission) AND m."tenantId"=${scope.tenantId}
      AND ${set(Prisma.sql`m."locationId"`, scope.locationIds)}
    )`,
    projection: Prisma.sql`
      'salesTax',(SELECT json_build_object(
        'knownNet',COALESCE(SUM("lineTotal") FILTER(WHERE tax_known),0)::numeric(30,2)::text,
        'knownTax',COALESCE(SUM("taxTotal") FILTER(WHERE tax_known),0)::numeric(30,2)::text,
        'knownGross',COALESCE(SUM(gross) FILTER(WHERE tax_known),0)::numeric(30,2)::text,
        'unknownLinesGross',COALESCE(SUM(gross) FILTER(WHERE NOT tax_known OR tax_known IS NULL),0)::numeric(30,2)::text,
        'unknownLineCount',COUNT(*) FILTER(WHERE NOT tax_known OR tax_known IS NULL)::int,
        'rates',COALESCE((SELECT json_agg(r ORDER BY r.rate::numeric) FROM (
          SELECT "vatRate"::numeric(5,2)::text AS rate,SUM("lineTotal")::numeric(30,2)::text AS net,
          SUM("taxTotal")::numeric(30,2)::text AS tax,SUM(gross)::numeric(30,2)::text AS gross
          FROM valuation_lines WHERE tax_known GROUP BY "vatRate")r),'[]'::json)
      ) FROM valuation_lines),
      'materials',CASE WHEN ${canReadInventory} THEN (SELECT json_build_object(
        'knownCost',COALESCE(SUM(cost) FILTER(WHERE cost_known),0)::numeric(30,6)::text,
        'unknownLineCount',COUNT(*) FILTER(WHERE NOT cost_known OR cost_known IS NULL)::int,
        'unattributedMovementGroups',(SELECT COUNT(*)::int FROM orphan_costs),
        'margin',CASE WHEN COUNT(*) FILTER(WHERE NOT cost_known OR cost_known IS NULL OR NOT tax_known OR tax_known IS NULL)=0
          AND NOT EXISTS(SELECT 1 FROM orphan_costs)
          AND COALESCE((SELECT SUM(gross-"linesGross") FROM sold),0)=0
          THEN COALESCE(SUM("lineTotal"-cost),0)::numeric(30,6)::text ELSE NULL END
      ) FROM valuation_lines) ELSE NULL END,
      'inventory',CASE WHEN (SELECT allowed FROM warehouse_permission) THEN (SELECT json_build_object(
        'receiptsNet',COALESCE(SUM("valueDelta") FILTER(WHERE kind='receipt'),0)::numeric(30,6)::text,
        'receiptsTax',COALESCE(SUM("purchaseTax") FILTER(WHERE kind='receipt' AND "purchaseVatRate" IS NOT NULL),0)::numeric(30,2)::text,
        'receiptsGross',CASE WHEN COUNT(*) FILTER(WHERE kind='receipt' AND ("purchaseTax" IS NULL OR "purchaseVatRate" IS NULL))=0
          THEN COALESCE(SUM("valueDelta"+"purchaseTax") FILTER(WHERE kind='receipt'),0)::numeric(30,6)::text ELSE NULL END,
        'receiptsUnknownTaxCount',COUNT(*) FILTER(WHERE kind='receipt' AND ("purchaseTax" IS NULL OR "purchaseVatRate" IS NULL))::int,
        'openingValue',COALESCE(SUM("valueDelta") FILTER(WHERE kind='opening'),0)::numeric(30,6)::text,
        'issuedCost',COALESCE(-SUM("valueDelta") FILTER(WHERE kind IN ('sale','consumption','issue','order_adjust_out')),0)::numeric(30,6)::text,
        'returnedCost',COALESCE(SUM("valueDelta") FILTER(WHERE kind IN ('return','order_adjust_in')),0)::numeric(30,6)::text,
        'transferDelta',COALESCE(SUM("valueDelta") FILTER(WHERE kind IN ('transfer_in','transfer_out')),0)::numeric(30,6)::text,
        'adjustmentDelta',COALESCE(SUM("valueDelta") FILTER(WHERE kind IN ('adjust_in','adjust_out')),0)::numeric(30,6)::text,
        'movementDelta',COALESCE(SUM("valueDelta"),0)::numeric(30,6)::text,
        'currentValue',(SELECT value::numeric(30,6)::text FROM warehouse_current),
        'currentLedgerValue',(SELECT value::numeric(30,6)::text FROM warehouse_ledger),
        'currentDifference',((SELECT value FROM warehouse_current)-(SELECT value FROM warehouse_ledger))::numeric(30,6)::text,
        'unknownProductLocations',(SELECT COUNT(*)::int FROM "Product" p CROSS JOIN "Location" l
          WHERE p."tenantId"=${scope.tenantId} AND p."stockTracked" AND l."tenantId"=${scope.tenantId}
          AND ${set(Prisma.sql`l.id`, scope.locationIds)} AND NOT EXISTS(
            SELECT 1 FROM "StockBalance" b WHERE b."tenantId"=${scope.tenantId} AND b."productId"=p.id AND b."locationId"=l.id AND b.initialized))
      ) FROM warehouse_period) ELSE NULL END`,
  };
}
