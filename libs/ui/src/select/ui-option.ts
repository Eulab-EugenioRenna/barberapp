/** Value carried by an option. `null` is a legitimate choice ("Nessuno"). */
export type UiOptionValue = string | number | boolean | null;

export interface UiOption<T extends UiOptionValue = UiOptionValue> {
  value: T;
  label: string;
  /** Secondary line, also searched by the filter. */
  hint?: string;
  disabled?: boolean;
  /** Options with the same group are listed under a heading. */
  group?: string;
}

/** Case and accent insensitive match on label and hint. */
export function uiOptionMatches(option: UiOption, query: string): boolean {
  const needle = normalize(query);
  if (!needle) return true;
  return normalize(`${option.label} ${option.hint ?? ""}`).includes(needle);
}

export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Builds options from any list, e.g. `uiOptions(locations, l => l.id, l => l.name)`. */
export function uiOptions<T, V extends UiOptionValue = string>(
  items: readonly T[] | null | undefined,
  value: (item: T) => V,
  label: (item: T) => string,
  extra?: (item: T) => Partial<Omit<UiOption<V>, "value" | "label">>,
): UiOption<V>[] {
  return (items ?? []).map((item) => ({
    value: value(item),
    label: label(item),
    ...(extra ? extra(item) : {}),
  }));
}
