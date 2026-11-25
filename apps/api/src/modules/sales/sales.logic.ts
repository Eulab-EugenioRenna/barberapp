import { Prisma } from "@prisma/client";
import {
  priceLine,
  applyOrderDiscount,
  type PriceMode,
  type PricedLine,
} from "../pricing/money";
export type OrderItemInput = Record<string, unknown>;

export type ProductCatalogEntry = {
  id: string;
  name: string;
  price: unknown;
  priceMode?: string;
  vatRate?: unknown;
};

export type ServiceCatalogEntry = {
  id: string;
  name: string;
  basePrice: unknown;
  priceMode?: string;
  vatRate?: unknown;
};

export type NormalizedOrderItem = {
  productId?: string;
  serviceId?: string;
  collaboratorId?: string;
  nonPerformanceChargeReason?: string | null;
  label: string;
  quantity: number;
  unitPrice: string;
  discount: string;
  taxTotal: string;
  lineTotal: string;
  priceMode: PriceMode;
  vatRate: string | null;
  lineSubtotal: string;
  discountNet: string;
  orderDiscountShare: string;
  priceOverrideReason?: string;
};

export type LabelResolvableItem = {
  label?: string | null;
  product?: { name?: string | null } | null;
  service?: { name?: string | null } | null;
};

/**
 * The stored `label` is only a fallback snapshot taken when the order was
 * created. The display label must always be resolved from the linked catalog
 * entity so renames show up immediately; the snapshot is used only when the
 * product/service has been deleted (FK set to null).
 */
export function resolveSaleItemLabel(item: LabelResolvableItem): string {
  return item.service?.name ?? item.product?.name ?? item.label ?? "Articolo";
}

export function resolveSaleItemLabels<T extends LabelResolvableItem>(
  items: T[],
): Array<Omit<T, "label"> & { label: string }> {
  return items.map((item) => ({ ...item, label: resolveSaleItemLabel(item) }));
}

export function resolveSaleLabels<T extends { items?: LabelResolvableItem[] }>(
  entity: T,
): T {
  if (!entity || !Array.isArray(entity.items)) {
    return entity;
  }

  return {
    ...entity,
    items: resolveSaleItemLabels(entity.items) as T["items"],
  };
}

export function calculateRetroactiveAppointment(input: {
  soldAt: Date;
  items: NormalizedOrderItem[];
  services: Array<ServiceCatalogEntry & { durationMinutes: number }>;
}) {
  const serviceItems = input.items.filter((item) => item.serviceId);
  const durationMinutes = serviceItems.reduce((sum, item) => {
    const service = input.services.find((entry) => entry.id === item.serviceId);
    return sum + Number(service?.durationMinutes ?? 0) * item.quantity;
  }, 0);
  const serviceTotal = serviceItems
    .reduce(
      (sum, item) => sum.plus(item.lineTotal).plus(item.taxTotal),
      new Prisma.Decimal(0),
    )
    .toFixed(2);

  return {
    serviceItems,
    primaryServiceId: serviceItems[0]?.serviceId,
    durationMinutes,
    serviceTotal,
    startsAt: new Date(input.soldAt.getTime() - durationMinutes * 60_000),
    endsAt: input.soldAt,
  };
}

type ExistingItem = {
  collaboratorId?: string | null;
  nonPerformanceChargeReason?: string | null;
  id: string;
  productId: string | null;
  serviceId: string | null;
  label: string;
  unitPrice: unknown;
  discount: unknown;
  taxTotal: unknown;
  priceMode: string;
  vatRate: unknown;
  priceOverrideReason: string | null;
};
export function normalizeOrderItems(input: {
  items: OrderItemInput[];
  products: ProductCatalogEntry[];
  services: ServiceCatalogEntry[];
  existing?: ExistingItem[];
  orderDiscount?: unknown;
}): NormalizedOrderItem[] {
  if (
    !input.items.length ||
    input.items.length > 200 ||
    input.items.some(
      (row) => !row || typeof row !== "object" || Array.isArray(row),
    )
  )
    throw Error("Aggiungi da una a 200 righe valide");
  const used = new Set<string>();
  const priced: PricedLine[] = [];
  const rows = input.items.map((item, index) => {
    const productId =
      typeof item["productId"] === "string" ? item["productId"] : "";
    const serviceId =
      typeof item["serviceId"] === "string" ? item["serviceId"] : "";
    const kind =
      item["kind"] === "service" || serviceId ? "service" : "product";
    let old = input.existing?.find((row) => row.id === item["id"]);
    if (!item["id"]) {
      const matches =
        input.existing?.filter(
          (row) =>
            !used.has(row.id) &&
            (row.productId || "") === productId &&
            (row.serviceId || "") === serviceId,
        ) || [];
      if (matches.length === 1) old = matches[0];
    }
    if (
      old &&
      ((old.productId || "") !== productId ||
        (old.serviceId || "") !== serviceId)
    )
      old = undefined;
    if (old) used.add(old.id);
    const product = input.products.find((row) => row.id === productId),
      service = input.services.find((row) => row.id === serviceId);
    const catalog = kind === "service" ? service : product;
    if (!catalog && !old) throw Error(`Riga ${index + 1}: articolo non valido`);
    const catalogPrice =
      kind === "service" ? service?.basePrice : product?.price;
    const hasExplicit =
      item["unitPrice"] !== undefined && item["unitPrice"] !== "";
    const unitPrice = hasExplicit
      ? item["unitPrice"]
      : (old?.unitPrice ?? catalogPrice);
    if (unitPrice === null || unitPrice === undefined)
      throw Error(`Riga ${index + 1}: inserisci il prezzo`);
    const quantity = Number(item["quantity"] ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000)
      throw Error(`Riga ${index + 1}: quantità non valida`);
    const mode = String(
      item["priceMode"] ?? old?.priceMode ?? catalog?.priceMode ?? "legacy",
    ) as PriceMode;
    const vatRate =
      item["vatRate"] === undefined
        ? (old?.vatRate ?? catalog?.vatRate)
        : item["vatRate"];
    let reason =
      typeof item["priceOverrideReason"] === "string"
        ? item["priceOverrideReason"].trim()
        : old?.priceOverrideReason || undefined;
    const baseRate = old?.vatRate ?? catalog?.vatRate;
    const changedRate =
      item["vatRate"] !== undefined &&
      !(item["vatRate"] == null && baseRate == null) &&
      (item["vatRate"] == null ||
        baseRate == null ||
        !new Prisma.Decimal(String(item["vatRate"])).equals(String(baseRate)));
    const baselinePrice = old?.unitPrice ?? catalogPrice;
    const changedPrice =
      baselinePrice !== null &&
      baselinePrice !== undefined &&
      new Prisma.Decimal(String(unitPrice)).comparedTo(
        String(baselinePrice),
      ) !== 0;
    const changedMode =
      mode !== (old?.priceMode ?? catalog?.priceMode ?? "legacy");
    // A price typed at the till is audited with an automatic reason; VAT and
    // price-mode changes still need one written by a person.
    if (!changedRate && !changedMode && mode !== "legacy" && changedPrice && (!reason || reason.length < 3))
      reason = "Prezzo modificato in cassa";
    if (
      (changedRate || changedMode || (mode !== "legacy" && changedPrice)) &&
      (!reason || reason.length < 3)
    )
      throw Error(
        `Riga ${index + 1}: indica il motivo della modifica a prezzo o IVA`,
      );
    if (reason && reason.length > 500)
      throw Error(`Riga ${index + 1}: motivazione troppo lunga`);
    const chargeReason = item["nonPerformanceChargeReason"];
    if (
      chargeReason !== undefined &&
      chargeReason !== null &&
      (typeof chargeReason !== "string" ||
        (chargeReason.trim() &&
          (chargeReason.trim().length < 3 ||
            chargeReason.trim().length > 500)) ||
        kind !== "service")
    )
      throw Error(
        `Riga ${index + 1}: motivo della quota per servizio non eseguito non valido`,
      );
    const line = priceLine({
      unitPrice,
      quantity,
      priceMode: mode,
      vatRate,
      discount: item["discount"] ?? old?.discount ?? 0,
      legacyTaxTotal: item["taxTotal"] ?? old?.taxTotal ?? 0,
    });
    priced.push(line);
    return {
      productId: product?.id ?? old?.productId ?? undefined,
      serviceId: service?.id ?? old?.serviceId ?? undefined,
      collaboratorId:
        kind !== "service"
          ? undefined
          : item["collaboratorId"] === undefined
            ? old?.collaboratorId || undefined
            : typeof item["collaboratorId"] === "string"
              ? item["collaboratorId"] || undefined
              : undefined,
      nonPerformanceChargeReason:
        item["nonPerformanceChargeReason"] === undefined
          ? old?.nonPerformanceChargeReason || null
          : typeof item["nonPerformanceChargeReason"] === "string"
            ? item["nonPerformanceChargeReason"].trim() || null
            : null,
      label: catalog?.name ?? old?.label ?? "Articolo",
      quantity,
      priceOverrideReason: reason,
    };
  });
  const final = applyOrderDiscount(priced, input.orderDiscount ?? 0);
  return rows.map((row, index) => {
    const line = final[index];
    return {
      ...row,
      unitPrice: line.unitPrice,
      discount: line.discount,
      taxTotal: line.taxTotal,
      lineTotal: line.lineTotal,
      priceMode: line.priceMode,
      vatRate: line.vatRate,
      lineSubtotal: line.lineSubtotal,
      discountNet: line.discountNet,
      orderDiscountShare: new Prisma.Decimal(priced[index].grossTotal)
        .minus(line.grossTotal)
        .toFixed(2),
    };
  });
}
