export function getValueByPath(
  source: Record<string, unknown>,
  path: string,
): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    return Object.prototype.hasOwnProperty.call(value, key)
      ? (value as Record<string, unknown>)[key]
      : undefined;
  }, source);
}

export function renderTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_, path: string) => {
    const value = getValueByPath(context, path);

    if (value === null || value === undefined) {
      return "";
    }

    return ["string", "number", "boolean"].includes(typeof value) ? String(value) : "";
  });
}
