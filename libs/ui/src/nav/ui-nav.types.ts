import type { UiIconName } from "../icon/ui-icon.component";

/** One destination. `key` is opaque to the design system. */
export interface UiNavItem {
  key: string;
  label: string;
  /** Short label for compact surfaces (bottom bar). */
  short?: string;
  /** One-line explanation shown under the label in the expanded sidebar. */
  hint?: string;
  icon: UiIconName;
  /** Counter shown on the icon; hidden when 0 or undefined. */
  badge?: number;
}

/** A labelled group of destinations (e.g. "Oggi", "Catalogo"). */
export interface UiNavGroup {
  id: string;
  label: string;
  items: UiNavItem[];
}
