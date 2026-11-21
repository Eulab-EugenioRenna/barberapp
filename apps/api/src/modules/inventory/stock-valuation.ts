import { Prisma } from "@prisma/client";
import { decimalInput, roundMoney } from "../pricing/money";

const D = Prisma.Decimal;
const six = (value: Prisma.Decimal) =>
  value.toDecimalPlaces(6, D.ROUND_HALF_UP);
export interface ValuedStock {
  initialized: boolean;
  quantity: string;
  value: string;
}

/** Purchase tax is supplied explicitly; sale tax is deliberately absent from this contract. */
export function quoteReceipt(input: {
  quantity: unknown;
  unitCost: unknown;
  purchaseVatRate: unknown;
  costMode: "net" | "gross";
}) {
  if (!["net", "gross"].includes(input.costMode))
    throw new Error("Indica la modalità del costo di acquisto");
  const quantity = decimalInput(input.quantity, "Quantità", 3);
  const unitCost = decimalInput(input.unitCost, "Costo unitario", 6);
  const rate = decimalInput(input.purchaseVatRate, "IVA acquisto");
  if (quantity.isZero()) throw new Error("Quantità di carico non valida");
  if (rate.greaterThan(100)) throw new Error("Aliquota acquisto non valida");
  const entered = roundMoney(unitCost.times(quantity));
  const net =
    input.costMode === "gross"
      ? roundMoney(entered.dividedBy(rate.dividedBy(100).plus(1)))
      : entered;
  const tax =
    input.costMode === "gross"
      ? entered.minus(net)
      : roundMoney(net.times(rate).dividedBy(100));
  return {
    quantity: quantity.toFixed(3),
    netValue: net.toFixed(6),
    purchaseTax: tax.toFixed(2),
    grossValue: net.plus(tax).toFixed(2),
    purchaseVatRate: rate.toFixed(2),
    unitNetCost: six(net.dividedBy(quantity)).toFixed(6),
  };
}

/** Pure valuation rule. Persistence, authorization and idempotency belong to the ledger command. */
export function valueStockChange(
  balance: ValuedStock,
  change: {
    direction: "in" | "out";
    quantity: unknown;
    incomingValue?: unknown;
    opening?: boolean;
  },
) {
  const oldQuantity = decimalInput(balance.quantity, "Giacenza", 3);
  const oldValue = decimalInput(balance.value, "Valore di giacenza", 6);
  const quantity = decimalInput(change.quantity, "Quantità movimento", 3);
  if (oldQuantity.isZero() && !oldValue.isZero())
    throw new Error("Giacenza e valore non riconciliati");
  if (!balance.initialized && !change.opening)
    throw new Error("Registra prima la giacenza iniziale o l'inventario");
  if (
    change.opening &&
    (balance.initialized || !oldQuantity.isZero() || !oldValue.isZero())
  )
    throw new Error("La giacenza iniziale è già registrata");
  if (change.opening && change.direction !== "in")
    throw new Error("Apertura non valida");
  if (quantity.isZero() && !change.opening)
    throw new Error("Quantità movimento non valida");
  const inwards = change.direction === "in";
  if (!inwards && quantity.greaterThan(oldQuantity))
    throw new Error("Giacenza insufficiente");
  let value: Prisma.Decimal;
  if (inwards) {
    if (change.incomingValue === undefined || change.incomingValue === null)
      throw new Error("Indica il valore netto del carico");
    value = decimalInput(change.incomingValue, "Valore netto", 6);
    if (quantity.isZero() && !value.isZero())
      throw new Error("Un'apertura senza quantità deve avere valore zero");
  } else {
    // Clear the residual exactly on the final issue; never leave value on an empty balance.
    value = quantity.equals(oldQuantity)
      ? oldValue
      : six(oldValue.times(quantity).dividedBy(oldQuantity));
  }
  const quantityDelta = inwards ? quantity : quantity.negated();
  const valueDelta = inwards ? value : value.negated();
  const newQuantity = oldQuantity.plus(quantityDelta),
    newValue = oldValue.plus(valueDelta);
  if (
    newQuantity.greaterThan("99999999.999") ||
    newValue.greaterThan("99999999.999999")
  )
    throw new Error("Giacenza o valore troppo elevati");
  return {
    initialized: true,
    quantity: newQuantity.toFixed(3),
    value: newValue.toFixed(6),
    averageCost: newQuantity.isZero()
      ? "0.000000"
      : six(newValue.dividedBy(newQuantity)).toFixed(6),
    quantityDelta: quantityDelta.toFixed(3),
    valueDelta: valueDelta.toFixed(6),
  };
}
