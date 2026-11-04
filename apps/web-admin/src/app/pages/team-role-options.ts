/** Product choices; Connect remains the authority for every function in a choice. */
export const COLLABORATOR_FUNCTIONS = [
  "appointments.read.own",
  "appointments.update.own",
];
export const PERSONAL_FUNCTIONS = [
  ...COLLABORATOR_FUNCTIONS,
  "dashboard.personal.values.read",
];
export const ROLE_OPTIONS = [
  {
    id: "recovery",
    name: "Recupero accessi",
    description:
      "Gestire gli accessi della squadra e richiedere un link di cambio password per i collaboratori amministrabili.",
    keys: ["users.manage", "team.manage", "team.password.reset"],
  },
  {
    id: "personal",
    name: "Le proprie attività",
    description: "Agenda personale e stato dei servizi assegnati.",
    keys: COLLABORATOR_FUNCTIONS,
  },
  {
    id: "personal-values",
    name: "Valore dei propri servizi",
    description:
      "Valori dei servizi attribuiti alla persona, senza incassi o compensi.",
    keys: ["dashboard.personal.values.read"],
  },
  {
    id: "agenda",
    name: "Agenda del salone",
    description:
      "Consultare, creare e modificare gli appuntamenti di tutta la squadra.",
    keys: [
      "appointments.read.all",
      "appointments.create",
      "appointments.update.all",
    ],
  },
  {
    id: "clients",
    name: "Clienti",
    description: "Consultare e gestire la rubrica aziendale.",
    keys: ["clients.read.full", "clients.manage"],
  },
  {
    id: "cash",
    name: "Cassa",
    description: "Gestire conti, vendite e conti da chiudere.",
    keys: ["sales.read", "sales.manage", "confirmations.read"],
  },
  {
    id: "catalog",
    name: "Servizi e prodotti",
    description: "Consultare e modificare il catalogo del salone.",
    keys: [
      "services.read",
      "services.manage",
      "products.read",
      "products.manage",
    ],
  },
  {
    id: "team",
    name: "Gestione della squadra",
    description: "Professionisti, orari, ruoli e accessi delle persone.",
    keys: [
      "collaborators.read",
      "collaborators.manage",
      "users.manage",
      "team.manage",
    ],
  },
  {
    id: "reports",
    name: "Andamento del salone",
    description: "Consultare i report e i valori economici aziendali.",
    keys: ["dashboard.revenue.read"],
  },
  {
    id: "settings",
    name: "Impostazioni e comunicazioni",
    description:
      "Configurazione del salone, notifiche e registro delle operazioni.",
    keys: [
      "settings.manage",
      "notifications.read",
      "notifications.manage",
      "audit.read",
    ],
  },
];
export function sameFunctions(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return (
    JSON.stringify([...new Set(a)].sort()) ===
    JSON.stringify([...new Set(b)].sort())
  );
}
export function roleScope(keys: readonly string[]): "collaborator" | "manager" {
  return keys.every((key) => PERSONAL_FUNCTIONS.includes(key))
    ? "collaborator"
    : "manager";
}
export function changeRoleOption(
  current: string[],
  option: (typeof ROLE_OPTIONS)[number],
  enabled: boolean,
): string[] {
  const next = enabled
    ? [...new Set([...current, ...option.keys])]
    : current.filter((key) => !option.keys.includes(key));
  if (enabled && option.id === "personal-values")
    return [...new Set([...next, ...COLLABORATOR_FUNCTIONS])];
  if (!enabled && option.id === "personal")
    return next.filter((key) => key !== "dashboard.personal.values.read");
  if (!enabled && option.id === "team")
    return next.filter((key) => key !== "team.password.reset");
  return next;
}
