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
        unitPrice: 25,
      }),
      expect.objectContaining({
        productId: "p-priced",
        quantity: 2,
        lineTotal: 24,
      }),
    ]);
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
    ).toBe(18.5);
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
