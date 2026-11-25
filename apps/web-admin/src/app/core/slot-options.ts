/**
 * Opening and working hours are for the public. Staff may book outside them:
 * those slots come flagged `outsideHours` and are listed after the others.
 */
export function slotOptions(
  slots: Array<{ startsAt: string; label: string; outsideHours?: boolean }>,
): Array<{ value: string; label: string; group?: string }> {
  const inside = slots.filter((slot) => !slot.outsideHours);
  const outside = slots.filter((slot) => slot.outsideHours);
  if (!outside.length)
    return inside.map((slot) => ({ value: slot.startsAt, label: slot.label }));
  return [
    ...inside.map((slot) => ({
      value: slot.startsAt,
      label: slot.label,
      group: "In orario",
    })),
    ...outside.map((slot) => ({
      value: slot.startsAt,
      label: slot.label,
      group: "Fuori orario · non prenotabile online",
    })),
  ];
}
