/**
 * Open sheets and confirms, bottom to top. Escape closes only the top one,
 * so a confirm opened over a sheet does not close the sheet too.
 */
const stack: object[] = [];

export function pushLayer(layer: object): void {
  stack.push(layer);
}

export function popLayer(layer: object): void {
  const index = stack.lastIndexOf(layer);
  if (index >= 0) stack.splice(index, 1);
}

export function isTopLayer(layer: object): boolean {
  return stack[stack.length - 1] === layer;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

let nextId = 0;
export function nextLayerId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}
