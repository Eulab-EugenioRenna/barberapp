import { Prisma } from "@prisma/client";
import { decimalInput } from "../pricing/money";
export interface PaymentAmount {
  id: string;
  kind: string;
  amount: Prisma.Decimal | string;
  refundOfId?: string | null;
}
/** No cash amount can be recovered from a legacy status or method. */
export function paymentBalance(
  total: Prisma.Decimal | string,
  basis: string,
  entries: PaymentAmount[],
) {
  const value = decimalInput(total, "Totale conto");
  if (basis === "legacy_unknown") {
    if (entries.length)
      throw new Error("Registro presente su storico non riconciliato");
    return {
      basis,
      total: value.toFixed(2),
      opening: null,
      receipts: null,
      refunds: null,
      netReceived: null,
      remaining: null,
      status: null,
    };
  }
  if (basis !== "ledger") throw new Error("Base pagamento non valida");
  let opening = new Prisma.Decimal(0),
    receipts = new Prisma.Decimal(0),
    refunds = new Prisma.Decimal(0);
  const originals = new Map<string, Prisma.Decimal>();
  const refunded = new Map<string, Prisma.Decimal>();
  let openings = 0;
  for (const row of entries) {
    const amount = decimalInput(row.amount, "Importo pagamento");
    if (row.kind === "opening") {
      if (++openings > 1 || row.refundOfId)
        throw new Error("Saldo iniziale duplicato o non valido");
      opening = opening.plus(amount);
      originals.set(row.id, amount);
    } else if (row.kind === "receipt") {
      if (amount.isZero() || row.refundOfId)
        throw new Error("Incasso non valido");
      receipts = receipts.plus(amount);
      originals.set(row.id, amount);
    } else if (row.kind === "refund") {
      if (amount.isZero() || !row.refundOfId)
        throw new Error("Rimborso non valido");
      refunds = refunds.plus(amount);
      refunded.set(
        row.refundOfId,
        (refunded.get(row.refundOfId) ?? new Prisma.Decimal(0)).plus(amount),
      );
    } else throw new Error("Tipo movimento non valido");
  }
  for (const [id, amount] of refunded) {
    const original = originals.get(id);
    if (!original || amount.greaterThan(original))
      throw new Error("Rimborso oltre incasso originale");
  }
  const net = opening.plus(receipts).minus(refunds);
  if (net.isNegative() || net.greaterThan(value))
    throw new Error("Incasso netto fuori totale conto");
  const status = net.isZero()
    ? refunds.greaterThan(0)
      ? "refunded"
      : "unpaid"
    : net.equals(value)
      ? "paid"
      : "partial";
  return {
    basis,
    total: value.toFixed(2),
    opening: opening.toFixed(2),
    receipts: receipts.toFixed(2),
    refunds: refunds.toFixed(2),
    netReceived: net.toFixed(2),
    remaining: value.minus(net).toFixed(2),
    status,
  };
}
