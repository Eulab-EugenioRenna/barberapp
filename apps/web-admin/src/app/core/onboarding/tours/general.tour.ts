import { ADMIN_NAV, MOBILE_PRIMARY } from "../../admin-navigation";
import type { TourDefinition, TourStep } from "../tour.types";

const ROLE_INTRO: Record<string, string> = {
  owner: "Come titolare vedi tutta l'attività: agenda, cassa, clienti, catalogo e organizzazione.",
  manager: "Come responsabile gestisci agenda, cassa e squadra delle sedi che ti sono assegnate.",
  platform_admin: "Da qui gestisci le aziende clienti della piattaforma e i loro abbonamenti.",
};

/**
 * Tour of the frame: built from ADMIN_NAV filtered by the same access rules
 * as the menu, so it lists exactly the sections this account can open.
 */
export const GENERAL_TOUR: TourDefinition = {
  id: "general",
  navKey: null,
  title: "Benvenuto",
  // v2: unified till ("Conti da chiudere" is now inside "Cassa").
  version: 2,
  steps: (ctx) => {
    const visible = ADMIN_NAV.filter((entry) => entry.isVisible(ctx.user));
    // On mobile only the bottom bar is on screen; the rest lives under "Altro".
    const onScreen = ctx.isMobile
      ? visible.filter((entry) => MOBILE_PRIMARY.includes(entry.key))
      : visible;
    const offScreen = visible.filter((entry) => !onScreen.includes(entry));
    const steps: TourStep[] = [
      {
        title: ctx.firstName ? `Ciao ${ctx.firstName}, iniziamo!` : "Iniziamo!",
        body:
          `${ROLE_INTRO[ctx.role] ?? "Qui trovi gli strumenti abilitati per il tuo account."}\n` +
          `Ti mostro dove si trova ogni cosa: usa «Avanti» per proseguire, puoi uscire quando vuoi.`,
      },
      {
        target: "shell-scope",
        title: "Sede e attività di lavoro",
        body: "Scegli qui su quale sede e attività stai lavorando: agenda, cassa e magazzino mostrano i dati della selezione.",
      },
      ...onScreen.map<TourStep>((entry) => ({
        target: `nav-${entry.key}`,
        title: entry.label,
        body: entry.description,
      })),
    ];
    if (ctx.isMobile && offScreen.length) {
      steps.push({
        target: "nav-more",
        title: "Altro",
        body:
          "Qui trovi il menu completo e il pulsante per uscire. Contiene anche: " +
          offScreen.map((entry) => entry.label).join(", ") +
          ".",
      });
    }
    if (!ctx.isMobile) {
      steps.push({
        target: "shell-rail",
        title: "Più spazio per lavorare",
        body: "Comprimi il menu a una colonna di icone quando ti serve più spazio; la scelta viene ricordata.",
      });
      steps.push({
        target: "shell-logout",
        title: "Esci",
        body: "Chiude la sessione su questo dispositivo. Usalo sempre su computer condivisi.",
      });
    }
    steps.push({
      target: "page-guide",
      title: "Guida di ogni pagina",
      body:
        "Ogni pagina ha la sua guida passo passo con le azioni disponibili per il tuo account. " +
        "La prima volta si apre da sola; poi la ritrovi sempre su questo pulsante.",
      fallback:
        "Ogni pagina ha la sua guida passo passo con le azioni disponibili per il tuo account: " +
        "cerca il pulsante «Guida» in alto nella pagina.",
    });
    return steps;
  },
};
