export function minutesBetween(startsAt: Date, endsAt: Date): number {
  return Math.max(0, Math.round((endsAt.getTime() - startsAt.getTime()) / 60000));
}

export function overlapsRange(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date
): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toLocalDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatCurrency(amount: number, currency = 'EUR', locale = 'it-IT'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency
  }).format(amount);
}
