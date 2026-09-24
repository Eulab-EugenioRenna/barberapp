const FIRST_CONTROL_SELECTOR = [
  "input:not([disabled]):not([readonly]):not([type='hidden'])",
  "textarea:not([disabled]):not([readonly])",
  "select:not([disabled])",
  "[role='combobox'][tabindex='0']",
  ".calendar-trigger:not([disabled])",
].join(",");

export function focusFirstAvailableControl(root: HTMLElement): boolean {
  const control = root.querySelector<HTMLElement>(FIRST_CONTROL_SELECTOR);
  if (!control) {
    return false;
  }

  control.focus({ preventScroll: true });
  return true;
}

export function restoreFocus(target: HTMLElement | null): boolean {
  if (!target?.isConnected) {
    return false;
  }

  target.focus({ preventScroll: true });
  return true;
}
