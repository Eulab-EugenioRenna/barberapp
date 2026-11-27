export type SetupKey = "location" | "services" | "team" | "customers" | "whatsapp" | "reminders" | "online";
export interface SetupStep { key: SetupKey; done: boolean; blockedBy: SetupKey | null; optional: boolean; detail: string | null }
export interface SetupStatus { steps: SetupStep[]; completed: number; total: number }

/** Page where each step is done: a step is offered only to who can open it. */
export const SETUP_STEP_VIEW: Record<SetupKey, string> = {
  location: "locations",
  services: "services",
  team: "collaborators",
  customers: "customers",
  whatsapp: "whatsapp",
  reminders: "notifications",
  online: "settings",
};

/**
 * «Primi passi» as this account can act on it: steps of functions not granted
 * are left out, and the card disappears once the essential steps are done.
 * Returns null when there is nothing to show.
 */
export function visibleSetup(status: SetupStatus | null, canView: (view: string) => boolean): SetupStatus | null {
  if (!status?.steps?.length) return null;
  const steps = status.steps.filter((step) => canView(SETUP_STEP_VIEW[step.key]));
  const essentials = steps.filter((step) => !step.optional);
  if (!steps.length || (essentials.length > 0 && essentials.every((step) => step.done))) return null;
  const completed = steps.filter((step) => step.done).length;
  if (completed === steps.length) return null;
  return { steps, completed, total: steps.length };
}
