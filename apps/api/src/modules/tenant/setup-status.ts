/** First-run steps of a business, in the order they unlock each other. */
export type SetupStepKey = "location" | "services" | "team" | "customers" | "whatsapp" | "reminders" | "online";
export interface SetupStepView {
  key: SetupStepKey;
  done: boolean;
  /** Step that must be done first; null when available now. */
  blockedBy: SetupStepKey | null;
  optional: boolean;
  /** Short count or state shown next to the step («2 servizi»). */
  detail: string | null;
}
export interface SetupStatusView { steps: SetupStepView[]; completed: number; total: number }

export interface SetupFacts {
  locations: number; services: number; collaborators: number; scheduledCollaborators: number;
  customers: number; whatsapp: boolean; remindersActive: boolean; online: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Pure: the order and the prerequisites live here, so the UI only renders them. */
export function setupSteps(f: SetupFacts): SetupStatusView {
  const done: Record<SetupStepKey, boolean> = {
    location: f.locations > 0,
    services: f.services > 0,
    team: f.collaborators > 0 && f.scheduledCollaborators > 0,
    customers: f.customers > 0,
    whatsapp: f.whatsapp,
    reminders: f.remindersActive,
    online: f.online,
  };
  const requires: Record<SetupStepKey, SetupStepKey[]> = {
    location: [], services: ["location"], team: ["services"], customers: [],
    whatsapp: [], reminders: ["team", "whatsapp"], online: ["team"],
  };
  // A prerequisite counts only through its own chain: team needs services, which needs a location.
  const firstMissing = (key: SetupStepKey): SetupStepKey | null => {
    for (const dep of requires[key]) {
      const deeper = firstMissing(dep);
      if (deeper) return deeper;
      if (!done[dep]) return dep;
    }
    return null;
  };
  const detail: Record<SetupStepKey, string | null> = {
    location: f.locations ? plural(f.locations, "sede", "sedi") : null,
    services: f.services ? plural(f.services, "servizio", "servizi") : null,
    team: f.collaborators ? `${plural(f.collaborators, "collaboratore", "collaboratori")}, ${f.scheduledCollaborators} con orari` : null,
    customers: f.customers ? plural(f.customers, "cliente", "clienti") : null,
    whatsapp: f.whatsapp ? "Collegato" : null,
    reminders: f.remindersActive ? "Attivi" : null,
    online: f.online ? "Attive" : null,
  };
  const order: SetupStepKey[] = ["location", "services", "team", "customers", "whatsapp", "reminders", "online"];
  const optional = new Set<SetupStepKey>(["customers", "whatsapp", "reminders", "online"]);
  const steps = order.map((key) => ({
    key, done: done[key], blockedBy: done[key] ? null : firstMissing(key), optional: optional.has(key), detail: detail[key],
  }));
  return { steps, completed: steps.filter((s) => s.done).length, total: steps.length };
}
