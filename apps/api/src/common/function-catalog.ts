/** Catalogo delle sole capacità operative implementate. Nessuna dipendenza da framework. */
export interface LocalIdentity {
  role: string;
  permissions?: readonly string[];
  permissionsConfigured?: boolean;
  connectFunctions?: readonly string[];
  /** EULab Admin access-as: native owner role grants every implemented function. */
  technicalAccess?: boolean;
  collaboratorId?: string | null;
}
export interface FunctionDefinition {
  key: string;
  /** «Area · Azione», as shown in Connect. */
  name: string;
  /** What it unlocks in ALORA and what it already includes. */
  description: string;
  legacy: boolean;
  aliases?: readonly string[];
  /** Granting this function also grants these (managing includes reading). */
  implies?: readonly string[];
}
// legacy è una concessione transitoria esplicita al titolare, non un default per nuove funzioni.
export const ALORA_FUNCTIONS = [
  {
    key: "dashboard.revenue.read",
    name: "Panoramica · Incassi e andamento",
    description:
      "Sblocca il menu Panoramica: incassi, andamento, attività recenti e report per sede, attività, professionista e cliente.",
    legacy: true,
  },
  {
    key: "appointments.read.all",
    name: "Agenda · Vedere tutta l’agenda",
    description:
      "Sblocca il menu Agenda con gli appuntamenti di tutta la squadra, in calendario e in lista.",
    legacy: true,
  },
  {
    key: "appointments.create",
    name: "Agenda · Prenotare",
    description:
      "Sblocca «Nuovo → Prenota»: scegliere servizi, professionista e orario libero. Include le liste di servizi, clienti e professionisti necessarie alla prenotazione.",
    legacy: true,
  },
  {
    key: "appointments.update.all",
    name: "Agenda · Modificare e annullare",
    description:
      "Spostare, modificare e annullare gli appuntamenti di tutti. Include «Agenda · Vedere tutta l’agenda».",
    legacy: true,
    implies: ["appointments.read.all"],
  },
  {
    key: "appointments.read.own",
    name: "La mia agenda · Vedere",
    description:
      "Sblocca «La mia agenda»: solo gli appuntamenti assegnati alla persona. Richiede che l’utente sia un professionista.",
    legacy: true,
  },
  {
    key: "appointments.update.own",
    name: "La mia agenda · Aggiornare lo stato",
    description:
      "Segnare i propri appuntamenti come arrivati, iniziati o completati. Include «La mia agenda · Vedere».",
    legacy: true,
    implies: ["appointments.read.own"],
  },
  {
    key: "dashboard.personal.values.read",
    name: "La mia agenda · Valore dei miei servizi",
    description:
      "Il professionista vede il valore registrato dei servizi che ha eseguito; esclusi incassi e compensi.",
    legacy: false,
  },
  {
    key: "sales.read",
    name: "Cassa · Vedere i conti",
    description:
      "Sblocca il menu Cassa: conti da chiudere, aperti e registrati, con dettaglio e pagamenti. Comprende il vecchio permesso «Conti da chiudere».",
    legacy: true,
  },
  {
    key: "sales.manage",
    name: "Cassa · Vendere e chiudere i conti",
    description:
      "Sblocca «Nuovo → Vendi adesso»: vendere servizi e prodotti, chiudere, modificare ed eliminare conti, registrare pagamenti. Include «Cassa · Vedere i conti» e le liste di servizi, prodotti, clienti e professionisti necessarie alla vendita.",
    legacy: true,
    implies: ["sales.read"],
  },
  {
    key: "clients.read.full",
    name: "Clienti · Vedere le schede",
    description: "Sblocca il menu Clienti: anagrafiche, note e storico di appuntamenti e conti.",
    legacy: true,
  },
  {
    key: "clients.manage",
    name: "Clienti · Creare e modificare",
    description:
      "Creare, modificare ed eliminare clienti. Include «Clienti · Vedere le schede».",
    legacy: true,
    implies: ["clients.read.full"],
  },
  {
    key: "services.read",
    name: "Listino · Vedere servizi e prodotti",
    description:
      "Sblocca il menu Listino: servizi, prodotti, prezzi e attività. Comprende il vecchio permesso «Consultazione prodotti».",
    legacy: true,
  },
  {
    key: "services.manage",
    name: "Listino · Modificare servizi e prodotti",
    description:
      "Creare e modificare servizi e prodotti, prezzi, barcode e prodotti consigliati. Include «Listino · Vedere servizi e prodotti». Comprende il vecchio permesso «Gestione prodotti».",
    legacy: true,
    implies: ["services.read"],
  },
  {
    key: "inventory.read",
    name: "Magazzino · Vedere le giacenze",
    description:
      "Sblocca il menu Magazzino: giacenze e movimenti delle sedi autorizzate, con ricerca per barcode.",
    legacy: false,
  },
  {
    key: "inventory.manage",
    name: "Magazzino · Carichi e rettifiche",
    description:
      "Registrare giacenze iniziali, carichi, rettifiche, resi e trasferimenti, e attivare il tracciamento sui prodotti. Include «Magazzino · Vedere le giacenze».",
    legacy: false,
    implies: ["inventory.read"],
  },
  {
    key: "locations.read",
    name: "Sedi e attività · Vedere",
    description:
      "Sblocca il menu Sedi e attività: sedi, attività svolte, orari, stanze e chi lavora dove.",
    legacy: false,
  },
  {
    key: "locations.manage",
    name: "Sedi e attività · Configurare",
    description:
      "Creare sedi e attività, orari, chiusure, stanze e assegnare i professionisti; non concede funzioni Connect. Include «Sedi e attività · Vedere».",
    legacy: false,
    implies: ["locations.read"],
  },
  {
    key: "collaborators.read",
    name: "Squadra · Vedere professionisti e orari",
    description: "Sblocca il menu Squadra: professionisti, orari settimanali ed eccezioni.",
    legacy: true,
  },
  {
    key: "collaborators.manage",
    name: "Squadra · Modificare professionisti e orari",
    description:
      "Creare e modificare professionisti, orari ed eccezioni. Include «Squadra · Vedere professionisti e orari».",
    legacy: true,
    implies: ["collaborators.read"],
  },
  {
    key: "users.manage",
    name: "Accessi · Vedere chi accede",
    description:
      "Sblocca la sezione accessi della Squadra: chi può entrare in ALORA, con la possibilità di chiudere le sessioni aperte.",
    legacy: true,
  },
  {
    key: "team.manage",
    name: "Accessi · Ruoli della squadra",
    description:
      "Assegnare ruoli e accesso all’installazione, entro la delega concessa in Connect. Include «Accessi · Vedere chi accede».",
    legacy: false,
    implies: ["users.manage"],
  },
  {
    key: "team.password.reset",
    name: "Accessi · Recupero password",
    description:
      "Inviare a un collaboratore il link per cambiare password, senza vederla né impostarla. Include «Accessi · Vedere chi accede».",
    legacy: false,
    implies: ["users.manage"],
  },
  {
    key: "whatsapp.read",
    name: "WhatsApp · Leggere le conversazioni",
    description:
      "Sblocca il menu WhatsApp: connessione, conversazioni e stato degli invii dell’attività.",
    legacy: false,
  },
  {
    key: "whatsapp.send",
    name: "WhatsApp · Scrivere ai clienti",
    description:
      "Inviare messaggi dal numero collegato. Include «WhatsApp · Leggere le conversazioni».",
    legacy: false,
    implies: ["whatsapp.read"],
  },
  {
    key: "whatsapp.manage",
    name: "WhatsApp · Collegare il numero",
    description:
      "Collegare il numero con il QR, ricollegarlo e scollegarlo. Include «WhatsApp · Leggere le conversazioni».",
    legacy: false,
    implies: ["whatsapp.read"],
  },
  {
    key: "notifications.read",
    name: "Notifiche · Le mie notifiche",
    description: "Ricevere le notifiche e gestire le proprie preferenze di avviso.",
    legacy: true,
    aliases: ["settings.manage"],
  },
  {
    key: "notifications.manage",
    name: "Notifiche · Promemoria e messaggi automatici",
    description:
      "Sblocca il menu Notifiche: promemoria, conferme, modelli dei messaggi e canali di invio. Include «Notifiche · Le mie notifiche».",
    legacy: true,
    aliases: ["settings.manage"],
    implies: ["notifications.read"],
  },
  {
    key: "settings.manage",
    name: "Impostazioni · Attività e prenotazione online",
    description:
      "Sblocca il menu Impostazioni: dati dell’attività, immagine, festività e pagina di prenotazione online.",
    legacy: true,
  },
  {
    key: "audit.read",
    name: "Impostazioni · Registro delle operazioni",
    description: "Consultare chi ha fatto cosa nell’attività (registro di sicurezza).",
    legacy: true,
  },
] as const satisfies readonly FunctionDefinition[];

/**
 * Functions merged into others in version 9. Grants of the old keys (from
 * Connect or local roles) count as the new ones, and code may still ask for
 * them: they resolve to the function that replaced them.
 */
export const MERGED_FUNCTIONS = {
  "products.read": "services.read",
  "products.manage": "services.manage",
  "confirmations.read": "sales.read",
} as const satisfies Readonly<Record<string, (typeof ALORA_FUNCTIONS)[number]["key"]>>;

export type PublishedFunctionKey = (typeof ALORA_FUNCTIONS)[number]["key"];
export type FunctionKey = PublishedFunctionKey | keyof typeof MERGED_FUNCTIONS;
export const FUNCTION_MATRIX_VERSION = 9;

/**
 * Lists needed to sell or book (catalogue, customers, professionals): whoever
 * may sell or book can read them, so no combination leaves an empty form.
 */
export const PICK_LIST_ACCESS = {
  services: ["services.read", "sales.manage", "appointments.create", "appointments.update.all"],
  products: ["services.read", "sales.manage", "inventory.read"],
  customers: ["clients.read.full", "sales.manage", "appointments.create", "appointments.update.all"],
  collaborators: ["collaborators.read", "sales.manage", "appointments.create", "appointments.update.all"],
  agenda: ["appointments.read.all", "appointments.create"],
} as const satisfies Readonly<Record<string, readonly PublishedFunctionKey[]>>;

const DEFINITIONS = new Map<string, FunctionDefinition>(
  ALORA_FUNCTIONS.map((item) => [item.key, item]),
);

/** Current key of a function (old merged keys resolve to their replacement). */
export function resolveFunctionKey(key: string): string {
  return (MERGED_FUNCTIONS as Record<string, string>)[key] ?? key;
}

/** Granted keys plus everything they include (managing includes reading). */
export function expandFunctions(keys: readonly string[] | undefined): Set<string> {
  const result = new Set<string>();
  const queue = (keys ?? []).map(resolveFunctionKey);
  while (queue.length) {
    const key = queue.pop()!;
    if (result.has(key)) continue;
    result.add(key);
    for (const implied of DEFINITIONS.get(key)?.implies ?? []) queue.push(implied);
  }
  return result;
}

export function canUseLocalFunction(
  user: LocalIdentity | null | undefined,
  key: string,
): boolean {
  const target = resolveFunctionKey(key);
  const definition = DEFINITIONS.get(target);
  if (!user || !definition || user.role === "platform_admin") return false;
  // In SSO sessions a local role/alias cannot grant a function denied by Connect.
  const connect = user.connectFunctions ? expandFunctions(user.connectFunctions) : null;
  if (connect && !connect.has(target)) return false;
  if (user.role === "collaborator") {
    if (!user.collaboratorId) return false;
    const own = expandFunctions(user.permissions);
    if (target === "dashboard.personal.values.read")
      return !!user.permissionsConfigured && own.has(target);
    return (
      ["appointments.read.own", "appointments.update.own"].includes(target) &&
      (!user.permissionsConfigured || own.has(target))
    );
  }
  if (user.role === "owner")
    return definition.legacy || user.technicalAccess === true || !!connect?.has(target);
  if (!["manager", "reception"].includes(user.role)) return false;
  const local = expandFunctions(user.permissions);
  return (
    local.has(target) ||
    (definition.aliases ?? []).some((alias) => user.permissions?.includes(alias))
  );
}

/** At least one of the functions (pick lists, alternative entry points). */
export function canUseAnyLocalFunction(
  user: LocalIdentity | null | undefined,
  keys: readonly string[],
): boolean {
  return keys.some((key) => canUseLocalFunction(user, key));
}

/**
 * Every ALORA function is active for this profile (shown as «PRO» next to the
 * logo). A technical "access as" does not count: it opens everything for
 * support, so it would show PRO on accounts that are not.
 */
export function hasAllLocalFunctions(user: LocalIdentity | null | undefined): boolean {
  if (!user) return false;
  const own = { ...user, technicalAccess: false };
  return ALORA_FUNCTIONS.every((item) => canUseLocalFunction(own, item.key));
}

export function requiresOwnAppointmentScope(
  user: LocalIdentity | null | undefined,
  companyPermission: FunctionKey,
): boolean {
  return (
    user?.role === "collaborator" ||
    !canUseLocalFunction(user, companyPermission)
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
  confirmations: "sales.read",
  sales: "sales.read",
  customers: "clients.read.full",
  services: "services.read",
  collaborators: "collaborators.read",
  team: "users.manage",
  settings: "settings.manage",
  locations: "locations.read",
  inventory: "inventory.read",
  whatsapp: "whatsapp.read",
  notifications: "notifications.manage",
};

export function canAccessLocalView(
  user: LocalIdentity | null | undefined,
  view: string,
): boolean {
  if (view === "collaborators")
    return (
      canUseLocalFunction(user, "collaborators.read") ||
      canUseLocalFunction(user, "users.manage")
    );
  return canUseLocalFunction(user, VIEW_FUNCTIONS[view]);
}
