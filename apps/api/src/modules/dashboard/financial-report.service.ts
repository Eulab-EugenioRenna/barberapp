import {
  financialValuationSql,
  SalesTaxReport,
  MaterialCostReport,
  InventoryValueReport,
} from "./financial-valuation.sql";
import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { OperationalScope } from "../locations/operational-scope";
import { FinancialReportDto } from "./financial-report.dto";
import { getRevenueRange } from "./revenue-report.logic";

interface ValueRow {
  id: string | null;
  label: string;
  revenue: string;
}
interface FinancialTotals {
  salesTax: SalesTaxReport;
  materials: MaterialCostReport | null;
  inventory: InventoryValueReport | null;
  sold: {
    gross: string;
    linesGross: string;
    unattributedGross: string;
    accounts: number;
  };
  cash: { receipts: string; refunds: string; net: string } | null;
  accounts: {
    total: string;
    opening: string;
    receipts: string;
    refunds: string;
    netReceived: string;
    remaining: string;
    knownCount: number;
    unknownCount: number;
    unknownTotal: string;
  } | null;
  byCustomer: ValueRow[];
  byCollaborator: ValueRow[];
  byService: Array<ValueRow & { quantity: number }>;
  byProduct: Array<ValueRow & { quantity: number }>;
  bySector: ValueRow[];
  byLocation: ValueRow[];
  collaboratorOptions: Array<{ value: string; label: string }>;
}

/** One SQL statement gives every aggregate the same PostgreSQL snapshot.
 * Payments belong to an account; they are never apportioned to its lines.
 */
@Injectable()
export class FinancialReportService {
  constructor(private readonly prisma: PrismaService) {}

  async read(
    scope: OperationalScope,
    filters: FinancialReportDto,
    sectorSelected: boolean,
    canReadInventory = false,
  ) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: scope.tenantId },
      select: { timezone: true, currency: true },
    });
    // What the active catalogue actually uses: the dashboard hides VAT and stock
    // sections that do not apply to this business.
    const tenantId = scope.tenantId;
    const [vatServices, vatProducts, purchaseVatProducts, trackedProducts] =
      await Promise.all([
        this.prisma.service.count({
          where: { tenantId, isActive: true, vatRate: { gt: 0 } },
        }),
        this.prisma.product.count({
          where: { tenantId, isActive: true, vatRate: { gt: 0 } },
        }),
        this.prisma.product.count({
          where: { tenantId, isActive: true, purchaseVatRate: { gt: 0 } },
        }),
        this.prisma.product.count({
          where: { tenantId, isActive: true, stockTracked: true },
        }),
      ]);
    const catalog = {
      salesVat: vatServices + vatProducts > 0,
      purchaseVat: purchaseVatProducts > 0,
      trackedProducts,
    };
    if (filters.month && !/^(\d{4})-(0[1-9]|1[0-2])$/.test(filters.month))
      throw new BadRequestException("Mese non valido");
    const period = filters.period ?? "month";
    const range = getRevenueRange(
      period,
      filters.date ?? filters.month,
      tenant.timezone,
    );
    const inPeriod = (field: Prisma.Sql) =>
      range.start && range.end
        ? Prisma.sql`${field} >= ${range.start} AND ${field} <= ${range.end}`
        : Prisma.sql`TRUE`;
    const inSet = (field: Prisma.Sql, values: string[]) =>
      values.length
        ? Prisma.sql`${field} IN (${Prisma.join(values)})`
        : Prisma.sql`FALSE`;
    const permittedSector = inSet(
      Prisma.sql`i."sectorId"`,
      scope.allowedSectorIds,
    );
    const selectedSector = inSet(Prisma.sql`i."sectorId"`, scope.sectorIds);
    // Only a completed row with its own declared performer is attributed.
    // Never fall back to the sale's primary or the planned collaborator.
    // Migrated accounts link only their first service to the appointment: the
    // other lines have no appointment of their own and count as performed when
    // the account's appointment was completed (the line's collaborator is kept).
    const performer = Prisma.sql`CASE WHEN a.status='completed' OR (a.id IS NULL AND sa.status='completed') THEN i."collaboratorId" ELSE NULL END`;
    const selectedLine = Prisma.sql`${selectedSector} ${
      filters.collaboratorId
        ? Prisma.sql`AND ${performer}=${filters.collaboratorId}`
        : Prisma.empty
    }`;
    const lineFiltered = sectorSelected || !!filters.collaboratorId;
    const accountValuesAvailable = !lineFiltered;
    const valuation = financialValuationSql({
      scope,
      canReadInventory,
      warehouseView: accountValuesAvailable && !filters.customerId,
      inPeriod,
    });
    const [result] = await this.prisma.$queryRaw<
      Array<{
        report: Omit<FinancialTotals, "cash"> & {
          cashValues: FinancialTotals["cash"];
        };
      }>
    >(Prisma.sql`
      WITH visible AS MATERIALIZED (
        SELECT s.* FROM "Sale" s
        WHERE s."tenantId"=${scope.tenantId}
        AND ${inSet(Prisma.sql`s."locationId"`, scope.locationIds)}
        ${filters.customerId ? Prisma.sql`AND s."customerId"=${filters.customerId}` : Prisma.empty}
        AND NOT EXISTS (SELECT 1 FROM "SaleItem" i WHERE i."saleId"=s.id AND NOT (${permittedSector}))
        AND (EXISTS (SELECT 1 FROM "SaleItem" i WHERE i."saleId"=s.id) OR NOT EXISTS (
          SELECT 1 FROM "Sector" b WHERE b."tenantId"=${scope.tenantId} AND b."locationId"=s."locationId"
          AND NOT (${inSet(Prisma.sql`b.id`, scope.allowedSectorIds)})))
        AND (s."appointmentId" IS NULL OR EXISTS (
          SELECT 1 FROM "Appointment" p WHERE p.id=s."appointmentId" AND p."tenantId"=${scope.tenantId}
          AND ${inSet(Prisma.sql`p."sectorId"`, scope.allowedSectorIds)}))
      ), lines AS MATERIALIZED (
        SELECT i.*, s."locationId", s."customerId", s."soldAt", s."orderStatus",
          i."lineTotal"+i."taxTotal" AS gross, ${performer} AS performer,
          (${selectedLine}) AS selected
        FROM visible s JOIN "SaleItem" i ON i."saleId"=s.id
        LEFT JOIN "Appointment" a ON a."orderItemId"=i.id AND a."tenantId"=${scope.tenantId}
        LEFT JOIN "Appointment" sa ON sa.id=s."appointmentId" AND sa."tenantId"=${scope.tenantId}
      ), scoped AS MATERIALIZED (
        SELECT s.* FROM visible s WHERE EXISTS(SELECT 1 FROM lines i WHERE i."saleId"=s.id AND i.selected)
        ${lineFiltered ? Prisma.empty : Prisma.sql`OR NOT EXISTS(SELECT 1 FROM "SaleItem" i WHERE i."saleId"=s.id)`}
      ), sold AS MATERIALIZED (
        SELECT s.*, COALESCE((SELECT SUM(i.gross) FROM lines i WHERE i."saleId"=s.id AND i.selected),0) AS "linesGross",
          ${lineFiltered ? Prisma.sql`COALESCE((SELECT SUM(i.gross) FROM lines i WHERE i."saleId"=s.id AND i.selected),0)` : Prisma.sql`s.total`} AS gross
        FROM scoped s WHERE s."orderStatus"='confirmed' AND ${inPeriod(Prisma.sql`s."soldAt"`)}
      ), sold_lines AS MATERIALIZED (
        SELECT i.* FROM lines i JOIN sold s ON s.id=i."saleId" WHERE i.selected
      ), balances AS MATERIALIZED (
        SELECT s.id, s.total, s."paymentBasis",
          COALESCE(SUM(p.amount) FILTER(WHERE p.kind='opening'),0) AS opening,
          COALESCE(SUM(p.amount) FILTER(WHERE p.kind='receipt'),0) AS receipts,
          COALESCE(SUM(p.amount) FILTER(WHERE p.kind='refund'),0) AS refunds
        FROM scoped s LEFT JOIN "PaymentEntry" p ON p."saleId"=s.id AND p."tenantId"=${scope.tenantId}
        WHERE s."orderStatus" IN ('open','confirmed') AND ${inPeriod(Prisma.sql`s."soldAt"`)}
        GROUP BY s.id,s.total,s."paymentBasis"
      ), cash AS (
        SELECT COALESCE(SUM(p.amount) FILTER(WHERE p.kind='receipt'),0) AS receipts,
          COALESCE(SUM(p.amount) FILTER(WHERE p.kind='refund'),0) AS refunds
        FROM scoped s JOIN "PaymentEntry" p ON p."saleId"=s.id AND p."tenantId"=${scope.tenantId}
        WHERE s."paymentBasis"='ledger' AND p.kind IN ('receipt','refund') AND ${inPeriod(Prisma.sql`p."receivedAt"`)}
      )
      ${valuation.ctes}
      SELECT json_build_object(
        ${valuation.projection},
        'sold',(SELECT json_build_object('gross',COALESCE(SUM(gross),0)::numeric(30,2)::text,
          'linesGross',COALESCE(SUM("linesGross"),0)::numeric(30,2)::text,
          'unattributedGross',COALESCE(SUM(gross-"linesGross"),0)::numeric(30,2)::text,'accounts',COUNT(*)::int) FROM sold),
        'accounts',(SELECT json_build_object(
          'total',COALESCE(SUM(total) FILTER(WHERE "paymentBasis"='ledger'),0)::numeric(30,2)::text,
          'opening',COALESCE(SUM(opening) FILTER(WHERE "paymentBasis"='ledger'),0)::numeric(30,2)::text,
          'receipts',COALESCE(SUM(receipts) FILTER(WHERE "paymentBasis"='ledger'),0)::numeric(30,2)::text,
          'refunds',COALESCE(SUM(refunds) FILTER(WHERE "paymentBasis"='ledger'),0)::numeric(30,2)::text,
          'netReceived',COALESCE(SUM(opening+receipts-refunds) FILTER(WHERE "paymentBasis"='ledger'),0)::numeric(30,2)::text,
          'remaining',COALESCE(SUM(total-opening-receipts+refunds) FILTER(WHERE "paymentBasis"='ledger'),0)::numeric(30,2)::text,
          'knownCount',COUNT(*) FILTER(WHERE "paymentBasis"='ledger')::int,
          'unknownCount',COUNT(*) FILTER(WHERE "paymentBasis"<>'ledger')::int,
          'unknownTotal',COALESCE(SUM(total) FILTER(WHERE "paymentBasis"<>'ledger'),0)::numeric(30,2)::text) FROM balances),
        'cashValues',(SELECT json_build_object('receipts',receipts::numeric(30,2)::text,
          'refunds',refunds::numeric(30,2)::text,'net',(receipts-refunds)::numeric(30,2)::text) FROM cash),
        'collaboratorOptions',COALESCE((SELECT json_agg(r ORDER BY r.label,r.value) FROM (
          SELECT c.id AS value,trim(c."firstName"||' '||c."lastName")||CASE WHEN c."isActive" THEN '' ELSE ' · non attivo' END AS label
          FROM "Collaborator" c WHERE c."tenantId"=${scope.tenantId} AND EXISTS (
            SELECT 1 FROM "CollaboratorSector" m WHERE m."collaboratorId"=c.id
            AND ${inSet(Prisma.sql`m."sectorId"`, scope.sectorIds)}))r),'[]'::json),
        'byCustomer',COALESCE((SELECT json_agg(r ORDER BY r.revenue::numeric DESC,r.label,r.id) FROM (
          SELECT s."customerId" AS id,COALESCE(NULLIF(trim(c."firstName"||' '||c."lastName"),''),'Senza cliente') AS label,
          SUM(s.gross)::numeric(30,2)::text AS revenue FROM sold s
          LEFT JOIN "Customer" c ON c.id=s."customerId" AND c."tenantId"=${scope.tenantId}
          GROUP BY s."customerId",c."firstName",c."lastName")r),'[]'::json),
        'byCollaborator',COALESCE((SELECT json_agg(r ORDER BY r.revenue::numeric DESC,r.label,r.id) FROM (
          SELECT i.performer AS id,COALESCE(NULLIF(trim(c."firstName"||' '||c."lastName"),''),'Senza collaboratore') AS label,
          SUM(i.gross)::numeric(30,2)::text AS revenue FROM sold_lines i
          LEFT JOIN "Collaborator" c ON c.id=i.performer AND c."tenantId"=${scope.tenantId}
          WHERE i."serviceId" IS NOT NULL GROUP BY i.performer,c."firstName",c."lastName")r),'[]'::json),
        'byService',COALESCE((SELECT json_agg(r ORDER BY r.revenue::numeric DESC,r.label,r.id) FROM (
          SELECT i."serviceId" AS id,c.name AS label,SUM(i.quantity)::int AS quantity,SUM(i.gross)::numeric(30,2)::text AS revenue
          FROM sold_lines i JOIN "Service" c ON c.id=i."serviceId" AND c."tenantId"=${scope.tenantId}
          GROUP BY i."serviceId",c.name)r),'[]'::json),
        'byProduct',COALESCE((SELECT json_agg(r ORDER BY r.revenue::numeric DESC,r.label,r.id) FROM (
          SELECT i."productId" AS id,c.name AS label,SUM(i.quantity)::int AS quantity,SUM(i.gross)::numeric(30,2)::text AS revenue
          FROM sold_lines i JOIN "Product" c ON c.id=i."productId" AND c."tenantId"=${scope.tenantId}
          GROUP BY i."productId",c.name)r),'[]'::json),
        'bySector',COALESCE((SELECT json_agg(r ORDER BY r.revenue::numeric DESC,r.label,r.id) FROM (
          SELECT i."sectorId" AS id,c.name AS label,SUM(i.gross)::numeric(30,2)::text AS revenue FROM sold_lines i
          JOIN "Sector" c ON c.id=i."sectorId" AND c."tenantId"=${scope.tenantId}
          GROUP BY i."sectorId",c.name)r),'[]'::json),
        'byLocation',COALESCE((SELECT json_agg(r ORDER BY r.revenue::numeric DESC,r.label,r.id) FROM (
          SELECT s."locationId" AS id,c.name AS label,SUM(s.gross)::numeric(30,2)::text AS revenue FROM sold s
          JOIN "Location" c ON c.id=s."locationId" AND c."tenantId"=${scope.tenantId}
          GROUP BY s."locationId",c.name)r),'[]'::json)
      ) AS report
    `);
    // Cash values are returned only for a complete-account view, never as line attribution.
    const { cashValues, ...totals } = result.report;
    const report: FinancialTotals = {
      ...totals,
      cash: accountValuesAvailable ? cashValues : null,
      accounts: accountValuesAvailable ? totals.accounts : null,
    };
    return {
      ...report,
      catalog,
      period,
      currency: tenant.currency,
      timezone: tenant.timezone,
      range: {
        start: range.start?.toISOString() ?? null,
        end: range.end?.toISOString() ?? null,
      },
      basis: {
        sold: "confirmed-account-soldAt",
        cash: "receipt-refund-receivedAt",
        accounts: "current-balances-of-period-accounts",
        scope: "fully-authorized-accounts",
        lineFiltered,
        accountValuesAvailable,
        paymentsAllocatedToLines: false,
        performer: "completed-row-declared-performer",
        salesTax: "recorded-lines-with-explicit-VAT-mode",
        materials: "current-tracked-material-cost-of-period-account-lines",
        inventoryPeriod: "movement-createdAt",
        inventoryCurrent: "current-ledger-and-initialized-balances",
        marginIncludesLaborOrOverheads: false,
      },
      metrics: [
        {
          label: "Venduto nel periodo",
          value: `${tenant.currency} ${report.sold.gross}`,
          trend: `${report.sold.accounts} conti confermati`,
        },
        {
          label: "Incassi nel periodo",
          value: report.cash
            ? `${tenant.currency} ${report.cash.receipts}`
            : "Non attribuiti",
          trend: "Movimenti registrati, senza saldi iniziali",
        },
        {
          label: "Rimborsi nel periodo",
          value: report.cash
            ? `${tenant.currency} ${report.cash.refunds}`
            : "Non attribuiti",
          trend: "Data effettiva del movimento",
        },
        {
          label: "Flusso netto nel periodo",
          value: report.cash
            ? `${tenant.currency} ${report.cash.net}`
            : "Non attribuito",
          trend: "Incassi meno rimborsi del periodo",
        },
        {
          label: "Residuo attuale dei conti del periodo",
          value: report.accounts
            ? `${tenant.currency} ${report.accounts.remaining}`
            : "Non attribuito",
          trend: report.accounts
            ? `${report.accounts.unknownCount} conti storici da riconciliare esclusi`
            : "Pagamenti registrati sul conto completo",
        },
      ],
    };
  }
}
