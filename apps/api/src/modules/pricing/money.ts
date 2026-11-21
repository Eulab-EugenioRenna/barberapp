import { Prisma } from "@prisma/client";

export type PriceMode = "legacy" | "net" | "gross";
type Decimal = Prisma.Decimal;
const D = Prisma.Decimal;
const ZERO = new D(0);
const HALF_UP = D.ROUND_HALF_UP;
export const roundMoney = (value: Decimal) => value.toDecimalPlaces(2, HALF_UP);

/** Accept decimal strings at the boundary; never do arithmetic on JS numbers. */
export function decimalInput(
  value: unknown,
  field: string,
  scale = 2,
): Decimal {
  const text =
    value instanceof D ? value.toFixed() : String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text) || text.length > 30)
    throw new Error(`${field}: valore decimale non valido`);
  const result = new D(text).toDecimalPlaces(scale, HALF_UP);
  if (result.greaterThan(new D("100000000").minus(new D(10).pow(-scale))))
    throw new Error(`${field}: valore troppo elevato`);
  return result;
}

export interface PricedLine {
  priceMode: PriceMode;
  unitPrice: string;
  quantity: string;
  vatRate: string | null;
  discount: string;
  lineSubtotal: string;
  discountNet: string;
  lineTotal: string;
  taxTotal: string;
  grossTotal: string;
}

export function priceLine(input: {
  unitPrice: unknown;
  quantity?: unknown;
  discount?: unknown;
  priceMode?: PriceMode;
  vatRate?: unknown;
  legacyTaxTotal?: unknown;
}): PricedLine {
  const mode = input.priceMode ?? "legacy";
  if (!["legacy", "net", "gross"].includes(mode))
    throw new Error("Modalità prezzo non valida");
  const unit = decimalInput(input.unitPrice, "Prezzo"),
    quantity = decimalInput(input.quantity ?? 1, "Quantità", 3),
    discount = decimalInput(input.discount ?? 0, "Sconto");
  if (quantity.isZero())
    throw new Error("Quantità: deve essere maggiore di zero");
  const enteredSubtotal = roundMoney(unit.times(quantity));
  if (discount.greaterThan(enteredSubtotal))
    throw new Error("Lo sconto supera il valore della riga");
  const enteredTotal = enteredSubtotal.minus(discount);
  let rate: Decimal | null = null;
  let subtotal: Decimal, net: Decimal, tax: Decimal;
  if (mode === "legacy") {
    subtotal = enteredSubtotal;
    net = enteredTotal;
    tax = decimalInput(input.legacyTaxTotal ?? 0, "IVA registrata");
  } else {
    if (
      input.vatRate === undefined ||
      input.vatRate === null ||
      input.vatRate === ""
    )
      throw new Error("Indica l'aliquota IVA per il prezzo netto o lordo");
    rate = decimalInput(input.vatRate, "Aliquota IVA");
    if (rate.greaterThan(100)) throw new Error("Aliquota IVA non valida");
    const factor = rate.dividedBy(100).plus(1);
    if (mode === "gross") {
      subtotal = roundMoney(enteredSubtotal.dividedBy(factor));
      net = roundMoney(enteredTotal.dividedBy(factor));
      tax = enteredTotal.minus(net);
    } else {
      subtotal = enteredSubtotal;
      net = enteredTotal;
      tax = roundMoney(net.times(rate).dividedBy(100));
    }
  }
  const gross = net.plus(tax);
  if (
    [subtotal, net, tax, gross].some((value) =>
      value.greaterThan("99999999.99"),
    )
  )
    throw new Error("Totale riga troppo elevato");
  return {
    priceMode: mode,
    unitPrice: unit.toFixed(2),
    quantity: quantity.toFixed(3),
    vatRate: rate?.toFixed(2) ?? null,
    discount: discount.toFixed(2),
    lineSubtotal: subtotal.toFixed(2),
    discountNet: subtotal.minus(net).toFixed(2),
    lineTotal: net.toFixed(2),
    taxTotal: tax.toFixed(2),
    grossTotal: gross.toFixed(2),
  };
}

/** Largest remainder allocation in integer cents; input order breaks exact ties. */
export function allocateDiscount(
  grossTotals: string[],
  amount: unknown,
): string[] {
  const weights = grossTotals.map((value) =>
    decimalInput(value, "Totale riga").times(100),
  );
  const total = weights.reduce((sum, value) => sum.plus(value), ZERO);
  const cents = decimalInput(amount, "Sconto complessivo").times(100);
  if (cents.greaterThan(total))
    throw new Error("Lo sconto complessivo supera il conto");
  if (total.isZero()) return weights.map(() => "0.00");
  const shares = weights.map((weight, index) => {
    const numerator = weight.times(cents),
      quotient = numerator.dividedToIntegerBy(total);
    return {
      index,
      quotient,
      remainder: numerator.minus(quotient.times(total)),
    };
  });
  let remaining = cents.minus(
    shares.reduce((sum, row) => sum.plus(row.quotient), ZERO),
  );
  for (const row of [...shares].sort(
    (a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index,
  )) {
    if (remaining.isZero()) break;
    row.quotient = row.quotient.plus(1);
    remaining = remaining.minus(1);
  }
  return shares.map((row) => row.quotient.dividedBy(100).toFixed(2));
}

/** The final order discount is explicitly a gross amount, independent of entry mode. */
export function applyOrderDiscount(
  lines: PricedLine[],
  amount: unknown,
): PricedLine[] {
  const allocated = allocateDiscount(
    lines.map((line) => line.grossTotal),
    amount,
  );
  return lines.map((line, index) => {
    const reduction = new D(allocated[index]);
    if (reduction.isZero()) return { ...line };
    if (line.priceMode === "legacy" && !new D(line.taxTotal).isZero())
      throw new Error(
        "Specifica la modalità IVA prima dello sconto complessivo su righe con IVA storica",
      );
    const gross = new D(line.grossTotal).minus(reduction);
    const net =
      line.vatRate === null
        ? gross
        : roundMoney(
            gross.dividedBy(new D(line.vatRate).dividedBy(100).plus(1)),
          );
    return {
      ...line,
      lineTotal: net.toFixed(2),
      taxTotal: gross.minus(net).toFixed(2),
      grossTotal: gross.toFixed(2),
      discountNet: new D(line.lineSubtotal).minus(net).toFixed(2),
    };
  });
}

export function sumPricedLines(
  lines: Pick<
    PricedLine,
    "lineSubtotal" | "discountNet" | "lineTotal" | "taxTotal"
  >[],
) {
  const sum = (field: keyof (typeof lines)[number]) =>
    lines.reduce((total, line) => total.plus(line[field]), ZERO);
  const result = {
    subtotal: sum("lineSubtotal"),
    discountTotal: sum("discountNet"),
    taxTotal: sum("taxTotal"),
    total: sum("lineTotal").plus(sum("taxTotal")),
  };
  if (Object.values(result).some((value) => value.greaterThan("99999999.99")))
    throw new Error("Totale conto troppo elevato");
  return Object.fromEntries(
    Object.entries(result).map(([key, value]) => [key, value.toFixed(2)]),
  ) as {
    subtotal: string;
    discountTotal: string;
    taxTotal: string;
    total: string;
  };
}
