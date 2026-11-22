import type { UiIconName, UiNavGroup, UiNavItem } from "@alora/ui";
import {
  canAccessLocalView,
  canUseLocalFunction,
} from "@barber/shared/functions";

/**
 * Single source of the admin information architecture. Sidebar, bottom bar,
 * "more" drawer and page headers all read from here, so a section has exactly
 * one name, one icon, one description and one access rule.
 */
export type AdminNavKey =
  | "dashboard"
  | "appointments"
  | "sales"
  | "customers"
  | "whatsapp"
  | "services"
  | "inventory"
  | "locations"
  | "collaborators"
  | "notifications"
  | "settings"
  | "my-agenda"
  | "account"
  | "platform";

export interface AdminNavEntry {
  key: AdminNavKey;
  group: AdminNavGroupId;
  label: string;
  short?: string;
  hint: string;
  /** Page header description: what the user does on this page. */
  description: string;
  icon: UiIconName;
  isVisible: (user: any) => boolean;
}

export type AdminNavGroupId =
  | "today"
  | "clients"
  | "catalog"
  | "organization"
  | "personal"
  | "platform";

const GROUP_LABELS: Record<AdminNavGroupId, string> = {
  today: "Oggi",
  clients: "Clienti",
  catalog: "Catalogo",
  organization: "Organizzazione",
  personal: "Il mio lavoro",
  platform: "Piattaforma",
};

const isPlatformAdmin = (user: any) => user?.role === "platform_admin";
// Mirrors authGuard: collaborators are always sent to their personal agenda.
const isCompanyUser = (user: any) =>
  !!user && !isPlatformAdmin(user) && user.role !== "collaborator";
const companyView = (view: string) => (user: any) =>
  isCompanyUser(user) && canAccessLocalView(user, view);
const companyFunction = (key: string) => (user: any) =>
  isCompanyUser(user) && canUseLocalFunction(user, key);

export const ADMIN_NAV: readonly AdminNavEntry[] = [
  {
    key: "dashboard",
    group: "today",
    label: "Panoramica",
    short: "Oggi",
    hint: "andamento",
    description: "Come sta andando la giornata: incassi, appuntamenti e squadra.",
    icon: "overview",
    isVisible: companyView("dashboard"),
  },
  {
    key: "appointments",
    group: "today",
    label: "Agenda",
    hint: "appuntamenti",
    description: "Appuntamenti del giorno e della settimana, per professionista.",
    icon: "calendar",
    isVisible: companyView("appointments"),
  },
  {
    key: "sales",
    group: "today",
    label: "Cassa",
    hint: "conti e incassi",
    description:
      "Tutti i conti in un posto: da chiudere, aperti e registrati, con o senza appuntamento.",
    icon: "cash",
    isVisible: companyView("sales"),
  },
  {
    key: "customers",
    group: "clients",
    label: "Clienti",
    hint: "schede e storico",
    description: "Schede cliente, contatti e storico di prenotazioni e acquisti.",
    icon: "users",
    isVisible: companyView("customers"),
  },
  {
    key: "whatsapp",
    group: "clients",
    label: "Messaggi WhatsApp",
    short: "WhatsApp",
    hint: "conversazioni",
    description: "Il tuo numero WhatsApp: collegamento, conversazioni e invii.",
    icon: "chat",
    isVisible: companyView("whatsapp"),
  },
  {
    key: "services",
    group: "catalog",
    label: "Listino",
    hint: "servizi, prodotti e prezzi",
    description: "Servizi offerti, prodotti in vendita e regole di prezzo.",
    icon: "scissors",
    isVisible: companyView("services"),
  },
  {
    key: "inventory",
    group: "catalog",
    label: "Magazzino",
    hint: "giacenze e barcode",
    description: "Giacenze per sede, carichi, scarichi e lettura barcode.",
    icon: "box",
    isVisible: companyView("inventory"),
  },
  {
    key: "locations",
    group: "organization",
    label: "Sedi e attività",
    hint: "barberia, estetica",
    description: "Le sedi e le attività di ciascuna (barberia, estetica), con chi ci lavora.",
    icon: "map-pin",
    isVisible: companyView("locations"),
  },
  {
    key: "collaborators",
    group: "organization",
    label: "Squadra e accessi",
    hint: "persone e ruoli",
    description: "Professionisti, orari, ruoli e accesso al gestionale.",
    icon: "team",
    isVisible: companyView("collaborators"),
  },
  {
    key: "notifications",
    group: "organization",
    label: "Promemoria e notifiche",
    hint: "messaggi automatici",
    description: "Promemoria automatici degli appuntamenti e testi dei messaggi.",
    icon: "bell",
    isVisible: companyFunction("notifications.manage"),
  },
  {
    key: "settings",
    group: "organization",
    label: "Profilo e prenotazioni",
    hint: "immagine e pagina online",
    description: "Nome, logo e immagini dell'attività, pagina di prenotazione online.",
    icon: "store",
    isVisible: companyView("settings"),
  },
  {
    key: "my-agenda",
    group: "personal",
    label: "La mia agenda",
    hint: "i miei appuntamenti",
    description: "I tuoi appuntamenti, i tuoi orari e il lavoro del periodo.",
    icon: "agenda",
    isVisible: (user) =>
      !isPlatformAdmin(user) &&
      !!user?.collaboratorId &&
      canUseLocalFunction(user, "appointments.read.own"),
  },
  {
    key: "account",
    group: "personal",
    label: "Il mio account",
    hint: "profilo e sicurezza",
    description: "I tuoi dati, la password, le sessioni e i dispositivi.",
    icon: "user",
    isVisible: (user) => !!user && !isPlatformAdmin(user) && !user.technicalAccess,
  },
  {
    key: "platform",
    group: "platform",
    label: "Gestione aziende",
    hint: "aziende e abbonamenti",
    description: "Aziende clienti, piani e abbonamenti della piattaforma.",
    icon: "building",
    isVisible: isPlatformAdmin,
  },
];

/** Destinations of the mobile bottom bar, in order; the rest go under "Altro". */
export const MOBILE_PRIMARY: readonly AdminNavKey[] = [
  "dashboard",
  "appointments",
  "sales",
  "customers",
];

export function findNavEntry(key: string | null | undefined): AdminNavEntry | undefined {
  return ADMIN_NAV.find((entry) => entry.key === key);
}

export function navKeyFromUrl(url: string): AdminNavKey | null {
  const segment = url.split(/[?#]/)[0].split("/").filter(Boolean)[0] ?? "";
  if (segment === "team") return "collaborators";
  // Former "Conti da chiudere": now part of the till.
  if (segment === "confirmations") return "sales";
  return findNavEntry(segment)?.key ?? null;
}

export function buildNavGroups(
  user: any,
  badges: Partial<Record<AdminNavKey, number>> = {},
): UiNavGroup[] {
  const groups: UiNavGroup[] = [];
  for (const entry of ADMIN_NAV) {
    if (!entry.isVisible(user)) continue;
    let group = groups.find((candidate) => candidate.id === entry.group);
    if (!group) {
      group = { id: entry.group, label: GROUP_LABELS[entry.group], items: [] };
      groups.push(group);
    }
    group.items.push(toNavItem(entry, badges[entry.key]));
  }
  return groups;
}

/** Personal destinations used when none of MOBILE_PRIMARY is available. */
export const MOBILE_PERSONAL: readonly AdminNavKey[] = ["my-agenda", "account"];

/**
 * Bottom bar destinations. Never empty for a signed-in user: the bar also
 * hosts "Altro", the only way to open the full menu (and logout) on mobile.
 */
export function buildMobileItems(
  user: any,
  badges: Partial<Record<AdminNavKey, number>> = {},
): UiNavItem[] {
  const pick = (keys: readonly AdminNavKey[]) =>
    keys
      .map((key) => findNavEntry(key)!)
      .filter((entry) => entry.isVisible(user))
      .map((entry) => toNavItem(entry, badges[entry.key]));
  const primary = pick(MOBILE_PRIMARY);
  return primary.length ? primary : pick(MOBILE_PERSONAL);
}

export function navGroupLabel(entry: AdminNavEntry): string {
  return GROUP_LABELS[entry.group];
}

function toNavItem(entry: AdminNavEntry, badge?: number): UiNavItem {
  return {
    key: entry.key,
    label: entry.label,
    short: entry.short,
    hint: entry.hint,
    icon: entry.icon,
    badge: badge || undefined,
  };
}
