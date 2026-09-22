export function normalizeCacheToken(value?: string | null): string {
  if (!value) {
    return "default";
  }

  return value.trim().toLowerCase() || "default";
}
