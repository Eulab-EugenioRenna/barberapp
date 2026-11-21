import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { lockOperationalTenant } from "../../common/operational-lock";
import { decimalInput, priceLine, PriceMode } from "./money";

type Catalog = {
  price?: unknown;
  basePrice?: unknown;
  priceMode?: string;
  vatRate?: unknown;
  cost?: unknown;
  costMode?: string;
  purchaseVatRate?: unknown;
  stockTracked?: boolean;
};
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}
  data(
    body: Record<string, unknown>,
    previous: Catalog | undefined,
    service = false,
  ) {
    try {
      const priceKey = service ? "basePrice" : "price";
      const mode = body["priceMode"] ?? previous?.priceMode ?? "legacy";
      if (!["legacy", "net", "gross"].includes(String(mode)))
        throw Error("Modalità prezzo non valida");
      const rate =
        body["vatRate"] === undefined ? previous?.vatRate : body["vatRate"];
      const vatRate =
        rate === null || rate === undefined || rate === ""
          ? null
          : decimalInput(rate, "IVA vendita").toFixed(2);
      if (vatRate !== null && new Prisma.Decimal(vatRate).greaterThan(100))
        throw Error("Aliquota IVA non valida");
      if (mode !== "legacy" && vatRate === null)
        throw Error("Indica l'aliquota di vendita");
      const entered = body[priceKey];
      const price =
        entered === undefined
          ? undefined
          : entered === null || entered === ""
            ? null
            : decimalInput(entered, "Prezzo").toFixed(2);
      const data: Record<string, unknown> = {
        priceMode: mode,
        vatRate,
        ...(price === undefined ? {} : { [priceKey]: price }),
      };
      if (service && price === null)
        throw Error("Indica il prezzo del servizio");
      if (!service) {
        const costMode = body["costMode"] ?? previous?.costMode ?? "legacy";
        if (!["legacy", "net", "gross"].includes(String(costMode)))
          throw Error("Modalità costo non valida");
        const purchaseRate =
          body["purchaseVatRate"] === undefined
            ? previous?.purchaseVatRate
            : body["purchaseVatRate"];
        const purchaseVatRate =
          purchaseRate === undefined ||
          purchaseRate === null ||
          purchaseRate === ""
            ? null
            : decimalInput(purchaseRate, "IVA acquisto").toFixed(2);
        if (
          purchaseVatRate !== null &&
          new Prisma.Decimal(purchaseVatRate).greaterThan(100)
        )
          throw Error("Aliquota acquisto non valida");
        if (costMode !== "legacy" && purchaseVatRate === null)
          throw Error("Indica l'aliquota di acquisto");
        Object.assign(data, {
          costMode,
          purchaseVatRate,
          ...(body["cost"] === undefined
            ? {}
            : {
                cost:
                  body["cost"] === null || body["cost"] === ""
                    ? null
                    : decimalInput(body["cost"], "Costo").toFixed(2),
              }),
          ...(typeof body["stockTracked"] === "boolean"
            ? { stockTracked: body["stockTracked"] }
            : {}),
        });
      }
      return data;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Prezzo non valido",
      );
    }
  }

  async write<T>(
    tenantId: string,
    actor: string,
    reason: unknown,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    const note =
      typeof reason === "string" && reason.trim()
        ? reason.trim()
        : "Aggiornamento listino";
    if (note.length > 500)
      throw new BadRequestException("Motivazione troppo lunga");
    return this.prisma.$transaction(async (tx) => {
      await lockOperationalTenant(tx, tenantId);
      await tx.$executeRaw`SELECT set_config('alora.actor',${actor},true),set_config('alora.price_reason',${note},true)`;
      return write(tx);
    });
  }
  async productHistory(tenantId: string, id: string, page = 1) {
    if (
      !(await this.prisma.product.findFirst({
        where: { tenantId, id },
        select: { id: true },
      }))
    )
      throw new NotFoundException("Prodotto non trovato");
    return this.history({ tenantId, productId: id }, page);
  }
  async serviceHistory(
    tenantId: string,
    id: string,
    sectorIds: string[],
    page = 1,
  ) {
    if (
      !(await this.prisma.service.findFirst({
        where: { tenantId, id, sectorId: { in: sectorIds } },
        select: { id: true },
      }))
    )
      throw new NotFoundException("Servizio non trovato");
    return this.history({ tenantId, serviceId: id }, page);
  }
  private async history(
    where: Prisma.CatalogPriceHistoryWhereInput,
    page: number,
  ) {
    if (!Number.isInteger(page) || page < 1 || page > 100000)
      throw new BadRequestException("Pagina non valida");
    const [items, total] = await Promise.all([
      this.prisma.catalogPriceHistory.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.catalogPriceHistory.count({ where }),
    ]);
    return { items, total, page, pageSize: 50, hasMore: page * 50 < total };
  }
}

/** Public booking displays gross when a VAT mode is explicitly configured. Legacy stays unchanged. */
export function catalogGross(entry: {
  priceMode?: string;
  vatRate?: unknown;
  basePrice: unknown;
}) {
  return priceLine({
    unitPrice: entry.basePrice,
    priceMode: (entry.priceMode ?? "legacy") as PriceMode,
    vatRate: entry.vatRate,
  }).grossTotal;
}
