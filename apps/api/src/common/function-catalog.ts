/** Catalogo delle sole capacità operative implementate. Nessuna dipendenza da framework. */
export interface LocalIdentity {
  role: string;
  permissions?: readonly string[];
  permissionsConfigured?: boolean;
  connectFunctions?: readonly string[];
  collaboratorId?: string | null;
}
export interface FunctionDefinition {
  key: string;
  name: string;
  description: string;
  legacy: boolean;
  aliases?: readonly string[];
}
// legacy è una concessione transitoria esplicita al titolare, non un default per nuove funzioni.
export const ALORA_FUNCTIONS = [
  {
    key: "appointments.read.all",
    name: "Agenda aziendale",
    description: "Consultare gli appuntamenti aziendali.",
    legacy: true,
  },
  {
    key: "appointments.read.own",
    name: "Agenda personale",
    description: "Consultare soltanto gli appuntamenti assegnati.",
    legacy: true,
  },
  {
    key: "appointments.create",
    name: "Creazione appuntamenti",
    description: "Prenotare un appuntamento.",
    legacy: true,
  },
  {
    key: "appointments.update.all",
    name: "Gestione appuntamenti",
    description: "Modificare e annullare gli appuntamenti aziendali.",
    legacy: true,
  },
  {
    key: "appointments.update.own",
    name: "Esecuzione personale",
    description: "Aggiornare lo stato degli appuntamenti assegnati.",
    legacy: true,
  },
  {
    key: "clients.read.full",
    name: "Consultazione clienti",
    description: "Consultare anagrafiche e storico aziendali.",
    legacy: true,
  },
  {
    key: "clients.manage",
    name: "Gestione clienti",
    description: "Creare, modificare ed eliminare clienti.",
    legacy: true,
  },
  {
    key: "services.read",
    name: "Consultazione listino",
    description: "Consultare i servizi aziendali.",
    legacy: true,
  },
  {
    key: "services.manage",
    name: "Gestione listino",
    description: "Modificare servizi e associazioni ai prodotti.",
    legacy: true,
  },
  {
    key: "products.read",
    name: "Consultazione prodotti",
    description: "Consultare il catalogo prodotti.",
    legacy: true,
  },
  {
    key: "products.manage",
    name: "Gestione prodotti",
    description:
      "Modificare il catalogo prodotti, senza gestione delle giacenze.",
    legacy: true,
  },
  {
    key: "collaborators.read",
    name: "Consultazione squadra",
    description: "Consultare professionisti e orari.",
    legacy: true,
  },
  {
    key: "collaborators.manage",
    name: "Gestione squadra",
    description: "Modificare professionisti e orari.",
    legacy: true,
  },
  {
    key: "sales.read",
    name: "Consultazione vendite",
    description: "Consultare conti e righe delle vendite.",
    legacy: true,
  },
  {
    key: "sales.manage",
    name: "Gestione vendite",
    description: "Creare, modificare ed eliminare conti e righe.",
    legacy: true,
  },
  {
    key: "dashboard.revenue.read",
    name: "Report aziendali",
    description: "Consultare andamento, attività e aggregazioni aziendali.",
    legacy: true,
  },
  {
    key: "settings.manage",
    name: "Impostazioni aziendali",
    description: "Gestire impostazioni, immagine e prenotazione pubblica.",
    legacy: true,
  },
  {
    key: "users.manage",
    name: "Utenze locali",
    description: "Elencare le utenze e revocarne le sessioni.",
    legacy: true,
  },
  {
    key: "team.manage",
    name: "Ruoli e accessi della squadra",
    description: "Gestire ruoli, assegnazioni e accesso alla sola installazione entro la delega Connect.",
    legacy: false,
  },
  {
    key: "audit.read",
    name: "Consultazione audit",
    description: "Consultare le operazioni registrate per la propria azienda.",
    legacy: true,
  },
  {
    key: "notifications.read",
    name: "Notifiche personali",
    description: "Consultare inbox e preferenze personali.",
    legacy: true,
    aliases: ["settings.manage"],
  },
  {
    key: "notifications.manage",
    name: "Gestione notifiche",
    description: "Gestire provider, template, preferenze aziendali ed eventi.",
    legacy: true,
    aliases: ["settings.manage"],
  },
  {
    key: "confirmations.read",
    name: "Conti da chiudere",
    description: "Ricevere gli appuntamenti aziendali in attesa di conto.",
    legacy: true,
    aliases: ["settings.manage"],
  },
] as const satisfies readonly FunctionDefinition[];
export type FunctionKey = (typeof ALORA_FUNCTIONS)[number]["key"];
export const FUNCTION_MATRIX_VERSION = 2;
export function canUseLocalFunction(
  user: LocalIdentity | null | undefined,
  key: string,
): boolean {
  const definition: FunctionDefinition | undefined = ALORA_FUNCTIONS.find(
    (item) => item.key === key,
  );
  if (!user || !definition || user.role === "platform_admin") return false;
  // In SSO sessions a local role/alias cannot grant a function denied by Connect.
  if (user.connectFunctions && !user.connectFunctions.includes(key))
    return false;
  if (user.role === "collaborator")
    return (
      !!user.collaboratorId &&
      ["appointments.read.own", "appointments.update.own"].includes(key) &&
      (!user.permissionsConfigured || !!user.permissions?.includes(key))
    );
  if (user.role === "owner")
    return definition.legacy || !!user.connectFunctions?.includes(key);
  if (!["manager", "reception"].includes(user.role)) return false;
  return [key, ...(definition.aliases ?? [])].some((permission) =>
    user.permissions?.includes(permission),
  );
}
export function createFunctionMatrix(appId: string) {
  if (!/^[a-z][a-z0-9_.:-]{0,79}$/.test(appId))
    throw new Error("ALORA_CONNECT_APP_ID non valido");
  return {
    schemaVersion: 1 as const,
    appId,
    version: FUNCTION_MATRIX_VERSION,
    functions: ALORA_FUNCTIONS.map(({ key, name, description }) => ({
      key,
      name,
      description,
    })),
  };
}
export const VIEW_FUNCTIONS: Readonly<Record<string, FunctionKey>> = {
  dashboard: "dashboard.revenue.read",
  appointments: "appointments.read.all",
  confirmations: "confirmations.read",
  sales: "sales.read",
  customers: "clients.read.full",
  services: "services.read",
  collaborators: "collaborators.read",
  team: "users.manage",
  settings: "settings.manage",
};

export function canAccessLocalView(
  user: LocalIdentity | null | undefined,
  view: string,
): boolean {
  if (view === "services")
    return (
      canUseLocalFunction(user, "services.read") ||
      canUseLocalFunction(user, "products.read")
    );
  return canUseLocalFunction(user, VIEW_FUNCTIONS[view]);
}
