export type OrderItemInput = Record<string, unknown>;

export type ProductCatalogEntry = {
  id: string;
  name: string;
  price: unknown;
};

export type ServiceCatalogEntry = {
  id: string;
  name: string;
  basePrice: unknown;
};

export type NormalizedOrderItem = {
  productId?: string;
  serviceId?: string;
  collaboratorId?: string;
  label: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxTotal: number;
  lineTotal: number;
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

  return { ...entity, items: resolveSaleItemLabels(entity.items) as T["items"] };
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
  const serviceTotal = serviceItems.reduce(
    (sum, item) => sum + item.lineTotal + item.taxTotal,
    0,
  );

  return {
    serviceItems,
    primaryServiceId: serviceItems[0]?.serviceId,
    durationMinutes,
    serviceTotal,
    startsAt: new Date(input.soldAt.getTime() - durationMinutes * 60_000),
    endsAt: input.soldAt,
  };
}

function money(value: unknown, fallback = 0): number {
  const parsed = value === "" || value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeOrderItems(input: {
  items: OrderItemInput[];
  products: ProductCatalogEntry[];
  services: ServiceCatalogEntry[];
}): NormalizedOrderItem[] {
  return input.items.map((item, index) => {
    const productId =
      typeof item["productId"] === "string" ? item["productId"] : "";
    const serviceId =
      typeof item["serviceId"] === "string" ? item["serviceId"] : "";
    const kind =
      item["kind"] === "service" || serviceId ? "service" : "product";
    const product = input.products.find((entry) => entry.id === productId);
    const service = input.services.find((entry) => entry.id === serviceId);

    if ((kind === "product" && !product) || (kind === "service" && !service)) {
      throw new Error(`Riga ${index + 1}: articolo non valido`);
    }

    const catalogPrice =
      kind === "service" ? service?.basePrice : product?.price;
    const hasExplicitPrice =
      item["unitPrice"] !== undefined && item["unitPrice"] !== "";

    if (
      !hasExplicitPrice &&
      (catalogPrice === null || catalogPrice === undefined)
    ) {
      throw new Error(`Riga ${index + 1}: inserisci il prezzo`);
    }

    const quantity = Math.max(1, Math.trunc(money(item["quantity"], 1)));
    const unitPrice = money(
      hasExplicitPrice ? item["unitPrice"] : catalogPrice,
      -1,
    );
    const discount = Math.max(0, money(item["discount"]));
    const taxTotal = Math.max(0, money(item["taxTotal"]));

    if (unitPrice < 0) {
      throw new Error(`Riga ${index + 1}: prezzo non valido`);
    }
    if (discount > quantity * unitPrice) {
      throw new Error(
        `Riga ${index + 1}: lo sconto supera il valore della riga`,
      );
    }
    return {
      productId: product?.id,
      serviceId: service?.id,
      collaboratorId:
        kind === "service" && typeof item["collaboratorId"] === "string"
          ? item["collaboratorId"]
          : undefined,
      label: (service ?? product)?.name ?? "Articolo",
      quantity,
      unitPrice,
      discount,
      taxTotal,
      lineTotal: quantity * unitPrice - discount,
    };
  });
}
