/** Cart quantity as the server accepts it: whole number, at least 1. */
export function wholeQuantity(value: unknown): number {
  const quantity = Math.trunc(Number(value));
  return Number.isFinite(quantity) && quantity >= 1 ? quantity : 1;
}
