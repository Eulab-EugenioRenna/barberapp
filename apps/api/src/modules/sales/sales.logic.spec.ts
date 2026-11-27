import {
  calculateRetroactiveAppointment,
  normalizeOrderItems,
  resolveSaleItemLabels,
} from "./sales.logic";

describe("normalizeOrderItems", () => {
  const products = [
    { id: "p-priced", name: "Shampoo", price: 12 },
    { id: "p-open", name: "Prodotto libero", price: null },
  ];
  const services = [{ id: "s-cut", name: "Taglio", basePrice: 25 }];

  it("records an automatic reason for a price typed at the till, and for VAT changes", () => {
    const taxed = [{ id: "s-vat", name: "Taglio", basePrice: 20, priceMode: "gross", vatRate: 22 }] as any;
    const [row] = normalizeOrderItems({ products, services: taxed, items: [{ serviceId: "s-vat", unitPrice: 18 }] });
    expect(row.priceOverrideReason).toBe("Prezzo modificato in cassa");
    const [vat] = normalizeOrderItems({ products, services: taxed, items: [{ serviceId: "s-vat", vatRate: 10 }] });
    expect(vat.priceOverrideReason).toBe("Prezzo o IVA modificati in cassa");
  });

  it("crea nello stesso ordine righe servizio e prodotto senza prenotazione", () => {
    const result = normalizeOrderItems({
      products,
      services,
      items: [
        {
          kind: "service",
          serviceId: "s-cut",
        },
        { kind: "product", productId: "p-priced", quantity: 2 },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        serviceId: "s-cut",
        unitPrice: "25.00",
      }),
      expect.objectContaining({
        productId: "p-priced",
        quantity: 2,
        lineTotal: "24.00",
      }),
    ]);
  });

  it("preserves a declared actual performer when omitted, while an explicit empty selection clears it", () => {
    const old = {
      ...normalizeOrderItems({
        products,
        services,
        items: [{ serviceId: "s-cut" }],
      })[0],
      id: "stable-row",
      productId: null,
      serviceId: "s-cut",
      collaboratorId: "actual-worker",
      priceOverrideReason: null,
    };
    expect(
      normalizeOrderItems({
        products,
        services,
        existing: [old],
        items: [{ id: old.id, serviceId: "s-cut" }],
      })[0].collaboratorId,
    ).toBe("actual-worker");
    expect(
      normalizeOrderItems({
        products,
        services,
        existing: [old],
        items: [{ id: old.id, serviceId: "s-cut", collaboratorId: "" }],
      })[0].collaboratorId,
    ).toBeUndefined();
  });
  it("does not infer a performer or a cancellation charge for a new service", () => {
    const row = normalizeOrderItems({
      products,
      services,
      items: [{ serviceId: "s-cut" }],
    })[0];
    expect(row.collaboratorId).toBeUndefined();
    expect(row.nonPerformanceChargeReason).toBeNull();
    expect(() =>
      normalizeOrderItems({
        products,
        services,
        items: [{ serviceId: "s-cut", nonPerformanceChargeReason: "x" }],
      }),
    ).toThrow("motivo della quota");
  });
  it("richiede un prezzo al checkout per un prodotto senza listino", () => {
    expect(() =>
      normalizeOrderItems({
        products,
        services,
        items: [{ productId: "p-open" }],
      }),
    ).toThrow("inserisci il prezzo");

    expect(
      normalizeOrderItems({
        products,
        services,
        items: [{ productId: "p-open", unitPrice: 18.5 }],
      })[0].unitPrice,
    ).toBe("18.50");
  });

  it("impedisce totali negativi", () => {
    expect(() =>
      normalizeOrderItems({
        products,
        services,
        items: [{ productId: "p-priced", unitPrice: 12, discount: 13 }],
      }),
    ).toThrow("sconto supera");
  });

  it("colloca l'appuntamento prima dell'istante di vendita sommando le durate", () => {
    const soldAt = new Date("2026-09-22T12:00:00.000Z");
    const items = normalizeOrderItems({
      products,
      services,
      items: [{ serviceId: "s-cut", quantity: 2 }],
    });
    const appointment = calculateRetroactiveAppointment({
      soldAt,
      items,
      services: [{ ...services[0], durationMinutes: 30 }],
    });

    expect(appointment.endsAt).toEqual(soldAt);
    expect(appointment.startsAt.toISOString()).toBe("2026-09-22T11:00:00.000Z");
    expect(appointment.durationMinutes).toBe(60);
  });

  it("mantiene il collaboratore sulla sola riga servizio", () => {
    const [service, product] = normalizeOrderItems({
      products,
      services,
      items: [
        { serviceId: "s-cut", collaboratorId: "c-marco" },
        { productId: "p-priced", collaboratorId: "c-marco" },
      ],
    });

    expect(service.collaboratorId).toBe("c-marco");
    expect(product.collaboratorId).toBeUndefined();
  });
});

describe("resolveSaleItemLabels", () => {
  it("usa il nome corrente del servizio/prodotto associato", () => {
    const [serviceItem, productItem] = resolveSaleItemLabels([
      { label: "Taglio (vecchio)", service: { name: "Taglio nuovo" } },
      { label: "Shampoo (vecchio)", product: { name: "Shampoo nuovo" } },
    ]);

    expect(serviceItem.label).toBe("Taglio nuovo");
    expect(productItem.label).toBe("Shampoo nuovo");
  });

  it("mantiene lo snapshot quando l'articolo è stato eliminato", () => {
    const [item] = resolveSaleItemLabels([
      { label: "Prodotto eliminato", product: null, service: null },
    ]);

    expect(item.label).toBe("Prodotto eliminato");
  });
});

describe("priced order snapshots", () => {
  const product = {
    id: "p",
    name: "Product",
    price: "12.20",
    priceMode: "gross",
    vatRate: "22",
  };
  it("uses the configured entry mode and keeps net, VAT and gross reconcilable", () => {
    const [row] = normalizeOrderItems({
      products: [product],
      services: [],
      items: [{ productId: "p", quantity: 3 }],
    });
    expect(row).toMatchObject({
      unitPrice: "12.20",
      priceMode: "gross",
      vatRate: "22.00",
      lineSubtotal: "30.00",
      lineTotal: "30.00",
      taxTotal: "6.60",
    });
  });
  it("retains the stored price and rate when the catalog later changes", () => {
    const old = {
      id: "row",
      productId: "p",
      serviceId: null,
      label: "Historical",
      unitPrice: "12.20",
      discount: 0,
      taxTotal: "2.20",
      priceMode: "gross",
      vatRate: "22",
      priceOverrideReason: null,
    };
    const [row] = normalizeOrderItems({
      products: [{ ...product, price: "15.60", vatRate: "4" }],
      services: [],
      existing: [old],
      items: [{ id: "row", productId: "p", quantity: 1 }],
    });
    expect(row).toMatchObject({
      unitPrice: "12.20",
      vatRate: "22.00",
      lineTotal: "10.00",
      taxTotal: "2.20",
    });
  });
  it("records a default reason for VAT overrides and price changes, and compares equivalent decimal rates numerically", () => {
    expect(
      normalizeOrderItems({
        products: [product],
        services: [],
        items: [{ productId: "p", unitPrice: "11.00" }],
      })[0].priceOverrideReason,
    ).toBe("Prezzo modificato in cassa");
    expect(
      normalizeOrderItems({
        products: [product],
        services: [],
        items: [{ productId: "p", vatRate: "4" }],
      })[0].priceOverrideReason,
    ).toBe("Prezzo o IVA modificati in cassa");
    expect(
      normalizeOrderItems({
        products: [product],
        services: [],
        items: [{ productId: "p", vatRate: "22.00" }],
      }),
    ).toHaveLength(1);
    expect(
      normalizeOrderItems({
        products: [product],
        services: [],
        items: [
          {
            productId: "p",
            unitPrice: "11.00",
            priceOverrideReason: "Accordo cliente",
          },
        ],
      }),
    ).toHaveLength(1);
  });
  it("allocates order discount across rows without changing input prices", () => {
    const rows = normalizeOrderItems({
      products: [product],
      services: [],
      items: [{ productId: "p" }, { productId: "p" }, { productId: "p" }],
      orderDiscount: "0.01",
    });
    expect(rows.map((row) => row.orderDiscountShare)).toEqual([
      "0.01",
      "0.00",
      "0.00",
    ]);
    expect(rows.map((row) => row.unitPrice)).toEqual([
      "12.20",
      "12.20",
      "12.20",
    ]);
  });
  it("preserves an editable historical line whose catalog reference was deleted", () => {
    const [row] = normalizeOrderItems({
      products: [],
      services: [],
      existing: [
        {
          id: "old",
          productId: null,
          serviceId: null,
          label: "Deleted catalog record",
          unitPrice: "1.17",
          discount: 0,
          taxTotal: 0,
          priceMode: "legacy",
          vatRate: null,
          priceOverrideReason: null,
        },
      ],
      items: [{ id: "old", unitPrice: "1.17" }],
    });
    expect(row.label).toBe("Deleted catalog record");
    expect(row.lineTotal).toBe("1.17");
  });
});
