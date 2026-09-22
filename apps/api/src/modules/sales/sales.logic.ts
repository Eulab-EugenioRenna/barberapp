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
  label: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxTotal: number;
  lineTotal: number;
  stationIds: string[];
};

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
  validStationIds: Set<string>;
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
    const stationIds = Array.isArray(item["stationIds"])
      ? [
          ...new Set(
            item["stationIds"].filter(
              (value): value is string =>
                typeof value === "string" && value.length > 0,
            ),
          ),
        ]
      : [];

    if (unitPrice < 0) {
      throw new Error(`Riga ${index + 1}: prezzo non valido`);
    }
    if (discount > quantity * unitPrice) {
      throw new Error(
        `Riga ${index + 1}: lo sconto supera il valore della riga`,
      );
    }
    if (stationIds.some((id) => !input.validStationIds.has(id))) {
      throw new Error(`Riga ${index + 1}: postazione non valida`);
    }
    if (kind === "product" && stationIds.length) {
      throw new Error(
        `Riga ${index + 1}: le postazioni sono disponibili solo per i servizi`,
      );
    }

    return {
      productId: product?.id,
      serviceId: service?.id,
      label: (service ?? product)?.name ?? "Articolo",
      quantity,
      unitPrice,
      discount,
      taxTotal,
      lineTotal: quantity * unitPrice - discount,
      stationIds,
    };
  });
}
