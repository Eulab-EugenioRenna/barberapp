import type { TourDefinition } from "../tour.types";

/** Guide of the customers page: search, customer card and history. */
export const CUSTOMERS_TOUR: TourDefinition = {
  id: "customers",
  navKey: "customers",
  title: "Clienti",
  version: 3,
  when: (ctx) => ctx.canView("customers"),
  steps: (ctx) => {
    const canManage = ctx.can("clients.manage");
    return [
      {
        title: "Le schede dei tuoi clienti",
        body: canManage
          ? "Qui trovi tutti i clienti dell'attività: contatti, tag, note e lo storico di prenotazioni e acquisti. Puoi crearli, aggiornarli ed eliminarli."
          : "Qui consulti i clienti dell'attività: contatti, tag, note e lo storico di prenotazioni e acquisti. Il tuo account può leggere le schede ma non modificarle.",
      },
      {
        target: "customers-search",
        title: "Cerca un cliente",
        body: "Scrivi nome, email o telefono: la ricerca parte da sola dopo un attimo e cerca in tutto l'archivio, non solo nella pagina caricata.",
      },
      {
        target: "customers-list",
        title: "Elenco clienti",
        body:
          "Ogni scheda mostra contatti e tag: in blu quelli automatici (sedute, appuntamenti completati, spesa), in grigio quelli inseriti a mano. " +
          "Scorrendo in fondo si caricano altri clienti.",
      },
      {
        target: "customers-list",
        title: "Apri la scheda",
        body: canManage
          ? "Tocca un cliente: a sinistra l'anagrafica da modificare, a destra lo storico con speso, visite, ultima e prossima visita. Nello storico cerchi per servizio, prodotto, professionista o note e filtri per tipo (appuntamenti o conti) e periodo; tocca una voce per il dettaglio."
          : "Tocca un cliente: a sinistra l'anagrafica, a destra lo storico con speso, visite, ultima e prossima visita. Nello storico cerchi e filtri per tipo e periodo; tocca una voce per il dettaglio.",
      },
      {
        target: "customers-new",
        title: "Nuovo cliente",
        body: "Apre il modulo di inserimento: nome e cognome sono obbligatori, email, telefono, tag (separati da virgola) e note sono facoltativi.",
        when: (c) => c.can("clients.manage"),
      },
      {
        target: "customers-whatsapp-all",
        title: "Messaggio a tutti",
        body: "Invia lo stesso messaggio WhatsApp, dal tuo numero collegato, a tutti i clienti con telefono e consenso marketing. Per un solo cliente usa «Invia messaggio» nella sua scheda.",
        when: (c) => c.can("whatsapp.send"),
      },
      {
        title: canManage ? "Modifiche ed eliminazione" : "Tutto pronto",
        body: canManage
          ? "Dalla scheda aperta salvi le modifiche con «Salva»; «Elimina» chiede sempre conferma prima di cancellare il contatto."
          : "Per creare o modificare clienti chiedi al titolare di abilitare la gestione clienti sul tuo account.",
      },
    ];
  },
};
